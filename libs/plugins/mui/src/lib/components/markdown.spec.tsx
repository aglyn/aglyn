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
  it('renders a `> ` group as one blockquote element (AGL-1315)', () => {
    const { container } = render(
      <Markdown content={'Prose.\n\n> quoted line one\n> and *two*'} />,
    )
    const quotes = container.querySelectorAll('blockquote')
    expect(quotes).toHaveLength(1)
    expect(quotes[0]?.textContent).toBe('quoted line one and two')
    expect(quotes[0]?.querySelector('em')?.textContent).toBe('two')
  })


  it('renders a numbered group as one <ol> carrying its start (AGL-1320)', () => {
    const { container } = render(
      <Markdown content={'Prose.\n\n2. step *two*\n3) step three'} />,
    )
    const lists = container.querySelectorAll('ol')
    expect(lists).toHaveLength(1)
    expect(lists[0]?.getAttribute('start')).toBe('2')
    expect(lists[0]?.querySelectorAll('li')).toHaveLength(2)
    expect(lists[0]?.querySelector('em')?.textContent).toBe('two')
    // Numbers come from the <ol>, never from literal text in the document.
    expect(container.textContent).toBe('Prose.step twostep three')
  })

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

/**
 * A Markdown block swallowing dropped elements (AGL-1388).
 *
 * Three product-screenshot nodes were parented under the `markdown` node on
 * `/press`. They shipped in the page payload and never became an `<img>`,
 * because `Markdown` renders parsed `content` blocks and nothing else — while
 * the hierarchy happily accepted the drop. The author saw them in the tree;
 * the published page did not have them; nothing warned. That reads as "never
 * done" rather than "broken", which is worse.
 *
 * The side that gives is the EDITOR: a markdown block's content IS its
 * `content` prop, so there is no position in a parsed block list a dropped
 * element could occupy. The schema already said so with
 * `flags.dropping: DISABLED` — nothing read the flag, which is the whole bug.
 */
describe('a Markdown node refuses children on BOTH sides (AGL-1388)', () => {
  const PRESS_DOC = '## Press kit\n\nLogos and screenshots below.'

  /** The /press shape: a markdown node carrying image nodes as children. */
  const fillPressCanvas = () => {
    Aglyn.canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: {
        $id: Aglyn.NODE_ROOT_ID,
        type: Aglyn.NodeType.NODE,
        componentId: 'div',
        nodes: ['WAUHna5nnG'],
      },
      WAUHna5nnG: {
        $id: 'WAUHna5nnG',
        type: Aglyn.NodeType.NODE,
        parentId: Aglyn.NODE_ROOT_ID,
        componentId: MARKDOWN_ID,
        props: { content: PRESS_DOC },
        nodes: ['D-Ghfaw6z3'],
      },
      'D-Ghfaw6z3': {
        $id: 'D-Ghfaw6z3',
        type: Aglyn.NodeType.NODE,
        parentId: 'WAUHna5nnG',
        componentId: 'muiImage',
        props: { src: '/screenshot.png' },
      },
    } as any)
  }

  beforeEach(() => {
    // The schema has to be REGISTERED for the gate to see its flags — the
    // besigner reads `nodeAcceptsChildren` off the live component registry.
    Aglyn.components.registerComponent(Markdown as any, markdownSchema)
  })
  afterEach(() => Aglyn.components.unregisterComponent(MARKDOWN_ID))

  it('the schema turns dropping off', () => {
    expect(markdownSchema.flags?.dropping).toBe(Aglyn.FEATURE_FLAG.DISABLED)
  })

  it('the hierarchy refuses it as a drop target', () => {
    fillPressCanvas()
    const markdownNode = Aglyn.canvas.getNode('WAUHna5nnG')!
    // Fails before the fix: `nodeAcceptsChildren` read only `selfClosing`
    // and `textEditable`, so a Markdown node advertised a children slot it
    // does not have and the canvas let the drop land inside.
    expect(Aglyn.canvas.nodeAcceptsChildren(markdownNode)).toBe(false)
  })

  it('an insert aimed at it lands as a SIBLING, not a child', () => {
    fillPressCanvas()
    // Every editor entry point funnels through one of two gates, and both
    // consult `nodeAcceptsChildren`: the Insert menu and paste go through
    // `resolveInsertTarget`, canvas drag-and-drop through the dnd manager's
    // `computedDrop`. Proving the first proves the shared gate.
    const { parent } = Aglyn.canvas.resolveInsertTarget(
      Aglyn.canvas.getNode('WAUHna5nnG'),
    )
    expect(parent.$id).toBe(Aglyn.NODE_ROOT_ID)
  })

  it('renders no child nodes next to a parsed document', () => {
    const { container } = render(
      <Markdown content={PRESS_DOC}>
        <img data-testid="dropped" src="/screenshot.png" alt="" />
      </Markdown>,
    )
    expect(container.querySelector('h2')?.textContent).toBe('Press kit')
    expect(screen.queryByTestId('dropped')).toBeNull()
  })

  it('renders no child nodes once the document is cleared either', () => {
    // The half that was genuinely inconsistent: the empty-content branch
    // spread `...rest` onto a childless Box, and `children` rode along in
    // `rest`. So clearing the Content attribute made the swallowed nodes
    // reappear — the same tree rendering two different pages depending on a
    // prop that has nothing to do with them.
    render(
      <Markdown content="">
        <img data-testid="dropped" src="/screenshot.png" alt="" />
      </Markdown>,
    )
    expect(screen.queryByTestId('dropped')).toBeNull()
  })
})

describe('markdown schemas (AGL-1162)', () => {
  it('keeps the persisted component ids', () => {
    // Ids live in every screen document that ever used these elements.
    expect(markdownSchema.$id).toBe('markdown')
    expect(tableOfContentsSchema.$id).toBe('tableOfContents')
  })

  it('offers the document as a WYSIWYG field and the source as a node pick', () => {
    const content = markdownSchema.attributes?.find(
      (field) => field.name === 'content',
    )
    // The markdown-lite editor, not a raw textarea (AGL-1616): this attribute
    // holds a whole document — the published Privacy Policy body is one — and
    // a textarea meant correcting it was a 13 KB paste (AGL-1594). The stored
    // value is unchanged, which is why the renderers below still pass.
    expect(content?.component).toBe(Aglyn.FieldComponentType.MARKDOWN)
    const forNodeId = tableOfContentsSchema.attributes?.find(
      (field) => field.name === 'forNodeId',
    )
    // A node PICKER, not a typed id or a DOM selector: the canvas lives in a
    // closed shadow root, so nothing DOM-shaped could resolve there.
    expect(forNodeId?.component).toBe(Aglyn.FieldComponentType.NODE_SELECT)
  })
})

/**
 * AGL-1451 on the Table of Contents — the component that shows why the
 * `dropClearedProps` wrapper is a decision and not a reflex.
 */
describe('Table of Contents cleared values (AGL-1451)', () => {
  const withDoc = (ui: React.ReactElement) => {
    fillCanvas([{ $id: 'doc1', props: { content: DOC } }])
    return render(ui)
  }

  it('never offers a depth the attributes form cannot persist', () => {
    const field = (tableOfContentsSchema.attributes ?? []).find(
      (a: any) => a.name === 'depth',
    ) as any
    for (const option of field.options) {
      expect(option.value).not.toBe('')
      expect(option.value).not.toBeNull()
      expect(option.value).not.toBeUndefined()
    }
    // `'3'` is what TableOfContentsProps has declared all along; the
    // option list was the half that had drifted to `''`.
    expect(field.options.map((o: any) => o.value)).toEqual(['3', '2'])
  })

  it('a cleared depth lists both levels, exactly as an absent one', () => {
    const { container: absent } = withDoc(<TableOfContents />)
    const { container: cleared } = withDoc(
      <TableOfContents depth={null as any} />,
    )
    expect(cleared.innerHTML).toBe(absent.innerHTML)
    expect(absent.querySelectorAll('li').length).toBeGreaterThan(2)
  })

  it('the sentinel means the same thing the empty value used to', () => {
    const { container: sentinel } = withDoc(<TableOfContents depth="3" />)
    const { container: absent } = withDoc(<TableOfContents />)
    expect(sentinel.innerHTML).toBe(absent.innerHTML)
  })

  it('a cleared DOM prop never reaches the element', () => {
    // The half of the guard this component does take: props spread onto
    // the Box are stripped, so a cleared attribute cannot land as `""`.
    const { container } = withDoc(
      <TableOfContents {...({ 'data-x': null } as any)} />,
    )
    expect(container.querySelector('[data-x]')).toBeNull()
  })

  // ---- positive control: the choice a blanket wrapper would have eaten ----

  it('an EMPTY heading still renders no label — a real author choice', () => {
    // This is why TableOfContents is not wrapped props-wide: `heading` reads
    // an empty value as "render no label" (its help text says so), and a
    // guard over the whole props object would strip it and put the default
    // "On this page" back.
    const { container } = withDoc(<TableOfContents heading="" />)
    expect(container.textContent).not.toContain('On this page')
    expect(container.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('and an explicit heading still wins over the default', () => {
    const { container } = withDoc(<TableOfContents heading="Contents" />)
    expect(container.textContent).toContain('Contents')
  })
})
