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

import {
  AI_USAGE_BY_USER_RETENTION_MONTHS,
  aiUsageByUserExpiry,
  aiUsageByUserMonthFrom,
  aiUsageKindFromRoute,
  aiUsageMonthKeys,
  aiUsageMonthWithinRetention,
  aiUsageShare,
  isAiUsageMonthKey,
  sumAiUsageCredits,
  topAiUsageKinds,
} from './ai-usage-by-user'
import { assistCreditsFromUsd } from './assist-credits'

/**
 * The per-user rollup's arithmetic (AGL-2928): the window a reader may ask
 * for, the expiry the TTL keys on, the share a customer is shown instead of
 * a dollar figure, and the zero-filled read of a document.
 */

const NOW = new Date('2026-09-14T12:00:00Z')

describe('the month window', () => {
  it('lists the month in progress and the twelve before it, newest first', () => {
    const keys = aiUsageMonthKeys(NOW)
    expect(keys).toHaveLength(AI_USAGE_BY_USER_RETENTION_MONTHS)
    expect(keys[0]).toBe('2026-09')
    expect(keys[1]).toBe('2026-08')
    expect(keys[keys.length - 1]).toBe('2025-09')
  })

  it('crosses a year boundary on the UTC calendar', () => {
    expect(aiUsageMonthKeys(new Date('2026-01-31T23:59:59Z'), 3)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ])
  })

  it('admits a month inside the window and refuses one past it', () => {
    expect(aiUsageMonthWithinRetention('2026-09', NOW)).toBe(true)
    expect(aiUsageMonthWithinRetention('2025-09', NOW)).toBe(true)
    // One month older than the window: reaped, so a request for it must
    // not read as "nobody spent anything".
    expect(aiUsageMonthWithinRetention('2025-08', NOW)).toBe(false)
    // The future is not a month with a document either.
    expect(aiUsageMonthWithinRetention('2026-10', NOW)).toBe(false)
  })

  it('refuses anything that is not a month key at all', () => {
    for (const junk of ['2026-9', '2026-13', '2026-09-01', '', 'latest', 202609]) {
      expect(isAiUsageMonthKey(junk)).toBe(false)
      expect(aiUsageMonthWithinRetention(String(junk), NOW)).toBe(false)
    }
  })
})

describe('the expiry the TTL keys on', () => {
  it('is the first instant of the month thirteen months after the described month closes', () => {
    // September 2026 closes at 2026-10-01; thirteen months on is 2027-11-01.
    expect(aiUsageByUserExpiry('2026-09').toISOString()).toBe('2027-11-01T00:00:00.000Z')
    // December rolls the year.
    expect(aiUsageByUserExpiry('2025-12').toISOString()).toBe('2027-02-01T00:00:00.000Z')
  })

  it('is the same instant however many times the month is written', () => {
    expect(aiUsageByUserExpiry('2026-09').getTime()).toBe(
      aiUsageByUserExpiry('2026-09').getTime(),
    )
  })

  it('throws on a malformed month rather than stamping a date in 1970', () => {
    expect(() => aiUsageByUserExpiry('nope')).toThrow(/month key/)
  })
})

describe('the kind, read off a route', () => {
  it('names the three besigner modes and calls everything else a chat turn', () => {
    expect(aiUsageKindFromRoute('/api/ai/assist/element')).toBe('element')
    expect(aiUsageKindFromRoute('/api/ai/assist/blog')).toBe('blog')
    expect(aiUsageKindFromRoute('/api/ai/assist/section')).toBe('section')
    expect(aiUsageKindFromRoute('/acme/screens')).toBe('assist')
    expect(aiUsageKindFromRoute('')).toBe('assist')
    expect(aiUsageKindFromRoute(null)).toBe('assist')
  })
})

describe('the share', () => {
  it('is the ratio of measured spends, to a basis point', () => {
    expect(aiUsageShare(1.8, 2.5)).toBe(0.72)
    expect(aiUsageShare(0.7, 2.5)).toBe(0.28)
    expect(aiUsageShare(1, 3)).toBe(0.3333)
  })

  it('is measured on dollars, not on credits, so rounding cannot inflate it', () => {
    // Ten requests at $0.0011 each round to 2 credits apiece — 20 credits —
    // against an org month of $0.011, which is 11 credits. On credits the
    // person would own 182% of the pool; on spend they own all of it.
    const perRequestUsd = 0.0011
    const requests = 10
    const personUsd = perRequestUsd * requests
    const personCredits = assistCreditsFromUsd(perRequestUsd) * requests
    expect(personCredits).toBeGreaterThan(assistCreditsFromUsd(personUsd))
    expect(aiUsageShare(personUsd, personUsd)).toBe(1)
  })

  it('clamps at one and answers zero for nothing to share', () => {
    expect(aiUsageShare(3, 2)).toBe(1)
    expect(aiUsageShare(0, 2)).toBe(0)
    expect(aiUsageShare(1, 0)).toBe(0)
    expect(aiUsageShare(Number.NaN, 2)).toBe(0)
    expect(aiUsageShare(1, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('reading a month document', () => {
  it('zero-fills what is absent and drops junk from the maps', () => {
    const read = aiUsageByUserMonthFrom(
      { credits: 120, estCostUsd: 0.12, requests: 4, byKind: { assist: 120, page: 'x' } },
      'user-1',
      '2026-09',
    )
    expect(read).toEqual({
      uid: 'user-1',
      month: '2026-09',
      credits: 120,
      estCostUsd: 0.12,
      requests: 4,
      refusals: 0,
      byKind: { assist: 120 },
      byHost: {},
    })
  })

  it('derives credits from the spend when the writer never set them', () => {
    expect(aiUsageByUserMonthFrom({ estCostUsd: 0.0123 }, 'u', '2026-09').credits).toBe(13)
    expect(aiUsageByUserMonthFrom(undefined, 'u', '2026-09').credits).toBe(0)
  })

  it('ranks kinds dearest first and sums months', () => {
    expect(topAiUsageKinds({ assist: 10, page: 300, element: 40 }, 2)).toEqual([
      { kind: 'page', credits: 300 },
      { kind: 'element', credits: 40 },
    ])
    expect(
      sumAiUsageCredits([
        aiUsageByUserMonthFrom({ credits: 5 }, 'u', '2026-09'),
        aiUsageByUserMonthFrom({ credits: 7 }, 'u', '2026-08'),
      ]),
    ).toBe(12)
  })
})
