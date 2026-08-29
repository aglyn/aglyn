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
 * ONE table footer, and no call site may re-decide it (AGL-2501).
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

/**
 * Surfaces that still GROW instead of paging, and what stands in the way.
 *
 * A second list rather than more entries in the one above, for the same reason
 * `OWES_A_FOOTER` is not `NOT_A_LIST`: an exemption and a debt read identically
 * in an allow-list, and the debt is the one that has to shrink. This one is
 * ratcheted below; the exemption above is not.
 *
 * They were invisible until the check learned the other spellings — see the
 * pattern, which used to demand the exact string `'Load more'`.
 */
const GROWS_INSTEAD_OF_PAGING: Array<[string, string]> = [
  [
    'apps/console/components/org-switcher-nav.component.tsx',
    'The workspace switcher: a cursor feed inside a NAV menu, where the row ' +
      'count is the accounts one person belongs to and the control is a ' +
      'dropdown rather than a list surface. It shares its button with the two ' +
      'workspace PAGES below and should be decided with them.',
  ],
  [
    'apps/console/app/(app)/(home)/page.tsx',
    'The workspace list, which grows with every workspace a person joins. A ' +
      'page shell another agent is converting to routed sections.',
  ],
  [
    'apps/console/app/(app)/billing/page.tsx',
    'The same workspace list on the billing entry page — the same button, ' +
      'the same block.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/billing/(sections)/invoices/page.tsx',
    'Invoices, one per month forever, behind a "Load older invoices" that ' +
      'only goes one way. Billing is out of this pass’s scope, and the same ' +
      'table is already named in `OWES_A_FOOTER` for the footer it lacks.',
  ],
]

/** A literal page-size array anywhere in a footer prop. */
const LITERAL_OPTIONS = /(?:rowsPerPage|pageSize)Options=\{\[/
/**
 * A literal label in the size-menu slot, in either spelling — the JSX prop
 * (`labelRowsPerPage="…"`) and the `slotProps` object form the grid family
 * has to use (`labelRowsPerPage: '…'`).
 */
const LITERAL_LABEL = /labelRowsPerPage(?:=|:\s*)(?:["']|\{\s*['"])/

describe('the console has one table footer (AGL-2501)', () => {
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
 * No list may grow its own pager again (AGL-2501, extended).
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

describe('no list hand-rolls a pager (AGL-2501)', () => {
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

describe('no list keeps a bespoke "Load more" (AGL-2501)', () => {
  const CONSOLE_ROOT = join(REPO, 'apps', 'console', 'components')
  /**
   * A button that GROWS the list, in any of the spellings this repo uses.
   *
   * `/'Load more'/` was the whole check, and three things walked past it. The
   * workspace lists say `'Load more workspaces'`, so the closing quote never
   * arrived where the pattern wanted it. The staff audit log said
   * `'Load older'`. And the site activity card said `Show ${more} more`, which
   * is how a FOURTH pagination grammar stood beside this guard for as long as
   * the guard existed — the one failure it was written to prevent.
   *
   * So the shape, not the string: a quoted or templated label that opens with
   * Load or Show and carries `more` or `older`. It stays narrow enough not to
   * fire on the counts this console writes everywhere — `+${n} more`,
   * `Confirm ${n} more` — because those do not begin with the verb.
   */
  const LOADS_MORE =
    /(['"`])(?:Load|Show)\s[^'"`]*\b(?:more|older)\b[^'"`]*\1/
  const repoRelative = (path: string) => path.replace(`${REPO}/`, '')

  it('THE CONTROL: the check catches every spelling, and no counts', () => {
    expect(LOADS_MORE.test(`<Button>{'Load more'}</Button>`)).toBe(true)
    expect(
      LOADS_MORE.test(`{loadingMore ? 'Loading…' : 'Load more'}`),
    ).toBe(true)
    // The three that escaped it, each of which was a real surface.
    expect(LOADS_MORE.test(`{'Load more workspaces'}`)).toBe(true)
    expect(LOADS_MORE.test(`{'Load older invoices'}`)).toBe(true)
    expect(LOADS_MORE.test('{`Show ${more} more`}')).toBe(true)
    // And what it must NOT claim: a count is not a pager.
    expect(LOADS_MORE.test('{`+${n} more`}')).toBe(false)
    expect(LOADS_MORE.test('{`Confirm ${n} more`}')).toBe(false)
    expect(LOADS_MORE.test(`<ListPagination page={0} />`)).toBe(false)
  })

  it('THE CONTROL: it reads code, not the prose that discusses it', () => {
    // This check used to read raw source, so a docblock explaining the rule
    // broke the rule — which is not a hypothetical: the activity card's
    // conversion is documented in the card, quoting the button it removed.
    expect(
      LOADS_MORE.test(
        withoutComments(`/* the old 'Load more' button */\nconst x = 1`),
      ),
    ).toBe(false)
  })

  it('only the documented grids and the owed list still grow', () => {
    const growing = [
      ...tsxFilesUnder(CONSOLE_ROOT),
      ...tsxFilesUnder(join(REPO, 'apps', 'console', 'app')),
      ...pluginComponentFiles(),
    ]
      .filter((path) => LOADS_MORE.test(withoutComments(readFileSync(path, 'utf8'))))
      .map(repoRelative)
    const owed = GROWS_INSTEAD_OF_PAGING.map(([path]) => path)
    expect(
      growing.filter(
        (path) => !LOAD_MORE_ALLOWED.includes(path) && !owed.includes(path),
      ),
    ).toEqual([])
    // The debt only ever shrinks, and every entry still describes a surface
    // that really does grow — a stale line here widens the exemption silently.
    expect(GROWS_INSTEAD_OF_PAGING).toHaveLength(4)
    for (const path of owed) expect(growing).toContain(path)
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
 * A paged list names its ORDER (AGL-2501, and the six times before it).
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
/**
 * A file NAMES its order when it writes an `orderBy` — or when it asks
 * through the shared builder that carries one.
 *
 * The plugin cards moved their ordering into `collectionPage` /
 * `collectionCeiling` for the same reason the console's four artifact lists
 * moved theirs into `hostArtifactQuery`: the decision is subtle, identical
 * everywhere, and wrong in a way nobody sees. A guard that only knew the word
 * would have reported every one of those conversions as unordered.
 */
const NAMES_ITS_ORDER = /\borderBy\(|\bcollectionPage\(|\bcollectionCeiling\(/

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

describe('every list that DRAWS a footer names its order (AGL-2501)', () => {
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
        return /\blimit\(/.test(code) && !NAMES_ITS_ORDER.test(code)
      })
    expect(unordered).toEqual([])
  })

  it('THE CONTROL: asking through the builder counts, a bare cap does not', () => {
    // Guard the widened guard. `collectionPage`/`collectionCeiling` carry the
    // `orderBy` for their callers, so a file that asks through one has named
    // its order without writing the word — and a pattern that did not know
    // that would report every converted card as unordered. A pattern that
    // accepted anything would report none.
    expect(NAMES_ITS_ORDER.test("orderBy('createdAt', 'desc')")).toBe(true)
    expect(NAMES_ITS_ORDER.test('collectionPage(ref, pageLimit)')).toBe(true)
    expect(NAMES_ITS_ORDER.test('collectionCeiling(ref, CEILING)')).toBe(true)
    expect(NAMES_ITS_ORDER.test('query(ref, limit(200))')).toBe(false)
  })
})

/**
 * The plugin console lists share ONE ordering decision (AGL-2501).
 *
 * `hostArtifactQuery` answered this for the console's four site-artifact
 * lists and could not share the answer: an app cannot be imported from a
 * library, so every plugin card faced the same question alone and eleven of
 * them answered it by not ordering at all. `collectionPage` and
 * `collectionCeiling` are that decision where a plugin can ask for it, and
 * this asserts the decision itself rather than that a file contains a word.
 */
describe('the shared plugin query builder orders on the document NAME', () => {
  const BUILDER =
    'libs/tenant/feature/instance/src/lib/hooks/host-collection-queries.ts'

  it('orders on the document id, and on no FIELD', () => {
    const builder = withoutComments(read(BUILDER))
    expect(builder).toContain('orderBy(documentId())')
    // The three that look safe and are not: `/api/hosts/resources` validates
    // no field for presence, and `IMPORTABLE_FIELDS` copies a name only if
    // the exported document carried one — so ordering on any of these hides
    // rows rather than mis-sorting them.
    for (const field of ['name', 'displayName', 'createdAt', 'updatedAt']) {
      expect(builder).not.toContain(`orderBy('${field}'`)
    }
  })

  it('the CEILING probes one document past itself', () => {
    // `length >= ceiling` is wrong at exactly the count that equals the
    // ceiling, which is the one collection size where a reader is told rows
    // are missing and none are.
    const builder = withoutComments(read(BUILDER))
    expect(builder).toMatch(/limit\(ceiling \+ 1\)/)
    expect(builder).toMatch(/rows\.length > ceiling/)
  })

  it('the console re-exports the probe rather than keeping a copy', () => {
    // Two implementations of "can this bounded list admit it is bounded" is
    // how the two halves of the console come to disagree about it.
    const consoleUtil = read('apps/console/utils/host-artifact-queries.ts')
    expect(consoleUtil).toContain('host-collection-queries')
    expect(withoutComments(consoleUtil)).not.toContain(
      'export function ceilingedWindow',
    )
  })
})

/**
 * The four site artifact lists ask ONE query builder (AGL-2501).
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

describe('the site artifact lists share one ordering decision (AGL-2501)', () => {
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

describe('a paged list names its order (AGL-2501)', () => {
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
 * A TABLE with no footer under it (AGL-2501, and the reason this kept being
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
 * A capped Firestore read — which is what makes a repeated element a LIST.
 *
 * The `<Table>` shape above found ten plugin surfaces and the owner went on
 * finding more, because a table is not how most of this console draws a list:
 * a row here is a `<Stack direction="row">` in a `CardDisplay`, and the
 * redirects, variables, functions, workflows, events and campaign lists were
 * every one of them that shape. A check that only knew about `<TableRow>` was
 * asking the wrong question for the third time.
 *
 * `limit(` is the half that keeps this from firing on everything. A row built
 * from a constant — a menu of statuses, a set of tabs, a form's fields — is a
 * fixed vocabulary and always was; a row built from a CAPPED COLLECTION READ
 * is a window over something that grows, which is the entire subject of this
 * file.
 */
const READS_A_CAPPED_COLLECTION = /\blimit\(/
/**
 * The repeated ROW elements, as this codebase actually writes them.
 *
 * Derived from the surfaces rather than guessed: every unpaginated plugin list
 * mapped into one of these. `MenuItem` is deliberately absent — a picker's
 * options are a lookup and not a list a reader pages through, which is the
 * same line the ordering guard above draws. `Box` is absent for the opposite
 * reason: it is the wrapper every non-list also uses, so including it bought
 * two more files and no more lists.
 */
const MAPS_INTO_ROWS =
  /\.map\([\s\S]{0,400}?<(TableRow|ListItem|ListItemButton|Card|Paper|Accordion|Stack|Grid)\b/
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
    (READS_A_CAPPED_COLLECTION.test(code) && MAPS_INTO_ROWS.test(code)) ||
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
  /*========================================================================
   * Caught by the widened shape: a row built from a CAPPED READ, with no
   * footer. Everything below draws repeated rows and is still not a list.
   *=======================================================================*/
  [
    'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page.tsx',
    'The editor. Its capped reads are the layout and screen PICKERS a node ' +
      'binds to, and the rows it maps are one screen’s node definitions — an ' +
      'editing working set, not a collection anybody pages through.',
  ],
  [
    'apps/console/components/content/content-scope.context.tsx',
    'A provider. It reads collections, authors and screens to fill the ' +
      'content pickers its consumers render; it draws no list of its own.',
  ],
  [
    'apps/console/components/document-preview.component.tsx',
    'One document, previewed. The rows are that document’s runtime fields ' +
      'and its format options — bounded by the document, not by the account.',
  ],
  [
    'apps/console/components/error-screens-card.component.tsx',
    'One row per declared error slot (`HOST_ERROR_SCREEN_SLOTS`), which is a ' +
      'fixed vocabulary the product ships. The capped `screens` read behind ' +
      'it fills each slot’s picker rather than the rows themselves.',
  ],
  [
    'apps/console/components/interaction-builder-dialog.component.tsx',
    'A picker dialog: workflows, overlays and screens are read as the ' +
      'OPTIONS an interaction can be bound to, which is a lookup and not a ' +
      'surface a reader scans — the same line the ordering guard draws.',
  ],
  [
    'apps/console/components/dashboard/newest-site-users-card.component.tsx',
    'A dashboard preview at `limit(5)` with a View all link to the paged ' +
      'list. Five rows chosen to be five, not a window that got cut short.',
  ],
  [
    'apps/console/components/media/media-library.component.tsx',
    'The DAM grid, already exempt and already explained: it completes a ' +
      'SEARCH as it loads (AGL-1460), so "how many pages" is not a question ' +
      'it can answer. Named here too because the widened shape reaches it.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/commerce-analytics-card.component.tsx',
    'Revenue and conversion BREAKDOWNS — a row per period, channel or ' +
      'status. A metric computed from a capped window is its own defect and ' +
      'not this one; a pager over four summary rows would answer nothing.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/commerce-glance-card.component.tsx',
    'The storefront glance: a handful of headline figures with a row each. ' +
      'The cardinality is the set of figures, which the card declares.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/locations-card.component.tsx',
    'One row per inventory location, and the plan bands are 1 / 1 / 2 / 4 / ' +
      '6 against a `limit(25)` window — the ceiling is four times the largest ' +
      'band, so the second page is empty on every plan that exists.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/registers-card.component.tsx',
    'One row per POS register, bands 0 / 0 / 1 / 2 under the same `limit(25)`. ' +
      'Bounded by what the plan sells, not by how long the store has traded.',
  ],
  [
    'libs/plugins/data/src/lib/components/dataset-schema-dialog.component.tsx',
    'One row per FIELD of the dataset being edited, which is the schema the ' +
      'author is defining in the dialog above the rows.',
  ],
  [
    'libs/plugins/logic/src/lib/components/host-reference-health-card.component.tsx',
    'A diagnostic: one row per BROKEN reference found across a fixed set of ' +
      'collections. A healthy site renders none, and a site with hundreds ' +
      'has a bigger problem than a pager would solve.',
  ],
  [
    'libs/plugins/marketing/src/lib/components/host-marketing-summary-card.component.tsx',
    'A summary card — overlays, campaigns and experiments counted into one ' +
      'row each, as a link to the surface that lists them properly.',
  ],
  [
    'libs/plugins/marketplace/src/lib/components/listing-content.component.tsx',
    'Registered as a WIDGET (`widgetId: marketplace-listing-content`), not a ' +
      'console page: it renders one listing’s own content — its versions, ' +
      'its screenshots, its install targets — inside whatever embeds it.',
  ],
  [
    'libs/plugins/workflows/src/lib/components/host-webhooks-card.component.tsx',
    'One row per inbound webhook, and `WEBHOOK_MAX_PER_HOST` is 5 while the ' +
      'listener reads 20. The cap is enforced server-side in ' +
      '`/api/hosts/resources`, so the window is four times a bound that ' +
      'cannot be exceeded and the second page can never exist.',
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
  [
    'libs/plugins/contacts/src/lib/components/contacts-console-page.tsx',
    'MISCLASSIFIED as the contact roster, which is not what the detector ' +
      'found here: the roster renders `ListTable` and has had a footer and a ' +
      'server-side filter since AGL-2292. The rows this matches are one ' +
      'contact’s interaction timeline in the drawer, and ' +
      '`CONTACT_INTERACTIONS_CAP` is 50 — `mergeContactInteraction` slices to ' +
      'it on every write, so the array cannot hold a fifty-first row and the ' +
      'second page is empty for every contact that will ever exist.',
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
    // The invoice table moved to its own section when billing was split
    // (AGL-2501). Same table, same reason, same scope decision — only the file
    // it lives in changed.
    'apps/console/app/(app)/[orgSlug]/billing/(sections)/invoices/page.tsx',
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
    'apps/console/components/staff-org-refund-card.component.tsx',
    'An organization’s charges, which grow with its trading.',
  ],
  /*========================================================================
   * The widened shape's own tranche: real lists, still footerless, each with
   * what stands in the way TODAY. Listed even where this pass could not fix
   * them — a guard that omits what it cannot fix is how this became three
   * rounds of somebody finding these by hand.
   *=======================================================================*/
  [
    'apps/console/components/billing/billing-usage-history.component.tsx',
    'Metered usage, one row per period forever. Billing is held by another ' +
      'agent’s split of that page; the classification is not why it is ' +
      'untouched.',
  ],
  [
    'apps/console/components/site-member-drawer.component.tsx',
    'One member’s orders and subscriptions. Bounded by that person rather ' +
      'than by the site, which makes it small — but it grows for as long as ' +
      'they keep buying, so it is a list and not a fixed set.',
  ],
  [
    'libs/plugins/bookings/src/lib/components/bookings-console-page.tsx',
    'Bookings, which grow with every reservation. A plugin PAGE SHELL, ' +
      'being converted to routed sections by another agent — the list lives ' +
      'in the shell here rather than in a card, so it cannot be paged ' +
      'without editing across that work.',
  ],
  [
    'libs/plugins/commerce/src/lib/components/console/pos-page.component.tsx',
    'The POS catalog grid, a page shell reading `limit(500)`. It is also the ' +
      'one surface here where a pager is the wrong control — a till is ' +
      'searched, not paged — so it wants the search-first treatment the DAM ' +
      'grid has rather than a footer.',
  ],
  [
    'libs/plugins/email/src/lib/components/email-screens-card.tsx',
    'Every email template on the site, read as an unordered `limit(200)` ' +
      'over `screens`. The email plugin’s page shell is mid-conversion.',
  ],
  [
    'libs/plugins/events-calendar/src/lib/components/events-console-page.tsx',
    'Events, a `limit(200)` window. ORDERED now — `orderBy(startsAtMs)` was ' +
      'safe on all three counts: the only writer refuses a save without the ' +
      'field, the server feed already orders by it, and `events` is not in ' +
      '`IMPORTABLE_FIELDS`. So the window is the newest 200 rather than a ' +
      'document-id sample, and what is still owed is the footer.',
  ],
  [
    'libs/plugins/redirects/src/lib/components/redirects-console-page.tsx',
    'Redirect rules, an unordered `limit(200)`. The QUOTA half is fixed: the ' +
      'gate and the readout now read an aggregation count over the whole ' +
      'collection, which is what `app/api/hosts/resources` enforces on, ' +
      'instead of the window length minus soft-deleted rows. What remains is ' +
      'the window itself — a document-id sample sorted by source in the ' +
      'browser — and the footer. Ordering needs a field every writer sets, ' +
      'and `source` is not yet checked that way.',
  ],
  [
    'libs/plugins/marketplace/src/lib/components/host-plugins-card.component.tsx',
    'Installed plugins, per site and per org, both unordered `limit(50)`. ' +
      'Bounded by the marketplace rather than by the account, but the ' +
      'marketplace is the thing that grows.',
  ],
  [
    'libs/plugins/marketplace/src/lib/components/listing-reviews.component.tsx',
    'Reviews of one listing, an unordered `limit(100)`. A popular listing ' +
      'accumulates them for as long as it is published.',
  ],
]

describe('a table with rows under it has a footer under those (AGL-2501)', () => {
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
    expect(OWES_A_FOOTER).toHaveLength(20)
    expect(NOT_A_LIST).toHaveLength(27)
  })
})

/**
 * A control that silently does nothing (AGL-2501).
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
