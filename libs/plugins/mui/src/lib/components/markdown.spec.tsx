/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Aglyn from '@aglyn/aglyn'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import Markdown, {
  MARKDOWN_ID,
  TABLE_OF_CONTENTS_ID,
  TableOfContents,
  markdownSchema,
  resolveMarkdownSource,
  scrollToHeading,
  tableOfContentsSchema,
} from './markdown'

const DOC =
  '# Privacy Policy\n\nHow we handle your data.\n\n' +
  '## Your Rights & Choices\n\nYou may ask us to delete it.\n\n' +
  '### Retention\n\nWe keep it for 30 days.\n\n' +
  '## Your Rights & Choices\n\nSaid twice, on purpose.'

/**
 * A screen tree, the way every render surface holds one: a flat node map
 * filled into the shared canvas singleton (the tenant page, the console's
 * Preview and the besigner all do exactly this before rendering).
 */
const fillCanvas = (
  nodes: Array<{ $id: string; componentId?: string; props?: any }>,
) => {
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      type: Aglyn.NodeType.NODE,
      componentId: 'box',
      nodes: nodes.map((node) => node.$id),
    },
    ...Object.fromEntries(
      nodes.map((node) => [
        node.$id,
        {
          $id: node.$id,
          type: Aglyn.NodeType.NODE,
          parentId: Aglyn.NODE_ROOT_ID,
          componentId: node.componentId ?? MARKDOWN_ID,
          props: node.props ?? {},
        },
      ]),
    ),
  } as any)
}

afterEach(() => Aglyn.canvas.clearNodes())

describe('Markdown element (AGL-1162)', () => {
  it('renders real headings, not a paragraph painted to look like one', () => {
    // The trap the marketing applier already hit: an sx fontSize with no
    // `component` screenshots correctly and leaves the page with no
    // headings in it at all — and here it would also leave the TOC
    // pointing at nothing.
    render(<Markdown content={DOC} />)
    // `#` clamps to the top RENDERED level (AGL-1082), so a document opening
    // the way every source file does still starts with a real heading.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    const tops = screen.getAllByRole('heading', { level: 2 })
    expect(tops.map((node) => node.textContent)).toEqual([
      'Privacy Policy',
      'Your Rights & Choices',
      'Your Rights & Choices',
    ])
    expect(
      screen.getByRole('heading', { level: 3 }).textContent,
    ).toBe('Retention')
  })

  it('gives every heading the anchor id a TOC links to, duplicates included', () => {
    const { container } = render(<Markdown content={DOC} />)
    expect(
      Array.from(container.querySelectorAll('h2, h3')).map((node) => node.id),
    ).toEqual([
      'privacy-policy',
      'your-rights-choices',
      'retention',
      'your-rights-choices-2',
    ])
  })

  it('renders links and marks as elements, never as markup text', () => {
    const { container } = render(
      <Markdown content={'Read the **terms** at [example](https://example.com).'} />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('terms')
    const link = screen.getByRole('link', { name: 'example' })
    expect(link.getAttribute('href')).toBe('https://example.com')
    // The parser emits data blocks, never an HTML string — a document that
    // contains markup must render that markup as words.
    const { container: raw } = render(
      <Markdown content={'<img src=x onerror="alert(1)"> plain'} />,
    )
    expect(raw.querySelector('img')).toBeNull()
    expect(raw.textContent).toContain('<img src=x onerror="alert(1)"> plain')
  })

  it('renders nothing on a published page when it has no content', () => {
    const { container } = render(<Markdown content="   " />)
    expect(container.textContent).toBe('')
  })

  it('names itself on editing surfaces when it has no content', () => {
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <Markdown />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByText(/paste the document/i)).toBeTruthy()
  })
})

describe('resolveMarkdownSource (AGL-1162)', () => {
  it('takes the first Markdown element in DOCUMENT order', () => {
    fillCanvas([
      { $id: 'aside', componentId: TABLE_OF_CONTENTS_ID, props: {} },
      { $id: 'doc1', props: { content: '## First' } },
      { $id: 'doc2', props: { content: '## Second' } },
    ])
    expect(resolveMarkdownSource(Aglyn.canvas.rootNode)).toBe('## First')
  })

  it('honours an explicit pick', () => {
    fillCanvas([
      { $id: 'doc1', props: { content: '## First' } },
      { $id: 'doc2', props: { content: '## Second' } },
    ])
    expect(resolveMarkdownSource(Aglyn.canvas.rootNode, 'doc2')).toBe(
      '## Second',
    )
  })

  it('matches a pick across a composition namespace', () => {
    // The tenant composes a layout's nodes under a `layout__` prefix
    // (AGL-573), so the stored raw canvas id never equals the live id.
    fillCanvas([{ $id: 'layout__doc2', props: { content: '## Second' } }])
    expect(resolveMarkdownSource(Aglyn.canvas.rootNode, 'doc2')).toBe(
      '## Second',
    )
  })

  it('falls back to the first element when the pick no longer exists', () => {
    // Deleting and re-adding the Markdown element is what re-pasting a
    // document looks like; an empty published aside is the worse answer.
    fillCanvas([{ $id: 'doc1', props: { content: '## First' } }])
    expect(resolveMarkdownSource(Aglyn.canvas.rootNode, 'gone')).toBe(
      '## First',
    )
  })

  it('is empty when the screen has no Markdown element', () => {
    fillCanvas([{ $id: 'aside', componentId: TABLE_OF_CONTENTS_ID }])
    expect(resolveMarkdownSource(Aglyn.canvas.rootNode)).toBe('')
    expect(resolveMarkdownSource(undefined)).toBe('')
  })
})

describe('Table of contents element (AGL-1162)', () => {
  it('lists the headings of the markdown on the same screen', () => {
    fillCanvas([{ $id: 'doc1', props: { content: DOC } }])
    render(<TableOfContents />)
    expect(
      screen.getAllByRole('link').map((node) => [
        node.textContent,
        node.getAttribute('href'),
      ]),
    ).toEqual([
      ['Privacy Policy', '#privacy-policy'],
      ['Your Rights & Choices', '#your-rights-choices'],
      ['Retention', '#retention'],
      ['Your Rights & Choices', '#your-rights-choices-2'],
    ])
  })

  it('can list top-level headings only', () => {
    fillCanvas([{ $id: 'doc1', props: { content: DOC } }])
    render(<TableOfContents depth="2" />)
    expect(
      screen.queryByRole('link', { name: 'Retention' }),
    ).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(3)
  })

  it('leaves an in-document anchor to the browser', () => {
    // The published page: a plain `#slug` anchor already does this better —
    // it updates the address bar, pushes history and honours the site's CSS
    // scroll-behaviour. Handling it here would take all of that away, and a
    // browser that declines to animate would leave the page unmoved.
    fillCanvas([{ $id: 'doc1', props: { content: DOC } }])
    render(
      <>
        <TableOfContents />
        <Markdown content={DOC} />
      </>,
    )
    const link = screen.getByRole('link', { name: 'Retention' })
    expect(scrollToHeading(link, 'retention')).toBe(false)
    const event = createEvent.click(link)
    fireEvent(link, event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('scrolls to the heading itself inside a shadow root', () => {
    // The besigner canvas: the heading is not in `document`, so fragment
    // navigation finds nothing and this is the only thing that works.
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const anchor = document.createElement('a')
    const heading = document.createElement('h3')
    heading.id = 'retention'
    shadow.append(anchor, heading)
    const scrolled: string[] = []
    // jsdom has no layout, so the assertion is "the right element was asked
    // to scroll" — which is the part that breaks when slugs drift.
    heading.scrollIntoView = function scrollIntoViewStub() {
      scrolled.push(this.id)
    } as never
    expect(scrollToHeading(anchor, 'retention')).toBe(true)
    expect(scrolled).toEqual(['retention'])
    // A slug with no heading behind it is still the browser's problem.
    expect(scrollToHeading(anchor, 'nowhere')).toBe(false)
    host.remove()
  })

  it('says what it needs while authoring and stays quiet once published', () => {
    fillCanvas([{ $id: 'doc1', props: { content: 'prose with no headings' } }])
    render(<TableOfContents />)
    expect(screen.getByText(/add ## headings/i)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('markdown schemas (AGL-1162)', () => {
  it('keeps the persisted component ids', () => {
    // Ids live in every screen document that ever used these elements.
    expect(markdownSchema.$id).toBe('markdown')
    expect(tableOfContentsSchema.$id).toBe('tableOfContents')
  })

  it('offers the document as a multiline field and the source as a node pick', () => {
    const content = markdownSchema.attributes?.find(
      (field) => field.name === 'content',
    )
    expect(content?.component).toBe(Aglyn.FieldComponentType.TEXTAREA)
    const forNodeId = tableOfContentsSchema.attributes?.find(
      (field) => field.name === 'forNodeId',
    )
    // A node PICKER, not a typed id or a DOM selector: the canvas lives in a
    // closed shadow root, so nothing DOM-shaped could resolve there.
    expect(forNodeId?.component).toBe(Aglyn.FieldComponentType.NODE_SELECT)
  })
})
