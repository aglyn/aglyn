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
import { sortListRows } from '@aglyn/shared-util-tools/list-query/list-column-sort'
import {
  USER_LIST_DEFAULT_SORT,
  USER_LIST_SORT_VALUES,
  userListSort,
} from '../utils/list-filters'

/*
 * THE ACCOUNTS LIST OPENS NEWEST FIRST (AGL-3660), and the route answers it.
 *
 * Firebase Auth lists by uid, so "the newest accounts" is a question only a
 * read of the whole directory answers. The route takes a request that asks
 * for no order as the default one and sorts the complete read before paging
 * it; the page asks for the same order on its first read. A header sort
 * still replaces it.
 */
describe('staff accounts list default order (AGL-3660)', () => {
  it('is Created, newest first', () => {
    expect(USER_LIST_DEFAULT_SORT).toMatchObject({ path: 'createdAt', direction: 'desc' })
  })

  it('answers a request that asks for nothing with the default', () => {
    expect(userListSort(null)).toBe(USER_LIST_DEFAULT_SORT)
    expect(userListSort(undefined)).toBe(USER_LIST_DEFAULT_SORT)
    expect(userListSort({ path: 'nope', direction: 'asc' })).toBe(USER_LIST_DEFAULT_SORT)
  })

  it('keeps every header sort the list offers', () => {
    expect(userListSort({ path: 'email', direction: 'asc' })).toMatchObject({
      path: 'email',
      direction: 'asc',
    })
    expect(userListSort({ path: 'createdAt', direction: 'asc' })).toMatchObject({
      path: 'createdAt',
      direction: 'asc',
    })
  })

  it('orders accounts newest first, an account with no date last', () => {
    const rows = [
      { uid: 'old', createdAt: 'Mon, 05 Jan 2026 10:00:00 GMT' },
      { uid: 'none', createdAt: null },
      { uid: 'new', createdAt: 'Thu, 08 Oct 2026 10:00:00 GMT' },
      { uid: 'mid', createdAt: 'Fri, 01 May 2026 10:00:00 GMT' },
    ].map((row) => ({
      ...row,
      email: null,
      displayName: null,
      staff: false,
      staffRole: null,
      disabled: false,
      lastSignInAt: null,
    }))
    const sort = userListSort(null)
    const sorted = sortListRows(rows, USER_LIST_SORT_VALUES[sort.path], sort.direction)
    expect(sorted.map((row) => row.uid)).toEqual(['new', 'mid', 'old', 'none'])
  })

  it('is asked for by the page on its first read and served by the route', () => {
    const page = readFileSync(
      join(__dirname, '../app/(app)/admin/users/page.tsx'),
      'utf8',
    )
    expect(page).toMatch(/sort: USER_LIST_DEFAULT_SORT/)
    expect(page).toMatch(/useState<ListQuerySort \| null>\(USER_LIST_DEFAULT_SORT\)/)
    const route = readFileSync(join(__dirname, '../app/api/admin/users/route.ts'), 'utf8')
    expect(route).toMatch(/userListSort\(listRequest\.sort\)/)
  })
})
