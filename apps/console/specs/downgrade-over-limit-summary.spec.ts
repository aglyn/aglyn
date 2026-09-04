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
 * The one surface that tells a customer what a plan change will leave them
 * over, and the one number in it that was measured against the wrong bound.
 *
 * Nothing in this repo revokes for being over a cap — sites keep serving,
 * managers keep managing, datasets keep reading. What the customer gets
 * instead of an eviction is this list, shown before they choose. That makes
 * the list the enforcement surface's only honest half, and a row that clears
 * an org it should have warned is worse than a missing row: it is a clean
 * bill of health nobody earned.
 *
 * `datasetsPerOrg` is what a plan INCLUDES. `maxDatasetsPerOrg` is the
 * purchase CEILING — the count the org could reach by buying extra datasets
 * on top. The sites and seats rows have always measured what the plan
 * includes; the datasets row measured the ceiling while printing the word
 * "includes" beside it.
 */

const PLAN = {
  starter: { datasetsPerOrg: 3, maxDatasetsPerOrg: 10 },
  pro: { datasetsPerOrg: 15, maxDatasetsPerOrg: 50 },
}

let mockDatasetCount: number | null = 0
let mockSeatCounts: { managerSeats: number } | null = { managerSeats: 0 }
let mockSiteDocs: { orgId: string; role?: string }[] = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: () => ({}),
  getCountFromServer: async () => {
    if (mockDatasetCount == null) throw new Error('unreadable')
    return { data: () => ({ count: mockDatasetCount }) }
  },
  getDocsFromServer: async () => ({
    docs: mockSiteDocs.map((row) => ({ data: () => row })),
  }),
}))

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  default: async () => mockSeatCounts,
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'
import overLimitSummary from '../utils/over-limit-summary'

const summarize = (targetPlan: 'starter' | 'pro') =>
  overLimitSummary({
    firestore: {} as never,
    user: { uid: 'u1', getIdToken: async () => 't' },
    orgId: 'org-1',
    targetPlan,
  })

beforeEach(() => {
  mockDatasetCount = 0
  mockSeatCounts = { managerSeats: 0 }
  mockSiteDocs = []
})

describe('the bounds this file measures against', () => {
  it('are two different numbers, which is the whole defect', () => {
    // Asserted rather than assumed: if a pricing change ever made the
    // included count equal the ceiling, every test below would pass without
    // distinguishing the two, and the row could quietly regress.
    expect(PLAN_ENTITLEMENTS.starter.datasetsPerOrg).toBe(PLAN.starter.datasetsPerOrg)
    expect(PLAN_ENTITLEMENTS.starter.maxDatasetsPerOrg).toBe(
      PLAN.starter.maxDatasetsPerOrg,
    )
    expect(PLAN_ENTITLEMENTS.pro.datasetsPerOrg).toBe(PLAN.pro.datasetsPerOrg)
    expect(PLAN_ENTITLEMENTS.pro.maxDatasetsPerOrg).toBe(PLAN.pro.maxDatasetsPerOrg)
  })
})

describe('the datasets row', () => {
  it('warns for a count over what the plan INCLUDES', async () => {
    // 8 datasets moving to Starter. Measured against the ceiling of 10 this
    // said nothing at all, and the org landed 5 over its included 3.
    mockDatasetCount = 8

    const over = await summarize('starter')

    expect(over).toHaveLength(1)
    expect(over[0]).toBe('8 datasets (starter includes 3)')
  })

  it('quotes the included count, not the purchase ceiling', async () => {
    // The sentence and the comparison have to agree. "includes 10" was false
    // about Starter on both halves.
    mockDatasetCount = 40

    const over = await summarize('pro')

    expect(over[0]).toContain('pro includes 15')
    expect(over[0]).not.toContain('50')
  })

  it('stays silent when the org is genuinely under', async () => {
    // The control that stops the fix from warning everybody. A row that
    // always fires is as useless as one that never does.
    mockDatasetCount = 3

    expect(await summarize('starter')).toEqual([])
  })

  it('reports an unreadable count as unchecked, never as clear', async () => {
    mockDatasetCount = null

    const over = await summarize('starter')

    expect(over).toHaveLength(1)
    expect(over[0]).toBe('datasets — could not be checked (starter includes 3)')
  })
})

describe('the rows that were already right', () => {
  it('measures sites against the plan hostLimit', async () => {
    mockSiteDocs = [
      { orgId: 'org-1', role: 'admin' },
      { orgId: 'org-1', role: 'editor' },
      // A site in another org must not be counted against this org's plan.
      { orgId: 'org-2', role: 'admin' },
    ]

    const over = await summarize('starter')

    expect(over).toEqual([`2 sites (starter includes ${PLAN_ENTITLEMENTS.starter.hostLimit})`])
  })

  it('measures team seats against managersPerOrg', async () => {
    mockSeatCounts = { managerSeats: 9 }

    const over = await summarize('starter')

    expect(over).toEqual([
      `9 team members (starter includes ${PLAN_ENTITLEMENTS.starter.managersPerOrg})`,
    ])
  })
})
