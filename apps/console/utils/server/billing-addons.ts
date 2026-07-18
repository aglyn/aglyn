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
  EVENT_CALENDAR_ADDON_MONTHLY_USD,
  PLAN_PRICING,
  POS_REGISTER_ADDON_MONTHLY_USD,
  type OrgPlan,
  type OrgSeatAddons,
} from '@aglyn/aglyn/server'

/**
 * Self-serve add-on price map (AGL-525): the bridge between
 * `STRIPE_PRICE_*` env price ids, `org.seatAddons` keys, and
 * `PLAN_PRICING` USD amounts. Add-ons bill as extra items on the org's
 * one subscription, so every kind has a monthly and a yearly price
 * (Stripe allows a single interval per subscription; annual orgs attach
 * the `_YEARLY` variants). Seat/member/dataset/host prices are per-plan;
 * POS registers and the Event Calendar are flat. Prices are minted by
 * `tools/scripts/setup-stripe.mjs` — keep the three in sync.
 */
export type AddonKind = keyof Required<OrgSeatAddons>

export const ADDON_KINDS: readonly AddonKind[] = [
  'managers',
  'members',
  'datasets',
  'hosts',
  'posRegisters',
  'eventCalendar',
]

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
}

const PAID_PLANS: readonly OrgPlan[] = ['starter', 'pro', 'business', 'advanced']

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
  const yearly = interval === 'year' ? '_YEARLY' : ''
  const flat = FLAT_ENV_NAME[kind]
  if (flat) return env(`STRIPE_PRICE_${flat}${yearly}`)
  const suffix = PER_PLAN_ENV_SUFFIX[kind]
  if (!suffix || plan === 'free') return null
  return env(`STRIPE_PRICE_${plan.toUpperCase()}_${suffix}${yearly}`)
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
      if (FLAT_ENV_NAME[kind]) {
        if (addonPriceId(kind, 'starter', interval) === priceId) return kind
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
 * Monthly USD per unit for an add-on on a plan (yearly prices are ×12 of
 * this); null when the plan doesn't sell the kind. Single pricing source
 * of truth: `PLAN_PRICING` + the two flat add-on constants.
 */
export function addonUnitUsd(kind: AddonKind, plan: OrgPlan): number | null {
  const pricing = PLAN_PRICING[plan]
  switch (kind) {
    case 'managers':
      return pricing.extraSeatMonthlyUsd
    case 'members':
      return pricing.extraMemberMonthlyUsd
    case 'datasets':
      return pricing.extraDatasetMonthlyUsd
    case 'hosts':
      return pricing.extraHostMonthlyUsd
    case 'posRegisters':
      return POS_REGISTER_ADDON_MONTHLY_USD
    case 'eventCalendar':
      return EVENT_CALENDAR_ADDON_MONTHLY_USD
  }
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
