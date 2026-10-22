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

import { AI_TIER_IDS, AI_TIERS, aiTierAddonKey, defaultAiTierForPlan } from './plan-entitlements'
import {
  ADDON_KINDS,
  addonMaxForPlan,
  addonUnitUsd,
  bundleAddonsParam,
  bundleAiTier,
  firstPlanSellingAddon,
  bundleDomainLine,
  describeBundle,
  fitBundleAddonsToPlan,
  normalizeBundleCoupon,
  normalizeBundleDomain,
  parseBundleAddons,
  planSellsAddon,
  resolveAiAddonTier,
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
    expect(parseBundleAddons('siteCare:5,ai:3').addons).toEqual({ siteCare: 1, aiAddon: 1 })
  })

  it('reads `ai:<tier>` as that Aglyn AI tier (AGL-3965), and drops a tier nobody sells', () => {
    expect(parseBundleAddons('siteCare,ai:boost')).toEqual({
      addons: { siteCare: 1, aiAddon: 1 },
      dropped: [],
      aiTier: 'boost',
    })
    // Every tier id, in any case, through the one `ai:<tier>` spelling.
    for (const tier of AI_TIER_IDS) {
      expect(resolveAiAddonTier(tier.toUpperCase())).toEqual({ kind: 'aiAddon', quantity: 1, tier })
      expect(parseBundleAddons(aiTierAddonKey(tier)).aiTier).toBe(tier)
    }
    expect(parseBundleAddons({ ai: 'studio' })).toMatchObject({ addons: { aiAddon: 1 }, aiTier: 'studio' })
    // Not a tier: left off with the notice, never read as "whichever tier".
    expect(parseBundleAddons('ai:pro')).toEqual({ addons: {}, dropped: ['ai:pro'] })
    // A bare `ai` names no tier: checkout sells the plan's default one.
    expect(parseBundleAddons('ai').aiTier).toBeUndefined()
  })

  it('writes and words the tier with the add-on (AGL-3965)', () => {
    expect(bundleAddonsParam({ siteCare: 1, aiAddon: 1 }, 'max')).toBe('ai:max,siteCare')
    expect(bundleAddonsParam({ siteCare: 1 }, 'max')).toBe('siteCare')
    expect(
      describeBundle({ plan: 'pro', addons: { aiAddon: 1 }, aiTier: 'studio' }, { brand: 'Aglyn' }),
    ).toBe('Pro with Aglyn AI Studio')
  })

  it('names the tier a bundle sells: the one chosen, else the plan’s default, and none without AI (AGL-4025)', () => {
    expect(bundleAiTier({ siteCare: 1, aiAddon: 1 }, 'starter', 'plus')).toBe('plus')
    // Nothing chosen: the plan's default tier, the one checkout would sell.
    expect(bundleAiTier({ aiAddon: 1 }, 'pro')).toBe(defaultAiTierForPlan('pro'))
    expect(bundleAiTier({ aiAddon: 1 }, 'pro', 'gold' as never)).toBe(defaultAiTierForPlan('pro'))
    // A tier without the add-on, or on a plan that sells none, is no tier.
    expect(bundleAiTier({ siteCare: 1 }, 'starter', 'plus')).toBeNull()
    expect(bundleAiTier({ aiAddon: 1 }, 'enterprise', 'plus')).toBeNull()
    // The price a picker shows for it is the tier's own, from AI_TIERS.
    for (const tier of AI_TIER_IDS) {
      expect(addonUnitUsd('aiAddon', 'starter', tier)).toBe(AI_TIERS[tier].monthlyUsd)
    }
  })

  it('names the smallest plan that sells an add-on, for one the chosen plan does not (AGL-4025)', () => {
    expect(planSellsAddon('posRegisters', 'starter')).toBe(false)
    expect(firstPlanSellingAddon('posRegisters', ['starter', 'pro', 'business'])).toBe('pro')
    expect(firstPlanSellingAddon('posRegisters', ['starter'])).toBeNull()
    expect(firstPlanSellingAddon('siteCare', ['starter', 'pro'])).toBe('starter')
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
    ).toBe('Starter with Aglyn AI and Site Care, billed yearly, code BOOTH25')
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

  it('carries an `ai:<tier>` token as the intent’s tier, through every hop (AGL-3965)', () => {
    const intent = parseOnboardingPlanIntent(query('plan=starter&addons=siteCare,ai:studio'))
    expect(intent).toMatchObject({ ai: true, aiTier: 'studio', addons: { siteCare: 1, aiAddon: 1 } })
    expect(onboardingPlanQuery(intent!)).toBe('plan=starter&addons=ai:studio,siteCare')
    expect(parseOnboardingPlanIntent(query(onboardingPlanQuery(intent!)))?.aiTier).toBe('studio')
    // Alone, the tier keeps the pricing CTAs' `ai=<tier>` spelling.
    const alone = parseOnboardingPlanIntent(query('plan=pro&addons=ai:max'))
    expect(onboardingPlanQuery(alone!)).toBe('plan=pro&ai=max')
    // `?ai=<tier>` is the explicit statement and wins over a token.
    expect(parseOnboardingPlanIntent(query('plan=pro&ai=plus&addons=ai:max'))?.aiTier).toBe('plus')
  })

  it('every tier staff can pick reaches Billing preselected, beside Site Care and the cadence (AGL-4025)', () => {
    for (const tier of AI_TIER_IDS) {
      const link = onboardingDestination('acme', {
        plan: 'starter',
        interval: 'year',
        intervalStated: true,
        contactSales: false,
        ai: true,
        aiTier: tier,
        addons: { siteCare: 1, aiAddon: 1 },
      })
      expect(link).toBe(`/acme/billing?plan=starter&interval=year&addons=ai:${tier},siteCare`)
      expect(parseOnboardingPlanIntent(query(link.split('?')[1]))).toMatchObject({
        plan: 'starter',
        interval: 'year',
        ai: true,
        aiTier: tier,
        addons: { siteCare: 1, aiAddon: 1 },
      })
    }
  })
})
