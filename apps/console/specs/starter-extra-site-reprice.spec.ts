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
 * Starter's extra site moves $20 -> $25 (AGL-4227) without ever quoting one
 * figure and charging another.
 *
 * A Stripe price is immutable, so $25 is a NEW price under its own env name.
 * Until that env is set the add-on sells the existing $20 price and quotes
 * $20; once it is set, both move to $25 together. The $20 price is still
 * read back as an extra site either way, so a subscription that already
 * carries it keeps every site it pays for.
 */

import { PLAN_PRICING } from '@aglyn/aglyn/server'
import {
  addonChargedUnitUsd,
  addonKindFromPriceId,
  addonPriceId,
} from '@aglyn/tenant-data-admin/server/billing-addons'

const ORIGINAL = process.env

afterEach(() => {
  process.env = ORIGINAL
})

function withEnv(extra: Record<string, string>) {
  process.env = {
    ...ORIGINAL,
    STRIPE_PRICE_STARTER_EXTRA_HOST: 'price_starter_host_20',
    STRIPE_PRICE_STARTER_EXTRA_HOST_YEARLY: 'price_starter_host_20_yearly',
    STRIPE_PRICE_STARTER_EXTRA_HOST_V2: '',
    STRIPE_PRICE_STARTER_EXTRA_HOST_V2_YEARLY: '',
    STRIPE_PRICE_PRO_EXTRA_HOST: 'price_pro_host_20',
    ...extra,
  } as NodeJS.ProcessEnv
}

describe('Starter extra site $20 -> $25 (AGL-4227)', () => {
  it('the catalog says $25 on Starter and keeps $20 on Pro', () => {
    expect(PLAN_PRICING.starter.extraHostMonthlyUsd).toBe(25)
    expect(PLAN_PRICING.pro.extraHostMonthlyUsd).toBe(20)
    // Three Starter sites now cost more than Pro on both intervals.
    expect(PLAN_PRICING.starter.basePriceMonthlyUsd + 2 * 25).toBeGreaterThan(PLAN_PRICING.pro.basePriceMonthlyUsd)
    expect(PLAN_PRICING.starter.basePriceAnnualMonthlyUsd + 2 * 25).toBeGreaterThan(
      PLAN_PRICING.pro.basePriceAnnualMonthlyUsd,
    )
  })

  it('before the $25 price is configured: sells the $20 price and quotes $20', () => {
    withEnv({})
    expect(addonPriceId('hosts', 'starter', 'month')).toBe('price_starter_host_20')
    expect(addonChargedUnitUsd('hosts', 'starter', 'month')).toBe(20)
    expect(addonChargedUnitUsd('hosts', 'starter', 'year')).toBe(20)
    // Pro is untouched.
    expect(addonChargedUnitUsd('hosts', 'pro', 'month')).toBe(20)
  })

  it('once it is configured: sells the $25 price and quotes $25, on each interval on its own', () => {
    withEnv({ STRIPE_PRICE_STARTER_EXTRA_HOST_V2: 'price_starter_host_25' })
    expect(addonPriceId('hosts', 'starter', 'month')).toBe('price_starter_host_25')
    expect(addonChargedUnitUsd('hosts', 'starter', 'month')).toBe(25)
    // The yearly v2 price is not set yet, so yearly still sells and quotes $20.
    expect(addonPriceId('hosts', 'starter', 'year')).toBe('price_starter_host_20_yearly')
    expect(addonChargedUnitUsd('hosts', 'starter', 'year')).toBe(20)
  })

  it('the $20 price on an existing subscription is still read back as an extra site', () => {
    withEnv({ STRIPE_PRICE_STARTER_EXTRA_HOST_V2: 'price_starter_host_25' })
    expect(addonKindFromPriceId('price_starter_host_20')).toBe('hosts')
    expect(addonKindFromPriceId('price_starter_host_25')).toBe('hosts')
  })
})
