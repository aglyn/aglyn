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
import { fireEvent, render, screen } from '@testing-library/react'
import {
  CollectionCategories,
  CollectionEntries,
  CollectionEntryBody,
  CollectionEntryMeta,
  CollectionRelated,
  CollectionSearch,
  CollectionShare,
  collectionCategoriesSchema,
  collectionEntriesSchema,
  collectionEntryBodySchema,
  collectionEntryMetaSchema,
  collectionPresets,
  collectionRelatedSchema,
  collectionSearchSchema,
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

describe('Collection entries search (AGL-1516)', () => {
  const index = [
    { title: 'Design it live', excerpt: 'how besigner renders the page' },
    { title: 'One platform, not a stack', excerpt: 'commerce forms media' },
  ]
  const cards = [
    <article key="a">First card</article>,
    <article key="b">Second card</article>,
  ]

  it('renders NO search box by default (regression pin)', () => {
    const { container } = render(<CollectionEntries>{cards}</CollectionEntries>)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
    // The block is exactly the stack of its children, as it always was.
    expect(container.firstElementChild?.children).toHaveLength(2)
    expect(container.firstElementChild?.textContent).toBe(
      'First cardSecond card',
    )
  })

  it('renders no box either while nothing is stamped on a live surface', () => {
    // Unknown collection / zero entries: the expansion stamped no index, so
    // a search box would be a control over nothing.
    render(<CollectionEntries search>{cards}</CollectionEntries>)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('renders the search box when enabled with a stamped index', () => {
    render(
      <CollectionEntries search searchIndex={index}>
        {cards}
      </CollectionEntries>,
    )
    const input = screen.getByRole('textbox', {
      name: 'Search entries',
    }) as HTMLInputElement
    expect(input.placeholder).toBe('Search posts…')
    // Everything renders while the box is empty.
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.getByText('Second card')).toBeTruthy()
  })

  it('honours an authored placeholder', () => {
    render(
      <CollectionEntries
        search
        searchPlaceholder="Search the changelog…"
        searchIndex={index}
      >
        {cards}
      </CollectionEntries>,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.placeholder).toBe('Search the changelog…')
  })

  it('filters the rendered entries by fuzzy title/excerpt match', () => {
    render(
      <CollectionEntries search searchIndex={index}>
        {cards}
      </CollectionEntries>,
    )
    const input = screen.getByRole('textbox')
    // Title hit — and typo-tolerant, which is the point of fuzzy.
    fireEvent.change(input, { target: { value: 'platfrom' } })
    expect(screen.queryByText('First card')).toBeNull()
    expect(screen.getByText('Second card')).toBeTruthy()
    // Excerpt hit.
    fireEvent.change(input, { target: { value: 'besigner' } })
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.queryByText('Second card')).toBeNull()
    // Clearing restores the full list.
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.getByText('Second card')).toBeTruthy()
  })

  it('filters whole entry GROUPS when the template has several roots', () => {
    // Two template roots per entry: children arrive as [a1, a2, b1, b2].
    render(
      <CollectionEntries search searchIndex={index}>
        <article key="a1">First card</article>
        <aside key="a2">First aside</aside>
        <article key="b1">Second card</article>
        <aside key="b2">Second aside</aside>
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'platform' },
    })
    expect(screen.queryByText('First card')).toBeNull()
    expect(screen.queryByText('First aside')).toBeNull()
    expect(screen.getByText('Second card')).toBeTruthy()
    expect(screen.getByText('Second aside')).toBeTruthy()
  })

  it('says NO MATCHES honestly on an unpaginated block', () => {
    render(
      <CollectionEntries search searchIndex={index}>
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(screen.getByText('No matches for “zzzz”.')).toBeTruthy()
    expect(screen.queryByText('First card')).toBeNull()
  })

  it('scopes the empty state to the PAGE when the block paginates', () => {
    // A paginated block holds one page window; claiming a global miss would
    // turn "not on this page" into "this post does not exist".
    render(
      <CollectionEntries
        search
        searchIndex={index}
        searchTotal={9}
        perPage={2}
        page={1}
      >
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(
      screen.getByText(
        'No matches for “zzzz” on this page — other pages are not searched.',
      ),
    ).toBeTruthy()
  })

  // ── The scope test keys off TRUNCATION, not off `perPage` (AGL-1516) ──
  //
  // `perPage` was the wrong proxy in both directions, and each direction is
  // its own lie. The three cases below are deliberately arranged so that a
  // fix which only stamps `searchTotal` — or only reads it in the paginated
  // branch — still fails: one has no `perPage` at all, one has a `perPage`
  // that does not truncate, and one is the pre-existing paginated case above
  // which must keep its wording.

  it('admits a limited block is truncated even with NO perPage set', () => {
    // The bug this reopened on. A block set to "latest 6 posts" is sliced by
    // `entriesLimit`, never sees `perPage`, and used to answer a miss with a
    // flat "No matches" — the false "this post does not exist" the honest
    // empty state exists to prevent.
    render(
      <CollectionEntries search searchIndex={index} searchTotal={40}>
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(
      screen.getByText(
        'No matches for “zzzz” in the 2 entries shown here — the rest of ' +
          'the collection is not searched.',
      ),
    ).toBeTruthy()
    // And it must NOT claim pages it does not have.
    expect(screen.queryByText(/other pages are not searched/)).toBeNull()
  })

  it('admits truncation by the 100-entry cap, which has no prop at all', () => {
    // COLLECTION_ENTRIES_MAX slices a block that set neither `perPage` nor
    // `entriesLimit`. Nothing on the props can see it; only the stamped
    // total can.
    render(
      <CollectionEntries search searchIndex={index} searchTotal={100 + 1}>
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(screen.queryByText('No matches for “zzzz”.')).toBeNull()
    expect(
      screen.getByText(/the rest of the collection is not searched\./),
    ).toBeTruthy()
  })

  it('does NOT blame other pages when perPage exceeds the entry count', () => {
    // The opposite lie, and the reason `truncated` is not simply OR'd onto
    // the old test: one complete page of 2 posts under `perPage={20}` has no
    // other pages, and telling the reader to go looking through them is as
    // wrong as hiding the truncation was.
    render(
      <CollectionEntries
        search
        searchIndex={index}
        searchTotal={2}
        perPage={20}
        page={1}
      >
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(screen.getByText('No matches for “zzzz”.')).toBeTruthy()
    expect(screen.queryByText(/are not searched/)).toBeNull()
  })

  it('will not claim completeness over a CAPPED read (AGL-1516)', () => {
    // The third truncation, and the invisible one. `searchTotal` counts the
    // entries the SERVER saw, and that read carries its own limit — so a
    // block holding every entry of a 400-post collection's first 100
    // satisfies `index.length === searchTotal` exactly, and takes the one
    // branch that claims to have looked everywhere. `searchCapped` is the
    // only thing that separates "this is all there is" from "this is all I
    // read".
    render(
      <CollectionEntries search searchIndex={index} searchTotal={2} searchCapped>
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(screen.queryByText('No matches for “zzzz”.')).toBeNull()
    expect(
      screen.getByText(
        'No matches for “zzzz” in the 2 entries shown here — the rest of ' +
          'the collection is not searched.',
      ),
    ).toBeTruthy()
  })

  it('falls back to the perPage reading when no total was stamped', () => {
    // A page cached before `searchTotal` shipped carries `searchIndex` and
    // nothing else. Behaviour there must be exactly what it was, not a
    // silent upgrade to "complete" — understating a search's scope is the
    // safe direction to be wrong in.
    render(
      <CollectionEntries search searchIndex={index} perPage={2} page={1}>
        {cards}
      </CollectionEntries>,
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zzzz' },
    })
    expect(
      screen.getByText(
        'No matches for “zzzz” on this page — other pages are not searched.',
      ),
    ).toBeTruthy()
  })

  it('keeps the search props off the DOM', () => {
    const { container } = render(
      <CollectionEntries
        search
        searchPlaceholder="Hint"
        searchIndex={index}
        searchTotal={2}
      >
        {cards}
      </CollectionEntries>,
    )
    const root = container.firstElementChild as HTMLElement
    for (const attribute of [
      'search',
      'searchPlaceholder',
      'searchIndex',
      'searchTotal',
    ])
      expect(root.getAttribute(attribute)).toBeNull()
  })

  it('renders an INERT affordance inside editing surfaces', () => {
    // The canvas renders the template once with literal tokens and no
    // stamped index — the author sees the field they enabled, and typing
    // must not filter a list that is not there (pills pattern).
    render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionEntries search>
          <article>{'{{entry.title}}'}</article>
        </CollectionEntries>
      </Aglyn.ScreenLinkContext.Provider>,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    fireEvent.change(input, { target: { value: 'anything' } })
    expect(input.value).toBe('')
    expect(screen.getByText('{{entry.title}}')).toBeTruthy()
  })

  it('offers Only-on-page-1 as a switch, kept off the DOM (AGL-1871)', () => {
    const attribute = (collectionEntriesSchema.attributes ?? []).find(
      (item) => item.name === 'firstPageOnly',
    )
    // A SWITCH, so the author flips it rather than typing a truthy string —
    // this is read with `Boolean()` at compose time and "false" is truthy.
    expect(attribute?.component).toBe(Aglyn.FieldComponentType.SWITCH)
    // Compose-time only: `expandCollectionEntries` acts on it and the
    // component must not leak it onto the rendered element, the way
    // collectionSlug/entriesLimit/perPage/page are stripped.
    //
    // React drops an unrecognized camelCase prop rather than rendering it, so
    // the ATTRIBUTE alone cannot tell a stripped prop from a leaked one — it
    // is absent either way, and only a console warning marks the difference.
    // Assert the warning too, or this passes on a component that forwards it.
    const warnings: unknown[][] = []
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args)
      })
    let root: HTMLElement
    try {
      const { container } = render(
        <CollectionEntries firstPageOnly>
          <span>{'{{entry.title}}'}</span>
        </CollectionEntries>,
      )
      root = container.firstElementChild as HTMLElement
    } finally {
      consoleError.mockRestore()
    }
    expect(root.getAttributeNames()).not.toContain('firstpageonly')
    expect(
      warnings.filter((args) => /firstPageOnly/.test(args.join(' '))),
    ).toEqual([])
  })

  it('offers Search as a switch and the placeholder gated behind it', () => {
    const attribute = (name: string) =>
      (collectionEntriesSchema.attributes ?? []).find(
        (item) => item.name === name,
      )
    expect(attribute('search')?.component).toBe(
      Aglyn.FieldComponentType.SWITCH,
    )
    expect(attribute('searchPlaceholder')?.component).toBe(
      Aglyn.FieldComponentType.TEXT_FIELD,
    )
    expect(attribute('searchPlaceholder')?.condition).toEqual({
      when: 'search',
      is: true,
    })
    // `searchIndex` and `searchTotal` are server-stamped, never authored.
    expect(attribute('searchIndex')).toBeUndefined()
    expect(attribute('searchTotal')).toBeUndefined()
  })
})

/**
 * The suggestion dropdown (AGL-1525, Figma 496:1218).
 *
 * The mode's whole promise is that the list the reader is looking at STAYS
 * THERE while they type — so nearly every test below asserts the grid as
 * well as the panel. A panel that opens correctly over a list it quietly
 * emptied is the exact failure this mode exists to prevent, and it is
 * invisible to any test that only looks at the panel.
 */
describe('Collection entries search — suggestions (AGL-1525)', () => {
  const index = [
    {
      title: 'Design it live',
      excerpt: 'how besigner renders the page',
      url: '/blog/design-it-live',
      date: 'Nov 14, 2023',
      category: 'Guides',
    },
    {
      title: 'One platform, not a stack',
      excerpt: 'commerce forms media',
      url: '/blog/one-platform',
      date: 'Jan 2, 2024',
    },
  ]
  const cards = [
    <article key="a">First card</article>,
    <article key="b">Second card</article>,
  ]
  const suggesting = (props: Record<string, unknown> = {}) =>
    render(
      <CollectionEntries search searchMode="suggest" searchIndex={index} {...props}>
        {cards}
      </CollectionEntries>,
    )
  const type = (value: string) =>
    fireEvent.change(screen.getByRole('textbox'), { target: { value } })
  const viewAll = () =>
    screen
      .queryAllByRole('link')
      .find((link) => link.textContent?.startsWith('View all results'))

  it('keeps FILTER as the reading of an absent mode (regression pin)', () => {
    // Every block published before AGL-1525 has no `searchMode` at all. If
    // absence ever started meaning "suggest", each of them would silently
    // stop filtering — the feature they were actually switched on for.
    render(
      <CollectionEntries search searchIndex={index}>
        {cards}
      </CollectionEntries>,
    )
    type('platform')
    expect(screen.queryByText('First card')).toBeNull()
    expect(screen.getByText('Second card')).toBeTruthy()
    expect(viewAll()).toBeUndefined()
  })

  it('leaves the card grid ALONE while suggesting', () => {
    suggesting()
    type('platform')
    // Both cards still there — the reader did not lose their place.
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.getByText('Second card')).toBeTruthy()
  })

  it('opens a panel of matching entries with chip, date and excerpt', () => {
    suggesting()
    type('besigner')
    expect(screen.getByText('Design it live')).toBeTruthy()
    expect(screen.getByText('Guides')).toBeTruthy()
    expect(screen.getByText('Nov 14, 2023')).toBeTruthy()
    expect(screen.getByText('how besigner renders the page')).toBeTruthy()
    // …and only the matching one.
    expect(screen.queryByText('One platform, not a stack')).toBeNull()
  })

  it('makes each suggestion a real link to the entry', () => {
    suggesting()
    type('besigner')
    const row = screen
      .queryAllByRole('link')
      .find((link) => link.textContent?.includes('Design it live'))
    expect(row?.getAttribute('href')).toBe('/blog/design-it-live')
  })

  it('renders a url-less suggestion as TEXT, never as a dead link', () => {
    // A page cached before AGL-1525 stamped urls, or a slugless entry. A row
    // that navigates nowhere — or worse, to the listing — is a broken
    // promise; showing the title without a link is not.
    suggesting({
      searchIndex: [{ title: 'Design it live', excerpt: 'besigner' }],
    })
    type('besigner')
    expect(screen.getByText('Design it live')).toBeTruthy()
    expect(
      screen
        .queryAllByRole('link')
        .some((link) => link.textContent?.includes('Design it live')),
    ).toBe(false)
    // The site-wide escape hatch still has to be there.
    expect(viewAll()).toBeTruthy()
  })

  it('always offers "View all results", encoded, EVEN with no matches', () => {
    suggesting()
    type('zzzz nothing')
    // No rows…
    expect(screen.queryByText('Design it live')).toBeNull()
    expect(
      screen.getByText('No matches for “zzzz nothing” on this page.'),
    ).toBeTruthy()
    // …which is exactly when the reader most needs the site-wide search:
    // this block only ever held one page of one collection.
    expect(viewAll()?.getAttribute('href')).toBe(
      '/search?q=zzzz%20nothing',
    )
    // The grid is STILL intact behind the empty panel.
    expect(screen.getByText('First card')).toBeTruthy()
  })

  it('opens nothing until the reader actually types', () => {
    suggesting()
    expect(viewAll()).toBeUndefined()
    // Whitespace is not a query.
    type('   ')
    expect(viewAll()).toBeUndefined()
  })

  it('closes on Escape, and TYPING brings it back', () => {
    suggesting()
    type('besigner')
    expect(screen.getByText('Design it live')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByText('Design it live')).toBeNull()
    // Escape dismissed one answer, it did not switch the feature off.
    type('besigner renders')
    expect(screen.getByText('Design it live')).toBeTruthy()
  })

  it('suggests even when the children do NOT divide by the index', () => {
    // `groupSize` is the filter mode's precondition: it maps clone groups to
    // index entries. Suggestions read the index directly, so an uneven
    // template — the very case the filter fails open on — must still
    // suggest. Three children over two entries: no whole group size.
    render(
      <CollectionEntries search searchMode="suggest" searchIndex={index}>
        <article key="a">First card</article>
        <aside key="b">Stray</aside>
        <article key="c">Second card</article>
      </CollectionEntries>,
    )
    type('besigner')
    expect(screen.getByText('Design it live')).toBeTruthy()
    expect(screen.getByText('Stray')).toBeTruthy()
  })

  it('submits to the site search, so Enter works without the panel', () => {
    // The panel is an enhancement over a working search box. With scripting
    // broken or slow, the field is still a GET form pointed at the reserved
    // /search route under the name that route reads.
    const { container } = suggesting()
    const form = container.querySelector('form')
    expect(form?.getAttribute('action')).toBe('/search')
    expect(form?.getAttribute('method')).toBe('get')
    expect(form?.querySelector('input')?.getAttribute('name')).toBe('q')
    // One search landmark, not two.
    expect(screen.getAllByRole('search')).toHaveLength(1)
  })

  it('caps the panel at five rows rather than growing into a page', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `Platform post ${i}`,
      excerpt: 'platform',
      url: `/blog/post-${i}`,
    }))
    suggesting({ searchIndex: many })
    type('platform')
    const rows = screen
      .queryAllByRole('link')
      .filter((link) => link.textContent?.startsWith('Platform post'))
    expect(rows).toHaveLength(5)
  })

  it('stays INERT on an editing surface — no panel, no form', () => {
    // Same contract as the filter mode's inert field and the pills: the
    // canvas has no stamped index, and a floating panel over the author's
    // template would cover the thing they are editing.
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionEntries search searchMode="suggest">
          <article>{'{{entry.title}}'}</article>
        </CollectionEntries>
      </Aglyn.ScreenLinkContext.Provider>,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(container.querySelector('form')).toBeNull()
    fireEvent.change(input, { target: { value: 'anything' } })
    expect(viewAll()).toBeUndefined()
    expect(screen.getByText('{{entry.title}}')).toBeTruthy()
  })

  it('offers the mode as a select, gated behind the search switch', () => {
    // Zach's rule: a capability that only exists in code is not shipped. The
    // author reaches this by clicking, in the Attributes panel.
    const attribute = (collectionEntriesSchema.attributes ?? []).find(
      (item) => item.name === 'searchMode',
    )
    expect(attribute?.component).toBe(Aglyn.FieldComponentType.SELECT)
    expect(attribute?.condition).toEqual({ when: 'search', is: true })
    const values = (attribute?.options ?? []).map((option: any) => option.value)
    expect(values).toEqual(['filter', 'suggest'])
    // AGL-1453: `''` cannot survive a save, so an option valued `''` is a
    // one-way door — the author picks it once and can never pick back.
    for (const value of values) expect(value).toBeTruthy()
    for (const option of (attribute?.options ?? []) as any[]) {
      expect(String(option.label ?? '').trim()).toBeTruthy()
    }
  })
})

describe('Collection Search block (AGL-1516, Figma 494:1220)', () => {
  const index = [
    {
      title: 'Design it live',
      excerpt: 'how besigner renders the page',
      url: '/blog/design-it-live',
      date: 'Nov 14, 2023',
      category: 'Guides',
    },
    {
      title: 'One platform, not a stack',
      excerpt: 'commerce forms media',
      url: '/blog/one-platform',
    },
  ]
  const box = (props: Record<string, unknown> = {}) =>
    render(
      <CollectionSearch searchIndex={index} searchTotal={index.length} {...props} />,
    )
  const type = (value: string) =>
    fireEvent.change(screen.getByRole('textbox'), { target: { value } })
  const viewAll = () =>
    screen
      .queryAllByRole('link')
      .find((link) => link.textContent?.startsWith('View all results'))

  it('is a block of its own, so the frame toolbar can hold it', () => {
    // The whole reason this element exists (AGL-1516). The entries block's
    // field is that block's first child and cannot be lifted into a toolbar
    // row; the pills cannot be moved in either, because every child of an
    // entries block is cloned once per entry. Standalone and self-closing is
    // what makes "pills left, search + RSS right" authorable at all.
    expect(collectionSearchSchema.$id).toBe(
      Aglyn.COLLECTION_SEARCH_COMPONENT_ID,
    )
    expect(collectionSearchSchema.flags?.selfClosing).toBe(
      Aglyn.FEATURE_FLAG.ENABLED,
    )
    const names = (collectionSearchSchema.attributes ?? []).map(
      (item) => item.name,
    )
    expect(names).toEqual(['collectionSlug', 'searchPlaceholder'])
    // The server-stamped facts stay un-authorable: an author who could edit
    // them could make the box lie about how far it looked.
    expect(names).not.toContain('searchIndex')
    expect(names).not.toContain('searchTotal')
    expect(names).not.toContain('searchCapped')
  })

  it('suggests matching entries with chip, date and excerpt', () => {
    box()
    type('besigner')
    expect(screen.getByText('Design it live')).toBeTruthy()
    expect(screen.getByText('Guides')).toBeTruthy()
    expect(screen.getByText('Nov 14, 2023')).toBeTruthy()
    expect(screen.queryByText('One platform, not a stack')).toBeNull()
  })

  it('opens nothing until the reader actually types', () => {
    box()
    expect(viewAll()).toBeUndefined()
    type('   ')
    expect(viewAll()).toBeUndefined()
  })

  it('submits to the site search, so Enter works without the panel', () => {
    const { container } = box()
    const form = container.querySelector('form')
    expect(form?.getAttribute('action')).toBe('/search')
    expect(form?.getAttribute('method')).toBe('get')
    expect(form?.querySelector('input')?.getAttribute('name')).toBe('q')
    expect(screen.getAllByRole('search')).toHaveLength(1)
  })

  it('reports the SIZE of what it searched, never a bare "no matches"', () => {
    // This box reads a bounded set. A flat "No matches." would be a claim
    // about the whole collection that the index behind it cannot support.
    box()
    type('zzzz')
    expect(
      screen.getByText('No matches for “zzzz” in the 2 entries searched here.'),
    ).toBeTruthy()
    expect(screen.queryByText('No matches for “zzzz”.')).toBeNull()
    // And the site-wide escape hatch, which is exactly what a miss needs.
    expect(viewAll()?.getAttribute('href')).toBe('/search?q=zzzz')
  })

  it('says so when the READ was capped, not just when the window was', () => {
    // The failure this guards is silent: `searchIndex.length ===
    // searchTotal` is satisfied by a box holding 100 of 400 posts, because
    // `searchTotal` counts what the server saw and the server's read stops
    // at its limit. Without the flag the miss above claims a completeness it
    // never had.
    box({ searchCapped: true })
    type('zzzz')
    expect(
      screen.getByText(
        'No matches for “zzzz” in the 2 entries searched here — the ' +
          'collection holds more, which this box has not read.',
      ),
    ).toBeTruthy()
  })

  it('renders NO field on a live surface with nothing stamped', () => {
    // Unknown collection, empty collection, or a page composed before this
    // block existed. A field here could only ever answer "no matches", which
    // reads as a fact about the query rather than about the absent index.
    render(<CollectionSearch />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
  })

  it('stays INERT on an editing surface — read-only, no panel, no form', () => {
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
        <CollectionSearch />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(container.querySelector('form')).toBeNull()
    fireEvent.change(input, { target: { value: 'anything' } })
    expect(viewAll()).toBeUndefined()
  })

  it('honours the placeholder, and falls back to the frame wording', () => {
    box({ searchPlaceholder: 'Search the changelog…' })
    expect(
      (screen.getByRole('textbox') as HTMLInputElement).placeholder,
    ).toBe('Search the changelog…')
    screen.getByRole('textbox').remove()
    box()
    expect(
      (screen.getByRole('textbox') as HTMLInputElement).placeholder,
    ).toBe('Search posts…')
  })

  it('keeps its compose-time props OFF the DOM', () => {
    const { container } = box({ collectionSlug: 'blog', searchCapped: true })
    const html = container.innerHTML
    for (const leak of [
      'collectionSlug',
      'searchIndex',
      'searchTotal',
      'searchCapped',
      'searchPlaceholder',
    ]) {
      expect(html).not.toContain(leak)
    }
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

  it('stamps heading ANCHORS, so an article can carry a contents aside (AGL-1162)', () => {
    // The anchor work reached the Markdown element and stopped there, which
    // made "On this page" beside a blog post impossible: the aside emits
    // `#slug` links and the post had nothing for them to land on.
    const { container } = render(
      <CollectionEntryBody
        markdown={'## The **fine** print\n\nbody\n\n### Notice\n\n### Notice'}
      />,
    )
    expect(container.querySelector('h2')?.id).toBe('the-fine-print')
    // Derived through the shared numbering, so two identical headings do NOT
    // collide — a hand-rolled slugify per renderer is how they would.
    expect(
      [...container.querySelectorAll('h3')].map((node) => node.id),
    ).toEqual(['notice', 'notice-2'])
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

  /**
   * AGL-1686. The entry COVER has resolved a reference since AGL-1215 while a
   * body image did not, so an author picking the same asset for both got one
   * that survives a folder move and one that did not even render.
   */
  it('resolves a media reference in a body image (AGL-1686)', () => {
    const { container } = render(
      <Aglyn.SiteContext.Provider value={{ hostId: 'site-b' } as any}>
        <CollectionEntryBody markdown="![Diagram](media:org:acme:site-a/med1)" />
      </Aglyn.SiteContext.Provider>,
    )
    const image = container.querySelector('img')
    // Host-qualified at render, exactly as the cover is.
    expect(image?.getAttribute('src')).toBe('/api/media/cdn/org:acme:site-b/med1')
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

/**
 * AGL-1457. The block shipped exactly two controls — Heading and Limit — so
 * the article frame's 3-up card grid (180px cover + category chip + title)
 * could not be authored at all, and the block never emitted a cover. Hand
 * building the grid was not an option either: related posts are resolved FROM
 * the collection, so a static 3-up would rot the moment the collection moved.
 *
 * The prop vocabulary mirrors the Collection Entries block: a `show*` SWITCH
 * (Entry Meta's showDate/showCategory/showTags) and a numeric TEXT_FIELD for a
 * count (Collection Entries' entriesLimit/perPage/page, Grid's columns).
 *
 * The plain list stays the DEFAULT. This block is live on every blog entry;
 * a new default would restyle 11 published pages nobody asked about.
 */
describe('Related posts covers and card grid (AGL-1457)', () => {
  const entries = [
    {
      title: 'First',
      url: '/blog/first',
      date: '1/1/2026',
      category: 'Guides',
      coverImage: 'https://cdn.example.com/first.png',
    },
    {
      title: 'Second',
      url: '/blog/second',
      date: '2/1/2026',
      category: 'Product',
      coverImage: 'media:org:jWmGooWE3L/4GF1hRJBUp',
    },
    { title: 'Third', url: '/blog/third' },
  ]

  describe('the default render is untouched', () => {
    it('emits no cover image at all', () => {
      const { container } = render(<CollectionRelated entries={entries} />)
      expect(container.querySelectorAll('img')).toHaveLength(0)
    })

    it('stays a stacked list, not a grid', () => {
      const { container } = render(<CollectionRelated entries={entries} />)
      const root = container.firstElementChild as HTMLElement
      expect(window.getComputedStyle(root).display).not.toBe('grid')
    })

    it('renders exactly the plain links and date · category captions', () => {
      const { container } = render(<CollectionRelated entries={entries} />)
      expect(
        Array.from(container.querySelectorAll('a')).map((a) =>
          a.getAttribute('href'),
        ),
      ).toEqual(['/blog/first', '/blog/second', '/blog/third'])
      expect(screen.getByText('1/1/2026 · Guides')).toBeTruthy()
      // No chip markup on the list layout — the caption carries the category.
      expect(container.querySelectorAll('.MuiChip-root')).toHaveLength(0)
    })

    it('is what the shipped preset asks for, explicitly', () => {
      // Not merely "absent so the runtime default applies": the preset names
      // the list, so an author who switches to cards has a route back.
      const preset = collectionPresets.find(
        (item) =>
          item.data.componentId === Aglyn.COLLECTION_RELATED_COMPONENT_ID,
      )
      expect((preset?.data.props as any)?.layout).toBe('list')
      expect((preset?.data.props as any)?.showCover).toBeUndefined()
    })
  })

  describe('Show cover', () => {
    it('emits each entry’s cover image', () => {
      const { container } = render(
        <CollectionRelated entries={entries} showCover />,
      )
      const sources = Array.from(container.querySelectorAll('img')).map((img) =>
        img.getAttribute('src'),
      )
      expect(sources).toEqual([
        'https://cdn.example.com/first.png',
        // A media reference resolves at render, like every other surface.
        '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp',
      ])
    })

    it('describes the cover with the entry title', () => {
      const { container } = render(
        <CollectionRelated entries={entries} showCover />,
      )
      expect(container.querySelector('img')?.getAttribute('alt')).toBe('First')
    })

    it('renders no cover box for an entry that has none', () => {
      const { container } = render(
        <CollectionRelated entries={[entries[2]]} showCover />,
      )
      expect(container.querySelectorAll('img')).toHaveLength(0)
      expect(screen.getByText('Third')).toBeTruthy()
    })
  })

  describe('Columns', () => {
    /**
     * Asserted on the SPECIFIED value, which is all jsdom has — there is no
     * layout here to resolve `repeat()` into used track sizes. A probe in a
     * real browser must count tracks instead; the same string reads as
     * `repeat(3, …)` before layout and `312px 312px 312px` after.
     */
    it('renders the authored column count as a grid', () => {
      const { container } = render(
        <CollectionRelated entries={entries} layout="cards" columns={3} />,
      )
      const root = container.firstElementChild as HTMLElement
      const style = window.getComputedStyle(root)
      expect(style.display).toBe('grid')
      expect(style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
      // Heading plus one cell per entry; the heading spans the whole row.
      expect(root.children).toHaveLength(4)
      expect(container.querySelectorAll('a')).toHaveLength(3)
    })

    it('honours a different count', () => {
      const { container } = render(
        <CollectionRelated entries={entries} layout="cards" columns={2} />,
      )
      const root = container.firstElementChild as HTMLElement
      expect(window.getComputedStyle(root).gridTemplateColumns).toBe(
        'repeat(2, minmax(0, 1fr))',
      )
    })

    it('falls back to the frame’s 3-up when the count is blank or junk', () => {
      for (const columns of [undefined, '', 'abc', 0, -2]) {
        const { container, unmount } = render(
          <CollectionRelated
            entries={entries}
            layout="cards"
            columns={columns as never}
          />,
        )
        const root = container.firstElementChild as HTMLElement
        expect(window.getComputedStyle(root).gridTemplateColumns).toBe(
          'repeat(3, minmax(0, 1fr))',
        )
        unmount()
      }
    })

    it('ignores the count while the layout is the list', () => {
      const { container } = render(
        <CollectionRelated entries={entries} columns={3} />,
      )
      const root = container.firstElementChild as HTMLElement
      expect(window.getComputedStyle(root).display).not.toBe('grid')
    })

    it('gives each card the category chip the frame asks for', () => {
      const { container } = render(
        <CollectionRelated entries={entries} layout="cards" columns={3} />,
      )
      const chips = Array.from(container.querySelectorAll('.MuiChip-root')).map(
        (chip) => chip.textContent,
      )
      // Third has no category, so it gets no chip — never an empty one.
      expect(chips).toEqual(['Guides', 'Product'])
    })

    it('keeps the compose-time and layout props off the DOM', () => {
      const { container } = render(
        <CollectionRelated
          entries={entries}
          limit={3}
          layout="cards"
          columns={3}
          showCover
        />,
      )
      const root = container.firstElementChild as HTMLElement
      for (const attribute of ['limit', 'layout', 'columns', 'showCover'])
        expect(root.getAttribute(attribute)).toBeNull()
    })

    it('never navigates the canvas away from an editing surface', () => {
      const { container } = render(
        <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
          <CollectionRelated entries={entries} layout="cards" showCover />
        </Aglyn.ScreenLinkContext.Provider>,
      )
      expect(container.querySelectorAll('a')).toHaveLength(0)
      expect(screen.getByText('First')).toBeTruthy()
    })
  })

  describe('the new controls are authorable', () => {
    const attribute = (name: string) =>
      (collectionRelatedSchema.attributes ?? []).find(
        (item) => item.name === name,
      )

    it('offers Show cover as a switch', () => {
      expect(attribute('showCover')?.component).toBe(
        Aglyn.FieldComponentType.SWITCH,
      )
      expect(attribute('showCover')?.label).toBe('Show cover')
    })

    it('offers Layout with values that can actually be saved (AGL-1453)', () => {
      const layout = attribute('layout')
      expect(layout?.component).toBe(Aglyn.FieldComponentType.SELECT)
      const values = (layout?.options ?? []).map((option: any) => option.value)
      expect(values).toEqual(['list', 'cards'])
      // `''` is the shape AGL-1451/AGL-1453 closed repo-wide: it cannot
      // survive a save, so the pick silently reverts.
      for (const value of values) expect(value).toBeTruthy()
    })

    it('offers Columns as a number field, like every other count', () => {
      expect(attribute('columns')?.component).toBe(
        Aglyn.FieldComponentType.TEXT_FIELD,
      )
      expect((attribute('columns') as any)?.type).toBe('number')
    })
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

  /**
   * AGL-1336. The attribute told authors to clear the box to omit the All
   * pill, and the form could not persist an emptied text field at all —
   * ddf maps it to `clearedValue`, which was undefined, so the key vanished
   * and the runtime default put the pill straight back.
   */
  it('clears the All label to a sentinel that can actually persist', () => {
    const allLabel = (collectionCategoriesSchema.attributes ?? []).find(
      (attribute) => attribute.name === 'allLabel',
    )
    expect(allLabel?.component).toBe(Aglyn.FieldComponentType.TEXT_FIELD)
    // Not `''`: that is exactly the value the form cannot store (AGL-1191).
    expect(allLabel?.clearedValue).toBe(Aglyn.COLLECTION_ALL_PILL_NONE)
    expect(allLabel?.clearedValue).toBeTruthy()
    expect(Aglyn.resolveCollectionAllLabel(allLabel?.clearedValue as string))
      .toBe('')
    // The description has to name the sentinel, since the box shows it.
    expect(allLabel?.description).toContain('none')
  })

  it('seeds the preset with a label, so clearing it has something to clear', () => {
    // `clearedValue` only fires when the field HAD an initial value, so a
    // preset that shipped the prop absent could never be cleared.
    const preset = collectionPresets.find(
      (item) => item.data.componentId === Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID,
    )
    expect((preset?.data.props as any)?.allLabel).toBe(
      Aglyn.COLLECTION_ALL_PILL_DEFAULT,
    )
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

/**
 * The node's authored styles reach a block as the ARRAY `mergeSxProps`
 * builds in `leaf.tsx` — `[callerSx, props.sx, node.sx]` — never as a plain
 * object. A block that folds that value in with `{...(rest.sx as object)}`
 * spreads an array: the result is `{0: …, 1: …, 2: …}`, numeric keys that
 * emotion emits as invalid selectors, so EVERY authored property is
 * discarded while the block's own defaults still apply. The panel reads the
 * value back from the node and the save reports success, so nothing in the
 * authoring loop signals the loss (AGL-1450).
 */
describe('Blocks that render their own Stack keep the node style slice (AGL-1450)', () => {
  /** Exactly what `mergeSxProps(sx, props.sx, node.sx)` yields for a node. */
  const nodeSlice = (sx: Record<string, unknown>) => [undefined, undefined, sx]

  const authored = { justifyContent: 'center', textAlign: 'center' } as const

  it.each([
    [
      'Entry Meta',
      <CollectionEntryMeta
        key="meta"
        date="1/1/2026"
        category="Guides"
        sx={nodeSlice(authored) as never}
      />,
    ],
    // The AGL-1459 byline is a THIRD arrangement of the same Stack — an
    // avatar sibling ahead of the line — and is held to the same rule.
    [
      'Entry Meta (byline)',
      <CollectionEntryMeta
        key="byline"
        avatarImage="https://cdn.example.com/mark.png"
        author="The Aglyn Team"
        date="Jul 2026"
        sx={nodeSlice(authored) as never}
      />,
    ],
    [
      'Share Bar',
      <CollectionShare key="share" sx={nodeSlice(authored) as never} />,
    ],
    [
      'Category pills',
      <CollectionCategories
        key="cats"
        items={[{ label: 'All', href: '/blog', active: true }]}
        sx={nodeSlice(authored) as never}
      />,
    ],
    // The new AGL-1457 markup is held to the same rule: a card grid built by
    // spreading `rest.sx` into an object would drop the whole slice again.
    [
      'Related posts (list)',
      <CollectionRelated
        key="related-list"
        entries={[{ title: 'First', url: '/blog/first' }]}
        sx={nodeSlice(authored) as never}
      />,
    ],
    [
      'Related posts (card grid)',
      <CollectionRelated
        key="related-cards"
        layout="cards"
        columns={3}
        showCover
        entries={[
          {
            title: 'First',
            url: '/blog/first',
            category: 'Guides',
            coverImage: 'https://cdn.example.com/first.png',
          },
        ]}
        sx={nodeSlice(authored) as never}
      />,
    ],
  ])('%s applies the authored justify-content and text-align', (_name, el) => {
    const { container } = render(el)
    const root = container.firstElementChild as HTMLElement
    const style = window.getComputedStyle(root)
    expect(style.justifyContent).toBe('center')
    expect(style.textAlign).toBe('center')
  })

  it('still applies the block default when the node authors nothing', () => {
    const { container } = render(
      <CollectionEntryMeta date="1/1/2026" category="Guides" />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(window.getComputedStyle(root).alignItems).toBe('center')
  })

  it('lets the node override the block default rather than losing to it', () => {
    const { container } = render(
      <CollectionEntryMeta
        date="1/1/2026"
        category="Guides"
        sx={nodeSlice({ alignItems: 'flex-start' }) as never}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(window.getComputedStyle(root).alignItems).toBe('flex-start')
  })
})


/**
 * AGL-1459. Entry Meta offered `Date`, `Category`, `Tags` and three `Show *`
 * switches — no author, no avatar, no date format — so the article frame's
 * byline (36px round brand mark + `The Aglyn Team` + `· Jul 2026`) could not
 * be authored at all. Every published post CARRIES an author, so this was a
 * presentation gap: the value was in the collection and the block could not
 * render it.
 *
 * The date format is the sharp one, and is independent of the other two.
 * Without it the only way to reach `Jul 2026` was to hardcode a string into
 * the Date OVERRIDE, which on a *template* stamps one fabricated date onto all
 * 11 published entries. That is a live trap, not a missing nicety.
 */
describe('Entry Meta byline (AGL-1459)', () => {
  const attribute = (name: string) =>
    (collectionEntryMetaSchema.attributes ?? []).find(
      (item) => item.name === name,
    )

  /**
   * The block is live on 11 published entries, so the render with none of the
   * new props set has to be the SAME markup, not merely a similar one.
   * Recorded off the pre-change implementation, emotion class hashes and all —
   * those hashes are a function of the sx the block builds, so a default that
   * quietly gained a property would move them.
   */
  describe('the default render is untouched', () => {
    const BEFORE =
      '<div class="MuiStack-root css-13mitf6-MuiStack-root">' +
      '<span class="MuiTypography-root MuiTypography-caption ' +
      'css-1374baf-MuiTypography-root">1/1/2026 · Guides</span>' +
      '<div class="MuiChip-root MuiChip-outlined MuiChip-sizeSmall ' +
      'MuiChip-colorDefault css-9bqyez-MuiChip-root">' +
      '<span class="MuiChip-label css-19m61dl-MuiChip-label">nextjs</span>' +
      '</div><div class="MuiChip-root MuiChip-outlined MuiChip-sizeSmall ' +
      'MuiChip-colorDefault css-9bqyez-MuiChip-root">' +
      '<span class="MuiChip-label css-19m61dl-MuiChip-label">seo</span>' +
      '</div></div>'

    it('emits byte-identical markup when no new prop is set', () => {
      const { container } = render(
        <CollectionEntryMeta
          date="1/1/2026"
          category="Guides"
          tags="nextjs, seo"
        />,
      )
      expect(container.innerHTML).toBe(BEFORE)
    })

    it('emits no avatar image and no byline separator of its own', () => {
      const { container } = render(
        <CollectionEntryMeta date="1/1/2026" category="Guides" />,
      )
      expect(container.querySelectorAll('img')).toHaveLength(0)
      expect(container.textContent).toBe('1/1/2026 · Guides')
    })

    it('is what the shipped preset asks for, by name rather than by absence', () => {
      const preset = collectionPresets.find(
        (item) =>
          item.data.componentId === Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID,
      )
      const props = preset?.data.props as any
      // The dropdown opens on the value the block is actually rendering.
      expect(props?.dateFormat).toBe(Aglyn.COLLECTION_ENTRY_DATE_FORMAT_DEFAULT)
      // No avatar is seeded: an image nobody chose would be a broken one.
      expect(props?.avatarImage).toBeUndefined()
    })
  })

  describe('Author', () => {
    it('leads the byline, ahead of the date', () => {
      render(
        <CollectionEntryMeta author="The Aglyn Team" date="Jul 2026" />,
      )
      expect(screen.getByText('The Aglyn Team · Jul 2026')).toBeTruthy()
    })

    it('hides behind Show author, like every other part', () => {
      render(
        <CollectionEntryMeta
          author="The Aglyn Team"
          date="Jul 2026"
          showAuthor={false}
        />,
      )
      expect(screen.getByText('Jul 2026')).toBeTruthy()
      expect(screen.queryByText(/Aglyn Team/)).toBeNull()
    })

    it('collapses an unresolved token on the published site', () => {
      const { container } = render(
        <CollectionEntryMeta author="{{entry.author}}" />,
      )
      expect(container.textContent).toBe('')
    })

    it('offers the same override semantics as Date and Category', () => {
      expect(attribute('author')?.component).toBe(
        Aglyn.FieldComponentType.TEXT_FIELD,
      )
      expect(attribute('author')?.description).toMatch(/blank/i)
      expect(attribute('author')?.description).toContain('{{entry.author}}')
      expect(attribute('showAuthor')?.component).toBe(
        Aglyn.FieldComponentType.SWITCH,
      )
    })
  })

  describe('Avatar', () => {
    it('renders the chosen brand mark as a 36px round image', () => {
      const { container } = render(
        <CollectionEntryMeta
          avatarImage="https://cdn.example.com/mark.png"
          author="The Aglyn Team"
          date="Jul 2026"
        />,
      )
      const image = container.querySelector('img') as HTMLElement
      expect(image.getAttribute('src')).toBe('https://cdn.example.com/mark.png')
      const style = window.getComputedStyle(image)
      expect(style.width).toBe('36px')
      expect(style.height).toBe('36px')
      expect(style.borderRadius).toBe('50%')
    })

    it('resolves a media reference at render, like every other surface', () => {
      const { container } = render(
        <CollectionEntryMeta avatarImage="media:org:jWmGooWE3L/4GF1hRJBUp" />,
      )
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        '/api/media/cdn/org:jWmGooWE3L/4GF1hRJBUp',
      )
    })

    it('renders NO image rather than a broken one', () => {
      // An unresolved token and an empty pick are the same answer: nothing.
      for (const avatarImage of ['{{entry.coverImage}}', '', '   ']) {
        const { container, unmount } = render(
          <CollectionEntryMeta avatarImage={avatarImage} date="Jul 2026" />,
        )
        expect(container.querySelectorAll('img')).toHaveLength(0)
        unmount()
      }
    })

    it('hides behind Show avatar without losing the picked image', () => {
      const { container } = render(
        <CollectionEntryMeta
          avatarImage="https://cdn.example.com/mark.png"
          author="The Aglyn Team"
          showAvatar={false}
        />,
      )
      expect(container.querySelectorAll('img')).toHaveLength(0)
      expect(screen.getByText('The Aglyn Team')).toBeTruthy()
    })

    it('is a media-picker target, so the library button appears on it', () => {
      // The besigner offers Browse on any TEXT_FIELD whose name ends in
      // image/logo/avatar/… (AGL-341); a differently-spelled prop would be a
      // URL box with no picker.
      expect(attribute('avatarImage')?.component).toBe(
        Aglyn.FieldComponentType.TEXT_FIELD,
      )
      expect(
        /^(src|poster)$|(image|logo|avatar|media|thumbnail|photo|background)(Url)?$/i.test(
          'avatarImage',
        ),
      ).toBe(true)
    })
  })

  describe('Date format', () => {
    it('offers the named shapes the pure layer knows how to produce', () => {
      const dateFormat = attribute('dateFormat')
      expect(dateFormat?.component).toBe(Aglyn.FieldComponentType.SELECT)
      expect((dateFormat?.options ?? []).map((option: any) => option.value))
        .toEqual(
          Aglyn.COLLECTION_ENTRY_DATE_FORMAT_OPTIONS.map(
            (option) => option.value,
          ),
        )
    })

    it('gives every option a value that can actually be saved (AGL-1453)', () => {
      // "Use the entry's default" is a REAL value. `''` cannot survive a save,
      // so an author who tried a format would have no route back.
      for (const option of (attribute('dateFormat')?.options ?? []) as any[]) {
        expect(option.value).toBeTruthy()
        expect(option.label).toBeTruthy()
      }
    })

    it('is compose-time, so it never reaches the DOM', () => {
      const { container } = render(
        <CollectionEntryMeta
          date="Jul 2026"
          dateFormat="monthYear"
          author="The Aglyn Team"
          showAuthor
          showAvatar
          avatarImage=""
        />,
      )
      const root = container.firstElementChild as HTMLElement
      for (const name of [
        'dateFormat',
        'author',
        'showAuthor',
        'showAvatar',
        'avatarImage',
      ]) {
        expect(root.getAttribute(name)).toBeNull()
      }
    })

    it('renders the frame’s byline end to end', () => {
      // What frame 170:190 asks for: brand mark, name, `· Jul 2026`.
      const { container } = render(
        <CollectionEntryMeta
          avatarImage="https://cdn.example.com/mark.png"
          author="The Aglyn Team"
          date={Aglyn.formatCollectionEntryDate(
            { seconds: 1_784_116_800 },
            'monthYear',
            'en-US',
          )}
          showCategory={false}
          showTags={false}
        />,
      )
      expect(container.querySelector('img')).toBeTruthy()
      expect(screen.getByText('The Aglyn Team · Jul 2026')).toBeTruthy()
    })
  })
})
