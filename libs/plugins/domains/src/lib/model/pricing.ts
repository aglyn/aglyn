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
  METERED_MARKUP,
  STRIPE_PROCESSOR_FEE_PCT,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

/*
 * WHAT A DOMAIN COSTS THE CUSTOMER (AGL-3962).
 *
 * The registrar's price, at cost + 30% KEPT after Stripe — the rule every
 * passed-through cost on the platform is held to (AGL-3476). A domain is
 * billed on an invoice of its own, so unlike an overage line it also pays
 * Stripe's fixed 30¢, which is grossed up here rather than eaten.
 *
 * The figure is rounded UP to the next whole dollar less a cent: a price a
 * person reads in a search result is a round one, and rounding up is the only
 * direction that never sells under the rule. For a `.com` at $11.25 that is
 * $15.99 a year, which sits under what site builders charge for the same
 * name ($20 and up) while every sale clears its cost.
 */

/** Stripe's fixed fee on a card charge, in dollars. */
export const STRIPE_FIXED_FEE_USD = 0.3

/**
 * The most a first year may cost US for it to be included free on an annual
 * plan. Covers every standard ending (`.com`, `.net`, `.org`, `.co` …) and
 * leaves out the premium-priced ones, the way site builders' free-domain
 * offers do.
 */
export const FREE_FIRST_YEAR_MAX_COST_USD = 20

/**
 * The most a domain may cost us to register or renew for it to be offered
 * at all. A name past this is a premium or speciality ending, where one
 * typo in a search costs a customer hundreds of dollars.
 */
export const MAX_OFFERED_COST_USD = 80

/** The customer's price, in cents, for a registrar cost in dollars. */
export function domainRetailCents(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0
  const grossed =
    (costUsd * METERED_MARKUP + STRIPE_FIXED_FEE_USD) /
    (1 - STRIPE_PROCESSOR_FEE_PCT)
  // Settled to the cent before the ceiling, so an exact figure is not lifted
  // a whole dollar by floating-point tail.
  const settled = Math.round(grossed * 100) / 100
  return Math.ceil(settled + 0.01) * 100 - 1
}

/** `1599` → `$15.99`. */
export function formatUsdCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`
}

/** What the free-first-year decision needs to know about the workspace. */
export interface FreeFirstYearInput {
  /** `orgs/{id}/billing/stripe`'s subscription interval. */
  interval: 'month' | 'year' | null | undefined
  /** Whether the subscription is live (`orgSubscriptionState === 'live'`). */
  subscriptionLive: boolean
  /** A plan staff granted for free: nothing was paid for it to include. */
  comped: boolean
  /** The first year's registrar cost, in dollars. */
  firstYearCostUsd: number
  /** Whether a domain was already bought free for this SITE. */
  siteUsedFreeDomain: boolean
}

/**
 * Whether this purchase's first year is included with the plan.
 *
 * One domain per site, on a paid annual plan, within the standard-ending
 * allowance — the offer site builders make. A monthly plan pays for the
 * first year; every plan pays for renewals.
 */
export function freeFirstYear(input: FreeFirstYearInput): boolean {
  return (
    input.interval === 'year' &&
    input.subscriptionLive &&
    !input.comped &&
    !input.siteUsedFreeDomain &&
    input.firstYearCostUsd > 0 &&
    input.firstYearCostUsd <= FREE_FIRST_YEAR_MAX_COST_USD
  )
}
