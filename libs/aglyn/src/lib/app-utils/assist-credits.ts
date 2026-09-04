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
  PLAN_PRICING,
  resolveEffectivePlan,
  resolveOrgEntitlements,
} from './plan-entitlements'
import type { AglynOrgBilling } from '../foundation/definitions/org-billing.types'

/**
 * Aglyn Assist credits: the unit assist is sold, metered and refused in.
 *
 * ## Why cost, and not messages
 *
 * Assist is measured per exchange as `estCostUsd` — real provider spend at
 * the serving model's rates, computed where the tokens were counted. A
 * message allowance would throw that measurement away and price every action
 * the same. It cannot: a question is a few thousand tokens, while generating
 * a screen carries the node tree, the component catalog and the theme tokens
 * in, emits structured markup out, and iterates. The two differ by up to two
 * orders of magnitude, so one workspace's ten screen builds can outspend
 * another's thousand questions while both read as "within allowance".
 *
 * Metering in cost is the only unit under which those two workspaces draw
 * down their bands differently, which is the entire point.
 *
 * ## Why a credit rather than the dollar figure
 *
 * `estCostUsd` is our provider bill, not a price. Publishing it would put our
 * model choice, our per-model rates and our margin on a billing page, and it
 * would move under customers every time a model is swapped. A credit is a
 * fixed quantity of that spend with a stable public meaning, so the band on
 * the plan card stays the same number when the model behind it changes.
 *
 * Everything customer-facing counts credits. This module is the ONLY place
 * the two units meet.
 */

/**
 * What one credit costs us, in USD of provider spend.
 *
 * A tenth of a cent, chosen for two properties rather than for roundness:
 *
 * - **1,000 credits cost exactly $1.00**, so the per-1,000 retail rates on
 *   `PLAN_PRICING.extraAssistCreditsUsdPer1k` read directly as multiples of
 *   cost. A rate of $2.00 per 1,000 is cost x2 with no arithmetic in between,
 *   which is what makes the 50% margin floor checkable by eye.
 * - **A single question is tens of credits, a generated screen is hundreds.**
 *   At Sonnet list rates a short grounded answer runs around $0.013, so ~13
 *   credits; a screen build runs into the hundreds. Both are whole numbers
 *   with room to differ, which a cent-sized credit would have flattened to
 *   "1 vs 20" and a dollar-sized one to "0 vs 0".
 *
 * ⚠️ This is a COST-MODEL constant, not a price and not a rate we publish.
 * It never appears on a customer surface; `assistCreditsFromUsd` is how a
 * measured dollar figure becomes something a customer may be shown.
 */
export const ASSIST_CREDIT_COST_USD = 0.001

/**
 * The minimum line margin every retail assist rate must clear.
 *
 * The same floor now applied to every retail rate in this codebase, and the
 * reason the assist ladder stops descending at cost x2 on Agency instead of
 * taking one more step the way the contacts ladder once did.
 */
export const ASSIST_CREDIT_MIN_MARGIN_PCT = 0.5

/**
 * Credits -> our cost in USD. Non-finite or negative input is 0 credits, so a
 * corrupt band cannot become a budget of `NaN` that every comparison passes.
 */
export function assistUsdFromCredits(credits: number): number {
  const value = Number(credits)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * ASSIST_CREDIT_COST_USD * 1_000_000) / 1_000_000
}

/**
 * Measured USD -> credits, rounded UP.
 *
 * Up, because this converts spend the platform has ALREADY made into the
 * figure a customer is shown against their band. Rounding down would let a
 * long tail of sub-credit exchanges cost real money and draw nothing, which
 * is the one direction a meter must not err in.
 */
export function assistCreditsFromUsd(usd: number): number {
  const value = Number(usd)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.ceil(value / ASSIST_CREDIT_COST_USD)
}

/**
 * The org's monthly assist band in credits, or `null` when its plan sells no
 * assist band at all.
 *
 * ## `null` is not zero, and the difference is the whole safety property
 *
 * Free and Starter carry `assistCreditsPerMonth: 0` because neither carries
 * `aiAssist` and neither is sold generative building. They still reach the
 * console assistant's docs-grounded rung, which is bounded by the free daily
 * message cap and by the operator's spend backstop. Resolving their band as a
 * budget of `$0` would refuse that rung outright — a tier's whole assistant
 * turned off by a pricing field that was never about it.
 *
 * The same reading is what makes the guard survive a stubbed entitlements
 * module. A test double that answers 0 for every quota produces `null` here,
 * which falls through to the operator backstop, rather than a budget of zero
 * that refuses everything while the assertions read green. A clamp that goes
 * green having refused every request has proved nothing, and 0 is exactly the
 * value a stub returns.
 *
 * ## Non-finite is also `null`, deliberately
 *
 * `Infinity` must never resolve to a budget. It is unrepresentable off-process
 * — `JSON.stringify(Infinity)` is `null` and reads back as 0 — so a band that
 * reached here as `Infinity` is a band that would read as zero somewhere
 * else. Falling through to the backstop is bounded and consistent; honouring
 * it would be an unbounded budget on one process and a refusal on the next.
 */
export function resolveAssistCreditBudget(
  org: Partial<AglynOrgBilling> | null | undefined,
): number | null {
  const credits = Number(resolveOrgEntitlements(org).assistCreditsPerMonth)
  if (!Number.isFinite(credits) || credits <= 0) return null
  return Math.floor(credits)
}

/** The org's monthly assist band in USD of provider spend, or `null`. */
export function resolveAssistBudgetUsd(
  org: Partial<AglynOrgBilling> | null | undefined,
): number | null {
  const credits = resolveAssistCreditBudget(org)
  return credits === null ? null : assistUsdFromCredits(credits)
}

/**
 * Credits spent past the band. A `null` band yields 0 — an org with no band
 * has nothing to be over, and reporting the whole month's spend as overage
 * there would invoice the free tier for its docs answers.
 */
export function assistCreditOverage(
  usedCredits: number,
  bandCredits: number | null,
): number {
  const used = Number(usedCredits)
  if (!Number.isFinite(used) || used <= 0) return 0
  if (bandCredits === null) return 0
  const band = Number(bandCredits)
  if (!Number.isFinite(band) || band <= 0) return 0
  return Math.max(0, used - band)
}

export interface AssistCreditOveragePrice {
  /** Credits past the plan's band, as handed in. */
  overageCredits: number
  /** Estimated charge at the plan's per-1,000 rate. */
  overageMonthlyUsd: number
  /** Per-1,000 rate; null when the plan prices no assist overage. */
  overageRateUsd: number | null
}

/**
 * Prices assist credits past a plan's band.
 *
 * ## No `allowed`, deliberately — and for the opposite reason to email
 *
 * `priceEmailSendOverage` omits an `allowed` field because email has two
 * gates and a transactional sender consulting the wrong one drops a password
 * reset. Assist omits it because it has exactly ONE gate and this is not it:
 * the refusal happens inside `reserveAssistMessage`, before a token is spent.
 * A second answer to "may this proceed", computed after the fact from a
 * rounded credit figure, would be a second gate to drift from the first.
 *
 * ## Takes the overage, does not recompute it
 *
 * `assistCreditOverage` derives the excess once, from the measured meter and
 * the resolved band. Re-deriving it here would be a second overage model.
 *
 * A null rate yields zero structurally rather than by a check, which is what
 * keeps Free and Starter at zero on this axis.
 */
export function priceAssistCreditOverage(
  org: Partial<AglynOrgBilling> | null | undefined,
  overageCredits: number,
): AssistCreditOveragePrice {
  const overageRateUsd =
    PLAN_PRICING[resolveEffectivePlan(org)].extraAssistCreditsUsdPer1k
  const credits = Number(overageCredits)
  const over = Number.isFinite(credits) && credits > 0 ? credits : 0
  return {
    overageCredits: over,
    overageMonthlyUsd:
      overageRateUsd === null
        ? 0
        : Math.round((over / 1000) * overageRateUsd * 100) / 100,
    overageRateUsd,
  }
}

/**
 * The line margin a per-1,000-credit retail rate earns, as a fraction.
 *
 * One expression, so the ladder and its floor cannot be checked against two
 * different definitions of margin. A null or non-positive rate has no margin
 * to report and answers `null` rather than 1 or 0 — "this plan sells no
 * overage" is not "this plan sells overage at 100% margin".
 */
export function assistCreditRateMarginPct(
  rateUsdPer1k: number | null,
): number | null {
  if (rateUsdPer1k === null) return null
  const rate = Number(rateUsdPer1k)
  if (!Number.isFinite(rate) || rate <= 0) return null
  const costPer1k = ASSIST_CREDIT_COST_USD * 1000
  return (rate - costPer1k) / rate
}

/**
 * What a refused or in-progress workspace may be TOLD about its assist band.
 *
 * The reservation carries `costUsd` and `costLimitUsd` because that is what
 * it measured and what it compared against, and both are our provider bill.
 * Shipping the reservation itself to a browser publishes them. This is the
 * projection that crosses that boundary: credits only, no dollars, no model,
 * no rates.
 */
export interface PublicAssistCredits {
  /** Credits drawn this month, rounded up. */
  used: number
  /** The band, or `null` when no band applied to this request. */
  limit: number | null
  /** Credits left in the band, or `null` when there is no band. */
  remaining: number | null
}

/**
 * Projects a measured spend figure and a ceiling into the credit view.
 *
 * Both inputs are nullable because the reservation's are: `costUsd` is `null`
 * when nothing consulted the monthly document, and a ceiling is `null` when
 * none applied. Neither collapses to 0 here — "nobody looked" and "spent
 * nothing" have to stay distinguishable at the surface, exactly as they do on
 * the reservation.
 */
export function publicAssistCredits(
  costUsd: number | null,
  ceilingUsd: number | null,
): PublicAssistCredits {
  const used = costUsd === null ? 0 : assistCreditsFromUsd(costUsd)
  if (ceilingUsd === null) return { used, limit: null, remaining: null }
  const limit = assistCreditsFromUsd(ceilingUsd)
  return { used, limit, remaining: Math.max(0, limit - used) }
}
