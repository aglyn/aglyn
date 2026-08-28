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

/**
 * ONE table footer, and no call site may re-decide it (AGL-693).
 *
 * Left to themselves the lists disagree: layouts page 5 at a time, components
 * and templates 10, the team list 10, the screens tree 25, with the size menu
 * labeled three different ways. Nothing is wrong with any single one — they
 * are written at different times and each picks its own numbers, which is what
 * a shared control looks like when nothing holds it together.
 *
 * A constant alone would not hold it: the next list added to the console can
 * type `[5, 10, 15]` and nothing objects. So this reads the SOURCE of every
 * footer in the console and fails on a literal, which is the only version of
 * this guard that survives the next list.
 *
 * Two page families are covered because the console has two — MUI X
 * `DataGrid` (`pageSizeOptions`) and a hand-rolled `TablePagination`
 * (`rowsPerPageOptions`) — and the whole point is that a reader cannot tell
 * which one they are standing in.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../constants/shared'

const REPO = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** Every file that renders a paginated footer from the primitives. */
const FOOTERS: Array<[string, string]> = [
  // The grid family: layouts, components and templates all render through it.
  [
    'the shared list table',
    'libs/shared/ui/jsx/src/lib/components/list-table.component.tsx',
  ],
  // The bespoke family.
  ['screens tree', 'apps/console/components/screens-hierarchy-table.component.tsx'],
  ['team list', 'apps/console/components/org-members-card.component.tsx'],
  [
    'content entries',
    'apps/console/components/content/collection-entries-page.component.tsx',
  ],
  // The shared footer itself — every cursor and window feed renders through
  // it, so it is the one that must not re-decide the options or the label.
  [
    'shared list pagination',
    'libs/shared/ui/jsx/src/lib/components/list-pagination.component.tsx',
  ],
]

/**
 * Lists that had NO footer at all — a bare Previous/Next pair, or a "Load
 * more" that only ever grew — and now render the shared one.
 *
 * Two of the console's four pagination grammars offered no way to change the
 * page size, and the activity feeds were both of them: a reader could page
 * through an audit log ten rows at a time and had no control saying so.
 */
const SHARED_FOOTER: Array<[string, string]> = [
  ['org activity', 'apps/console/components/org-activity-card.component.tsx'],
  ['site activity', 'apps/console/components/host-activity-table.component.tsx'],
  // The shared activity/audit table, which is where the actor feed's footer
  // now lives — two audit tables stacked on the staff user page were two
  // implementations, and adding a footer to the hand-rolled one would have
  // made them similar rather than the same.
  ['activity table', 'apps/console/components/activity-table.component.tsx'],
  ['notifications', 'apps/console/app/(app)/manage/notifications/page.tsx'],
  /*
   * The staff audit log, which kept a "Load older" of its own — a fifth
   * grammar that escaped both walks below, because it is a page rather than
   * a component and because its button did not say "Load more". It grew a
   * 200-row window 200 rows at a time and could only ever go forward.
   */
  ['audit log', 'apps/console/app/(app)/admin/audit/page.tsx'],
  ['staff lists', 'apps/console/components/staff-list-pagination.component.tsx'],
  ['site collaborators', 'apps/console/components/host-members-card.component.tsx'],
  ['site accounts', 'apps/console/components/site-accounts-card.component.tsx'],
  // The console's OWN artifact lists. The sweep that converted the plugin
  // cards never walked `apps/console`, so these three carried the same defect
  // one directory over from the guard that was supposed to cover it.
  [
    'site layouts',
    'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/page.tsx',
  ],
  [
    'reusable components',
    'apps/console/components/host-components-card.component.tsx',
  ],
  [
    'per-screen traffic',
    'apps/console/components/analytics/screens-analytics-table.component.tsx',
  ],
  // Plugin console cards are lists too, and were the worst of the four
  // grammars: a big read sliced small, with no control at all.
  ...(
    [
      'gift-cards-card',
      'host-coupons-card',
      'member-posts-card',
      'reservations-card',
      'reviews-moderation-card',
    ].map((name) => [
      `commerce ${name}`,
      `libs/plugins/commerce/src/lib/components/console/${name}.component.tsx`,
    ]) as Array<[string, string]>
  ),
  // Three card GRIDS and a bare table, all of which rendered their whole
  // window in one wall with no control over it at all. A grid is still a
  // list: the reader's question — how much of this am I looking at, and is
  // there more — is the same one, and it was unanswerable on all four.
  [
    'marketplace browse',
    'libs/plugins/marketplace/src/lib/components/marketplace-browse.component.tsx',
  ],
  [
    'templates gallery',
    'apps/console/components/templates/template-gallery-dialog.component.tsx',
  ],
  [
    'datasets records',
    'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
  ],
]

/**
 * The two lists that keep "Load more", and why.
 *
 * Neither is a table. The DAM grid completes a SEARCH as it loads — it reads
 * until the filter is satisfied or a document ceiling is hit (AGL-1460), so
 * "how many pages" is not a question it can answer, and a page number would
 * be a number about the wrong thing. The storefront product grid is a
 * shopper's browse surface on a published site, where a pager is a different
 * design decision from a console list's.
 *
 * Listed rather than skipped: an exclusion nobody wrote down is
 * indistinguishable from one nobody noticed.
 */
const LOAD_MORE_ALLOWED = [
  'apps/console/components/media/media-library.component.tsx',
  'libs/plugins/commerce/src/lib/components/product-grid.tsx',
]

/** A literal page-size array anywhere in a footer prop. */
const LITERAL_OPTIONS = /(?:rowsPerPage|pageSize)Options=\{\[/
/**
 * A literal label in the size-menu slot, in either spelling — the JSX prop
 * (`labelRowsPerPage="…"`) and the `slotProps` object form the grid family
 * has to use (`labelRowsPerPage: '…'`).
 */
const LITERAL_LABEL = /labelRowsPerPage(?:=|:\s*)(?:["']|\{\s*['"])/

describe('the console has one table footer (AGL-693)', () => {
  it.each(FOOTERS)('%s takes the shared options and label', (_label, path) => {
    const source = read(path)
    expect(source).toContain('TABLE_PAGE_SIZE_OPTIONS')
    expect(source).toContain('TABLE_ROWS_PER_PAGE_LABEL')
  })

  it.each(FOOTERS)('%s hardcodes neither of them', (_label, path) => {
    const source = read(path)
    expect(source).not.toMatch(LITERAL_OPTIONS)
    expect(source).not.toMatch(LITERAL_LABEL)
  })

  it('THE CONTROL: those patterns catch what they are meant to catch', () => {
    // Guard the guard. A regex that matched nothing would let every
    // assertion above pass on a file that had gone back to literals.
    expect('rowsPerPageOptions={[10, 25, 50]}').toMatch(LITERAL_OPTIONS)
    expect('pageSizeOptions={[5, 10, 15]}').toMatch(LITERAL_OPTIONS)
    expect(`labelRowsPerPage="Entries per page:"`).toMatch(LITERAL_LABEL)
    expect(`labelRowsPerPage: 'Rows per page:'`).toMatch(LITERAL_LABEL)
    expect('rowsPerPageOptions={TABLE_PAGE_SIZE_OPTIONS}').not.toMatch(
      LITERAL_OPTIONS,
    )
    expect('labelRowsPerPage={TABLE_ROWS_PER_PAGE_LABEL}').not.toMatch(
      LITERAL_LABEL,
    )
    expect('labelRowsPerPage: TABLE_ROWS_PER_PAGE_LABEL').not.toMatch(
      LITERAL_LABEL,
    )
  })

  it('every list starts on the SMALLEST page size', () => {
    // options rather than against `10`, so the rule outlives the number: a
    // default that stops being the minimum is the failure, whatever the
    // minimum becomes.
    expect(TABLE_PAGE_SIZE_DEFAULT).toBe(Math.min(...TABLE_PAGE_SIZE_OPTIONS))
    expect(TABLE_PAGE_SIZE_DEFAULT).toBe(TABLE_PAGE_SIZE_OPTIONS[0])
  })

  it('every list starts on the same page size', () => {
    // The three lists that own their own page-size state, and the one that
    // sets it through `initialState`. A default that differs per list is the
    // most visible half of the inconsistency — it is the number on screen.
    for (const path of [
      'apps/console/components/screens-hierarchy-table.component.tsx',
      'apps/console/components/org-members-card.component.tsx',
      'apps/console/components/content/collection-entries-page.component.tsx',
      'apps/console/components/analytics/screens-analytics-table.component.tsx',
      'libs/shared/ui/jsx/src/lib/components/list-table.component.tsx',
      // The shared window hook, which is where a server-paged list gets its
      // default now — the layouts page used to hold this state itself and no
      // longer does, so the constant has to be asserted where it moved to or
      // the rule quietly stops covering every list that adopts the hook.
      'libs/tenant/feature/instance/src/lib/hooks/use-paged-collection.ts',
    ]) {
      expect(read(path)).toContain('TABLE_PAGE_SIZE_DEFAULT')
    }
    // And the default is one the options menu can actually select — a
    // default outside the menu renders an out-of-range MUI select warning
    // and a blank size box.
    expect(TABLE_PAGE_SIZE_OPTIONS).toContain(TABLE_PAGE_SIZE_DEFAULT)
  })

  it('labels the size menu with a generic noun, on every list', () => {
    // Including the screens tree, which pages TOP-LEVEL screens: that
    // difference belongs in the COUNT, and the count says so.
    expect(TABLE_ROWS_PER_PAGE_LABEL).toBe('Rows per page:')
    expect(read(FOOTERS[1][1])).toContain('top-level')
  })
})

/**
 * No list may grow its own pager again (AGL-693, extended).
 *
 * A constant and a component are not enough on their own: the previous round
 * of this left four grammars standing, and every one of them began as a
 * reasonable two-button Stack written next to the list it served. This walks
 * the console's component tree and fails on the SHAPE, which is the only
 * version of the guard that survives the next list.
 */
const CONSOLE_COMPONENTS = join(__dirname, '..', 'components')
/**
 * The console's PAGES, which no walk in this file used to reach.
 *
 * Every check here walked `apps/console/components` and the plugin trees and
 * stopped there — so the layouts page, the screens page and every other list
 * that lives in the route tree sat outside a guard whose name says it covers
 * the console. Three of them were still on the unordered `limit()` this file
 * exists to catch, one directory over from the assertion that would have
 * caught them.
 */
const CONSOLE_PAGES = join(__dirname, '..', 'app')

function tsxFilesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...tsxFilesUnder(path))
      continue
    }
    if (entry.name.endsWith('.tsx') && !entry.name.includes('.spec.')) {
      found.push(path)
    }
  }
  return found
}

/**
 * Every plugin's console components, not one plugin's.
 *
 * The previous version of this walk named `libs/plugins/commerce` outright,
 * so the marketplace grid, the template gallery and the datasets table — all
 * lists, all rendering their whole window at once — sat outside a guard whose
 * name says it covers plugin console cards.
 */
function pluginComponentFiles(): string[] {
  const root = join(REPO, 'libs', 'plugins')
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const components = join(root, entry.name, 'src', 'lib', 'components')
    try {
      found.push(...tsxFilesUnder(components))
    } catch {
      // A plugin with no components directory. Not every plugin renders.
    }
  }
  return found
}

/** A hand-rolled pager: a Previous label and a Next label in one file. */
const handRolledPager = (source: string) =>
  /\{'Previous'\}/.test(source) && /\{'Next'\}/.test(source)

describe('no list hand-rolls a pager (AGL-693)', () => {
  it('THE CONTROL: the shape check catches what it is meant to catch', () => {
    // Guard the guard. A check that matched nothing would pass over a console
    // that had grown ten new two-button pagers.
    expect(handRolledPager(`<Button>{'Previous'}</Button><Button>{'Next'}</Button>`)).toBe(
      true,
    )
    expect(handRolledPager(`<ListPagination page={0} />`)).toBe(false)
  })

  it('no console or plugin component renders its own Previous/Next pair', () => {
    const offenders = [
      ...tsxFilesUnder(CONSOLE_COMPONENTS),
      ...tsxFilesUnder(CONSOLE_PAGES),
      ...pluginComponentFiles(),
    ]
      .filter((path) => handRolledPager(readFileSync(path, 'utf8')))
      .map((path) => path.replace(`${REPO}/`, ''))
    expect(offenders).toEqual([])
  })

  it.each(SHARED_FOOTER)('%s renders the shared footer', (_label, path) => {
    expect(read(path)).toContain('<ListPagination')
  })

  it.each(SHARED_FOOTER)('%s does not re-decide the page size', (_label, path) => {
    const source = read(path)
    expect(source).not.toMatch(LITERAL_OPTIONS)
    expect(source).not.toMatch(LITERAL_LABEL)
  })
})

describe('no list keeps a bespoke "Load more" (AGL-693)', () => {
  const CONSOLE_ROOT = join(REPO, 'apps', 'console', 'components')
  // The literal, not one JSX spelling of it: the storefront grid writes
  // `{loadingMore ? 'Loading…' : 'Load more'}`, which a check for
  // `{'Load more'}` walks straight past.
  const LOADS_MORE = /'Load more'/
  const repoRelative = (path: string) => path.replace(`${REPO}/`, '')

  it('THE CONTROL: the check catches both spellings', () => {
    expect(LOADS_MORE.test(`<Button>{'Load more'}</Button>`)).toBe(true)
    expect(
      LOADS_MORE.test(`{loadingMore ? 'Loading…' : 'Load more'}`),
    ).toBe(true)
    expect(LOADS_MORE.test(`<ListPagination page={0} />`)).toBe(false)
  })

  it('only the two documented grids still grow instead of paging', () => {
    const offenders = [
      ...tsxFilesUnder(CONSOLE_ROOT),
      ...tsxFilesUnder(join(REPO, 'apps', 'console', 'app')),
      ...pluginComponentFiles(),
    ]
      .filter((path) => LOADS_MORE.test(readFileSync(path, 'utf8')))
      .map(repoRelative)
      .filter((path) => !LOAD_MORE_ALLOWED.includes(path))
    expect(offenders).toEqual([])
  })

  it('THE CONTROL: the plugin walk reaches more than one plugin', () => {
    // The walk named `commerce` and only commerce, so every list the
    // marketplace and data plugins rendered was outside the guard that was
    // supposed to cover plugin console cards — which is how three of them
    // stayed unconverted while this file read as complete. A walk that has
    // narrowed back to one plugin would pass every assertion above by
    // finding nothing.
    const reached = new Set(
      pluginComponentFiles().map(
        (path) => repoRelative(path).split('/')[2],
      ),
    )
    expect(reached.size).toBeGreaterThan(1)
    for (const plugin of ['commerce', 'marketplace', 'data']) {
      expect(reached.has(plugin)).toBe(true)
    }
  })

  it('the allowlist names files that EXIST and still load more', () => {
    // An allowlist entry that has gone stale silently widens the exemption.
    for (const path of LOAD_MORE_ALLOWED) {
      expect(read(path)).toMatch(LOADS_MORE)
    }
  })
})

/**
 * A paged list names its ORDER (AGL-693, and the six times before it).
 *
 * `limit()` with no `orderBy` is not "the first N". Firestore answers it in
 * document-id order, and every collection here is keyed by a generated id — so
 * the window is a pseudo-random sample of the collection. It then gets sorted
 * in the browser, which is what makes the bug invisible: the rows on screen
 * are in a believable order, they are simply the wrong rows, and the ones
 * missing leave no gap to notice.
 *
 * This has now been the same bug seven times in this repo. A guard that names
 * the SHAPE is the only version that survives the eighth: any file with a
 * footer under it, that builds a capped Firestore query, has to say what the
 * cap is a cap ON.
 *
 * It is a coarse check — one `orderBy` anywhere in a file with several queries
 * satisfies it — and coarse is what catches the failure that actually happens,
 * which is a paged list with no ordering anywhere in sight.
 */
const UNORDERED_BY_DESIGN = [
  /*
   * A coupon's document ID *is* its code. Document-id order is therefore
   * already the alphabetical order the list wants, so the default is not a
   * fallback here — it is the intended ordering, named in the file.
   *
   * Listed rather than skipped: an exemption nobody wrote down is
   * indistinguishable from one nobody noticed.
   */
  'libs/plugins/commerce/src/lib/components/console/host-coupons-card.component.tsx',
]

/**
 * Source with comments removed.
 *
 * Every file in this list DISCUSSES `limit()` and `orderBy()` — several of
 * them at length, because that is where the reasoning for the current query
 * lives. Reading the prose would make the check pass on a file whose
 * explanation survived and whose query did not.
 */
const withoutComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, (_match, before) => before)

/**
 * A list is a file that DRAWS one, not a file somebody remembered to list.
 *
 * The check above walked two hand-written arrays, so it could only ever ask
 * the question of surfaces already converted — which is how four console
 * lists (the layouts page, the components card, the templates library and the
 * screens tree's read) stayed on an unordered `limit()` while this file read
 * as complete. The walk asks every file that renders a footer.
 *
 * A file that caps a query and draws NO footer is out of scope here on
 * purpose: it is a lookup — a picker's option list, a provider's cache, an
 * editor's working set — and those are a different question from a list, with
 * a different answer. This guard is about the surfaces a reader pages
 * through.
 */
const DRAWS_A_FOOTER =
  /<ListPagination|<ListTable|<DataTableComponent|<TablePagination|<DataGrid|<ScreensHierarchyTable/

/** Every file in the console and the plugins that renders a paginated list. */
function footerFiles(): string[] {
  return [
    ...tsxFilesUnder(CONSOLE_COMPONENTS),
    ...tsxFilesUnder(CONSOLE_PAGES),
    ...pluginComponentFiles(),
  ].filter((path) => DRAWS_A_FOOTER.test(withoutComments(readFileSync(path, 'utf8'))))
}

describe('every list that DRAWS a footer names its order (AGL-693)', () => {
  const repoRelative = (path: string) => path.replace(`${REPO}/`, '')

  it('THE CONTROL: the footer check catches what it is meant to catch', () => {
    // Guard the guard. A pattern that matched nothing would leave the walk
    // below with an empty set and every assertion vacuously true.
    expect(DRAWS_A_FOOTER.test(`<ListPagination page={0} />`)).toBe(true)
    expect(DRAWS_A_FOOTER.test(`<ListTable rows={rows} />`)).toBe(true)
    expect(DRAWS_A_FOOTER.test(`<Stack><Button>More</Button></Stack>`)).toBe(false)
  })

  it('THE CONTROL: the walk reaches the console PAGES, not only components', () => {
    // The narrowing this widening exists to prevent. A walk that lost the
    // route tree would pass every assertion below by never looking at the
    // three lists that were broken.
    const reached = footerFiles().map(repoRelative)
    expect(
      reached.some((path) => path.startsWith('apps/console/app/')),
    ).toBe(true)
    expect(
      reached.some((path) => path.startsWith('apps/console/components/')),
    ).toBe(true)
    expect(
      reached.some((path) => path.startsWith('libs/plugins/')),
    ).toBe(true)
  })

  it('THE CONTROL: some of those lists really do cap a query', () => {
    // Otherwise the filter below is satisfied by a set of files that never
    // touch Firestore, and the guard passes by never testing anything.
    const capped = footerFiles().filter((path) =>
      /\blimit\(/.test(withoutComments(readFileSync(path, 'utf8'))),
    )
    expect(capped.length).toBeGreaterThan(5)
  })

  it('no list caps a query it has not ordered', () => {
    const unordered = footerFiles()
      .map(repoRelative)
      .filter((path) => !UNORDERED_BY_DESIGN.includes(path))
      .filter((path) => {
        const code = withoutComments(read(path))
        return /\blimit\(/.test(code) && !/\borderBy\(/.test(code)
      })
    expect(unordered).toEqual([])
  })
})

/**
 * The four site artifact lists ask ONE query builder (AGL-693).
 *
 * They read four different collections under `hosts/{id}` and every one of
 * them faces the same question: `orderBy` matches only documents that HAVE
 * the field, so ordering on `displayName` — the field all four are sorted by
 * on screen — hides every artifact a writer created without one. Four call
 * sites answering that separately is how three of them answered it by not
 * ordering at all.
 *
 * `hostArtifactQuery` is where the answer lives, so this asserts the surfaces
 * ASK through it rather than merely that they contain an `orderBy` somewhere.
 */
const ARTIFACT_LISTS: Array<[string, string]> = [
  ['screens', 'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx'],
  ['layouts', 'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/page.tsx'],
  ['components', 'apps/console/components/host-components-card.component.tsx'],
  [
    'templates',
    'apps/console/components/templates/host-templates-card.component.tsx',
  ],
]

describe('the site artifact lists share one ordering decision (AGL-693)', () => {
  it.each(ARTIFACT_LISTS)('the %s list asks through the shared builder', (
    _label,
    path,
  ) => {
    const code = withoutComments(read(path))
    expect(code).toContain('hostArtifactQuery(')
    // And does not go around it. A second capped query written beside the
    // shared one is how a list ends up with two orderings, only one of which
    // anybody reviews — so these files build no `limit()` of their own at
    // all. (Uncapped reads are untouched: the templates card counts screens
    // with a server aggregate, which is a different question from a list.)
    expect(code).not.toMatch(/\blimit\(/)
  })

  it('the builder orders on the document NAME, which cannot be absent', () => {
    // The decision itself, asserted where it lives. `orderBy('displayName')`
    // here would not mis-sort these lists, it would silently drop every
    // artifact created without a name — a worse failure, and an invisible one.
    const builder = withoutComments(
      read('apps/console/utils/host-artifact-queries.ts'),
    )
    expect(builder).toContain('orderBy(documentId())')
    expect(builder).not.toMatch(/orderBy\('displayName'/)
  })

  it('none of them re-sorts the window it was handed', () => {
    // Sorting a server-ordered page in the browser is what made the original
    // bug invisible: the rows run in a believable order and are the wrong
    // rows. The two lists that read a CEILING rather than a page may sort —
    // they hold the whole collection — so this covers the paged two.
    for (const path of [
      'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/page.tsx',
      'apps/console/components/host-components-card.component.tsx',
    ]) {
      expect(withoutComments(read(path))).not.toMatch(/\.sort\(/)
    }
  })

  it('the two ceilinged reads probe for what they could not read', () => {
    // A tree and a template bundle cannot be sliced by document, so both read
    // a ceiling. A ceiling with no probe is a partial site rendered as a whole
    // one, which is the failure the pager solves for every other list.
    for (const path of [
      'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx',
      'apps/console/components/templates/host-templates-card.component.tsx',
    ]) {
      const code = withoutComments(read(path))
      expect(code).toContain('ceilingedWindow')
      expect(code).toMatch(/WINDOW \+ 1/)
    }
  })
})

describe('a paged list names its order (AGL-693)', () => {
  it('THE CONTROL: the comment stripper reads code, not prose', () => {
    // Both halves matter. A stripper that removed nothing would let a file
    // pass on its own docblock; one that removed everything would make every
    // assertion below vacuous.
    expect(withoutComments(`// query(x, limit(200))\nquery(y, orderBy('a'))`))
      .not.toContain('limit(')
    expect(withoutComments(`/* limit(200) */\nquery(y, limit(10))`)).toContain(
      'limit(',
    )
    // A `//` inside a URL is not a comment, and several of these files carry
    // license headers full of them.
    expect(withoutComments(`const u = 'https://example.test/x'`)).toContain(
      'https://example.test',
    )
  })

  it('every paged list that caps a query also orders it', () => {
    const unordered = [...FOOTERS, ...SHARED_FOOTER]
      .map(([, path]) => path)
      .filter((path) => !UNORDERED_BY_DESIGN.includes(path))
      .filter((path) => {
        const code = withoutComments(read(path))
        return /\blimit\(/.test(code) && !/\borderBy\(/.test(code)
      })
    expect(unordered).toEqual([])
  })

  it('THE CONTROL: some of those files do cap a query', () => {
    // Otherwise the filter above is satisfied by a list of files that never
    // touch Firestore, and the test passes by never testing anything.
    const capped = [...FOOTERS, ...SHARED_FOOTER]
      .map(([, path]) => path)
      .filter((path) => /\blimit\(/.test(withoutComments(read(path))))
    expect(capped.length).toBeGreaterThan(5)
  })

  it('the exemption still EXISTS and still explains itself', () => {
    // An allow-list entry that has gone stale silently widens the exemption —
    // and this one is only safe while the reason in the file is still true.
    for (const path of UNORDERED_BY_DESIGN) {
      const source = read(path)
      expect(withoutComments(source)).toMatch(/\blimit\(/)
      expect(source).toContain('document ID is its CODE')
    }
  })
})


/**
 * A TABLE with no footer under it (AGL-693, and the reason this kept being
 * found one at a time).
 *
 * Every check above this point looks for a PAGER — a hand-rolled Previous/Next
 * pair, a "Load more", a `limit()` that forgot its `orderBy`. A card that
 * renders a `<Table>` over an array it already holds matches none of them: it
 * has no pager to be inconsistent, no cap to be unordered, and no footer at
 * all. So three consecutive sweeps each scoped to a directory found these one
 * at a time, and the guard was silent between them because it was looking for
 * the wrong shape.
 *
 * This looks for the shape that actually matters: rows mapped into a `<Table>`
 * (or a grid with its own footer switched off) and nothing under them. Every
 * such file must be classified — converted, or named here with the reason it
 * is not a list. A file in neither list fails, which is what stops the next
 * one arriving unnoticed.
 */
const RENDERS_A_TABLE = /<Table\b/
const MAPS_ROWS_INTO_IT = /\.map\([\s\S]{0,400}?<TableRow/
/** A grid renders its own footer unless the caller turns it off. */
const GRID_FOOTER_SWITCHED_OFF = /hideFooter/
/**
 * `StaffListPagination` counts: it is `ListPagination` with the page size
 * fixed by the route behind it, and a check that missed it would report three
 * already-paged staff lists as unpaginated.
 */
const RENDERS_A_FOOTER = /<ListPagination|<TablePagination|<StaffListPagination/

const unpaginatedTable = (source: string) => {
  const code = withoutComments(source)
  if (RENDERS_A_FOOTER.test(code)) return false
  return (
    (RENDERS_A_TABLE.test(code) && MAPS_ROWS_INTO_IT.test(code)) ||
    GRID_FOOTER_SWITCHED_OFF.test(code)
  )
}

/**
 * Every table in the console AND in the plugins.
 *
 * The walk stopped at `apps/console`, which is how a sweep that found twelve
 * of these could report itself complete with twenty-five more standing one
 * directory over. A plugin console card is the same surface as a console one —
 * it renders into the same shell, under the same header, for the same reader —
 * and the collections behind the plugin cards are the ones that grow FASTEST:
 * a site's form submissions, its leads, its stock ledger, its suppression list.
 */
function tablesWithoutFooters(): string[] {
  return [
    ...tsxFilesUnder(CONSOLE_PAGES),
    ...tsxFilesUnder(CONSOLE_COMPONENTS),
    ...pluginComponentFiles(),
  ]
    .filter((path) => unpaginatedTable(readFileSync(path, 'utf8')))
    .map((path) => path.replace(`${REPO}/`, ''))
    .sort()
}

/**
 * NOT a list: a fixed or bounded set, where a pager would be a control about
 * nothing and the second page would always be empty.
 *
 * The distinction is what the row COUNT is a function of. A row per US state,
 * per configuration knob, per month in a fixed window or per line of a
 * statutory form is bounded by the taxonomy; a row per invoice, per version or
 * per audited action is bounded by how long the account has existed.
 */
const NOT_A_LIST: Array<[string, string]> = [
  [
    'apps/console/app/(app)/admin/revenue/page.tsx',
    'Attribution and earnings BREAKDOWNS — one row per traffic source, plan ' +
      'or refund cause. The cardinality is the taxonomy’s, not the traffic’s.',
  ],
  [
    'apps/console/app/(app)/admin/tax-return/page.tsx',
    'Form 01-114’s filing lines are fixed by the form, and the breakdowns ' +
      'beside them run one row per state or jurisdiction. Another agent owns ' +
      'this file today; the classification is not why it is untouched.',
  ],
  [
    'apps/console/components/server-config-card.component.tsx',
    'One row per declared configuration knob — a fixed set the server ships.',
  ],
  [
    'apps/console/components/staff-org-usage-table.component.tsx',
    'One row per month in a fixed window.',
  ],
  [
    'apps/console/components/theme-editor/theme-overrides-card.component.tsx',
    'One row per overridden theme token on one site, described from the ' +
      'theme’s own shape.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/hosts/[host]/templates/[templateId]/page.tsx',
    'The sibling PAGES of one starter bundle, bounded by what the bundle ' +
      'holds — the library that lists bundles is paged separately.',
  ],
  [
    'apps/console/app/(app)/admin/users/[uid]/page.tsx',
    'The two tables left here are one row per ORGANIZATION this account ' +
      'belongs to and one per legal document version it has accepted — both ' +
      'bounded by what the account IS rather than by what it has done. The ' +
      'audit trail, which was bounded by the latter, renders `ActivityTable`.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/product-editor-dialog.component.tsx',
    'One row per VARIANT of the single product being edited, and the variant ' +
      'set is the cross-product of the options this same dialog defines a few ' +
      'lines above the table. Its size is the author’s own choice, made on ' +
      'screen, and every row is an input the save reads — a page boundary ' +
      'would hide half a form from the submit that posts all of it.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/storefront-tax-summary-card.component.tsx',
    'One row per JURISDICTION inside one liability bucket, which is the same ' +
      'shape as the console’s revenue breakdowns: the cardinality belongs to ' +
      'the tax taxonomy a store sells into, not to how long it has traded.',
  ],
  [
    'libs/plugins/marketing/src/lib/components/host-overlays-card.component.tsx',
    'A PRECEDENCE list: the first enabled overlay of each kind is the one a ' +
      'visitor sees, and the arrows reorder by swapping `order` with the ' +
      'ADJACENT row — so a page boundary separates a row from the neighbor it ' +
      'would trade places with and the eleventh overlay could never be moved ' +
      'into tenth. Ceilinged and ordered instead, with a probe, exactly like ' +
      'the console’s screen tree and starter bundles.',
  ],
]

/**
 * A real list that still owes a footer, and what stands in the way today.
 *
 * Listed rather than skipped, and listed even where this pass could not fix
 * it: a guard that omits what it cannot fix today is exactly how this became
 * a dozen surfaces found one at a time. The list may shrink. It may not grow
 * without someone writing a reason next to the addition.
 */
const OWES_A_FOOTER: Array<[string, string]> = [
  [
    'apps/console/app/(app)/[orgSlug]/billing/page.tsx',
    'Invoices, one per month forever. Billing is out of this pass’s scope.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/hosts/[host]/components/[componentId]/page.tsx',
    'Version history, `limit(100)` unordered and sorted by `createdAt` in the ' +
      'browser. Blocked on the ordering trap: `IMPORTABLE_FIELDS.versions` ' +
      'carries no `createdAt`, so a version restored from a site bundle has ' +
      'none — `orderBy(\'createdAt\')` would hide restored versions rather ' +
      'than mis-order them. Needs an audit of `updatedAt`’s writers, or a ' +
      'backfill, before it can be paged.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/[layoutId]/page.tsx',
    'The same version history, the same block.',
  ],
  [
    'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
    'The same version history, the same block.',
  ],
  [
    'apps/console/components/besigner-versions.component.tsx',
    'The same version history, the same block.',
  ],
  [
    'apps/console/app/(app)/admin/assist-signals/page.tsx',
    'Mined signal rows, which grow with usage. Another agent owns this file.',
  ],
  [
    'apps/console/app/(app)/admin/health/page.tsx',
    'The CSP report table renders `csp.rows.slice(0, 100)` — a silent ' +
      'truncation, not a bound. The CHECK tables beside it are a fixed set ' +
      'and would not want a pager.',
  ],
  [
    'apps/console/app/(app)/admin/orgs/[orgId]/page.tsx',
    'An organization’s invoices, one per month forever.',
  ],
  [
    'apps/console/components/org-licences-panel.component.tsx',
    'Marketplace licences held and sold, which grow with every purchase.',
  ],
  [
    'apps/console/components/org-sso-card.component.tsx',
    'The accounts a domain claim would move. A large customer’s domain is ' +
      'not a bounded preview.',
  ],
  [
    'apps/console/components/idempotency-claims-card.component.tsx',
    'Pending claims. They accumulate exactly when a process is stuck, which ' +
      'is the state this card exists to show — so the long list is the one ' +
      'that matters. `hideFooter` here was about rows having no detail page ' +
      'of their own, which is a different question from paging.',
  ],
  [
    'apps/console/components/pending-erasures-card.component.tsx',
    'Pending erasures, which accumulate for the same reason.',
  ],
  [
    'apps/console/components/staff-org-refund-card.component.tsx',
    'An organization’s charges, which grow with its trading.',
  ],
]

describe('a table with rows under it has a footer under those (AGL-693)', () => {
  it('THE CONTROL: the detector fires on a <Table> with no footer', () => {
    // The assertion this whole block turns on. The previous guards looked for
    // a pager, and a table that never had one matched nothing — so the spec
    // passed by asking the wrong question, which is how twelve of these
    // shipped.
    expect(
      unpaginatedTable(`
        <Table><TableBody>{rows.map((row) => (<TableRow key={row.id} />))}</TableBody></Table>
      `),
    ).toBe(true)
    // A grid whose own footer was switched off and given nothing in its place.
    expect(unpaginatedTable(`<ListTable rows={rows} hideFooter />`)).toBe(true)
  })

  it('THE CONTROL: it does not fire when a footer IS present', () => {
    // A check that fired on everything would make the classification below a
    // list of every file in the console, which is no classification at all.
    expect(
      unpaginatedTable(`
        <Table><TableBody>{rows.map((row) => (<TableRow key={row.id} />))}</TableBody></Table>
        <ListPagination page={0} pageSize={10} rowCount={rows.length} />
      `),
    ).toBe(false)
    // The staff wrapper counts: it is `ListPagination` with the page size
    // fixed by the route behind it.
    expect(
      unpaginatedTable(`<ListTable rows={rows} hideFooter /><StaffListPagination page={0} />`),
    ).toBe(false)
    // A table of static content maps nothing into itself.
    expect(
      unpaginatedTable(`<Table><TableBody><TableRow><TableCell>One</TableCell></TableRow></TableBody></Table>`),
    ).toBe(false)
  })

  it('THE CONTROL: the walk reaches both the pages and the components', () => {
    // Scoping this walk to one directory is what let three separate sweeps
    // each miss what the others had not reached.
    const found = tablesWithoutFooters()
    expect(found.some((path) => path.startsWith('apps/console/app/'))).toBe(true)
    expect(
      found.some((path) => path.startsWith('apps/console/components/')),
    ).toBe(true)
  })

  it('every unpaginated table is classified', () => {
    const classified = new Set([
      ...NOT_A_LIST.map(([path]) => path),
      ...OWES_A_FOOTER.map(([path]) => path),
    ])
    const unclassified = tablesWithoutFooters().filter(
      (path) => !classified.has(path),
    )
    expect(unclassified).toEqual([])
  })

  it('every classification still describes a real file', () => {
    // A stale entry silently widens the exemption, and an entry for a file
    // that has since been paged makes the owed list read as longer than it is.
    const found = new Set(tablesWithoutFooters())
    for (const [path, reason] of [...NOT_A_LIST, ...OWES_A_FOOTER]) {
      expect({ path, found: found.has(path) }).toEqual({ path, found: true })
      expect(reason.length).toBeGreaterThan(30)
    }
  })

  it('THE CONTROL: the walk reaches the PLUGIN trees too', () => {
    // The narrowing this widening exists to prevent, and the one that let a
    // sweep report itself complete: every check above walked `apps/console`
    // and stopped, so twenty-five plugin lists — the inbox, the suppression
    // list, the stock ledger — sat outside a guard whose name says it covers
    // a table with rows under it. A walk that lost the plugins would pass
    // every assertion below by never looking at them.
    const found = tablesWithoutFooters()
    expect(found.some((path) => path.startsWith('libs/plugins/'))).toBe(true)
    // And it reaches more than the one plugin that happens to be classified
    // today, or the guard narrows back the moment that file is converted.
    const plugins = new Set(
      pluginComponentFiles().map(
        (path) => path.replace(`${REPO}/`, '').split('/')[2],
      ),
    )
    expect(plugins.size).toBeGreaterThan(4)
  })

  it('the owed list only ever shrinks', () => {
    // A ratchet. Converting one of these means lowering the number with it;
    // adding a surface to the list means raising it, which is a change a
    // reviewer sees rather than a line lost in a diff.
    expect(OWES_A_FOOTER).toHaveLength(13)
    expect(NOT_A_LIST).toHaveLength(10)
  })
})

/**
 * A control that silently does nothing (AGL-693).
 *
 * `filterMode="server"` hands the whole filter model to the caller and stops
 * the grid applying any of it. A list that answers only `quickFilterValues`
 * has therefore turned its per-column filter panel into a funnel that sets a
 * filter nobody reads and nothing applies — and an inert control does not
 * read as unsupported, it reads as the list being broken.
 *
 * Two honest ways out: give each filterable column a server predicate, or
 * turn the panel off. This asserts a list took one of them.
 *
 * The predicate route goes through `gridFilterRequest`, the shared reader.
 * Reading `model.items` by hand is what a list does just before it forgets
 * that `isEmpty` carries no value and so is skipped by any check that
 * requires one — which is how an operator ends up in the menu and never in a
 * request.
 */
describe('server-filtered lists do not offer a dead filter panel', () => {
  const serverFiltered = tsxFilesUnder(join(REPO, 'apps', 'console'))
    .filter((path) => readFileSync(path, 'utf8').includes('filterMode="server"'))

  it('THE CONTROL: there is at least one such list to check', () => {
    // Otherwise every assertion below is vacuously true.
    expect(serverFiltered.length).toBeGreaterThan(0)
  })

  it('each one either disables the panel or reads the filter items', () => {
    const dead = serverFiltered
      .filter((path) => {
        const source = readFileSync(path, 'utf8')
        return (
          !source.includes('disableColumnFilter') &&
          !source.includes('gridFilterRequest')
        )
      })
      .map((path) => path.replace(`${REPO}/`, ''))
    expect(dead).toEqual([])
  })
})
