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

import { aiCatalogEntry } from '../providers/catalog'
import { publicAssistQuota, type AssistReservation } from './assist-usage'
import { aiUsageMeterState, type AiUsageMeterWire } from './ai-usage-wire'

/**
 * The usage strip's envelope from what a door already holds (AGL-2942): the
 * reservation it took and, once the provider answered, what the exchange
 * cost. No read — the reservation measured the pool and the caller's month
 * inside the transaction it already runs.
 *
 * Every figure is credits. The pool comes through `publicAssistQuota`, the
 * one projection allowed to turn our provider bill into a customer figure;
 * the caller's month comes off the allotment gate, which the meter wrote in
 * credits in the first place.
 *
 * `last` is added to both months, because the reservation measured them
 * BEFORE this exchange and the strip is read after it.
 */
export function aiUsageMeter(
  reservation: Pick<AssistReservation, 'monthKey' | 'allowed'> &
    Partial<AssistReservation>,
  extra: {
    lastCredits?: number | null
    model?: { id: string; auto: boolean } | null
  } = {},
): AiUsageMeterWire {
  const last =
    typeof extra.lastCredits === 'number' && Number.isFinite(extra.lastCredits)
      ? Math.max(0, Math.ceil(extra.lastCredits))
      : null
  const spent = last ?? 0
  let pool: AiUsageMeterWire['pool'] = { used: spent, limit: null }
  try {
    const credits = publicAssistQuota(reservation as AssistReservation)?.credits
    if (credits) pool = { used: credits.used + spent, limit: credits.limit }
  } catch {
    // A reservation without its dollar figures (a double, a refusal taken
    // before the month was read) reports the exchange alone.
  }
  const gate = reservation.allotment ?? null
  const binding = gate?.binding ?? null
  const mine: AiUsageMeterWire['mine'] = binding
    ? {
        used: binding.used + spent,
        limit: binding.credits,
        mode: binding.mode,
        scope: binding.scope,
      }
    : {
        used: (gate?.personalCredits ?? 0) + spent,
        limit: null,
        mode: null,
        scope: null,
      }
  const refused = !reservation.allowed
  const entry = extra.model ? aiCatalogEntry(extra.model.id) : undefined
  return {
    month: reservation.monthKey,
    pool,
    mine,
    last,
    refused,
    state: aiUsageMeterState({ pool, mine, refused }),
    model:
      extra.model && entry
        ? { id: entry.id, label: entry.label, auto: extra.model.auto }
        : null,
  }
}
