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
 * A staff comp and the AI credits band (AGL-3034, AGL-3049): a comp sells
 * nothing past its bands, so the assist band is a wall priced at nothing; an
 * uncapped comp has no band to be a wall at; a dormant comp leaves a paying
 * workspace's band sold past at the plan's own rate. The plan module's half
 * of each rule is `plan-comp.spec.ts` in core; this is the AI band's.
 */

import {
  hasAiAddon,
  PLAN_PRICING,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { registerPluginEntitlements } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { AI_PLUGIN_ENTITLEMENTS } from '../declarations'
import {
  assistBandRefuses,
  assistMonthOverage,
  priceAssistCreditOverage,
  resolveAssistCreditBudget,
  resolveAssistOverageRateUsdPer1k,
} from './assist-credits'

beforeAll(() => {
  registerPluginEntitlements(AI_PLUGIN_ENTITLEMENTS)
})

/** A comp as the override route writes it. */
const comp = (plan: string, extra: Record<string, unknown> = {}) => ({
  plan,
  reason: 'beta',
  note: 'AGL-3024 live run',
  grantedBy: 'staff-1',
  grantedAt: { seconds: 1_789_560_000, nanoseconds: 0 },
  ...extra,
})
const uncappedComp = (plan: string) =>
  comp(plan, { uncapped: true, reason: 'other', note: 'Internal workspace' })
const withComp = (org: Record<string, any>, planComp: unknown) =>
  ({
    ...org,
    entitlements: { ...(org['entitlements'] ?? {}), planComp },
  }) as any

/** test-org's shape on 2026-09-16: a dead Pro subscription and 5,000 credits. */
const TEST_ORG = {
  plan: 'pro',
  billingStatus: 'canceled',
  entitlements: { assistCreditsPerMonth: 5000 },
}

/** An internal workspace with a staff-set band, as aglyn-org carries one. */
const INTERNAL = {
  plan: 'enterprise',
  enterprise: true,
  entitlements: { assistCreditsPerMonth: 5000 },
}

describe('a comp sells no AI credits past its band (AGL-3034)', () => {
  it('prices no AI overage, so the assist band refuses at 100%', () => {
    const org = withComp(TEST_ORG, comp('pro'))
    expect(resolveAssistOverageRateUsdPer1k(org)).toBeNull()
    expect(assistBandRefuses(org)).toBe(true)
    // Ten times the band, measured: still nothing to bill.
    const month = assistMonthOverage(org, 50)
    expect(month.overageCredits).toBeGreaterThan(0)
    expect(month.overageMonthlyUsd).toBe(0)
    expect(month.overageRateUsd).toBeNull()
    expect(priceAssistCreditOverage(org, 1_000_000).overageMonthlyUsd).toBe(0)

    // The control: Pro on a live subscription does sell it.
    const paying = { plan: 'pro', billingStatus: 'active' } as any
    expect(resolveAssistOverageRateUsdPer1k(paying)).toBe(
      PLAN_PRICING.pro.extraAssistCreditsUsdPer1k,
    )
  })

  it('refuses the Starter add-on rate to a Starter comp with a staff-set add-on', () => {
    // No subscription, so a staff-set add-on quantity still counts (the AI
    // plugin widens the band from it) — and without the comp check that band
    // would be sold past at the add-on rate, to nobody.
    const org = withComp({ seatAddons: { aiAddon: 1 } }, comp('starter'))
    expect(hasAiAddon(org)).toBe(true)
    expect(resolveAssistOverageRateUsdPer1k(org)).toBeNull()
    expect(assistBandRefuses(org)).toBe(true)
    // The control: the same add-on on a live Starter subscription is sold.
    const paying = { plan: 'starter', billingStatus: 'active', seatAddons: { aiAddon: 1 } }
    expect(resolveAssistOverageRateUsdPer1k(paying as any)).not.toBeNull()
  })

  it('raises the AI band like any other: a wall at the raised figure, priced at nothing', () => {
    const org = withComp(
      { billingStatus: 'canceled', entitlements: { assistCreditsPerMonth: 20_000 } },
      comp('pro'),
    )
    expect(resolveAssistCreditBudget(org)).toBe(20_000)
    expect(assistBandRefuses(org)).toBe(true)
    expect(assistMonthOverage(org, 50).overageMonthlyUsd).toBe(0)
  })
})

describe('an uncapped comp and the AI band (AGL-3049)', () => {
  it('has no band to be a wall at, and none to measure against', () => {
    const org = withComp({ billingStatus: 'canceled' }, uncappedComp('starter'))
    expect(assistBandRefuses(org)).toBe(false)
    expect(resolveAssistCreditBudget(org)).toBeNull()
    // The control: the same Starter comp, capped, refuses at its band.
    const capped = withComp({ billingStatus: 'canceled' }, comp('starter'))
    expect(assistBandRefuses(capped)).toBe(true)
  })

  it('bills nothing past a band it does not have', () => {
    const org = withComp(INTERNAL, uncappedComp('agency'))
    expect(assistMonthOverage(org, 1_000_000)).toMatchObject({
      bandCredits: null,
      overageCredits: 0,
      overageMonthlyUsd: 0,
      overageRateUsd: null,
    })
    expect(resolveAssistOverageRateUsdPer1k(org)).toBeNull()
    expect(priceAssistCreditOverage(org, 1_000_000).overageMonthlyUsd).toBe(0)
  })

  it('is ignored while a live subscription is in force: the band is sold past at the plan’s rate', () => {
    // Since AGL-3203 Starter includes 750 credits and carries a $3.00 rate,
    // so a paying Starter meters past the band — the dormant comp lifts
    // nothing.
    const live = withComp(
      { plan: 'starter', billingStatus: 'active' },
      uncappedComp('agency'),
    )
    expect(assistBandRefuses(live)).toBe(false)
    expect(resolveAssistOverageRateUsdPer1k(live)).toBe(3)
  })

  it('removing uncapped restores the staff-set band, as a wall', () => {
    const recapped = withComp(INTERNAL, comp('enterprise', { uncapped: false }))
    expect(assistBandRefuses(recapped)).toBe(true)
    expect(resolveAssistCreditBudget(recapped)).toBe(5000)
  })
})
