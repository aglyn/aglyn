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

// AGL-3965: the AI add-on migration moves each per-plan item to the tier with
// the same price, and refuses anything that would move a bill.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  legacyToTierLookupKeys,
  moveParams,
  pairLegacyPrices,
  planAiTierMoves,
  stripeKeyMode,
  summarizeAiTierMoves,
} from './ai-tier-migration.mjs'

const TIER_USD = { spark: 9, boost: 19, plus: 39, max: 69, ultra: 99, studio: 299 }

/** Every legacy and tier price, minted the way setup-stripe.mjs mints them. */
function allPrices(mutate = (price) => price) {
  const prices = {}
  for (const key of legacyToTierLookupKeys()) {
    const usd = TIER_USD[key.tier] * (key.interval === 'year' ? 12 : 1)
    for (const [lookup, id] of [
      [key.from, `price_${key.from}`],
      [key.to, `price_${key.to}`],
    ]) {
      prices[lookup] = mutate({
        id,
        lookup_key: lookup,
        unit_amount: usd * 100,
        currency: 'usd',
        recurring: { interval: key.interval },
      })
    }
  }
  return prices
}

test('every legacy per-plan price maps to the tier with its price', () => {
  const map = Object.fromEntries(
    legacyToTierLookupKeys().map((key) => [key.from, key.to]),
  )
  assert.equal(map.aglyn_starter_ai_addon, 'aglyn_ai_spark')
  assert.equal(map.aglyn_pro_ai_addon, 'aglyn_ai_boost')
  assert.equal(map.aglyn_business_ai_addon, 'aglyn_ai_plus')
  assert.equal(map.aglyn_scale_ai_addon, 'aglyn_ai_max')
  assert.equal(map.aglyn_advanced_ai_addon_yearly, 'aglyn_ai_ultra_yearly')
  assert.equal(map.aglyn_agency_ai_addon, 'aglyn_ai_studio')
  assert.equal(Object.keys(map).length, 12)
})

test('pairs every legacy price when the amounts agree', () => {
  const { pairs, problems } = pairLegacyPrices(allPrices())
  assert.deepEqual(problems, [])
  assert.equal(pairs.length, 12)
})

test('REFUSES a pair whose amount differs — the move would change a bill', () => {
  const prices = allPrices((price) =>
    price.lookup_key === 'aglyn_ai_boost' ? { ...price, unit_amount: 2100 } : price,
  )
  const { problems } = pairLegacyPrices(prices)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /aglyn_pro_ai_addon .*would change a bill/)
})

test('an unminted tier price is named, and its legacy items still counted, never moved', () => {
  const prices = allPrices()
  delete prices.aglyn_ai_studio_yearly
  const { pairs, problems, unminted } = pairLegacyPrices(prices)
  // Not a mismatch: the commit refuses on `unminted`, the dry run counts.
  assert.deepEqual(problems, [])
  assert.equal(unminted.length, 1)
  assert.match(unminted[0], /aglyn_ai_studio_yearly is not minted/)
  const pending = pairs.find((pair) => pair.from === 'aglyn_agency_ai_addon_yearly')
  assert.equal(pending.toPriceId, null)
  assert.equal(pairs.length, 12)
  // A move to an unminted price cannot be sent.
  assert.throws(() => moveParams({ itemId: 'si_1', toPriceId: null, to: 'aglyn_ai_studio_yearly' }), /not minted/)
})

test('before ANY tier price is minted, the dry run still sees every legacy item', () => {
  const prices = allPrices()
  for (const key of Object.keys(prices)) if (key.startsWith('aglyn_ai_')) delete prices[key]
  const { pairs, unminted } = pairLegacyPrices(prices)
  assert.equal(pairs.length, 12)
  assert.equal(unminted.length, 12)
  const subscription = {
    id: 'sub_1',
    status: 'active',
    metadata: { orgId: 'org_1' },
    items: { data: [{ id: 'si_ai', price: { id: 'price_aglyn_scale_ai_addon_yearly' }, quantity: 1 }] },
  }
  const { moves, skipped } = planAiTierMoves([subscription], pairs)
  assert.equal(moves.length, 1)
  assert.equal(moves[0].tier, 'max')
  assert.equal(moves[0].toPriceId, null)
  assert.deepEqual(summarizeAiTierMoves(moves, skipped), {
    toMove: 1,
    skipped: 0,
    subscriptions: 1,
    byFrom: [{ from: 'aglyn_scale_ai_addon_yearly', to: 'aglyn_ai_max_yearly', tier: 'max', items: 1 }],
    skips: {},
  })
})

test('the mode is read off the key', () => {
  assert.equal(stripeKeyMode('sk_live_x'), 'LIVE')
  assert.equal(stripeKeyMode('rk_live_x'), 'LIVE')
  assert.equal(stripeKeyMode('sk_test_x'), 'test')
  assert.equal(stripeKeyMode(undefined), 'test')
})

test('an archived legacy price is simply not migrated', () => {
  const prices = allPrices()
  delete prices.aglyn_starter_ai_addon
  const { pairs, problems } = pairLegacyPrices(prices)
  assert.deepEqual(problems, [])
  assert.equal(pairs.length, 11)
})

test('moves a live item, keeps scheduled and ended ones for later', () => {
  const { pairs } = pairLegacyPrices(allPrices())
  const subscription = (id, status, extra = {}) => ({
    id,
    status,
    metadata: { orgId: `org_${id}` },
    items: {
      data: [
        { id: `si_plan_${id}`, price: { id: 'price_aglyn_pro_v2' } },
        { id: `si_ai_${id}`, price: { id: 'price_aglyn_pro_ai_addon' }, quantity: 1 },
      ],
    },
    ...extra,
  })
  const { moves, skipped } = planAiTierMoves(
    [
      subscription('a', 'active'),
      subscription('b', 'past_due'),
      subscription('c', 'active', { schedule: 'sub_sched_1' }),
      subscription('d', 'canceled'),
    ],
    pairs,
  )
  assert.deepEqual(
    moves.map((move) => [move.subscriptionId, move.itemId, move.tier, move.toPriceId, move.orgId]),
    [
      ['a', 'si_ai_a', 'boost', 'price_aglyn_ai_boost', 'org_a'],
      ['b', 'si_ai_b', 'boost', 'price_aglyn_ai_boost', 'org_b'],
    ],
  )
  assert.deepEqual(skipped.map((skip) => skip.subscriptionId), ['c', 'd'])
})

test('a move swaps the price on the same item, with no proration', () => {
  const params = moveParams({ itemId: 'si_1', toPriceId: 'price_aglyn_ai_spark' })
  assert.equal(params.get('items[0][id]'), 'si_1')
  assert.equal(params.get('items[0][price]'), 'price_aglyn_ai_spark')
  assert.equal(params.get('proration_behavior'), 'none')
  assert.equal(params.has('items[0][quantity]'), false)
})
