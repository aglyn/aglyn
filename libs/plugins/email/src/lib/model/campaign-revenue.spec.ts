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
  campaignMoneyPerMessage,
  campaignRevenueReport,
  EMAIL_ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  type CampaignRevenueRollup,
} from './campaign-revenue'

const rollup = (
  overrides: Partial<CampaignRevenueRollup> = {},
): CampaignRevenueRollup => ({
  model: EMAIL_ATTRIBUTION_MODEL,
  windowDays: EMAIL_ATTRIBUTION_WINDOW_DAYS,
  byCurrency: { usd: { grossCents: 50_000, orders: 4 } },
  ...overrides,
})

describe('campaignRevenueReport', () => {
  it('reports gross, refunded and net for one currency', () => {
    const report = campaignRevenueReport({
      rollup: rollup({
        byCurrency: {
          usd: {
            grossCents: 50_000,
            refundedCents: 12_500,
            orders: 4,
            refundedOrders: 1,
          },
        },
      }),
      delivered: 500,
    })

    expect(report.currencies).toHaveLength(1)
    expect(report.currencies[0]).toMatchObject({
      currency: 'usd',
      grossCents: 50_000,
      refundedCents: 12_500,
      netCents: 37_500,
      orders: 4,
      refundedOrders: 1,
    })
    expect(report.attributedOrders).toBe(4)
  })

  it('clamps the net at zero rather than printing negative earnings', () => {
    // A refund larger than the credited amount is arithmetically reachable —
    // the credit was the charge, the refund covered more. The stored pair
    // keeps both true figures; only the printed net is clamped.
    const report = campaignRevenueReport({
      rollup: rollup({
        byCurrency: { usd: { grossCents: 1_000, refundedCents: 4_000, orders: 1 } },
      }),
      delivered: 100,
    })
    expect(report.currencies[0].netCents).toBe(0)
    expect(report.currencies[0].grossCents).toBe(1_000)
    expect(report.currencies[0].refundedCents).toBe(4_000)
  })

  it('NEVER adds two currencies into one number', () => {
    const report = campaignRevenueReport({
      rollup: rollup({
        byCurrency: {
          usd: { grossCents: 50_000, orders: 4 },
          eur: { grossCents: 30_000, orders: 2 },
        },
      }),
      delivered: 500,
    })

    expect(report.multiCurrency).toBe(true)
    // Two blocks, each with its own money. Nothing on the report holds
    // 80_000, which is the number a careless sum would have produced.
    expect(report.currencies.map((one) => one.currency)).toEqual(['usd', 'eur'])
    expect(report.currencies.map((one) => one.netCents)).toEqual([50_000, 30_000])
    expect(
      report.currencies.some((one) => one.netCents === 80_000),
    ).toBe(false)
    // Orders ARE summed, and that is not the same sin: an order is a count of
    // events, not an amount, so counting four dollar orders and two euro
    // orders as six is true.
    expect(report.attributedOrders).toBe(6)
    expect(report.caveats.map((one) => one.id)).toContain(
      'revenue-multi-currency',
    )
  })

  it('withholds revenue per delivered when delivery was never recorded', () => {
    const report = campaignRevenueReport({
      rollup: rollup(),
      delivered: null,
    })
    expect(report.currencies[0].netPerDelivered).toBeNull()
    expect(report.caveats.map((one) => one.id)).toContain(
      'revenue-denominator-unrecorded',
    )
  })

  it('withholds revenue per delivered when the denominator is zero', () => {
    // Not "$500.00 per message". A zero denominator is no figure at all,
    // exactly as it is for every rate on the report beside it.
    const report = campaignRevenueReport({ rollup: rollup(), delivered: 0 })
    expect(report.currencies[0].netPerDelivered).toBeNull()
  })

  it('names the denominator of the per-message figure as data', () => {
    const report = campaignRevenueReport({
      rollup: rollup({ byCurrency: { usd: { grossCents: 50_000, orders: 4 } } }),
      delivered: 500,
    })
    expect(report.currencies[0].netPerDelivered).toEqual({
      cents: 100,
      numeratorCents: 50_000,
      denominator: 500,
      denominatorLabel: 'delivered',
      currency: 'usd',
    })
  })

  it('tells an unrecorded campaign apart from one that earned nothing', () => {
    const never = campaignRevenueReport({ rollup: undefined, delivered: 500 })
    expect(never.recorded).toBe(false)
    expect(never.currencies).toEqual([])

    const nothing = campaignRevenueReport({
      rollup: rollup({ byCurrency: {} }),
      delivered: 500,
    })
    expect(nothing.recorded).toBe(true)
    expect(nothing.currencies).toEqual([])
  })

  it('says a running total is running, while the send is still going', () => {
    const report = campaignRevenueReport({
      rollup: rollup(),
      delivered: 500,
      midFlight: true,
    })
    expect(report.caveats.map((one) => one.id)).toContain('revenue-mid-flight')
  })

  it('carries the model and window the figures were credited under', () => {
    const report = campaignRevenueReport({
      rollup: rollup({ model: 'last-click', windowDays: 30 }),
      delivered: 500,
    })
    // Read back from the record, not re-derived from today's constant: a
    // campaign credited under a different window has to keep saying so.
    expect(report.windowDays).toBe(30)
    expect(report.model).toBe('last-click')
  })

  it('defaults the model and window when the rollup predates them', () => {
    const report = campaignRevenueReport({
      rollup: { byCurrency: { usd: { grossCents: 100, orders: 1 } } },
      delivered: 10,
    })
    expect(report.windowDays).toBe(EMAIL_ATTRIBUTION_WINDOW_DAYS)
    expect(report.model).toBe(EMAIL_ATTRIBUTION_MODEL)
  })

  it('drops a currency bucket holding neither orders nor money', () => {
    const report = campaignRevenueReport({
      rollup: rollup({
        byCurrency: {
          usd: { grossCents: 5_000, orders: 1 },
          // A bucket that only ever received a reversal, which is a bucket
          // with nothing to report rather than a campaign that lost money.
          gbp: { grossCents: 0, refundedCents: 900, orders: 0 },
        },
      }),
      delivered: 100,
    })
    expect(report.currencies.map((one) => one.currency)).toEqual(['usd'])
    expect(report.multiCurrency).toBe(false)
  })

  it('sorts the biggest earner first', () => {
    const report = campaignRevenueReport({
      rollup: rollup({
        byCurrency: {
          aud: { grossCents: 1_000, orders: 1 },
          usd: { grossCents: 9_000, orders: 2 },
        },
      }),
      delivered: 100,
    })
    expect(report.currencies.map((one) => one.currency)).toEqual(['usd', 'aud'])
  })
})

describe('campaignMoneyPerMessage', () => {
  it('refuses a zero denominator', () => {
    expect(campaignMoneyPerMessage(5_000, 0, 'delivered', 'usd')).toBeNull()
  })

  it('refuses an unrecorded denominator', () => {
    expect(
      campaignMoneyPerMessage(5_000, undefined, 'delivered', 'usd'),
    ).toBeNull()
  })

  it('divides when it honestly can', () => {
    expect(campaignMoneyPerMessage(5_000, 250, 'delivered', 'usd')).toEqual({
      cents: 20,
      numeratorCents: 5_000,
      denominator: 250,
      denominatorLabel: 'delivered',
      currency: 'usd',
    })
  })
})
