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

import { PLAN_PRICING, RETIRED_PLANS, SELF_SERVE_PLANS } from './plan-entitlements'
import {
  AI_CREDIT_BLOCK_MONTHLY_USD,
  AI_CREDIT_BLOCK_YEARLY_USD,
  AI_CREDIT_BLOCKS_MAX,
} from './ai-credit-blocks'
import {
  ADDON_KINDS,
  addonMaxForPlan,
  addonUnitUsd,
  bundleAddonLabel,
  bundleAddonsParam,
  bundleListPriceCents,
  firstPlanSellingAddon,
  bundleDomainLine,
  describeBundle,
  fitBundleAddonsToPlan,
  normalizeBundleCoupon,
  normalizeBundleDomain,
  describeBundleAddon,
  parseBundleAddons,
  planSellsAddon,
  TOGGLE_ADDON_KIND_LIST,
} from './bundle-intent'
import {
  intentAddons,
  onboardingDestination,
  onboardingPlanQuery,
  parseOnboardingPlanIntent,
} from './onboarding-deep-link'

describe('the bundle link’s add-ons (AGL-3955)', () => {
  it('reads the link form the account owner chose, quantities included', () => {
    expect(parseBundleAddons('siteCare,ai,eventCalendar,extraHost:2')).toEqual({
      addons: { siteCare: 1, aiAddon: 1, eventCalendar: 1, hosts: 2 },
      dropped: [],
    })
  })

  it('reads the stored kinds, a list, and the toggle map the native screens post', () => {
    expect(parseBundleAddons(['siteCare', 'hosts:3']).addons).toEqual({ siteCare: 1, hosts: 3 })
    expect(
      parseBundleAddons({ siteCare: true, aiAddon: 'false', eventCalendar: 'true', hosts: '2', managers: '' })
        .addons,
    ).toEqual({ siteCare: 1, eventCalendar: 1, hosts: 2 })
  })

  it('drops what nobody sells under that name, and says which', () => {
    expect(parseBundleAddons('siteCare,jetpack,extraHost:0,extraHost:lots')).toEqual({
      addons: { siteCare: 1 },
      dropped: ['jetpack', 'extraHost:0', 'extraHost:lots'],
    })
  })

  it('holds a toggle at one however many the link asks for', () => {
    expect(parseBundleAddons('siteCare:5,eventCalendar:2').addons).toEqual({ siteCare: 1, eventCalendar: 1 })
  })

  it('counts Aglyn AI credits in blocks (AGL-4144): `ai` is one, `ai:3` three', () => {
    expect(TOGGLE_ADDON_KIND_LIST).not.toContain('aiAddon')
    expect(parseBundleAddons('siteCare:5,ai:3').addons).toEqual({ siteCare: 1, aiAddon: 3 })
    expect(parseBundleAddons('ai').addons).toEqual({ aiAddon: 1 })
    expect(parseBundleAddons({ aiAddon: 4 }).addons).toEqual({ aiAddon: 4 })
    expect(parseBundleAddons('aiCredits:2').addons).toEqual({ aiAddon: 2 })
    // Held to the ceiling once fitted to a plan that sells blocks.
    expect(fitBundleAddonsToPlan(parseBundleAddons('ai:40').addons, 'pro').addons).toEqual({
      aiAddon: AI_CREDIT_BLOCKS_MAX,
    })
  })

  it('drops a retired Aglyn AI tier name and reports it, never read as some blocks (AGL-4144)', () => {
    for (const tier of ['spark', 'boost', 'plus', 'max', 'ultra', 'studio']) {
      expect(parseBundleAddons(`siteCare,ai:${tier}`)).toEqual({
        addons: { siteCare: 1 },
        dropped: [`ai:${tier}`],
      })
      expect(parseBundleAddons({ ai: tier })).toEqual({ addons: {}, dropped: ['ai'] })
    }
    // The parse result carries no tier field at all any more.
    expect(parseBundleAddons('ai:boost')).not.toHaveProperty('aiTier')
  })

  it('writes and words the blocks with the add-on (AGL-4144)', () => {
    expect(bundleAddonsParam({ siteCare: 1, aiAddon: 3 })).toBe('ai:3,siteCare')
    expect(bundleAddonsParam({ siteCare: 1, aiAddon: 1 })).toBe('ai,siteCare')
    expect(bundleAddonLabel('aiAddon', 'Aglyn')).toBe('Aglyn AI credit block')
    expect(describeBundleAddon('aiAddon', 3, 'Aglyn')).toBe('3 × Aglyn AI credit block')
    expect(describeBundle({ plan: 'pro', addons: { aiAddon: 3 } }, { brand: 'Aglyn' })).toBe(
      'Pro with 3 × Aglyn AI credit block',
    )
  })

  it('prices a block at $10 on every paid plan, 0–30 of them, and on no other (AGL-4144)', () => {
    // The paid plans SOLD since pricing v4 (AGL-4126).
    const sold = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')
    expect(sold).toEqual(['starter', 'pro'])
    for (const plan of sold) {
      expect(addonUnitUsd('aiAddon', plan)).toBe(AI_CREDIT_BLOCK_MONTHLY_USD)
      expect(addonMaxForPlan('aiAddon', plan)).toBe(AI_CREDIT_BLOCKS_MAX)
      expect(planSellsAddon('aiAddon', plan)).toBe(true)
    }
    // A plan pricing v4 retired sells no blocks.
    for (const plan of RETIRED_PLANS) {
      expect(addonUnitUsd('aiAddon', plan)).toBeNull()
      expect(addonMaxForPlan('aiAddon', plan)).toBe(0)
      expect(planSellsAddon('aiAddon', plan)).toBe(false)
    }
    expect(addonUnitUsd('aiAddon', 'free')).toBeNull()
    expect(addonUnitUsd('aiAddon', 'enterprise')).toBeNull()
    expect(addonMaxForPlan('aiAddon', 'free')).toBe(0)
    expect(addonMaxForPlan('aiAddon', 'enterprise')).toBe(0)
  })

  it('names the smallest plan that sells an add-on, for one the chosen plan does not (AGL-4025)', () => {
    expect(planSellsAddon('posRegisters', 'starter')).toBe(false)
    expect(firstPlanSellingAddon('posRegisters', ['starter', 'pro', 'business'])).toBe('pro')
    expect(firstPlanSellingAddon('posRegisters', ['starter'])).toBeNull()
    expect(firstPlanSellingAddon('siteCare', ['starter', 'pro'])).toBe('starter')
  })

  it('prices a bundle at list price before tax, at the cadence chosen (AGL-4026)', () => {
    const starter = PLAN_PRICING.starter
    const seat = addonUnitUsd('managers', 'starter')!
    const care = addonUnitUsd('siteCare', 'starter')!
    expect(bundleListPriceCents({ plan: 'starter', interval: 'month' })).toBe(starter.basePriceMonthlyUsd * 100)
    expect(bundleListPriceCents({ plan: 'starter', interval: 'year' })).toBe(starter.basePriceAnnualMonthlyUsd * 12 * 100)
    expect(
      bundleListPriceCents({
        plan: 'starter',
        interval: 'year',
        addons: { siteCare: 1, aiAddon: 2, managers: 2 },
      }),
    ).toBe(
      (starter.basePriceAnnualMonthlyUsd * 12 + AI_CREDIT_BLOCK_YEARLY_USD * 2 + care * 12 + seat * 2 * 12) * 100,
    )
    // Aglyn AI credits are $10 a block a month, whatever the plan.
    expect(bundleListPriceCents({ plan: 'pro', interval: 'month', addons: { aiAddon: 3 } })).toBe(
      (PLAN_PRICING.pro.basePriceMonthlyUsd + AI_CREDIT_BLOCK_MONTHLY_USD * 3) * 100,
    )
    // What the plan does not sell costs nothing here, as checkout would refuse it.
    expect(bundleListPriceCents({ plan: 'starter', interval: 'month', addons: { posRegisters: 2 } })).toBe(
      starter.basePriceMonthlyUsd * 100,
    )
  })

  it('accepts every kind Billing sells, and only those', () => {
    const all = parseBundleAddons(ADDON_KINDS.join(',')).addons
    expect(Object.keys(all).sort()).toEqual([...ADDON_KINDS].sort())
  })

  it('fits the add-ons to what a plan sells: Site Care on Starter, held to the ceiling', () => {
    expect(planSellsAddon('siteCare', 'starter')).toBe(true)
    expect(planSellsAddon('siteCare', 'free')).toBe(false)
    const fitted = fitBundleAddonsToPlan({ siteCare: 1, hosts: 10_000 }, 'starter')
    expect(fitted.addons.siteCare).toBe(1)
    expect(fitted.addons.hosts).toBe(addonMaxForPlan('hosts', 'starter'))
    expect(fitBundleAddonsToPlan({ siteCare: 1 }, 'free')).toEqual({ addons: {}, notSold: ['siteCare'] })
  })

  it('writes the link form back, in the Billing card’s order', () => {
    expect(bundleAddonsParam({ siteCare: 1, hosts: 2, aiAddon: 1 })).toBe('extraHost:2,ai,siteCare')
    expect(parseBundleAddons(bundleAddonsParam({ siteCare: 1, hosts: 2, aiAddon: 1 })).addons).toEqual({
      siteCare: 1,
      hosts: 2,
      aiAddon: 1,
    })
  })

  it('applies a code only when it reads as one', () => {
    expect(normalizeBundleCoupon(' BOOTH25 ')).toBe('BOOTH25')
    expect(normalizeBundleCoupon('booth 25')).toBeUndefined()
    expect(normalizeBundleCoupon('x'.repeat(65))).toBeUndefined()
    expect(normalizeBundleCoupon(42)).toBeUndefined()
  })

  it('takes a domain name, and nothing that is not one', () => {
    expect(normalizeBundleDomain('https://Example.COM/')).toBe('example.com')
    expect(normalizeBundleDomain('acme-roofing.co.uk')).toBe('acme-roofing.co.uk')
    expect(normalizeBundleDomain('localhost')).toBeUndefined()
    expect(normalizeBundleDomain('-bad-.com')).toBeUndefined()
    expect(normalizeBundleDomain('a.b.c.123')).toBeUndefined()
  })

  it('words the domain line and the bundle the way the owner reads them', () => {
    expect(bundleDomainLine({ name: 'example.com', firstYearCents: 1599, renewalCents: 1599 })).toBe(
      'example.com — $15.99 first year, renews yearly at $15.99',
    )
    expect(
      describeBundle({ plan: 'starter', addons: { siteCare: 1, aiAddon: 1 }, interval: 'year', coupon: 'BOOTH25' }, {
        brand: 'Aglyn',
      }),
    ).toBe('Starter with Aglyn AI credit block and Site Care, billed yearly, code BOOTH25')
    expect(describeBundle({ plan: 'pro' })).toBe('Pro')
  })
})

describe('the Billing link carries the bundle (AGL-3955)', () => {
  const query = (search: string) => new URLSearchParams(search)

  it('preselects the plan, every add-on, the cadence and the coupon', () => {
    const intent = parseOnboardingPlanIntent(
      query('plan=starter&addons=siteCare,ai,extraHost:2&interval=year&coupon=Booth25'),
    )
    expect(intent).toMatchObject({
      plan: 'starter',
      interval: 'year',
      intervalStated: true,
      ai: true,
      addons: { siteCare: 1, aiAddon: 1, hosts: 2 },
      coupon: 'Booth25',
    })
    expect(intent?.droppedAddons).toBeUndefined()
  })

  it('reports the add-on tokens it left off, and still lands', () => {
    const intent = parseOnboardingPlanIntent(query('plan=starter&addons=siteCare,jetpack&coupon=no%20way'))
    expect(intent?.addons).toEqual({ siteCare: 1 })
    expect(intent?.droppedAddons).toEqual(['jetpack'])
    expect(intent?.coupon).toBeUndefined()
  })

  it('round-trips through every hop that re-serializes it', () => {
    const intent = parseOnboardingPlanIntent(
      query('plan=pro&interval=year&addons=siteCare,extraHost:2&ai=1&coupon=SPRING'),
    )
    const again = parseOnboardingPlanIntent(query(onboardingPlanQuery(intent!)))
    expect(intentAddons(again)).toEqual({ siteCare: 1, hosts: 2, aiAddon: 1 })
    expect(again?.coupon).toBe('SPRING')
    expect(onboardingDestination('acme', intent)).toBe(
      '/acme/billing?plan=pro&interval=year&addons=extraHost:2,ai,siteCare&coupon=SPRING',
    )
  })

  it('keeps `ai=1` as the spelling when Aglyn AI is the only add-on', () => {
    const intent = parseOnboardingPlanIntent(query('plan=pro&addons=ai'))
    expect(onboardingPlanQuery(intent!)).toBe('plan=pro&ai=1')
  })

  it('carries a count of credit blocks through every hop (AGL-4144)', () => {
    const intent = parseOnboardingPlanIntent(query('plan=starter&addons=siteCare,ai:3'))
    expect(intent).toMatchObject({ ai: true, addons: { siteCare: 1, aiAddon: 3 } })
    expect(onboardingPlanQuery(intent!)).toBe('plan=starter&addons=ai:3,siteCare')
    expect(intentAddons(parseOnboardingPlanIntent(query(onboardingPlanQuery(intent!))))).toEqual({
      siteCare: 1,
      aiAddon: 3,
    })
    // Alone, three blocks keep the pricing CTAs' `ai=` spelling.
    const alone = parseOnboardingPlanIntent(query('plan=pro&addons=ai:3'))
    expect(onboardingPlanQuery(alone!)).toBe('plan=pro&ai=3')
    expect(intentAddons(parseOnboardingPlanIntent(query('plan=pro&ai=3')))).toEqual({ aiAddon: 3 })
    expect(intentAddons(parseOnboardingPlanIntent(query('plan=pro&ai=1')))).toEqual({ aiAddon: 1 })
  })

  it('reads a retired tier on the link as no Aglyn AI at all (AGL-4144)', () => {
    const named = parseOnboardingPlanIntent(query('plan=pro&ai=boost'))
    expect(named?.ai).toBeUndefined()
    expect(intentAddons(named)).toEqual({})
    expect(named).not.toHaveProperty('aiTier')
    const token = parseOnboardingPlanIntent(query('plan=starter&addons=siteCare,ai:studio'))
    expect(token?.addons).toEqual({ siteCare: 1 })
    expect(token?.droppedAddons).toEqual(['ai:studio'])
  })

  it('a staff bundle with blocks reaches Billing preselected, beside Site Care and the cadence', () => {
    const link = onboardingDestination('acme', {
      plan: 'starter',
      interval: 'year',
      intervalStated: true,
      contactSales: false,
      ai: true,
      addons: { siteCare: 1, aiAddon: 4 },
    })
    expect(link).toBe('/acme/billing?plan=starter&interval=year&addons=ai:4,siteCare')
    expect(parseOnboardingPlanIntent(query(link.split('?')[1]))).toMatchObject({
      plan: 'starter',
      interval: 'year',
      ai: true,
      addons: { siteCare: 1, aiAddon: 4 },
    })
  })
})
