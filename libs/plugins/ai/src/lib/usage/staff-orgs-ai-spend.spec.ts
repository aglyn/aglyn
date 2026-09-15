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
 * The staff Organizations list's AI spend column, as data (AGL-2984).
 *
 * The column sorts the page by a comparator over the figures, so the one
 * thing that can go wrong is comparing the TEXT a cell shows: `$10.0000`
 * sorts before `$9.0000`. Pinned: the sort value is a number, an unmeasured
 * org sorts last in both directions and never renders as `$0`, and the
 * request's id list survives the query string with the route's refusals
 * intact.
 */

import {
  aiSpendCell,
  aiSpendRowComparator,
  aiSpendSortValue,
  byAiSpendAsc,
  byAiSpendDesc,
  parseStaffOrgIds,
  STAFF_ORGS_AI_SPEND_MAX_IDS,
  staffOrgsAiSpendQuery,
} from './staff-orgs-ai-spend'

describe('the AI spend figures the Organizations list sorts and shows (AGL-2984)', () => {
  it('sorts on the number, so ten lands after nine and not before it', () => {
    expect([10, 9, 0.08].map(aiSpendSortValue)).toEqual([10, 9, 0.08])
    expect([0.08, 10, 9].sort(byAiSpendDesc)).toEqual([10, 9, 0.08])
    expect([10, 0.08, 9].sort(byAiSpendAsc)).toEqual([0.08, 9, 10])
    // The formatted cell is what a sort must NOT compare.
    expect(['$10.0000', '$9.0000'].sort()).toEqual(['$10.0000', '$9.0000'])
  })

  it('puts an unmeasured org last in both directions, and never renders it as $0', () => {
    expect([null, 2, 5].sort(byAiSpendDesc)).toEqual([5, 2, null])
    expect([null, 5, 2].sort(byAiSpendAsc)).toEqual([2, 5, null])
    expect(aiSpendSortValue(null)).toBeNull()
    expect(aiSpendSortValue(undefined)).toBeNull()
    expect(aiSpendCell(null)).toBe('—')
    expect(aiSpendCell(undefined)).toBe('—')
    expect(aiSpendCell(0)).toBe('$0.0000')
    expect(aiSpendCell(0.08)).toBe('$0.0800')
  })

  it('orders rows by their org, reading an org the answer omits as unmeasured', () => {
    // `b` has no month document; `c` is not in the answer at all.
    const spendUsd = { a: 2, b: null, d: 5 }
    const rows = [{ $id: 'a' }, { $id: 'b' }, { $id: 'c' }, { $id: 'd' }]
    const order = (direction: 'asc' | 'desc') =>
      [...rows]
        .sort(aiSpendRowComparator(spendUsd, direction))
        .map((row) => row.$id)
    expect(order('desc')).toEqual(['d', 'a', 'b', 'c'])
    expect(order('asc')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('asks for a set of orgs in one parameter that survives an id holding the separator', () => {
    const plain = new URLSearchParams(staffOrgsAiSpendQuery(['org-1', 'org-2']))
    expect(plain.get('orgIds')).toBe('org-1,org-2')
    expect(parseStaffOrgIds(plain.get('orgIds'))).toEqual({
      orgIds: ['org-1', 'org-2'],
      error: null,
    })
    const awkward = new URLSearchParams(
      staffOrgsAiSpendQuery(['org-1', 'acme,inc']),
    )
    expect(parseStaffOrgIds(awkward.get('orgIds'))).toEqual({
      orgIds: ['org-1', 'acme,inc'],
      error: null,
    })
  })

  it('reads each org once, in the order asked', () => {
    expect(parseStaffOrgIds('b,a,b,,a')).toEqual({
      orgIds: ['b', 'a'],
      error: null,
    })
  })

  it('refuses an empty ask, more ids than the cap, and an id no org document could have', () => {
    const refused = (error: string) => ({ orgIds: [], error })
    expect(parseStaffOrgIds('')).toEqual(refused('Missing orgIds'))
    expect(parseStaffOrgIds(undefined)).toEqual(refused('Missing orgIds'))
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `org-${index}`).join(',')
    const atCap = parseStaffOrgIds(ids(STAFF_ORGS_AI_SPEND_MAX_IDS))
    expect(atCap.error).toBeNull()
    expect(atCap.orgIds).toHaveLength(STAFF_ORGS_AI_SPEND_MAX_IDS)
    expect(parseStaffOrgIds(ids(STAFF_ORGS_AI_SPEND_MAX_IDS + 1))).toEqual(
      refused(`At most ${STAFF_ORGS_AI_SPEND_MAX_IDS} orgIds`),
    )
    for (const bad of ['a/b', 'a%2Fb', '..', '__name__', '%E0%A4%A']) {
      expect(parseStaffOrgIds(bad)).toEqual(refused('Invalid orgIds'))
    }
  })
})
