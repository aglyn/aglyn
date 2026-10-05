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
 * Next activity, the pure half (AGL-2661).
 *
 * What has to hold: only an OPEN task with a finite due time sets the
 * value; a stored value is read as `null` whenever it is not a usable
 * time, absent included; the view clause round-trips through the toggle;
 * and a stuck deal is an open one with nothing scheduled — never a closed
 * one, whatever it carries.
 */

import {
  CRM_NO_NEXT_ACTIVITY_CLAUSE,
  filterByNextActivity,
  hasNoNextActivity,
  isNoNextActivityClause,
  mergeNextActivityLinks,
  nextActivityLinksOfTask,
  nextTaskAtMsOf,
  readNextTaskAtMs,
  stuckDeals,
  withNoNextActivity,
} from './crm-next-activity'

describe('nextTaskAtMsOf (AGL-2661)', () => {
  it('is the earliest open, dated task — done and undated ones do not count', () => {
    expect(
      nextTaskAtMsOf([
        { status: 'done', dueAtMs: 100 },
        { status: 'open', dueAtMs: 500 },
        { status: 'open', dueAtMs: 300 },
        { status: 'open', dueAtMs: null },
        { status: 'open', dueAtMs: Number.NaN },
      ]),
    ).toBe(300)
    expect(nextTaskAtMsOf([{ status: 'open', dueAtMs: null }])).toBeNull()
    expect(nextTaskAtMsOf([])).toBeNull()
  })
})

describe('readNextTaskAtMs / hasNoNextActivity', () => {
  it('reads a usable time and nothing else', () => {
    expect(readNextTaskAtMs({ nextTaskAtMs: 1_700_000_000_000 })).toBe(1_700_000_000_000)
    expect(readNextTaskAtMs({ nextTaskAtMs: null })).toBeNull()
    expect(readNextTaskAtMs({})).toBeNull()
    expect(readNextTaskAtMs({ nextTaskAtMs: 0 })).toBeNull()
    expect(readNextTaskAtMs({ nextTaskAtMs: '123' })).toBeNull()
    expect(readNextTaskAtMs(null)).toBeNull()
    expect(hasNoNextActivity({ nextTaskAtMs: 5 })).toBe(false)
    expect(hasNoNextActivity({})).toBe(true)
  })
})

describe('the links a recompute walks', () => {
  it('reads a task’s links without the blanks, and merges many to one per record', () => {
    expect(nextActivityLinksOfTask({ contactId: 'c1', companyId: '', dealId: undefined })).toEqual({
      contactId: 'c1',
    })
    expect(
      mergeNextActivityLinks([
        { contactId: 'c1', dealId: 'd1' },
        { contactId: 'c1' },
        null,
        { companyId: 'k1', dealId: 'd1' },
      ]),
    ).toEqual([
      { field: 'contactId', id: 'c1' },
      { field: 'dealId', id: 'd1' },
      { field: 'companyId', id: 'k1' },
    ])
  })
})

describe('the "No next activity" clause', () => {
  it('toggles on and off without touching the other clauses', () => {
    const owner = { field: 'ownerUid', op: 'equals', value: 'u1' }
    const on = withNoNextActivity([owner], true)
    expect(on).toEqual([owner, CRM_NO_NEXT_ACTIVITY_CLAUSE])
    expect(on.some(isNoNextActivityClause)).toBe(true)
    expect(withNoNextActivity(on, false)).toEqual([owner])
    // Switching on twice keeps one clause.
    expect(withNoNextActivity(on, true).filter(isNoNextActivityClause)).toHaveLength(1)
  })

  it('narrows a loaded page to the records with nothing scheduled', () => {
    const rows = [{ id: 'a', nextTaskAtMs: 5 }, { id: 'b', nextTaskAtMs: null }, { id: 'c' }]
    expect(filterByNextActivity(rows, []).map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(
      filterByNextActivity(rows, [CRM_NO_NEXT_ACTIVITY_CLAUSE]).map((row) => row.id),
    ).toEqual(['b', 'c'])
  })
})

describe('stuckDeals', () => {
  it('counts open deals with nothing scheduled, never a closed one', () => {
    const deals: Array<{ $id: string; status: 'open' | 'won' | 'lost'; nextTaskAtMs?: number | null }> = [
      { $id: 'open-stuck', status: 'open' },
      { $id: 'open-moving', status: 'open', nextTaskAtMs: 10 },
      { $id: 'won', status: 'won' },
      { $id: 'lost', status: 'lost', nextTaskAtMs: null },
    ]
    const stuck = stuckDeals(deals)
    expect(stuck.count).toBe(1)
    expect(stuck.deals.map((deal) => deal.$id)).toEqual(['open-stuck'])
    expect(stuckDeals([])).toEqual({ count: 0, deals: [] })
  })
})
