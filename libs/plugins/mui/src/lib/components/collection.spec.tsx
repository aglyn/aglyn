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
import { render, screen } from '@testing-library/react'
import {
  CollectionCategories,
  CollectionEntries,
  CollectionEntryBody,
  CollectionEntryMeta,
  CollectionRelated,
  CollectionShare,
  collectionCategoriesSchema,
  collectionEntriesSchema,
  collectionEntryBodySchema,
  collectionEntryMetaSchema,
  collectionPresets,
  collectionRelatedSchema,
  collectionShareSchema,
} from './collection'

describe('Collection entries block (AGL-551)', () => {
  it('registers under the persisted compose-time component ids', () => {
    expect(collectionEntriesSchema.$id).toBe(
      Aglyn.COLLECTION_ENTRIES_COMPONENT_ID,
    )
    expect(collectionEntryBodySchema.$id).toBe(
      Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID,
    )
    expect(collectionRelatedSchema.$id).toBe(
      Aglyn.COLLECTION_RELATED_COMPONENT_ID,
    )
    expect(collectionShareSchema.$id).toBe(
      Aglyn.COLLECTION_SHARE_COMPONENT_ID,
    )
    expect(collectionEntryMetaSchema.$id).toBe(
      Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID,
    )
    expect(collectionCategoriesSchema.$id).toBe(
      Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID,
    )
  })

  it('renders its children as the entry template', () => {
    render(
      <CollectionEntries collectionSlug="blog" entriesLimit={3}>
        <span>{'{{entry.title}}'}</span>
      </CollectionEntries>,
    )
    expect(screen.getByText('{{entry.title}}')).toBeTruthy()
  })

  it('ships a preset with title/date/excerpt/Read-more defaults', () => {
    const preset = collectionPresets.find(
      (item) => item.displayName === 'Collection Entries',
    )
    const json = JSON.stringify(preset?.data)
    for (const token of [
      '{{entry.title}}',
      '{{entry.date}}',
      '{{entry.excerpt}}',
      '{{entry.url}}',
    ]) {
      expect(json).toContain(token)
    }
    expect(json).toContain('Read more')
  })
})

describe('Entry body block (AGL-551)', () => {
  it('renders markdown-lite as themed elements', () => {
    const markdown =
      '## Heading\n\nSome **bold** words and a ' +
      '[link](https://example.com).\n\n- one\n- two'
    const { container } = render(<CollectionEntryBody markdown={markdown} />)
    const heading = container.querySelector('h2')
    expect(heading?.textContent).toBe('Heading')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('renders a `> ` line as a styled blockquote, not literal text (AGL-1315)', () => {
    const { container } = render(
      <CollectionEntryBody markdown={'Before.\n\n> Pull **this** quote.'} />,
    )
    const quote = container.querySelector('blockquote')
    expect(quote?.textContent).toBe('Pull this quote.')
    expect(quote?.querySelector('strong')?.textContent).toBe('this')
    // The raw marker must not leak into the article.
    expect(container.textContent).not.toContain('>')
  })

  it('renders `1. ` lines as an <ol>, keeping the start number (AGL-1320)', () => {
    const { container } = render(
      <CollectionEntryBody
        markdown={'Before.\n\n3. A **numbered** step\n4. Another one'}
      />,
    )
    const list = container.querySelector('ol')
    expect(list?.getAttribute('start')).toBe('3')
    expect(list?.querySelectorAll('li')).toHaveLength(2)
    expect(list?.querySelector('strong')?.textContent).toBe('numbered')
    // The raw markers must not leak into the article as prose.
    expect(container.textContent).toBe('Before.A numbered stepAnother one')
  })

  it('renders nothing on the site for an unresolved token', () => {
    const { container } = render(
      <CollectionEntryBody markdown="{{entry.body}}" />,
    )
    expect(container.textContent).toBe('')
  })

  it('shows an editor affordance inside editing surfaces', () => {
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionEntryBody markdown="{{entry.body}}" />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(
      screen.getByText(/Entry body — the \{\{entry\.body\}\} markdown/),
    ).toBeTruthy()
  })

  it('renders ![alt](url) images as constrained plain img tags', () => {
    const { container } = render(
      <CollectionEntryBody markdown="![Diagram](https://cdn.example.com/d.png)" />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/d.png')
    expect(image?.getAttribute('alt')).toBe('Diagram')
  })

  it('routes internal markdown links through AppLink (AGL-582)', () => {
    const { container } = render(
      <CollectionEntryBody markdown="Go [about](/about) or [out](https://example.com)." />,
    )
    const anchors = Array.from(container.querySelectorAll('a'))
    const internal = anchors.find((a) => a.getAttribute('href') === '/about')
    const external = anchors.find(
      (a) => a.getAttribute('href') === 'https://example.com',
    )
    expect(internal).toBeTruthy()
    expect(external).toBeTruthy()
    // AppLink stamps its class keys; the plain anchor never gets them.
    expect(internal?.className).toContain('AglynAppLink')
    expect(external?.className ?? '').not.toContain('AglynAppLink')
  })

  it('renders markdown links inert inside editing surfaces', () => {
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionEntryBody markdown="Go [about](/about) now." />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('about')).toBeTruthy()
  })
})

describe('Related posts block (AGL-582)', () => {
  const entries = [
    {
      title: 'Match',
      url: '/blog/match',
      date: '1/1/2026',
      category: 'News',
    },
  ]

  it('renders stamped entries as links with a heading', () => {
    const { container } = render(<CollectionRelated entries={entries} />)
    expect(screen.getByText('Related articles')).toBeTruthy()
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('/blog/match')
    expect(screen.getByText('1/1/2026 · News')).toBeTruthy()
  })

  it('renders nothing on the site without stamped entries', () => {
    const { container } = render(<CollectionRelated />)
    expect(container.textContent).toBe('')
  })

  it('shows an affordance inside editing surfaces', () => {
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionRelated />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByText(/Related posts — entries sharing/)).toBeTruthy()
  })
})

describe('Category pills block (AGL-1321)', () => {
  const items = [
    { label: 'All', href: '/blog', active: false },
    { label: 'Product', href: '/blog/category/product', active: true },
    { label: 'Open source', href: '/blog/category/opensrc', active: false },
  ]

  it('renders every pill as a REAL anchor', () => {
    // Anchors, not click handlers: a JS-only toggle is invisible to
    // crawlers, unopenable in a new tab and unlinkable.
    const { container } = render(<CollectionCategories items={items} />)
    const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) =>
      anchor.getAttribute('href'),
    )
    expect(hrefs).toEqual([
      '/blog',
      '/blog/category/product',
      '/blog/category/opensrc',
    ])
    expect(screen.getByText('Open source')).toBeTruthy()
  })

  it('marks the routed pill with aria-current in the SERVER markup', () => {
    const { container } = render(<CollectionCategories items={items} />)
    const current = container.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute('href')).toBe('/blog/category/product')
  })

  it('keeps the compose-time props off the DOM', () => {
    const { container } = render(
      <CollectionCategories
        collectionSlug="blog"
        allLabel="All"
        items={items}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('collectionSlug')).toBeNull()
    expect(root.getAttribute('allLabel')).toBeNull()
  })

  it('renders nothing on the site without stamped items', () => {
    const { container } = render(<CollectionCategories />)
    expect(container.textContent).toBe('')
  })

  it('shows an affordance inside editing surfaces', () => {
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionCategories />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(screen.getByText(/Category pills — All \+ one pill/)).toBeTruthy()
  })

  it('never navigates the canvas away from an editing surface', () => {
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionCategories items={items} />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(screen.getByText('Product')).toBeTruthy()
  })
})

describe('Share bar block (AGL-582)', () => {
  it('renders X/LinkedIn/Facebook/copy buttons with the heading', () => {
    render(<CollectionShare />)
    expect(screen.getByText('Share')).toBeTruthy()
    for (const label of [
      'Share on X',
      'Share on LinkedIn',
      'Share on Facebook',
      'Copy link',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
  })
})

describe('Entry meta block (AGL-582)', () => {
  it('renders the date · category line and tag chips', () => {
    render(
      <CollectionEntryMeta
        date="1/1/2026"
        category="Guides"
        tags="nextjs, seo"
      />,
    )
    expect(screen.getByText('1/1/2026 · Guides')).toBeTruthy()
    expect(screen.getByText('nextjs')).toBeTruthy()
    expect(screen.getByText('seo')).toBeTruthy()
  })

  it('hides parts behind the show switches', () => {
    render(
      <CollectionEntryMeta
        date="1/1/2026"
        category="Guides"
        tags="nextjs"
        showCategory={false}
        showTags={false}
      />,
    )
    expect(screen.getByText('1/1/2026')).toBeTruthy()
    expect(screen.queryByText(/Guides/)).toBeNull()
    expect(screen.queryByText('nextjs')).toBeNull()
  })

  it('collapses unresolved tokens on the published site', () => {
    const { container } = render(
      <CollectionEntryMeta
        date="{{entry.date}}"
        category="{{entry.category}}"
        tags="{{entry.tags}}"
      />,
    )
    expect(container.textContent).toBe('')
  })
})
