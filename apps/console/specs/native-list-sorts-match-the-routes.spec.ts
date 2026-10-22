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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { USER_LIST_COLUMN_SORTS, USER_LIST_DEFAULT_SORT } from '../utils/list-filters'
import { ORG_LIST_COLUMN_SORTS } from '../utils/org-list-query'
import { STAFF_SITE_LIST_COLUMN_SORTS, STAFF_SITE_LIST_SORT } from '../utils/staff-site-list-query'

/**
 * The staff apps' header sorts for the Workspaces, Sites and People lists (AGL-3667): a `route` column asks the route
 * for `sort=<path>:<dir>`, and the route only honours an order its list declares (a sort it does not offer is ignored,
 * as a query ignores one). So every route column the screens name must be one the console's own header sorts, in both
 * directions, and the load's default must be the order the page opens in.
 */
const SPECS = JSON.parse(
  readFileSync(join(__dirname, '../../../libs/native/screens/staff.screens.json'), 'utf8'),
) as { screens: Array<{ id: string; load: Record<string, any>; blocks: Array<Record<string, any>> }> }

const CASES = [
  { screen: 'core.staff.orgs', load: 'orgs', declared: ORG_LIST_COLUMN_SORTS, first: ORG_LIST_COLUMN_SORTS[0] },
  { screen: 'core.staff.sites', load: 'sites', declared: STAFF_SITE_LIST_COLUMN_SORTS, first: STAFF_SITE_LIST_SORT },
  { screen: 'core.staff.users', load: 'users', declared: USER_LIST_COLUMN_SORTS, first: USER_LIST_DEFAULT_SORT },
] as const

describe.each(CASES)('the $screen list sorts only by what its route offers', ({ screen, load, declared, first }) => {
  const spec = SPECS.screens.find((entry) => entry.id === screen)!
  const list = spec.blocks.find((block) => block['type'] === 'list')!
  const columns = list['columns'] as Array<{ id: string; sort?: { route?: string; page?: string } }>

  it('asks the route through sort, and opens in the order the page does', () => {
    expect(spec.load[load].sortParam).toBe('sort')
    expect(spec.load[load].sortDefault).toBe(`${first.path}:${first.direction}`)
    // The default is not also written into the URL, where a chosen order could not replace it.
    expect(spec.load[load].url).not.toMatch(/[?&]sort=/)
  })

  it('names only route sorts the console’s own headers offer, each in both directions', () => {
    const routed = columns.filter((column) => column.sort?.route)
    expect(routed.length).toBeGreaterThan(0)
    for (const column of routed) {
      const directions = declared.filter((sort) => sort.path === column.sort!.route).map((sort) => sort.direction)
      expect({ column: column.id, directions: directions.sort() }).toEqual({ column: column.id, directions: ['asc', 'desc'] })
    }
  })

  it('offers every column the console’s grid sorts by, on the route or on the page', () => {
    const sortable = new Set(columns.filter((column) => column.sort).map((column) => column.id))
    expect(sortable.size).toBe(columns.filter((column) => column.sort).length)
    expect(sortable.size).toBeGreaterThanOrEqual(declared.map((sort) => sort.path).filter((path, index, all) => all.indexOf(path) === index).length)
  })
})
