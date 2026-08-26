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
 * Zach: *"The table footer is not consistent."* It was not — layouts paged 5
 * at a time, components and templates 10, the team list 10, the screens tree
 * 25, and the size menu was labelled three different ways. Nothing was wrong
 * with any single one; they were written at different times and each picked
 * its own numbers, which is what a shared control looks like when nothing
 * holds it together.
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_ROWS_PER_PAGE_LABEL,
} from '../constants/shared'

const REPO = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** Every file in the console that renders a paginated table footer. */
const FOOTERS: Array<[string, string]> = [
  // The grid family: layouts, components and templates all render through it.
  ['artifact table', 'apps/console/components/artifacts/artifact-table.component.tsx'],
  // The bespoke family.
  ['screens tree', 'apps/console/components/screens-hierarchy-table.component.tsx'],
  ['team list', 'apps/console/components/org-members-card.component.tsx'],
  [
    'content entries',
    'apps/console/components/content/collection-entries-page.component.tsx',
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
    // Zach: "Make all paginated lists default to the minimum count … that
    // goes for all lists across the entire platform." Asserted against the
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
      'apps/console/components/artifacts/artifact-table.component.tsx',
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
