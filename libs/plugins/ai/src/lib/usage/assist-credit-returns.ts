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

// Imported from BOTH graphs — the staff card (client) and every server
// reader of a credit meter — so it imports no Firebase and no entry barrel.
import { ASSIST_CREDIT_COST_USD, assistCreditsFromUsd } from './assist-credits'

/**
 * CREDITS GIVEN BACK (AGL-3595): what a month's meter reads once the credits
 * returned to it are taken off.
 *
 * Two meters count AI credits by the month, both as BILLED dollars in
 * `estCostUsd`:
 *
 *   orgs/{orgId}/assistUsage/{YYYY-MM}    the WORKSPACE's band
 *   users/{uid}/aiUsage/{YYYY-MM}         a Free workspace OWNER's account
 *                                         allowance (`assist-free-taste.ts`)
 *
 * A give-back never rewrites `estCostUsd`. It adds to a second field,
 * `returnedUsd`, and records the act under `creditReturns.{key}` on the same
 * document, so the month still says what was spent, and what was handed
 * back, and by whom. Every reader that turns a meter into "credits used" —
 * the reservation, the customer's usage strip and banner, the staff card,
 * the overage the invoice prices — reads the figure through
 * `assistSpendAfterReturnsUsd`, so no surface can show a person a balance the
 * gate would not admit them at.
 *
 * The provider figure is NOT adjusted. `providerCostUsd` is what the month
 * cost Aglyn, and a give-back does not refund the model provider: margins
 * and spend alerts keep reading the real money.
 */

/** The field a give-back adds to, in billed USD, beside `estCostUsd`. */
export const ASSIST_RETURNED_USD_FIELD = 'returnedUsd'

/** The map of give-backs on a month document, keyed by idempotency key. */
export const ASSIST_CREDIT_RETURNS_FIELD = 'creditReturns'

/** Which meter a give-back lands on. */
export type AssistCreditMeter = 'workspace' | 'account'

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

const nonNegative = (value: unknown): number => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * The month's spend after give-backs, in billed USD — never below zero.
 *
 * Takes the two raw field values rather than a snapshot, so a transaction's
 * snapshot, a plain document and a test double all read the same way:
 * `assistSpendAfterReturnsUsd(snap.get('estCostUsd'), snap.get(ASSIST_RETURNED_USD_FIELD))`.
 *
 * Rounded to 6dp, the precision the meter writes at, so a give-back of
 * exactly what was spent reads as zero rather than as a float's residue —
 * a residue that `assistCreditsFromUsd` would round UP into a credit.
 */
export function assistSpendAfterReturnsUsd(
  estCostUsd: unknown,
  returnedUsd: unknown,
): number {
  return Math.max(0, round6(nonNegative(estCostUsd) - nonNegative(returnedUsd)))
}

/** The same figure off a month document's data, for readers holding one. */
export function assistMonthSpendUsd(
  monthDoc: Record<string, unknown> | null | undefined,
): number {
  return assistSpendAfterReturnsUsd(
    monthDoc?.['estCostUsd'],
    monthDoc?.[ASSIST_RETURNED_USD_FIELD],
  )
}

/** Credits given back on a month document so far. */
export function assistReturnedCredits(
  monthDoc: Record<string, unknown> | null | undefined,
): number {
  // Nearest, not up: a give-back is a whole number of credits, or the whole
  // remainder of a meter, which is never more than one credit's fraction.
  const usd = nonNegative(monthDoc?.[ASSIST_RETURNED_USD_FIELD])
  return Math.round(usd / ASSIST_CREDIT_COST_USD)
}

/**
 * The most credits a give-back may return to a month: what the meter reads
 * as used after earlier give-backs. A give-back past it would bank credits
 * against next spend, which is a grant, not a compensation.
 */
export function assistReturnableCredits(
  monthDoc: Record<string, unknown> | null | undefined,
): number {
  return assistCreditsFromUsd(assistMonthSpendUsd(monthDoc))
}
