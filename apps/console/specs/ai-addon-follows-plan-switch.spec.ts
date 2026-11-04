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

/**
 * Aglyn AI credit blocks follow a plan switch (AGL-2897), keeping their COUNT
 * (AGL-4144).
 *
 * `/api/billing/subscription` re-prices every add-on item it recognises onto
 * the target — `buildTargetItems` for the schedule phase, and the same
 * `addonKindFromPriceId`/`addonTargetPriceId` pair for the instant delta —
 * and carries anything it cannot classify through verbatim while warning that
 * it did so. The blocks have to land on the FIRST side of that line: an
 * `aiAddon` item that read as "unrecognised" would survive a switch at a
 * price the target interval cannot carry.
 *
 * A block is one flat price on every paid plan, so a plan change keeps the
 * line and its quantity and moves only its interval.
 *
 * Pure: `buildTargetItems` reads env-resolved price ids and nothing else.
 */

import { buildTargetItems } from '../utils/server/billing-schedule'

const PRICE_ENV: Record<string, string> = {
  // Pricing v4 (AGL-4126): the switch is Starter -> Pro, the plans sold; it
  // was Starter -> Agency until v4 retired every plan above Pro.
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
  STRIPE_PRICE_AI_CREDITS: 'price_ai_credits',
  STRIPE_PRICE_AI_CREDITS_YEARLY: 'price_ai_credits_yearly',
  // A retired tier price still set in an environment: nothing reads it now.
  STRIPE_PRICE_AI_BOOST: 'price_ai_boost',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_METERED_YEARLY: 'price_metered_usage_yearly',
}

const ORIGINAL_ENV = process.env

beforeEach(() => {
  const clean = { ...ORIGINAL_ENV }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_PRICE_')) delete clean[key]
  }
  process.env = { ...clean, ...PRICE_ENV }
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

const item = (priceId: string, quantity = 1, interval = 'month') => ({
  id: `si_${priceId}`,
  price: { id: priceId, recurring: { interval } },
  quantity,
})

const STARTER_WITH_THREE_BLOCKS = [
  item('price_starter'),
  item('price_ai_credits', 3),
  item('price_metered_usage'),
]

describe('AI credit blocks keep their count across a plan switch (AGL-2897, AGL-4144)', () => {
  it('Starter -> Pro keeps three blocks on the same price, quantity intact', () => {
    const target = buildTargetItems(STARTER_WITH_THREE_BLOCKS, {
      targetPlan: 'pro',
      targetInterval: 'month',
      targetPlanPrice: 'price_pro',
      meteredPrice: 'price_metered_usage',
    })
    expect(target.items).toContainEqual({ price: 'price_ai_credits', quantity: 3 })
    // Recognised, so neither dropped nor carried through as a stranger.
    expect(target.droppedAddons).toEqual([])
    expect(target.clampedAddons).toEqual([])
    expect(target.unrecognizedPriceIds).toEqual([])
  })

  it('follows an interval switch onto the yearly block price', () => {
    const target = buildTargetItems(STARTER_WITH_THREE_BLOCKS, {
      targetPlan: 'pro',
      targetInterval: 'year',
      targetPlanPrice: 'price_pro_yearly',
      meteredPrice: 'price_metered_usage_yearly',
    })
    expect(target.items).toContainEqual({ price: 'price_ai_credits_yearly', quantity: 3 })
    expect(target.items.map((entry) => entry.price)).not.toContain('price_ai_credits')
    expect(target.unrecognizedPriceIds).toEqual([])
  })

  it('never exceeds 30 — the most blocks any plan sells', () => {
    // A hand-edited quantity of 40 in the dashboard is clamped to what the
    // plan can deliver, and the clamp is reported so the confirm can say so.
    const target = buildTargetItems(
      [item('price_starter'), item('price_ai_credits', 40)],
      {
        targetPlan: 'pro',
        targetInterval: 'month',
        targetPlanPrice: 'price_pro',
        meteredPrice: null,
      },
    )
    expect(target.items).toContainEqual({ price: 'price_ai_credits', quantity: 30 })
    expect(target.clampedAddons).toEqual([{ kind: 'aiAddon', from: 40, to: 30 }])
  })

  it('reads a retired tier price as no add-on at all', () => {
    // No subscription carries one (the 10/19 dry run found none); were one
    // there, it is not read as some number of blocks the owner never chose.
    const target = buildTargetItems(
      [item('price_starter'), item('price_ai_boost')],
      {
        targetPlan: 'pro',
        targetInterval: 'month',
        targetPlanPrice: 'price_pro',
        meteredPrice: null,
      },
    )
    expect(target.unrecognizedPriceIds).toEqual(['price_ai_boost'])
    expect(target.droppedAddons).toEqual([])
    expect(target.items.map((entry) => entry.price)).not.toContain('price_ai_credits')
  })

  it('is dropped, and named, when the block has no price configured at the target interval', () => {
    delete process.env.STRIPE_PRICE_AI_CREDITS_YEARLY
    const target = buildTargetItems(STARTER_WITH_THREE_BLOCKS, {
      targetPlan: 'pro',
      targetInterval: 'year',
      targetPlanPrice: 'price_pro_yearly',
      meteredPrice: 'price_metered_usage_yearly',
    })
    expect(target.droppedAddons).toEqual(['aiAddon'])
    expect(target.items.map((entry) => entry.price)).not.toContain('price_ai_credits')
  })

  it('is dropped, and named, on a target that sells no blocks', () => {
    const target = buildTargetItems(STARTER_WITH_THREE_BLOCKS, {
      targetPlan: 'free',
      targetInterval: 'month',
      targetPlanPrice: null as never,
      meteredPrice: null,
    })
    expect(target.droppedAddons).toContain('aiAddon')
  })
})

export {}
