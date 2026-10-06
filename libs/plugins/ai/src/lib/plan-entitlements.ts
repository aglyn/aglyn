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

// Types only: the manifest generator loads this module on its own to compile
// the plan figures, before the catalog file core reads them from exists in
// its new shape, so nothing here may reach a core module at runtime.
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginPlanEntitlementsDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-plan-entitlements'

/**
 * THE AI PLUGIN'S PLAN BAND (AGL-3080): how many AI credits each plan
 * includes a month. Compiled into core's `PLAN_ENTITLEMENTS` by the manifest
 * generator (`register.planEntitlements`), so `/pricing`, the plan comparison
 * and every gate read the same figure they always have; this is where it is
 * written, beside the reasoning that sized it.
 */
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    /**
     * AI credits per calendar month — the band assist spends against.
     *
     * A CREDIT IS A UNIT OF MODEL COST, not a message. One assist action can
     * cost two orders of magnitude more than another: a question is a few
     * thousand tokens, while generating a screen carries the node tree, the
     * component catalog and the theme tokens in, structured markup out, and
     * iterates. A message allowance would price those the same, so one
     * workspace's ten screen builds would outspend another's thousand
     * questions and both would read as "within allowance".
     *
     * The unit is defined by `ASSIST_CREDIT_COST_USD` and the conversion
     * lives in `assist-credits.ts`. Only that module turns credits into
     * dollars; everything a customer sees counts credits, because the dollar
     * figure behind them is our provider bill and not a price.
     *
     * ## HOW THE BAND IS SIZED, and why it is not a share of the price
     *
     * A credit is a dollar of provider spend at `ASSIST_CREDIT_COST_USD`, so
     * the band IS a liability figure: the plan's whole assist give is
     * `assistCreditsPerMonth / 1000` dollars. Credits past it are not a give
     * — since AGL-2653 they are SOLD at `extraAssistCreditsUsdPer1k`, unless
     * the org's `assistOverage.hardCap` asks `reserveAssistMessage` to refuse
     * at the band instead. Sizing it as a share of the subscription price
     * says nothing about whether the tier can afford it, because the price is
     * also carrying storage, bandwidth, form submissions, dataset storage,
     * API requests, contacts and email.
     *
     * So each band is sized against what those SEVEN other terms leave.
     * Every paid band takes between a quarter and a third of that remainder,
     * which keeps the tier's worst case positive and keeps the ladder's
     * shape: the margin each tier holds at 100% of every band stays in
     * proportion to what it held before assist was sold at all.
     * `tier-margin-floor.spec.ts` is the model, and it pins both the rule and
     * the resulting figures.
     *
     * The Aglyn AI add-on (AGL-2896) adds `AI_ADDON_CREDITS_PER_MONTH[plan]`
     * to this band in `resolveOrgEntitlements` — one pool, widened, rather
     * than a second meter.
     */
    assistCreditsPerMonth?: number
  }
}

/**
 * AI credits an Enterprise agreement includes per month, before the contract
 * says otherwise.
 *
 * ## Never `UNLIMITED`, and the reason is not stylistic
 *
 * `UNLIMITED` is `Number.POSITIVE_INFINITY`, `JSON.stringify(Infinity)` is
 * `null`, and `Number(null)` is `0`. An unbounded assist band therefore
 * serialises to a band of ZERO through every route that does not also send
 * the explicit flag `restoreQuotaLimit` rebuilds from — which would hand the
 * only customers with a signed contract the one budget that refuses
 * everything. A finite number crosses the wire as itself.
 *
 * The band is also a real liability rather than a capacity we already own.
 * Storage and page views are infrastructure metered into the deal; assist is
 * a per-token charge from a third party, and generative building spends it in
 * units two orders of magnitude apart.
 *
 * ## Why this number
 *
 * Enterprise carries no list price, so the band cannot be sized the way every
 * self-serve tier's is — against what that tier's other cost terms leave out
 * of a known price. It is anchored to the top of the ladder instead: 116,000
 * credits is twice Agency's band, the rule every Enterprise fallback follows
 * since the 2026-09-07 pricing decision (see the `enterprise` row of
 * `PLAN_ENTITLEMENTS`). In cost that is $116 of provider spend a month, or
 * under 9% of any deal priced at or above the self-serve top. A deal below
 * that is sold as Agency, not written as an Enterprise agreement.
 *
 * ## It is a DEFAULT, and a contract raises it
 *
 * `resolveOrgEntitlements` applies a per-org
 * `entitlements.assistCreditsPerMonth` override ahead of this, so a deal that
 * buys more assist buys it on that org without moving the figure every other
 * agreement is measured against — the same mechanism the other contracted
 * bands use.
 */
export const ENTERPRISE_ASSIST_CREDITS_PER_MONTH = 116_000

/**
 * The Free AI taste (AGL-2925): the credits a Free workspace draws on each
 * month, behind a hard wall.
 *
 * ## Why it exists
 *
 * So the AI landing pages can say "generate your first page free" and mean
 * it. Three hundred credits is one or two generated sections or a handful of
 * copy rewrites — enough to see what the assistant does, not enough to build
 * a site on. The band is a WALL: `PLAN_PRICING.free
 * .extraAssistCreditsUsdPer1k` stays `null`, so `assistBandRefuses` answers
 * true and the reservation refuses at 100% with no overage, no switch and no
 * invoice. Nothing about a Free workspace can produce a charge.
 *
 * ## What it costs, and why that is the number
 *
 * A credit is `ASSIST_CREDIT_COST_USD` of provider spend, so the band costs
 * at most **$0.30 per Free workspace per month** — asserted by
 * `apps/console/specs/tier-margin-floor.spec.ts`. It is the one AI band with
 * no invoice behind it, which is why the same issue closes every multiplier
 * a script could use before the flag flips:
 *
 *  - it is metered per ACCOUNT as well as per workspace, so the three free
 *    workspaces an account may hold (AGL-2265) share one 300-credit
 *    allowance rather than tripling it (`reserveAssistMessage`);
 *  - every free request is bounded per IP, per uid and per account per
 *    day (a minimum account age, `AI_FREE_MIN_ACCOUNT_AGE_HOURS`, is
 *    available and off by default — AGL-3591);
 *  - a platform-wide daily ceiling on free spend pauses the taste for
 *    everyone until the UTC day rolls, paid workspaces untouched.
 *
 * The account allowance reads THIS constant rather than the workspace's
 * resolved band, because a staff override that widens one workspace's band
 * is a decision about that workspace, not about how much one person may draw
 * across all of theirs.
 */
export const FREE_AI_TASTE_CREDITS_PER_MONTH = 300

/** The AI credits each plan includes a month — see the key's own docblock. */
export const AI_CREDITS_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  // The Free AI taste (AGL-2925): a real band, and a wall. See the constant
  // for what it buys, what it costs and the precautions that keep one person
  // from drawing it three times over.
  free: FREE_AI_TASTE_CREDITS_PER_MONTH,
  // The first paid rung of the assist ladder (AGL-3203). Starter banded at 0
  // until 2026-09-20, which put a PAYING workspace below the Free taste's 300
  // on the one axis a visitor compares straight down the column — the
  // `/pricing` row read `300 / mo` for Free and `—` for Starter. A paid plan
  // that includes less of something than the free plan is not a packaging
  // subtlety; it is the comparison table arguing against the upgrade.
  //
  // 750 is deliberately small: 2.5x the taste, enough that the assistant is a
  // thing the tier HAS rather than a thing it is shown, and $0.75 of provider
  // spend a month at `ASSIST_CREDIT_COST_USD` against a $16 annual price — a
  // twentieth of the $8.81 the tier's other metered bands already cost, and
  // the widest margin on the ladder absorbs it with room left
  // (`tier-margin-floor.spec.ts` carries the arithmetic).
  //
  // It is NOT a wall, unlike Free's: `PLAN_PRICING.starter
  // .extraAssistCreditsUsdPer1k` is $3.00, so past 750 the tier meters and
  // bills like every paid plan above it. The two fields move together by rule
  // — a positive band with no rate beside it is usage past a bound that is
  // silently free, which `plan-entitlements.spec.ts` forbids.
  //
  // `features.aiAssist` is TRUE, and AGL-3203 shipping it false was the
  // defect AGL-3207 closes. The reasoning then was "the band is credits, not
  // the guided rung, exactly as on Free" — but on Free the band IS spendable,
  // through `aiGenerative`, which is the door the taste exists for. Starter
  // carried neither flag, so it was the only row on the ladder sold a band
  // with nothing to spend it through: 750 credits reachable only by buying
  // the $9 add-on that was also the only thing that made them usable. "No
  // plan bands at zero any more" was true of the number and false of the
  // capability.
  //
  // It opens `aiAssist` rather than `aiGenerative` because that is the shape
  // of every paid rung above it — the included band funds the guided
  // assistant and generation is the add-on. Opening the generative door here
  // instead would hand the FIRST paid rung a door Pro through Agency have to
  // buy.
  //
  // No cost moves: `tier-margin-floor.spec.ts` already prices this tier's
  // assist term at 100% burn of the 750 credits, 75¢/mo. A door does not
  // widen a band; it only makes spend that was already modeled reachable.
  //
  // The AI add-on adds `AI_ADDON_CREDITS_PER_MONTH.starter` on top and
  // switches `aiGenerative` on as well.
  starter: 750,
  // $2.75 of provider spend, against the $8.35 the tier's other seven cost
  // terms leave out of $56. See the key's docblock for why the remainder and
  // not the price is what sizes this.
  pro: 2_750,
  // $7.50, against the $22.69 the other seven terms leave out of $139.
  business: 7_500,
  // $10.00, against the $30.62 the other seven terms leave out of $249.
  scale: 10_000,
  // $13.00, against the $39.74 the other seven terms leave out of $399 — the
  // thinnest remainder on the ladder, and the tier that binds the whole
  // assist ladder's share of it.
  advanced: 13_000,
  // $58.00, against the $176.71 the other seven terms leave out of $1,299.
  agency: 58_000,
  enterprise: ENTERPRISE_ASSIST_CREDITS_PER_MONTH,
}

/** The AI plugin's plan figures, for the manifest generator. */
export function aiPlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      {
        key: 'assistCreditsPerMonth',
        label: 'AI credits / mo',
        byPlan: AI_CREDITS_BY_PLAN,
      },
    ],
  }
}
