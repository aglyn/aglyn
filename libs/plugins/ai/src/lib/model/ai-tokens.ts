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
  assistProviderCostUsd,
  ASSIST_PROVIDER_COST_FIELD,
} from '@aglyn/aglyn/app-utils/assist-credits'
import type { AiUsage } from '../providers/contract'

/**
 * TOKENS AS THE ROLLUPS KEEP THEM (AGL-2937): the pure half.
 *
 * A provider reports four counts per request, and each is priced at its own
 * rate: prompt tokens sent uncached, prompt tokens read from the prompt
 * cache, prompt tokens written to it, and tokens generated. The org month
 * (per kind), the person's month and the job step keep the same four, so a
 * figure read off one means what it means on the others, and the cache hit
 * rate is the same division everywhere it is shown.
 *
 * Stored shapes:
 *
 *   orgs/{orgId}/assistUsage/{YYYY-MM}
 *     kinds: { [kind]: { requests, estCostUsd, providerCostUsd,
 *                        tokens: { input, cached, cacheWrite, output } } }
 *   orgs/{orgId}/aiUsageByUser/{uid}/months/{YYYY-MM}
 *     tokens: { input, cached, cacheWrite, output }
 *
 * The month document's own top-level `inputTokens`, `outputTokens`,
 * `cacheReadTokens` and `cacheWriteTokens` stay its totals; `kinds` splits
 * them by what the request was for.
 */

/** The month document's per-kind map. */
export const AI_USAGE_MONTH_KINDS_FIELD = 'kinds'

/** The token map, on a person's month and on each kind of the org's. */
export const AI_USAGE_TOKENS_FIELD = 'tokens'

export interface AiTokenTotals {
  /** Prompt tokens sent uncached, at the model's input rate. */
  input: number
  /** Prompt tokens read from the prompt cache, at its read rate. */
  cached: number
  /** Prompt tokens written to the prompt cache, at its write rate. */
  cacheWrite: number
  /** Tokens the model generated, thinking included. */
  output: number
}

const count = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function emptyAiTokenTotals(): AiTokenTotals {
  return { input: 0, cached: 0, cacheWrite: 0, output: 0 }
}

/** A request's usage, in the rollups' names. */
export function aiTokenTotalsFrom(usage: AiUsage): AiTokenTotals {
  return {
    input: count(usage.inputTokens),
    cached: count(usage.cacheReadTokens),
    cacheWrite: count(usage.cacheWriteTokens),
    output: count(usage.outputTokens),
  }
}

export function addAiTokenTotals(a: AiTokenTotals, b: AiTokenTotals): AiTokenTotals {
  return {
    input: a.input + b.input,
    cached: a.cached + b.cached,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  }
}

/** A stored token map read back, every absent or malformed count as zero. */
export function readAiTokenTotals(raw: unknown): AiTokenTotals {
  const record = isRecord(raw) ? raw : {}
  return {
    input: count(record['input']),
    cached: count(record['cached']),
    cacheWrite: count(record['cacheWrite']),
    output: count(record['output']),
  }
}

/**
 * The share of prompt tokens served from the cache: reads over everything the
 * prompt was billed as — sent, read and written.
 *
 * Writes sit in the denominator on purpose. A prefix that expires and is
 * rewritten every other request is the expensive failure, since a write costs
 * more than a fresh input token; a rate over reads and fresh input alone
 * reads that month as healthy. `null` when there are no prompt tokens at all,
 * which is nothing to divide rather than a 0% hit rate.
 */
export function aiCacheHitRate(
  tokens: Pick<AiTokenTotals, 'input' | 'cached' | 'cacheWrite'>,
): number | null {
  const prompt = tokens.input + tokens.cached + tokens.cacheWrite
  return prompt > 0 ? tokens.cached / prompt : null
}

/** One kind of request in an org's month. */
export interface AiKindMonth {
  /** An `AiUsageKind`: `assist`, a besigner mode, or a job kind. */
  kind: string
  /** Metered model requests; a docs answer or a cache hit is not one. */
  requests: number
  /** What the kind DREW, at billed rates — the credits behind it. */
  estCostUsd: number
  /**
   * What the kind COST US (AGL-3015). Equal to `estCostUsd` on a kind served
   * only by models billed at their provider's list, and below it wherever a
   * marked-up model served. A month written before the split answers the
   * billed figure here, which over-reads our bill rather than under-reads it.
   */
  providerCostUsd: number
  tokens: AiTokenTotals
}

/**
 * The month document's `kinds` map as rows, dearest first.
 *
 * Ordered on what each kind DREW, not on what it cost us: the reader asking
 * "which kind is expensive" is asking about the meter every other figure on
 * the card is denominated in, and the two orders differ only where a kind's
 * model mix differs from its neighbour's.
 */
export function readAiKindMonths(raw: unknown): AiKindMonth[] {
  if (!isRecord(raw)) return []
  const rows: AiKindMonth[] = []
  for (const [kind, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const cost = Number(value['estCostUsd'] ?? 0)
    const billed = Number.isFinite(cost) && cost > 0 ? cost : 0
    rows.push({
      kind,
      requests: count(value['requests']),
      estCostUsd: billed,
      providerCostUsd: assistProviderCostUsd(
        billed,
        value[ASSIST_PROVIDER_COST_FIELD],
      ),
      tokens: readAiTokenTotals(value[AI_USAGE_TOKENS_FIELD]),
    })
  }
  return rows.sort(
    (a, b) => b.estCostUsd - a.estCostUsd || b.requests - a.requests || a.kind.localeCompare(b.kind),
  )
}
