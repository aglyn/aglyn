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
  campaignRevenueAcrossSends,
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

/**
 * MERGING A CAMPAIGN'S EMAILS, which is where the currencies could be lost.
 *
 * The single-send report cannot get this wrong: it reads one bucket map and
 * renders it. The merge can, because it adds — and the addition that would
 * pass every single-currency fixture ever written is the one that adds a USD
 * amount to a EUR amount. Every case below that involves money therefore
 * either carries two currencies or exists to pin an edge the two-currency
 * case cannot see.
 */
describe('campaignRevenueAcrossSends', () => {
  it('sums one currency across the campaign’s emails', () => {
    const report = campaignRevenueAcrossSends([
      rollup({
        byCurrency: {
          usd: { grossCents: 50_000, refundedCents: 5_000, orders: 4 },
        },
      }),
      rollup({
        byCurrency: {
          usd: { grossCents: 30_000, orders: 2, refundedOrders: 0 },
        },
      }),
    ])

    expect(report.currencies).toHaveLength(1)
    expect(report.currencies[0]).toMatchObject({
      currency: 'usd',
      grossCents: 80_000,
      refundedCents: 5_000,
      netCents: 75_000,
      orders: 6,
      emails: 2,
    })
    expect(report.multiCurrency).toBe(false)
    expect(report.attributedOrders).toBe(6)
  })

  it('NEVER adds two currencies, whatever the caller asks it for', () => {
    const report = campaignRevenueAcrossSends([
      rollup({ byCurrency: { usd: { grossCents: 50_000, orders: 3 } } }),
      rollup({ byCurrency: { eur: { grossCents: 30_000, orders: 2 } } }),
      rollup({ byCurrency: { gbp: { grossCents: 10_000, orders: 1 } } }),
    ])

    expect(report.multiCurrency).toBe(true)
    expect(report.currencies.map((entry) => entry.currency)).toEqual([
      'usd',
      'eur',
      'gbp',
    ])
    // The figure a summing implementation would produce, asserted against by
    // name: 90_000 is 50 + 30 + 10 and belongs to nothing.
    expect(report.currencies.some((entry) => entry.grossCents === 90_000)).toBe(
      false,
    )
    expect(report.currencies.map((entry) => entry.grossCents)).toEqual([
      50_000, 30_000, 10_000,
    ])
    // And there is no field for a screen to print a total FROM. A combined
    // amount that exists anywhere on the result is a combined amount that
    // eventually reaches a `<MoneyFigure>`.
    expect(Object.keys(report)).not.toContain('grossCents')
    expect(Object.keys(report)).not.toContain('netCents')
    expect(report.caveats.map((caveat) => caveat.id)).toContain(
      'revenue-multi-currency',
    )
  })

  it('keeps one email’s two currencies apart', () => {
    // The case a per-EMAIL currency assumption would pass: the rollup itself
    // holds both, so nothing about which document it came from separates them.
    const report = campaignRevenueAcrossSends([
      rollup({
        byCurrency: {
          usd: { grossCents: 20_000, orders: 2 },
          eur: { grossCents: 20_000, orders: 2 },
        },
      }),
    ])

    expect(report.currencies).toHaveLength(2)
    expect(report.multiCurrency).toBe(true)
    expect(report.attributedOrders).toBe(4)
    expect(report.currencies.every((entry) => entry.emails === 1)).toBe(true)
  })

  it('counts the emails each currency was earned in', () => {
    const report = campaignRevenueAcrossSends([
      rollup({ byCurrency: { usd: { grossCents: 10_000, orders: 1 } } }),
      rollup({ byCurrency: { usd: { grossCents: 10_000, orders: 1 } } }),
      rollup({ byCurrency: { eur: { grossCents: 40_000, orders: 1 } } }),
    ])

    expect(
      Object.fromEntries(
        report.currencies.map((entry) => [entry.currency, entry.emails]),
      ),
    ).toEqual({ usd: 2, eur: 1 })
  })

  it('clamps the net ONCE over the campaign, not per email', () => {
    /*
     * An over-refunded email beside a profitable one. Clamping each send's
     * net at zero and then summing would report $200 for a campaign that is
     * holding $150 — the refund on the first email would simply vanish.
     */
    const report = campaignRevenueAcrossSends([
      rollup({
        byCurrency: {
          usd: { grossCents: 10_000, refundedCents: 15_000, orders: 1 },
        },
      }),
      rollup({ byCurrency: { usd: { grossCents: 20_000, orders: 1 } } }),
    ])

    expect(report.currencies[0]).toMatchObject({
      grossCents: 30_000,
      refundedCents: 15_000,
      netCents: 15_000,
    })
  })

  it('still refuses to print a negative campaign', () => {
    const report = campaignRevenueAcrossSends([
      rollup({
        byCurrency: {
          usd: { grossCents: 1_000, refundedCents: 9_000, orders: 1 },
        },
      }),
    ])

    expect(report.currencies[0].netCents).toBe(0)
    expect(report.currencies[0].refundedCents).toBe(9_000)
  })

  it('tells a campaign with no record apart from one that earned nothing', () => {
    // Neither email has ever been credited: the join may not exist, the site
    // may have no store, the emails may predate the whole mechanism.
    const absent = campaignRevenueAcrossSends([undefined, undefined])
    expect(absent.recorded).toBe(0)
    expect(absent.read).toBe(2)
    expect(absent.currencies).toEqual([])

    // A record exists and holds nothing: this campaign really earned nothing.
    const zero = campaignRevenueAcrossSends([
      rollup({ byCurrency: {} }),
      undefined,
    ])
    expect(zero.recorded).toBe(1)
    expect(zero.read).toBe(2)
    expect(zero.currencies).toEqual([])
  })

  it('reports how much of the campaign the amounts cover', () => {
    const report = campaignRevenueAcrossSends([
      rollup({ byCurrency: { usd: { grossCents: 10_000, orders: 1 } } }),
      undefined,
      undefined,
    ])

    expect(report.read).toBe(3)
    expect(report.recorded).toBe(1)
  })

  it('says when the emails were not all credited under one rule', () => {
    const report = campaignRevenueAcrossSends([
      rollup({
        windowDays: 7,
        byCurrency: { usd: { grossCents: 10_000, orders: 1 } },
      }),
      rollup({
        windowDays: 30,
        byCurrency: { usd: { grossCents: 10_000, orders: 1 } },
      }),
    ])

    expect(report.windowDays).toEqual([7, 30])
    expect(report.caveats.map((caveat) => caveat.id)).toContain(
      'revenue-mixed-model',
    )
    // The amounts are one unit, so unlike two currencies they still add.
    expect(report.currencies[0].grossCents).toBe(20_000)
  })

  it('is quiet about the rule when every email shares it', () => {
    const report = campaignRevenueAcrossSends([
      rollup({ byCurrency: { usd: { grossCents: 10_000, orders: 1 } } }),
      rollup({ byCurrency: { usd: { grossCents: 10_000, orders: 1 } } }),
    ])

    expect(report.models).toEqual([EMAIL_ATTRIBUTION_MODEL])
    expect(report.windowDays).toEqual([EMAIL_ATTRIBUTION_WINDOW_DAYS])
    expect(report.caveats).toEqual([])
  })

  it('merges buckets whose codes differ only in case', () => {
    // Two spellings of one currency are one currency. Left apart they would
    // render as two blocks and read as a campaign that took two units.
    const report = campaignRevenueAcrossSends([
      rollup({ byCurrency: { usd: { grossCents: 10_000, orders: 1 } } }),
      rollup({ byCurrency: { USD: { grossCents: 10_000, orders: 1 } } }),
    ])

    expect(report.currencies).toHaveLength(1)
    expect(report.multiCurrency).toBe(false)
    expect(report.currencies[0]).toMatchObject({
      currency: 'usd',
      grossCents: 20_000,
      emails: 2,
    })
  })

  it('sorts the biggest earner first', () => {
    const report = campaignRevenueAcrossSends([
      rollup({
        byCurrency: {
          usd: { grossCents: 1_000, orders: 1 },
          eur: { grossCents: 9_000, orders: 1 },
        },
      }),
    ])

    expect(report.currencies.map((entry) => entry.currency)).toEqual([
      'eur',
      'usd',
    ])
  })

  it('drops a bucket holding neither orders nor money', () => {
    const report = campaignRevenueAcrossSends([
      rollup({
        byCurrency: {
          usd: { grossCents: 10_000, orders: 1 },
          eur: { grossCents: 0, orders: 0 },
        },
      }),
    ])

    expect(report.currencies).toHaveLength(1)
    // One surviving currency is not a multi-currency campaign, so the reader
    // is not warned about a total that was never in question.
    expect(report.multiCurrency).toBe(false)
  })

  it('answers an empty campaign without inventing a figure', () => {
    const report = campaignRevenueAcrossSends([])
    expect(report).toMatchObject({
      currencies: [],
      attributedOrders: 0,
      read: 0,
      recorded: 0,
      multiCurrency: false,
      models: [],
      windowDays: [],
      caveats: [],
    })
  })
})
