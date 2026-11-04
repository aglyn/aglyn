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
  SELF_SERVE_PLANS,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  ADDON_KINDS,
  addonMaxForBaseline,
  addonMaxForPlan,
  addonUnitUsd,
  type AddonKind,
} from '@aglyn/aglyn/app-utils/bundle-intent'
// The Aglyn AI credit block (AGL-4144) by its own modules rather than the
// server barrel: the webhook and every billing route read a subscription's
// AI item through here, and the many route specs that stub
// `@aglyn/aglyn/server` with a partial object would otherwise see these as
// undefined.
import { planSellsAiCredits } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { AI_CREDIT_BLOCK_ENV_KEY } from '@aglyn/aglyn/app-utils/ai-credit-blocks'

/*
 * The add-on kinds, their unit prices (the Aglyn AI credit block's included) and
 * their ceilings live beside the bundle-link parser (AGL-3955), so the link,
 * the Billing card and this price map read one list. Re-exported here for
 * every server reader that already imports them from this module.
 */
export { ADDON_KINDS, addonMaxForBaseline, addonMaxForPlan, addonUnitUsd, type AddonKind }

/**
 * Self-serve add-on price map (AGL-525): the bridge between
 * `STRIPE_PRICE_*` env price ids, `org.seatAddons` keys, and
 * `PLAN_PRICING` USD amounts. Add-ons bill as extra items on the org's
 * one subscription, so every kind has a monthly and a yearly price
 * (Stripe allows a single interval per subscription; annual orgs attach
 * the `_YEARLY` variants). Seat/member/dataset/host prices are per-plan;
 * POS registers, the Event Calendar, Site Care (AGL-3954) and Aglyn AI
 * credit blocks (AGL-4144, `STRIPE_PRICE_AI_CREDITS`, on any paid plan) are
 * flat. Prices are minted by `tools/scripts/setup-stripe.mjs` — keep the
 * three in sync.
 */
export type BillingInterval = 'month' | 'year'

/** Kinds priced per plan (env `STRIPE_PRICE_{PLAN}_{SUFFIX}[_YEARLY]`). */
const PER_PLAN_ENV_SUFFIX: Partial<Record<AddonKind, string>> = {
  managers: 'EXTRA_SEAT',
  members: 'EXTRA_MEMBER',
  datasets: 'EXTRA_DATASET',
  hosts: 'EXTRA_HOST',
}

/** Kinds priced flat across plans (env `STRIPE_PRICE_{SUFFIX}[_YEARLY]`). */
const FLAT_ENV_NAME: Partial<Record<AddonKind, string>> = {
  posRegisters: 'POS_REGISTER',
  eventCalendar: 'EVENT_CALENDAR',
  siteCare: 'SITE_CARE',
  // Credits by the block (AGL-4144): `STRIPE_PRICE_AI_CREDITS[_YEARLY]`.
  aiAddon: AI_CREDIT_BLOCK_ENV_KEY,
}

/**
 * Every plan that is sold with a Stripe price — DERIVED, never hand-listed
 * (AGL-1340).
 *
 * The literal that used to sit here listed starter, pro, business and
 * advanced only — it predated the Scale and Agency tiers, so
 * `addonKindFromPriceId()` could not recognise a single Scale/Agency add-on
 * price coming back from Stripe. `addonPriceId()` still SOLD them (it only
 * uppercases the plan), so the money moved and the read-back returned
 * nothing: the webhook wrote `seatAddons: {all zeros}` for the
 * highest-paying orgs on the next subscription event, and `seatAddons` is an
 * ENTITLEMENT INPUT (`plan-entitlements.ts` — it raises `hostLimit` and
 * `posRegisters`, and flips the `eventCalendar` feature).
 *
 * Deriving from `SELF_SERVE_PLANS` is what stops the next tier from
 * reintroducing it: `free` has nothing to sell and `enterprise` is quoted
 * per deal (no `STRIPE_PRICE_ENTERPRISE_*` exists), so everything else is
 * by definition a paid, priced plan.
 *
 * Since pricing v4 (2026-11-03, AGL-4126) that is Starter and Pro. Business,
 * Scale, Advanced and Agency are retired: their prices are archived and
 * their env removed, and no subscription carried one when v4 shipped, so
 * nothing is left on Stripe for the read-back to recognise.
 */
export const PAID_PLANS: readonly OrgPlan[] = SELF_SERVE_PLANS.filter(
  (plan) => plan !== 'free',
)

function env(name: string): string | null {
  const value = process.env[name]
  return value ? value : null
}

/**
 * The Stripe price id for an add-on kind on a plan at a billing interval;
 * null when the plan doesn't sell it (free) or the env isn't configured.
 */
export function addonPriceId(
  kind: AddonKind,
  plan: OrgPlan,
  interval: BillingInterval,
): string | null {
  const name = addonPriceEnvName(kind, plan, interval)
  return name ? env(name) : null
}

/**
 * The env var that holds an add-on's price id on a plan at an interval, or
 * null where the plan sells no such price. Named on its own so a checkout
 * that Stripe refuses can say which variable points at a missing price.
 * For Aglyn AI credit blocks it is `STRIPE_PRICE_AI_CREDITS[_YEARLY]`
 * (AGL-4144), on a plan that sells them.
 */
export function addonPriceEnvName(
  kind: AddonKind,
  plan: OrgPlan,
  interval: BillingInterval,
): string | null {
  const yearly = interval === 'year' ? '_YEARLY' : ''
  // Flat, but sold only on a paid self-serve plan: Free has no subscription
  // to carry the blocks and Enterprise's AI is in the agreement.
  if (kind === 'aiAddon' && !planSellsAiCredits(plan)) return null
  const flat = FLAT_ENV_NAME[kind]
  if (flat) return `STRIPE_PRICE_${flat}${yearly}`
  const suffix = PER_PLAN_ENV_SUFFIX[kind]
  // Only a plan that is sold has per-plan add-on prices: Free sells none, and
  // the plans pricing v4 retired (AGL-4126) are sold no longer, so their
  // `STRIPE_PRICE_{PLAN}_EXTRA_*` env is not read.
  if (!suffix || !PAID_PLANS.includes(plan)) return null
  return `STRIPE_PRICE_${plan.toUpperCase()}_${suffix}${yearly}`
}

/**
 * Reverse map: which add-on kind a subscription item's price id sells.
 * Null for non-add-on prices (the base plan item, unknown prices).
 */
export function addonKindFromPriceId(
  priceId: string | null | undefined,
): AddonKind | null {
  if (!priceId) return null
  for (const kind of ADDON_KINDS) {
    for (const interval of ['month', 'year'] as const) {
      const flat = FLAT_ENV_NAME[kind]
      if (flat) {
        // Read by the env name itself rather than through a plan, so a flat
        // price is recognised whichever plans sell it.
        if (env(`STRIPE_PRICE_${flat}${interval === 'year' ? '_YEARLY' : ''}`) === priceId) {
          return kind
        }
        continue
      }
      for (const plan of PAID_PLANS) {
        if (addonPriceId(kind, plan, interval) === priceId) return kind
      }
    }
  }
  return null
}

/**
 * The price an add-on item moves to on a target plan/interval: the kind's
 * price there. Aglyn AI credit blocks are one flat price per interval
 * (AGL-4144), so a plan change re-prices only their interval. The current
 * price is accepted so a caller states what it is moving from; no kind needs
 * it to choose the target any more.
 */
export function addonTargetPriceId(
  kind: AddonKind,
  plan: OrgPlan,
  interval: BillingInterval,
  _currentPriceId?: string | null,
): string | null {
  return addonPriceId(kind, plan, interval)
}

/**
 * The BASE plan's Stripe price id at an interval
 * (`STRIPE_PRICE_{PLAN}[_YEARLY]`); null for `free`, for the custom-priced
 * `enterprise`, and for an env that isn't configured. Read at call time, so
 * it never freezes a stale value at module load the way the routes'
 * `PRICE_ENV` maps do.
 */
export function planPriceId(
  plan: OrgPlan,
  interval: BillingInterval,
): string | null {
  if (!PAID_PLANS.includes(plan)) return null
  const yearly = interval === 'year' ? '_YEARLY' : ''
  return env(`STRIPE_PRICE_${plan.toUpperCase()}${yearly}`)
}

/**
 * Which plan a subscription item's price sells AND on which interval; null for
 * an add-on price, the metered price, an ad-hoc enterprise price, and anything
 * unknown.
 *
 * The interval half exists because a schedule phase read back from Stripe
 * carries price IDS and nothing else (AGL-2150): rebuilding that phase's item
 * list needs to know which interval it is priced on, and guessing it from the
 * live subscription is wrong exactly when the pending change is also an
 * interval change.
 */
export function planAndIntervalFromPriceId(
  priceId: string | null | undefined,
): { plan: OrgPlan; interval: BillingInterval } | null {
  if (!priceId) return null
  for (const plan of PAID_PLANS) {
    for (const interval of ['month', 'year'] as const) {
      if (planPriceId(plan, interval) === priceId) return { plan, interval }
    }
  }
  return null
}

/**
 * Which plan a subscription item's price sells; null for an add-on price,
 * the metered price, an ad-hoc enterprise price, and anything unknown.
 */
export function planFromPriceId(
  priceId: string | null | undefined,
): OrgPlan | null {
  return planAndIntervalFromPriceId(priceId)?.plan ?? null
}

/**
 * The shared metered-usage price (AGL-635) that makes reported usage
 * billable, for a given billing interval.
 *
 * Stripe rejects a subscription whose items mix `recurring.interval`, so the
 * metered item has to recur the same way the plan does. There are two prices
 * — `aglyn_metered_usage` (monthly) and `aglyn_metered_usage_yearly` — and
 * both bill $0.01 per aggregated unit against the SAME meter, because the
 * rollup posts an already-computed value in CENTS. The interval is therefore
 * the only thing that differs, and it is the only thing a caller must get
 * right.
 *
 * `interval` is REQUIRED on purpose (AGL-1280). It used to be monthly-only
 * with no argument, so the failure mode of forgetting it was attaching a
 * monthly price to a yearly subscription — the exact mixed-interval crash
 * this signature now makes unrepresentable. A default would hand that
 * footgun straight back.
 */
export function meteredPriceId(interval: 'month' | 'year'): string | null {
  return env(
    interval === 'year' ? 'STRIPE_PRICE_METERED_YEARLY' : 'STRIPE_PRICE_METERED',
  )
}

/**
 * Whether a price id is EITHER shared metered-usage price.
 *
 * Interval-agnostic by design: callers ask this to exclude the metered item
 * from plan/add-on reasoning, and an annual subscription's metered item must
 * be excluded just as thoroughly as a monthly one.
 */
export function isMeteredPriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false
  return (
    priceId === meteredPriceId('month') || priceId === meteredPriceId('year')
  )
}

/**
 * The subscription's BASE PLAN item, identified POSITIVELY (AGL-1340).
 *
 * This used to be "whatever no add-on price claims" — identification by
 * elimination, which quietly returns the wrong item the moment a
 * subscription carries anything the add-on map doesn't recognise: the
 * metered item, a grandfathered v1 price, a coupon-era SKU, an item added
 * by hand in the Stripe dashboard. Picking an add-on item as the plan item
 * means a plan switch re-prices the ADD-ON, and reads the billing interval
 * off it.
 *
 * So: match a known `STRIPE_PRICE_{PLAN}[_YEARLY]` first. Only when nothing
 * matches — an enterprise deal bills on an ad-hoc price, and grandfathered
 * subscriptions predate the current SKUs — fall back to the old rule,
 * minus the metered item, and finally to `items[0]` so behaviour for those
 * subscriptions is unchanged.
 */
export function findPlanItem<T extends { price?: { id?: string } | null }>(
  items: readonly T[] | null | undefined,
): T | null {
  const list = items ?? []
  const byPlanPrice = list.find((item) => planFromPriceId(item?.price?.id))
  if (byPlanPrice) return byPlanPrice
  const notAnAddon = list.find(
    (item) =>
      !addonKindFromPriceId(item?.price?.id) &&
      !isMeteredPriceId(item?.price?.id),
  )
  return notAnAddon ?? list[0] ?? null
}

/**
 * Full add-on quantity map (explicit zeros for absent kinds) from a
 * subscription's items — the shape written to `org.seatAddons` so
 * removals and dashboard edits converge on sync (AGL-527).
 */
export function addonQuantitiesFromItems(
  items:
    | Array<{ price?: { id?: string } | null; quantity?: number | null }>
    | null
    | undefined,
): Record<AddonKind, number> {
  const quantities = Object.fromEntries(
    ADDON_KINDS.map((kind) => [kind, 0]),
  ) as Record<AddonKind, number>
  for (const item of items ?? []) {
    const kind = addonKindFromPriceId(item?.price?.id)
    if (kind) {
      quantities[kind] += Math.max(0, Math.floor(Number(item?.quantity ?? 0)))
    }
  }
  return quantities
}
