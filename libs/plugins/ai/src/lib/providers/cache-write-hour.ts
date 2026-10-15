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

import type { AiTokenRates } from './catalog'
import type { AiUsage } from './contract'

/**
 * What an hour-long cache entry costs to write on top of what the rates
 * price it at (AGL-3830). A rate table carries one write rate, the
 * five-minute entry's 1.25 times the input price; the provider bills an
 * hour-long entry at {@link AI_CACHE_WRITE_HOUR_FACTOR} times, so each token
 * of `cacheWriteHourTokens` owes the difference. Kept out of the four-figure
 * price on purpose: only a server reader can be handed an hour-long write,
 * and the model selector that prices nominal usage never is. Its own module,
 * not the catalog's, because the catalog loads on every console page and a
 * helper beside it would load there too.
 */
export const AI_CACHE_WRITE_HOUR_FACTOR = 2

export function aiCacheWriteHourSurchargeUsd(
  usage: Pick<AiUsage, 'cacheWriteHourTokens'>,
  rate: AiTokenRates,
): number {
  const tokens = Number(usage.cacheWriteHourTokens ?? 0)
  if (!Number.isFinite(tokens) || tokens <= 0) return 0
  const usd = tokens * (rate.inputPerToken * AI_CACHE_WRITE_HOUR_FACTOR - rate.cacheWritePerToken)
  return Math.round(usd * 1_000_000) / 1_000_000
}

/**
 * The hour-long writes of two exchanges added up, as a spread: absent where
 * neither reported any, so a usage object that never had the field keeps
 * the shape it had.
 */
export function aiCacheWriteHourSum(
  a: Pick<AiUsage, 'cacheWriteHourTokens'>,
  b: Pick<AiUsage, 'cacheWriteHourTokens'>,
): Pick<AiUsage, 'cacheWriteHourTokens'> {
  if (a.cacheWriteHourTokens === undefined && b.cacheWriteHourTokens === undefined) return {}
  return { cacheWriteHourTokens: (a.cacheWriteHourTokens ?? 0) + (b.cacheWriteHourTokens ?? 0) }
}
