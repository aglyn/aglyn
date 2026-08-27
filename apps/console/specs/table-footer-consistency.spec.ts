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
  ['actor activity', 'apps/console/components/actor-activity-table.component.tsx'],
  ['notifications', 'apps/console/app/(app)/manage/notifications/page.tsx'],
  ['staff lists', 'apps/console/components/staff-list-pagination.component.tsx'],
  ['site collaborators', 'apps/console/components/host-members-card.component.tsx'],
  ['site accounts', 'apps/console/components/site-accounts-card.component.tsx'],
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
      'apps/console/app/(app)/[orgSlug]/hosts/[host]/layouts/page.tsx',
      'libs/shared/ui/jsx/src/lib/components/list-table.component.tsx',
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

  it('no console component renders its own Previous/Next pair', () => {
    const offenders = tsxFilesUnder(CONSOLE_COMPONENTS)
      .filter((path) => handRolledPager(readFileSync(path, 'utf8')))
      .map((path) => path.slice(path.indexOf('apps/console')))
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
  const PLUGIN_CONSOLE = join(
    REPO,
    'libs',
    'plugins',
    'commerce',
    'src',
    'lib',
    'components',
  )
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
      ...tsxFilesUnder(PLUGIN_CONSOLE),
    ]
      .filter((path) => LOADS_MORE.test(readFileSync(path, 'utf8')))
      .map(repoRelative)
      .filter((path) => !LOAD_MORE_ALLOWED.includes(path))
    expect(offenders).toEqual([])
  })

  it('the allowlist names files that EXIST and still load more', () => {
    // An allowlist entry that has gone stale silently widens the exemption.
    for (const path of LOAD_MORE_ALLOWED) {
      expect(read(path)).toMatch(LOADS_MORE)
    }
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
