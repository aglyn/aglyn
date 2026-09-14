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
 * The Aglyn AI add-on follows a plan switch (AGL-2897).
 *
 * `/api/billing/subscription` re-prices every add-on item it recognises onto
 * the target plan's own price — `buildTargetItems` for the schedule phase, and
 * the same `addonKindFromPriceId`/`addonPriceId` pair for the instant delta —
 * and carries anything it cannot classify through verbatim while warning that
 * it did so. The add-on has to land on the FIRST side of that line: an
 * `aiAddon` item that read as "unrecognised" would survive a switch at the OLD
 * plan's price, so a Starter org moving to Agency would keep paying Starter's
 * price for Agency's band.
 *
 * Pure: `buildTargetItems` reads env-resolved price ids and nothing else.
 */

import { buildTargetItems } from '../utils/server/billing-schedule'

const PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_AGENCY: 'price_agency',
  STRIPE_PRICE_AGENCY_YEARLY: 'price_agency_yearly',
  STRIPE_PRICE_STARTER_AI_ADDON: 'price_starter_ai_addon',
  STRIPE_PRICE_STARTER_AI_ADDON_YEARLY: 'price_starter_ai_addon_yearly',
  STRIPE_PRICE_AGENCY_AI_ADDON: 'price_agency_ai_addon',
  STRIPE_PRICE_AGENCY_AI_ADDON_YEARLY: 'price_agency_ai_addon_yearly',
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

const STARTER_WITH_AI = [
  item('price_starter'),
  item('price_starter_ai_addon'),
  item('price_metered_usage'),
]

describe('the AI add-on is re-priced onto the target plan (AGL-2897)', () => {
  it("moves Starter's add-on to Agency's price, quantity intact", () => {
    const target = buildTargetItems(STARTER_WITH_AI, {
      targetPlan: 'agency',
      targetInterval: 'month',
      targetPlanPrice: 'price_agency',
      meteredPrice: 'price_metered_usage',
    })
    expect(target.items).toContainEqual({ price: 'price_agency_ai_addon', quantity: 1 })
    expect(target.items.map((entry) => entry.price)).not.toContain('price_starter_ai_addon')
    // Recognised, so neither dropped nor carried through as a stranger.
    expect(target.droppedAddons).toEqual([])
    expect(target.clampedAddons).toEqual([])
    expect(target.unrecognizedPriceIds).toEqual([])
  })

  it('follows an interval switch onto the yearly variant', () => {
    const target = buildTargetItems(STARTER_WITH_AI, {
      targetPlan: 'agency',
      targetInterval: 'year',
      targetPlanPrice: 'price_agency_yearly',
      meteredPrice: 'price_metered_usage_yearly',
    })
    expect(target.items).toContainEqual({ price: 'price_agency_ai_addon_yearly', quantity: 1 })
    expect(target.unrecognizedPriceIds).toEqual([])
  })

  it('never exceeds one — the add-on is a toggle on every plan', () => {
    // A hand-edited quantity of 2 in the dashboard is clamped to what the
    // plan can deliver, and the clamp is reported so the confirm can say so.
    const target = buildTargetItems(
      [item('price_starter'), item('price_starter_ai_addon', 2)],
      {
        targetPlan: 'agency',
        targetInterval: 'month',
        targetPlanPrice: 'price_agency',
        meteredPrice: null,
      },
    )
    expect(target.items).toContainEqual({ price: 'price_agency_ai_addon', quantity: 1 })
    expect(target.clampedAddons).toEqual([{ kind: 'aiAddon', from: 2, to: 1 }])
  })

  it('is dropped, and named, when the target plan has no add-on price configured', () => {
    delete process.env.STRIPE_PRICE_AGENCY_AI_ADDON
    const target = buildTargetItems(STARTER_WITH_AI, {
      targetPlan: 'agency',
      targetInterval: 'month',
      targetPlanPrice: 'price_agency',
      meteredPrice: 'price_metered_usage',
    })
    expect(target.droppedAddons).toEqual(['aiAddon'])
    expect(target.items.map((entry) => entry.price)).not.toContain('price_starter_ai_addon')
  })
})

export {}
