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
 * The month's spend leaderboard ordering (AGL-2930): dearest first, credits
 * as the tiebreak, id as the last one so equal rows render in one stable
 * order — and the cut reports how many were ranked, so the page can say
 * "top 2 of 4" rather than imply the cut is the fleet.
 */

import { rankAssistSpend, type AssistSpendRow } from './assist-signal-mining'

const row = (
  orgId: string,
  estCostUsd: number,
  credits = Math.ceil(estCostUsd * 1000),
): AssistSpendRow => ({
  orgId,
  plan: 'pro',
  aiAddon: false,
  credits,
  estCostUsd,
  refusals: {
    band: 0,
    cap: 0,
    messages: 0,
    budget: 0,
    account: 0,
    requests: 0,
    refusals: 0,
    platform: 0,
    total: 0,
  },
})

describe('rankAssistSpend (AGL-2930)', () => {
  it('orders dearest first, then by credits, then by id', () => {
    const { rows, ranked } = rankAssistSpend(
      [
        row('c', 1),
        row('a', 4),
        row('d', 1, 1500),
        row('b', 4),
        row('e', 0),
      ],
      10,
    )
    expect(rows.map((r) => r.orgId)).toEqual(['a', 'b', 'd', 'c', 'e'])
    expect(ranked).toBe(5)
  })

  it('cuts to the limit and still reports how many were ranked', () => {
    const { rows, ranked } = rankAssistSpend([row('a', 1), row('b', 3), row('c', 2)], 2)
    expect(rows.map((r) => r.orgId)).toEqual(['b', 'c'])
    expect(ranked).toBe(3)
  })

  it('does not reorder the caller’s array', () => {
    const input = [row('a', 1), row('b', 3)]
    rankAssistSpend(input, 5)
    expect(input.map((r) => r.orgId)).toEqual(['a', 'b'])
  })
})
