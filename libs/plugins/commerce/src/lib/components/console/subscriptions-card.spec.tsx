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
 * The Subscriptions section's figures (AGL-4191): monthly recurring revenue is
 * summed by Firestore per billing interval, and only over live-mode, paying
 * subscriptions. These pin the queries it asks and the arithmetic it does with
 * the answers.
 */

const mockAsked: Array<{ wheres: unknown[][]; fields: string[] }> = []
const mockAnswers: Record<string, Record<string, number>> = {}

jest.mock('firebase/firestore', () => {
  const marker = (kind: string) => (...args: unknown[]) => ({ __constraint: kind, args })
  return {
    __esModule: true,
    collection: (_db: unknown, ...segments: string[]) => ({ __path: segments.join('/') }),
    query: (base: { __path: string }, ...constraints: Array<{ __constraint: string; args: unknown[] }>) => ({
      __path: base.__path,
      wheres: constraints.filter((c) => c.__constraint === 'where').map((c) => c.args),
    }),
    where: marker('where'),
    count: () => ({ __agg: 'count' }),
    sum: (field: string) => ({ __agg: 'sum', field }),
    getAggregateFromServer: async (
      q: { wheres: unknown[][] },
      spec: Record<string, { __agg: string }>,
    ) => {
      mockAsked.push({ wheres: q.wheres, fields: Object.keys(spec) })
      const key = q.wheres.map((w) => `${w[0]}${w[1]}${JSON.stringify(w[2])}`).join('&')
      return { data: () => mockAnswers[key] ?? {} }
    },
  }
})

import { loadSubscriptionsSummary } from './subscriptions-card.component'

const PAYING = `statusin${JSON.stringify(['active', 'past_due'])}`
const LIVE = `livemode==true`

beforeEach(() => {
  mockAsked.length = 0
  for (const key of Object.keys(mockAnswers)) delete mockAnswers[key]
})

describe('loadSubscriptionsSummary (AGL-4191)', () => {
  it('adds monthly plans whole and yearly plans as a twelfth, tax left out', async () => {
    mockAnswers[`${PAYING}&interval=="month"&${LIVE}`] = {
      subscriptions: 20,
      totalCents: 200_000,
      taxCents: 10_000,
    }
    mockAnswers[`${PAYING}&interval=="year"&${LIVE}`] = {
      subscriptions: 4,
      totalCents: 120_000,
      taxCents: 0,
    }
    mockAnswers[`status=="trialing"&${LIVE}`] = { subscriptions: 3 }
    mockAnswers[`status=="past_due"&${LIVE}`] = { subscriptions: 2 }

    const summary = await loadSubscriptionsSummary({} as never, 'h1')

    expect(summary).toEqual({
      monthlyRecurringCents: 190_000 + 10_000,
      payingCount: 24,
      trialCount: 3,
      pastDueCount: 2,
    })
  })

  it('asks only about live-mode subscriptions, so a test checkout never counts', async () => {
    await loadSubscriptionsSummary({} as never, 'h1')
    expect(mockAsked).toHaveLength(4)
    for (const asked of mockAsked) {
      expect(asked.wheres).toContainEqual(['livemode', '==', true])
    }
  })

  it('counts a trial out of the revenue: it has not paid yet', async () => {
    await loadSubscriptionsSummary({} as never, 'h1')
    const revenue = mockAsked.filter((asked) => asked.fields.includes('totalCents'))
    expect(revenue).toHaveLength(2)
    for (const asked of revenue) {
      expect(asked.wheres).toContainEqual(['status', 'in', ['active', 'past_due']])
    }
  })

  it('reads an empty store as zeros, not as missing numbers', async () => {
    const summary = await loadSubscriptionsSummary({} as never, 'h1')
    expect(summary).toEqual({
      monthlyRecurringCents: 0,
      payingCount: 0,
      trialCount: 0,
      pastDueCount: 0,
    })
  })
})
