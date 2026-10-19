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

// The pure half of `migrate-ai-addon-tiers.mjs` (AGL-3965): which Stripe
// subscription item moves to which Aglyn AI tier price, decided from data the
// script fetched. No network and no filesystem, so the self-test can pin the
// one property the migration exists for — nobody's bill moves.

import { AI_TIER_IDS, LEGACY_AI_ADDON_TIER_BY_PLAN } from './pricing-drift.mjs'

export { AI_TIER_IDS, LEGACY_AI_ADDON_TIER_BY_PLAN }

/** Subscription states with nothing left to move. */
const ENDED = new Set(['canceled', 'incomplete_expired'])

/**
 * Every legacy → tier lookup-key pair, monthly and yearly.
 *
 * @returns {Array<{ plan: string, tier: string, interval: 'month'|'year', from: string, to: string }>}
 */
export function legacyToTierLookupKeys() {
  return Object.entries(LEGACY_AI_ADDON_TIER_BY_PLAN).flatMap(([plan, tier]) => [
    { plan, tier, interval: 'month', from: `aglyn_${plan}_ai_addon`, to: `aglyn_ai_${tier}` },
    { plan, tier, interval: 'year', from: `aglyn_${plan}_ai_addon_yearly`, to: `aglyn_ai_${tier}_yearly` },
  ])
}

/**
 * Pair each legacy price with its tier price, refusing any pair whose amount,
 * currency or interval differ — the move must not change a charge.
 *
 * @param prices - lookup key → `{ id, unit_amount, currency, recurring: { interval } }`
 * @returns `{ pairs, problems }`; a non-empty `problems` means do not run.
 */
export function pairLegacyPrices(prices) {
  const pairs = []
  const problems = []
  for (const key of legacyToTierLookupKeys()) {
    const from = prices[key.from]
    const to = prices[key.to]
    if (!from) continue // never minted or already archived: nothing to move
    if (!to) {
      problems.push(`${key.to} is not minted — run setup-stripe.mjs first`)
      continue
    }
    if (
      from.unit_amount !== to.unit_amount ||
      from.currency !== to.currency ||
      from.recurring?.interval !== to.recurring?.interval
    ) {
      problems.push(
        `${key.from} (${from.unit_amount} ${from.currency}/${from.recurring?.interval}) ` +
          `does not charge what ${key.to} charges (${to.unit_amount} ${to.currency}/` +
          `${to.recurring?.interval}) — moving it would change a bill`,
      )
      continue
    }
    pairs.push({ ...key, fromPriceId: from.id, toPriceId: to.id })
  }
  return { pairs, problems }
}

/**
 * The moves for a page of subscriptions.
 *
 * One move per subscription item on a legacy price: the same item, given the
 * tier price, quantity untouched, no proration (the amounts are equal, so
 * there is nothing to prorate). Skipped, and said why: an ended subscription,
 * and one a schedule manages — a schedule's future phase still names the
 * legacy price and would put it back at the flip, so it is left for a re-run
 * once the schedule releases (the console reads the legacy price as the same
 * tier meanwhile).
 *
 * @param subscriptions - Stripe subscription objects with `items.data`
 * @param pairs - `pairLegacyPrices(...).pairs`
 */
export function planAiTierMoves(subscriptions, pairs) {
  const byFrom = new Map(pairs.map((pair) => [pair.fromPriceId, pair]))
  const moves = []
  const skipped = []
  for (const subscription of subscriptions ?? []) {
    for (const item of subscription?.items?.data ?? []) {
      const pair = byFrom.get(item?.price?.id)
      if (!pair) continue
      const base = {
        subscriptionId: subscription.id,
        orgId: subscription?.metadata?.orgId ?? null,
        itemId: item.id,
        tier: pair.tier,
        from: pair.from,
        to: pair.to,
      }
      if (ENDED.has(subscription.status)) {
        skipped.push({ ...base, reason: `subscription is ${subscription.status}` })
      } else if (subscription.schedule) {
        skipped.push({ ...base, reason: 'a subscription schedule manages it; re-run after it releases' })
      } else {
        moves.push({ ...base, toPriceId: pair.toPriceId })
      }
    }
  }
  return { moves, skipped }
}

/** The Stripe form body for one move. */
export function moveParams(move) {
  return new URLSearchParams({
    'items[0][id]': move.itemId,
    'items[0][price]': move.toPriceId,
    proration_behavior: 'none',
  })
}
