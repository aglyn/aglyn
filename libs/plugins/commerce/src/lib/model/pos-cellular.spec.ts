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
  closePosCellularPeriod,
  isPosCellularDeviceType,
  openPosCellularPeriod,
  parsePosCellularConfig,
  posCellularBilledInMonth,
  posCellularChargeCents,
  posCellularMonthBounds,
  posCellularMonthKey,
  posCellularMonthLabel,
  posCellularPreviousMonthKey,
  posCellularReaderMonthlyCents,
  posCellularReadersByWorkspace,
  posCellularView,
  POS_CELLULAR_DEFAULT_BILLING_COST_BPS,
  POS_CELLULAR_DEFAULT_BILLING_COST_FIXED_CENTS,
  POS_CELLULAR_ENV,
  POS_CELLULAR_MAX_PERIODS,
  type PosCellularConfig,
  type PosCellularReaderRecord,
} from './pos-cellular'

/** Figures for the specs only: none of them is anyone's real price. */
const ENV = {
  [POS_CELLULAR_ENV.monthlyCostCents]: '1000',
  [POS_CELLULAR_ENV.productId]: 'prod_cellular',
}
const CONFIG: PosCellularConfig = { monthlyCostCents: 1_000, billingCostBps: 290, billingCostFixedCents: 30, productId: 'prod_cellular' }

describe('4G pricing is configuration (AGL-4038)', () => {
  it('is not offered without a monthly cost and a product, or with one that is not a whole number', () => {
    expect(parsePosCellularConfig({})).toBeNull()
    expect(parsePosCellularConfig({ [POS_CELLULAR_ENV.monthlyCostCents]: '1000' })).toBeNull()
    expect(parsePosCellularConfig({ [POS_CELLULAR_ENV.productId]: 'prod_cellular' })).toBeNull()
    for (const bad of ['10.00', '-5', '0', 'ten', '1e3', '100001']) {
      expect([bad, parsePosCellularConfig({ ...ENV, [POS_CELLULAR_ENV.monthlyCostCents]: bad })]).toEqual([bad, null])
    }
    expect(parsePosCellularConfig({ ...ENV, [POS_CELLULAR_ENV.productId]: 'price_1' })).toBeNull()
    expect(parsePosCellularConfig({ ...ENV, [POS_CELLULAR_ENV.billingCostBps]: '2.9' })).toBeNull()
    expect(parsePosCellularConfig({ ...ENV, [POS_CELLULAR_ENV.billingCostFixedCents]: '-30' })).toBeNull()
  })

  it('takes the billing cost from the platform’s card rate unless it is set', () => {
    expect(parsePosCellularConfig(ENV)).toEqual({
      monthlyCostCents: 1_000,
      billingCostBps: POS_CELLULAR_DEFAULT_BILLING_COST_BPS,
      billingCostFixedCents: POS_CELLULAR_DEFAULT_BILLING_COST_FIXED_CENTS,
      productId: 'prod_cellular',
    })
    expect(POS_CELLULAR_DEFAULT_BILLING_COST_BPS).toBe(290)
    expect(POS_CELLULAR_DEFAULT_BILLING_COST_FIXED_CENTS).toBe(30)
    expect(
      parsePosCellularConfig({
        ...ENV,
        [POS_CELLULAR_ENV.billingCostBps]: '0',
        [POS_CELLULAR_ENV.billingCostFixedCents]: '0',
      }),
    ).toMatchObject({ billingCostBps: 0, billingCostFixedCents: 0 })
  })

  it('charges Stripe’s price per reader plus what collecting it costs, in whole cents, rounded up', () => {
    // (1000 + 30) / (1 - 0.029) = 1060.76… → 1061
    expect(posCellularChargeCents(1, CONFIG)).toBe(1_061)
    // (3000 + 30) / 0.971 = 3120.49… → 3121: the fixed fee once per charge.
    expect(posCellularChargeCents(3, CONFIG)).toBe(3_121)
    expect(posCellularReaderMonthlyCents(CONFIG)).toBe(1_061)
    // No billing cost: exactly Stripe's price, no markup.
    expect(posCellularChargeCents(2, { ...CONFIG, billingCostBps: 0, billingCostFixedCents: 0 })).toBe(2_000)
    expect(posCellularChargeCents(0, CONFIG)).toBe(0)
    expect(posCellularChargeCents(-1, CONFIG)).toBe(0)
    expect(posCellularChargeCents(1.5, CONFIG)).toBe(0)
  })

  it('never leaves the platform less than Stripe’s price after the charge’s own processing', () => {
    for (let readers = 1; readers <= 50; readers += 1) {
      const charged = posCellularChargeCents(readers, CONFIG)
      expect(Number.isInteger(charged)).toBe(true)
      const kept = charged - (charged * CONFIG.billingCostBps) / 10_000 - CONFIG.billingCostFixedCents
      expect(kept).toBeGreaterThanOrEqual(readers * CONFIG.monthlyCostCents)
      // …and the console's per-reader figure never understates a reader's share.
      expect(readers * posCellularReaderMonthlyCents(CONFIG)).toBeGreaterThanOrEqual(charged)
    }
  })

  it('is the Stripe Reader S710 only', () => {
    expect(isPosCellularDeviceType('stripe_s710')).toBe(true)
    expect(isPosCellularDeviceType('simulated_stripe_s710')).toBe(true)
    for (const other of ['stripe_s700', 'bbpos_wisepos_e', 'stripe_m2', '', null, undefined]) {
      expect(isPosCellularDeviceType(other)).toBe(false)
    }
  })
})

describe('calendar months, as Stripe bills them (AGL-4038)', () => {
  it('keys, bounds and steps back over a year end, in UTC', () => {
    expect(posCellularMonthKey(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10')
    expect(posCellularPreviousMonthKey(Date.UTC(2026, 10, 1, 0, 5))).toBe('2026-10')
    expect(posCellularPreviousMonthKey(Date.UTC(2027, 0, 15))).toBe('2026-12')
    expect(posCellularMonthBounds('2026-12')).toEqual({ startMs: Date.UTC(2026, 11, 1), endMs: Date.UTC(2027, 0, 1) })
    expect(posCellularMonthBounds('2026-13')).toBeNull()
    expect(posCellularMonthBounds('October')).toBeNull()
    expect(posCellularMonthLabel('2026-10')).toBe('October 2026')
  })
})

describe('a reader’s 4G periods (AGL-4038)', () => {
  const base = { orgId: 'org-1', hostId: 'host-1', readerId: 'tmr_1', serialNumber: 'S710-1', stripeConfigurationId: 'tmc_1' }
  const oct = posCellularMonthBounds('2026-10')!

  it('opens once, closes once, and keeps a bounded history', () => {
    const on = openPosCellularPeriod(base, null, 100)
    expect(on).toMatchObject({ enabled: true, periods: [{ fromMs: 100, toMs: null }], disabledAtMs: null })
    // Opening again while open changes nothing.
    expect(openPosCellularPeriod(base, on, 200).periods).toEqual([{ fromMs: 100, toMs: null }])
    const off = closePosCellularPeriod(on, 300)
    expect(off).toMatchObject({ enabled: false, periods: [{ fromMs: 100, toMs: 300 }], disabledAtMs: 300 })
    expect(closePosCellularPeriod(off, 400)).toBe(off)
    let record: PosCellularReaderRecord = off
    for (let at = 1_000; at < 1_000 + 40 * 10; at += 10) {
      record = closePosCellularPeriod(openPosCellularPeriod(base, record, at), at + 5)
    }
    expect(record.periods).toHaveLength(POS_CELLULAR_MAX_PERIODS)
  })

  it('bills a month the reader had 4G at any time in, and no other', () => {
    const at = (day: number, month = 9) => Date.UTC(2026, month, day)
    const cases: Array<[string, PosCellularReaderRecord['periods'], boolean]> = [
      ['on before the month, still on', [{ fromMs: at(5, 8), toMs: null }], true],
      ['on and off within the month', [{ fromMs: at(3), toMs: at(4) }], true],
      ['turned off on the 1st', [{ fromMs: at(5, 8), toMs: at(1) + 1 }], true],
      ['off before the month began', [{ fromMs: at(5, 8), toMs: at(1) }], false],
      ['on only after the month', [{ fromMs: at(1, 10), toMs: null }], false],
      ['no periods', [], false],
    ]
    for (const [label, periods, billed] of cases) {
      expect([label, posCellularBilledInMonth({ periods }, oct)]).toEqual([label, billed])
    }
  })

  it('counts each reader once per workspace, across its stores', () => {
    const record = (orgId: string, hostId: string, readerId: string, fromMs: number): PosCellularReaderRecord => ({
      ...openPosCellularPeriod({ ...base, orgId, hostId, readerId }, null, fromMs),
    })
    const byOrg = posCellularReadersByWorkspace(
      [
        record('org-1', 'host-1', 'tmr_1', oct.startMs - 1),
        record('org-1', 'host-2', 'tmr_2', oct.startMs + 10),
        record('org-2', 'host-3', 'tmr_3', oct.endMs + 1),
      ],
      '2026-10',
    )
    expect([...byOrg]).toEqual([['org-1', { readers: 2, hostIds: ['host-1', 'host-2'] }]])
  })
})

describe('the POS devices card’s 4G row (AGL-4038)', () => {
  it('shows only where 4G is offered and the store has an S710, or already has 4G on', () => {
    const s710 = [{ deviceType: 'stripe_s710' }, { deviceType: 'stripe_s700' }]
    expect(posCellularView(null, { cellularEnabled: true }, s710)).toBeNull()
    expect(posCellularView(CONFIG, {}, [{ deviceType: 'stripe_s700' }])).toBeNull()
    expect(posCellularView(CONFIG, {}, s710)).toEqual({ readerMonthlyCents: 1_061, enabled: false, readers: 1 })
    expect(posCellularView(CONFIG, { cellularEnabled: true }, [])).toEqual({ readerMonthlyCents: 1_061, enabled: true, readers: 0 })
  })
})
