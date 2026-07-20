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
  CollectionEntries,
  CollectionEntryBody,
  CollectionEntryMeta,
  CollectionRelated,
  CollectionShare,
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
