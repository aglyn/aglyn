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
  addAiTokenTotals,
  aiCacheHitRate,
  aiTokenTotalsFrom,
  emptyAiTokenTotals,
  readAiKindMonths,
  readAiTokenTotals,
} from './ai-tokens'

describe('tokens as every rollup keeps them (AGL-2937)', () => {
  it('names a request’s usage the way the rollups store it, and sums two', () => {
    const one = aiTokenTotalsFrom({
      inputTokens: 900,
      outputTokens: 400,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 3_400,
    })
    expect(one).toEqual({ input: 900, cached: 3_000, cacheWrite: 3_400, output: 400 })
    expect(addAiTokenTotals(one, one)).toEqual({
      input: 1_800,
      cached: 6_000,
      cacheWrite: 6_800,
      output: 800,
    })
  })

  it('reads a stored map back with every absent or malformed count as zero', () => {
    expect(readAiTokenTotals({ input: 12, cached: 'x', output: -4 })).toEqual({
      input: 12,
      cached: 0,
      cacheWrite: 0,
      output: 0,
    })
    expect(readAiTokenTotals(null)).toEqual(emptyAiTokenTotals())
  })

  it('counts cache writes against the hit rate, and has none with no prompt', () => {
    expect(aiCacheHitRate({ input: 500, cached: 18_000, cacheWrite: 2_000 })).toBeCloseTo(
      18_000 / 20_500,
      9,
    )
    // A prefix that expires and is written again as often as it is read:
    // against reads and fresh input alone it would read as 67%.
    expect(aiCacheHitRate({ input: 5_000, cached: 10_000, cacheWrite: 10_000 })).toBeCloseTo(0.4, 9)
    expect(aiCacheHitRate(emptyAiTokenTotals())).toBeNull()
  })

  it('reads the month’s kinds as rows, dearest first, skipping what is not a kind', () => {
    expect(
      readAiKindMonths({
        assist: {
          requests: 30,
          estCostUsd: 0.3,
          providerCostUsd: 0.2,
          tokens: { input: 1_000, cached: 9_000, cacheWrite: 0, output: 500 },
        },
        page: { requests: 4, estCostUsd: 2.2, tokens: { input: 2_000, cacheWrite: 3_000, output: 1_000 } },
        stray: 7,
      }),
    ).toEqual([
      {
        kind: 'page',
        requests: 4,
        estCostUsd: 2.2,
        // A bucket written before the split has only the billed figure and
        // answers with it, which over-reads our bill (AGL-3015).
        providerCostUsd: 2.2,
        tokens: { input: 2_000, cached: 0, cacheWrite: 3_000, output: 1_000 },
      },
      {
        kind: 'assist',
        requests: 30,
        estCostUsd: 0.3,
        providerCostUsd: 0.2,
        tokens: { input: 1_000, cached: 9_000, cacheWrite: 0, output: 500 },
      },
    ])
    expect(readAiKindMonths(undefined)).toEqual([])
  })
})
