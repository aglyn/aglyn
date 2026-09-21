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
  isUncappedPlanComp,
  resolveOrgEntitlements,
  resolvePlanPricing,
} from './plan-entitlements'
import type { AglynOrgBilling } from '../foundation/definitions/org-billing.types'

/**
 * Aglyn Assist credits: the unit assist is sold, metered and refused in.
 *
 * ## Why cost, and not messages
 *
 * Assist is measured per exchange as `estCostUsd` — the exchange priced at
 * the serving model's billed rates, computed where the tokens were counted. A
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
 * `estCostUsd` is a dollar figure off our own cost model, not a price.
 * Publishing it would put our model choice, our per-model rates and our
 * margin on a billing page, and it would move under customers every time a
 * model is swapped. A credit is a fixed quantity of that spend with a stable
 * public meaning, so the band on the plan card stays the same number when
 * the model behind it changes.
 *
 * Everything customer-facing counts credits. This module is the ONLY place
 * the two units meet.
 *
 * ## `estCostUsd` is the BILLED figure, not the bill we pay (AGL-3015)
 *
 * It is every exchange priced at the catalog's billed rates, which a model
 * may carry above what its provider charges. Credits are drawn from it, so
 * it is the right figure for a band, a wall, a cap and an invoice line. It
 * is the WRONG figure for a margin or a cost meter, which read the rollup's
 * provider figure through `assistProviderCostUsd` instead.
 */

/**
 * What one credit is BILLED at, in USD.
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
 *
 * ⚠️ AND IT IS NOT WHAT A CREDIT COSTS US (AGL-3015). The dollar figure this
 * divides is priced at the model catalog's BILLED rates, and a model may be
 * billed above what the provider charges. A credit is therefore a tenth of a
 * cent of BILLED spend, and at most a tenth of a cent of provider spend. Read
 * against a retail rate it yields the floor of the line margin, never the
 * middle of it — which is the safe direction, and the direction every margin
 * assertion in this repo depends on. What a period actually cost is measured,
 * not derived: `assistProviderCostUsd` reads it off the rollup.
 */
export const ASSIST_CREDIT_COST_USD = 0.001

/**
 * The field a monthly assist rollup, a signal row and a kind bucket keep
 * PROVIDER spend under, beside the `estCostUsd` a customer's credits are
 * drawn from (AGL-3015).
 *
 * Named here rather than in the meter that writes it because the readers are
 * spread across the plugin, the billing routes and the staff surfaces, and a
 * field name spelled out at six call sites is a field name that will be
 * spelled differently at the seventh.
 */
export const ASSIST_PROVIDER_COST_FIELD = 'providerCostUsd'

/**
 * What a metered period ACTUALLY COST US, from the two dollar figures a
 * rollup carries.
 *
 * `billedUsd` is `estCostUsd`: every exchange priced at its model's billed
 * rates, and the figure credits are drawn from. `providerUsd` is
 * `ASSIST_PROVIDER_COST_FIELD`: the same exchanges priced at what the
 * provider charged. The second is the answer wherever it exists.
 *
 * ## Why a rollup may not carry one, and which way that errs
 *
 * The provider figure is written from the commit that split the two rates
 * onward. A period closed before it answers with the BILLED figure, which is
 * at or above what we paid — so a margin taken on history reads low and a
 * cost reads high, the direction a cost figure is allowed to be wrong in.
 * The one period that under-reads is the month in flight when the split
 * shipped, whose provider figure covers only the exchanges after it; that
 * month's error is bounded by the markup on a few days of a meter whose
 * largest measured organization is a fraction of a cent.
 */
export function assistProviderCostUsd(
  billedUsd: unknown,
  providerUsd: unknown,
): number {
  const provider = Number(providerUsd)
  if (Number.isFinite(provider) && provider > 0) return provider
  const billed = Number(billedUsd)
  return Number.isFinite(billed) && billed > 0 ? billed : 0
}

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
 * A band of 0 resolves to `null` — "this org sells no band" — and never to
 * a budget of `$0`. An org with no band still reaches the console
 * assistant's docs-grounded rung, which is bounded by the free daily message
 * cap and by the operator's spend backstop. Resolving zero as a budget would
 * refuse that rung outright: a whole assistant turned off by a pricing field
 * that was never about it.
 *
 * Since AGL-3203 no PLAN ROW bands at zero. Free carries the AGL-2925 taste
 * of `FREE_AI_TASTE_CREDITS_PER_MONTH` with no rate beside it, so it
 * resolves to a budget here and `assistBandRefuses` makes that budget a
 * wall; Starter carries 750 WITH a rate, so its budget is a line it meters
 * past rather than a wall. Both draw their docs-grounded chat on the same
 * band, which is fine — each is sized so a month of it costs well under a
 * dollar.
 *
 * So the zero case is now reached only by a per-org override that writes
 * one, and the reading above is what keeps that org's assistant running.
 *
 * The Aglyn AI add-on (AGL-2896) needs no knowledge here either way: the
 * resolver has already added `AI_ADDON_CREDITS_PER_MONTH[plan]` to the
 * band, because the add-on widens the one pool rather than opening a
 * second.
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
 *
 * An UNCAPPED staff comp (AGL-3049) is where that `Infinity` comes from on
 * purpose, and `null` is right for it here too: there is no band to measure
 * against, be over, price or alert on. What `null` must NOT bring with it is
 * the backstop, whose repo default would cap the one workspace staff said
 * has no cap — so `assistBandRefuses` answers false for it, and the
 * reservation's ceiling (`assistMonthlyCeilingUsd` in the AI plugin) drops
 * the default and keeps only an operator's explicit figure.
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

/**
 * The per-1,000 rate the org's assist credits are sold at past its band, or
 * `null` when nothing is sold past it — the ONE reading of the rate
 * (AGL-2896). `priceAssistCreditOverage`, `assistBandRefuses`,
 * `assistRefusedByHardCap` and `assistHardCapRefusalText` all go through
 * it, so the gate, the invoice and the refusal sentence cannot quote three
 * different rates for one org.
 *
 * The plan's `extraAssistCreditsUsdPer1k` IS the answer — the whole answer,
 * since AGL-3203. Starter used to be the one exception: it banded at 0, so
 * the rate could not sit on its plan row without advertising a fee on a
 * quantity the plan never sold, and the add-on's band was priced from a
 * constant read here instead. Starter now includes 750 credits
 * unconditionally and carries $3.00 on its own row, so the exception and its
 * constant are gone and there is exactly one place the rate is written.
 *
 * Free and Enterprise are null with or without the add-on: Free sells no
 * add-on and its taste band is a wall by decision (AGL-2925), and
 * Enterprise's usage is in the contract.
 *
 * A STAFF COMP is null on every plan and with every add-on (AGL-3034),
 * because `resolvePlanPricing` — never `PLAN_PRICING` indexed directly —
 * sells nothing on a comp. That is what makes a comp's band a wall at the
 * gate and prices its overage to zero at the charge: the AI overage path
 * (AGL-3011) claims only what `assistMonthOverage` prices, so a comp never
 * becomes a Stripe invoice. The function is a single read for that reason;
 * a second source for the rate is how a comp gets quoted one.
 */
export function resolveAssistOverageRateUsdPer1k(
  org: Partial<AglynOrgBilling> | null | undefined,
): number | null {
  return resolvePlanPricing(org).extraAssistCreditsUsdPer1k
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
 * whether the band refuses is `assistBandRefuses`, applied inside
 * `reserveAssistMessage` before a token is spent. A second answer to "may
 * this proceed", computed after the fact from a rounded credit figure, would
 * be a second gate to drift from the first.
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
  const overageRateUsd = resolveAssistOverageRateUsdPer1k(org)
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
 * The line margin a per-1,000-credit retail rate earns AT LEAST, as a
 * fraction.
 *
 * One expression, so the ladder and its floor cannot be checked against two
 * different definitions of margin. A null or non-positive rate has no margin
 * to report and answers `null` rather than 1 or 0 — "this plan sells no
 * overage" is not "this plan sells overage at 100% margin".
 *
 * A LOWER BOUND, not the realized figure (AGL-3015). The cost side is
 * `ASSIST_CREDIT_COST_USD`, which is what a credit BILLS at; a model billed
 * above its provider rate costs us less than that per credit, so the real
 * line margin is this or better and never worse. The floor stays checkable
 * by eye — a $2.00 rate is still cost x2 — and a retail rate that clears the
 * floor here clears it on every model mix. What a period realized is the
 * staff margin card's business, and it reads measured provider spend.
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

/**
 * The console's name for the org's hard-cap switch (AGL-2653), quoted by the
 * refusal so the words on the 402 and the words beside the switch are one
 * string. Change it here and both move.
 */
export const ASSIST_HARD_CAP_CONTROL_LABEL = 'Stop AI assist at the included band'

/** Where the switch lives, in the words the refusal uses. */
export const ASSIST_HARD_CAP_CONTROL_LOCATION = 'Billing → Usage'

/**
 * Whether the org asked to be stopped at its assist band (AGL-2653).
 *
 * Strictly `=== true`: the map is absent on every org that has not touched
 * the switch, and absent is the selling default. A truthy string or a `1`
 * written by hand must not switch an assistant off at the band, so nothing
 * short of the boolean counts.
 */
export function resolveAssistHardCap(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  return org?.assistOverage?.hardCap === true
}

/**
 * Is the org's assist band a WALL, or a line past which credits are sold?
 *
 * Two things make it a wall, and only two:
 *
 * - **The org asked.** `assistOverage.hardCap` is the customer's own ceiling,
 *   the `storageOverage.capUsd` of this meter.
 * - **There is nothing to sell past it at.** An org whose
 *   `resolveAssistOverageRateUsdPer1k` is `null` has no rate to bill, so
 *   credits past its band would be provider spend with no invoice line — the
 *   silent free overage `plan-entitlements.spec.ts` forbids. Enterprise is
 *   one case, its band being contractual; FREE is the other, its taste band
 *   a wall by the AGL-2925 decision so that nothing about a Free workspace
 *   can produce a charge.
 *
 * Everything else sells past the band by default, which is the 2026-09-07
 * decision this function encodes — and since AGL-3203 that includes Starter,
 * which carries 750 credits and a $3.00 rate like every paid tier above it.
 *
 * An org with NO band at all answers the same as Enterprise, harmlessly:
 * `resolveAssistBudgetUsd` is `null` for it and the reservation never
 * measures against a band. No plan ROW is in that state any more — Free and
 * Starter both were, at different times — so it is reached by a per-org
 * override that writes a zero.
 *
 * An UNCAPPED staff comp (AGL-3049) is neither: it has no band to be a wall,
 * and nothing is sold past a band it does not have. It answers false, ahead
 * of the switch — a workspace staff uncapped is not stopped by a band, and
 * the reservation reads that answer as "no wall, no backstop default".
 */
export function assistBandRefuses(
  org: Partial<AglynOrgBilling> | null | undefined,
): boolean {
  if (isUncappedPlanComp(org)) return false
  if (resolveAssistHardCap(org)) return true
  return resolveAssistOverageRateUsdPer1k(org) === null
}

/**
 * Which ceiling refused a reservation, or `null` when it was admitted.
 *
 * - `messages`: the message cap (daily on the free rung, monthly entitled).
 * - `budget`:   the operator's spend backstop.
 * - `band`:     the plan's own band, as a wall — the switch, or a plan with
 *               no rate to sell past it at.
 * - `cap`:      the org's own dollar ceiling on overage (AGL-2898).
 *
 * The four that exist only on the Free taste (AGL-2925), each a precaution
 * against the one band that has no invoice behind it:
 *
 * - `account`:  the ACCOUNT's 300 credits are spent across every free
 *               workspace it owns — the org band alone would multiply by
 *               the workspaces one person may hold.
 * - `requests`: the account's daily free request cap.
 * - `refusals`: the account's free generation is paused for the day after
 *               too many `refusal` stops — a brief the model declined is a
 *               brief that should not be retried thirty times.
 * - `platform`: the platform-wide daily ceiling on free spend; nobody's
 *               fault, and "try again tomorrow" is the whole answer.
 *
 * Declared here, beside the helpers that read it, so the reservation, its
 * public projection and both doors name one union.
 */
export type AssistRefusedBy =
  | 'messages'
  | 'budget'
  | 'band'
  | 'cap'
  | 'account'
  | 'requests'
  | 'refusals'
  | 'platform'
  | null

/**
 * The sentence a Free workspace is told when one of the taste's own
 * precautions refused it, or `null` when the refusal was something else.
 *
 * One string per rung, for both doors and the gate ladder, so a customer
 * reading the console panel and one reading the besigner get the same
 * words. Every sentence is customer-safe: it names what to do (upgrade,
 * wait) and never a figure from our cost model, a counter document, or
 * another workspace.
 */
export function assistFreeTasteRefusalText(
  refusedBy: AssistRefusedBy,
): string | null {
  switch (refusedBy) {
    case 'account':
      return (
        'Your free AI credits for this month are used across your ' +
        'workspaces — upgrade any workspace to keep going.'
      )
    case 'requests':
      return (
        'Free workspaces get a limited number of AI requests a day — ' +
        'try again tomorrow, or upgrade to keep going.'
      )
    case 'refusals':
      return (
        'The AI declined several requests today, so free AI generation is ' +
        'paused until tomorrow. Try a different kind of brief then.'
      )
    case 'platform':
      return (
        'Free AI generation is paused for the rest of today — try again ' +
        'tomorrow. Paid workspaces are not affected.'
      )
    default:
      return null
  }
}

/**
 * Whether a refusal at the band was the org's OWN doing — the switch is on
 * AND turning it off would have let the exchange through. The refusal that
 * names the switch has to be the one the switch caused: on a plan with no
 * rate the band refuses whatever the switch says, and telling that customer
 * to turn it off would send them to a control that does nothing.
 */
export function assistRefusedByHardCap(
  org: Partial<AglynOrgBilling> | null | undefined,
  refusedBy: AssistRefusedBy,
): boolean {
  return (
    refusedBy === 'band' &&
    resolveAssistHardCap(org) &&
    resolveAssistOverageRateUsdPer1k(org) !== null
  )
}

/**
 * The sentence a workspace is told when its own hard cap refused it. ONE
 * string for both assist entrypoints, so the console panel and the besigner
 * cannot describe the same control in two ways. It names the switch by its
 * label, says where it lives, and quotes the plan's rate so the reader knows
 * what turning it off costs.
 */
export function assistHardCapRefusalText(
  org: Partial<AglynOrgBilling> | null | undefined,
): string {
  const rate = resolveAssistOverageRateUsdPer1k(org)
  const rateClause =
    rate === null ? '' : ` at $${rate.toFixed(2)} per 1,000 credits`
  return (
    `This workspace used its assistant credits for the month, and ` +
    `"${ASSIST_HARD_CAP_CONTROL_LABEL}" is on. Turn it off under ` +
    `${ASSIST_HARD_CAP_CONTROL_LOCATION} to keep going${rateClause}.`
  )
}

export interface AssistMonthOverage extends AssistCreditOveragePrice {
  /** Credits drawn this month, rounded up from the measured spend. */
  usedCredits: number
  /** The band those credits were measured against, or `null` for no band. */
  bandCredits: number | null
}

/**
 * A month's assist overage from its measured spend — the ONE derivation the
 * invoice and every meter read (AGL-2653).
 *
 * Takes `estCostUsd` as the rollup reads it and composes the three steps
 * that already existed — credits from spend, overage past the band, price at
 * the plan's rate — so `report-usage` cannot assemble them in a different
 * order from a console readout and arrive at a different figure. The
 * rounding is the other overage terms' rounding: `priceAssistCreditOverage`
 * rounds to the cent, and the rollup turns dollars into cents with the same
 * `Math.round(usd * 100)` it applies to contacts, API and dataset storage.
 *
 * A non-finite or negative spend is zero credits, for the reason
 * `assistCreditsFromUsd` gives; a plan with no band or no rate prices zero
 * structurally, so Free, Starter and Enterprise bill nothing here without a
 * check that could be forgotten.
 */
export function assistMonthOverage(
  org: Partial<AglynOrgBilling> | null | undefined,
  estCostUsd: number,
): AssistMonthOverage {
  const usedCredits = assistCreditsFromUsd(estCostUsd)
  const bandCredits = resolveAssistCreditBudget(org)
  return {
    usedCredits,
    bandCredits,
    ...priceAssistCreditOverage(
      org,
      assistCreditOverage(usedCredits, bandCredits),
    ),
  }
}

/** The console's name for the org's overage ceiling (AGL-2898). */
export const ASSIST_OVERAGE_CAP_CONTROL_LABEL =
  'Stop AI when this month’s overage reaches'

/**
 * Bounds on the ceiling a self-serve org may set. The floor is a dollar
 * because a ceiling of cents would refuse on the first exchange past the
 * band while reading as a limit; the roof is the storage cap's, so no
 * self-serve org writes itself an enterprise-sized commitment.
 */
export const ASSIST_OVERAGE_CAP_MIN_USD = 1
export const ASSIST_OVERAGE_CAP_MAX_USD = 100_000

/**
 * The org's monthly ceiling on AI overage dollars, or `null` for none.
 *
 * Strictly a finite positive number. `null`, absent, a string, `NaN`,
 * `Infinity` and zero all read as no ceiling — the failure mode of the
 * alternative is a wall of `NaN` that every comparison passes, or a ceiling
 * of zero that refuses the first exchange past the band while the card
 * says nothing is set.
 */
export function resolveAssistOverageCapUsd(
  org: Partial<AglynOrgBilling> | null | undefined,
): number | null {
  const raw = org?.assistOverage?.capUsd
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  return raw
}

/**
 * Has this month's overage reached the org's own ceiling (AGL-2898)?
 *
 * Composed from `assistMonthOverage`, the ONE derivation the invoice reads,
 * so the figure the ceiling stops at is the figure the invoice would have
 * billed. That composition is also what confines the ceiling to plans that
 * sell past their band: a plan with no rate prices its overage to zero, and
 * zero never reaches a positive ceiling — Free and Enterprise cannot get here
 * without a check that could be forgotten. `>=` rather than `>`, because an
 * org that asked to stop AT a figure is stopped when the figure is met.
 */
export function assistOverageCapReached(
  org: Partial<AglynOrgBilling> | null | undefined,
  estCostUsd: number,
): boolean {
  const cap = resolveAssistOverageCapUsd(org)
  if (cap === null) return false
  return assistMonthOverage(org, estCostUsd).overageMonthlyUsd >= cap
}

/**
 * Whether a refusal was the org's own ceiling. The reservation answers
 * `'cap'` only when `assistOverageCapReached` did, and that helper only
 * reaches a ceiling on a plan with a rate, so the two conditions restated
 * here are the same guarantee `assistRefusedByHardCap` gives the switch: the
 * control the sentence names is the control that refused.
 */
export function assistRefusedByOverageCap(
  org: Partial<AglynOrgBilling> | null | undefined,
  refusedBy: AssistRefusedBy,
): boolean {
  return (
    refusedBy === 'cap' &&
    resolveAssistOverageCapUsd(org) !== null &&
    resolveAssistOverageRateUsdPer1k(org) !== null
  )
}

/**
 * The sentence a workspace is told when its own overage ceiling refused it.
 * ONE string for both assist entrypoints, as `assistHardCapRefusalText` is
 * for the switch. It names the control by its label, quotes the figure the
 * org chose, and says where to raise or clear it.
 */
export function assistOverageCapRefusalText(
  org: Partial<AglynOrgBilling> | null | undefined,
): string {
  const cap = resolveAssistOverageCapUsd(org)
  const figure = cap === null ? '' : ` $${cap.toFixed(2)}`
  return (
    `This month’s AI assist overage reached${figure}, the figure you set as ` +
    `"${ASSIST_OVERAGE_CAP_CONTROL_LABEL}". Raise or remove it under ` +
    `${ASSIST_HARD_CAP_CONTROL_LOCATION} to keep going.`
  )
}

/**
 * The refusal sentence for whichever of the org's OWN controls refused, or
 * `null` when the refusal was nobody's control — the message cap, the
 * operator's backstop, or a plan that sells no overage. Both doors answer a
 * 402 with this text when it is a string and their usual 429 otherwise, so
 * the status and the sentence cannot disagree about whose decision it was.
 */
export function assistOwnControlRefusalText(
  org: Partial<AglynOrgBilling> | null | undefined,
  refusedBy: AssistRefusedBy,
): string | null {
  if (assistRefusedByHardCap(org, refusedBy)) return assistHardCapRefusalText(org)
  if (assistRefusedByOverageCap(org, refusedBy)) {
    return assistOverageCapRefusalText(org)
  }
  return null
}
