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
 * BOTH BASES, AND THE GAP, REACH THE SCREEN (AGL-2486).
 *
 * Zach asked for contracted and settled revenue "both, side by side" — and
 * the gap between them is the part that does the work, because two totals
 * with a reader left to subtract has wasted the decision.
 *
 * ASSERTED BY RENDERING, not by reading the helpers. The sibling AGL-2163
 * defect on the tax-return page was exactly a correct helper the page never
 * called: figures that existed only in a JSON response nobody sees. So every
 * number below is looked up in the rendered DOM.
 *
 * The fixture amounts are deliberately DISTINCT per figure, so no assertion
 * can be satisfied by a different figure that happens to be nearby — the
 * failure mode where a page renders one number four times and every
 * `getByText` passes.
 *
 * The prose assertions are not decoration either. "Refunds are a loss" and
 * "the pass-through is not revenue" are accounting positions this page is
 * required to STATE, not merely to compute correctly; a future edit that
 * tidies the copy away would leave the arithmetic right and the page
 * misleading, and that is precisely what these catch.
 */

import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { RevenuePayload } from '../utils/revenue-view'

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  ICON_VARIANT_SYMBOL_SECURE: { path: 'M0 0' },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDisplay: ({
    header,
    children,
  }: {
    header?: ReactNode
    children?: ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  GridItems: ({ items }: { items: Array<{ children: ReactNode }> }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
// StaffOnly is a pass-through HERE and nowhere else: the 404 gate is real
// product behaviour with its own coverage, and this suite is about what a
// staff member sees once through it.
jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
}))
jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))
jest.mock('../constants/route-links', () => ({
  __esModule: true,
  buildRoute: () => '/admin',
  Route: { ADMIN_OVERVIEW: 'ADMIN_OVERVIEW', ADMIN_REVENUE: 'ADMIN_REVENUE' },
}))

import AdminRevenue from '../app/(app)/admin/revenue/page'

/**
 * Every figure a distinct magnitude, so a match is unambiguous:
 * contracted $9,100.00 · collecting $6,100.00 · trialing $1,700.00 ·
 * past-due $1,300.00 · settled-earned $4,321.00 · subscription settled
 * $3,100.00 · marketplace commission $811.00 · storefront take $410.00 ·
 * reversals $260.00 · unbilled meter $170.00 · pass-through $930.00.
 */
const payload: RevenuePayload = {
  period: '2026-07',
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  contracted: {
    total: { orgs: 14, listPriceUsd: 9800, mrrUsd: 9100 },
    collecting: { orgs: 9, listPriceUsd: 6500, mrrUsd: 6100 },
    trialing: { orgs: 3, listPriceUsd: 1700, mrrUsd: 1700 },
    pastDue: { orgs: 2, listPriceUsd: 1300, mrrUsd: 1300 },
    compedOrgs: 5,
    discountUsd: 700,
  },
  settled: {
    subscriptions: {
      transactionCount: 22,
      grossCents: 355_000,
      taxCents: 19_000,
      netCents: 336_000,
      refundedCents: 26_000,
      chargedBackCents: 9_000,
      netOfReversalsCents: 310_000,
      internalTrafficCents: 4_500,
    },
    marketplace: {
      transactionCount: 7,
      grossCents: 240_000,
      taxCents: 12_000,
      sellerTransferCents: 146_900,
      commissionCents: 90_000,
      commissionRefundedCents: 8_900,
      commissionNetCents: 81_100,
      estimatedProcessingCostCents: 14_700,
    },
    commerce: {
      transactionCount: 31,
      grossCents: 1_540_000,
      applicationFeeCents: 134_000,
      processingPassThroughCents: 93_000,
      commissionCents: 41_000,
      commissionRefundedCents: 0,
      commissionNetCents: 41_000,
      subscriptionOrders: 4,
      truncated: false,
    },
    totalEarnedCents: 432_100,
  },
  gap: {
    collectingMrrCents: 610_000,
    settledSubscriptionCents: 310_000,
    gapCents: 300_000,
    causes: {
      trialingCents: 170_000,
      pastDueCents: 130_000,
      reversedCents: 26_000,
      discountCents: 70_000,
      unbilledMeteredCents: 17_000,
    },
    unexplainedCents: 257_000,
  },
  attention: { rowsOutsideEveryPeriod: 0, commerceTruncated: false },
  unbilledMeteredApplies: true,
  commerceQueryFailed: false,
  subscriptionsTruncated: false,
  marketplaceTruncated: false,
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as never
})

describe('the revenue page shows both bases (AGL-2486)', () => {
  it('renders contracted and settled as separate headline figures', async () => {
    render(<AdminRevenue />)
    // Contracted MRR — the book as it stands. Unique on the page.
    expect(await screen.findByText('$9,100.00')).toBeTruthy()
    // Settled and earned — cash Aglyn kept. A DIFFERENT number, so neither
    // assertion can be satisfied by the other. It appears twice by design:
    // once as the headline and once as the earned breakdown's total.
    expect((await screen.findAllByText(/4,321\.00/)).length).toBeGreaterThan(0)
    // The two headline figures are genuinely different figures.
    expect(screen.queryByText('$9,100.00')).not.toBeNull()
    expect(screen.queryAllByText('$9,100.00')).toHaveLength(1)
  })

  it('states that the two columns are not two attempts at one number', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/not two attempts at the same number/i),
      ).toBeTruthy(),
    )
  })
})

describe('the gap is decomposed into named causes', () => {
  it('shows the gap itself and each cause as its own figure', async () => {
    render(<AdminRevenue />)
    // Should-have-collected, settled, and the gap: three distinct amounts.
    // Several appear twice by design — the org-treatment table states the
    // same slice the gap compares against, and the earned breakdown restates
    // the settled subscription line — so presence, not uniqueness, is the
    // claim here. $3,000.00 (the gap itself) IS unique, and is asserted so.
    expect((await screen.findAllByText('$6,100.00')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('$3,100.00')).length).toBeGreaterThan(0)
    expect(await screen.findByText('$3,000.00')).toBeTruthy()
    // Each named cause carries its own amount.
    expect((await screen.findAllByText('$1,700.00')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('$1,300.00')).length).toBeGreaterThan(0)
    expect(await screen.findByText('$170.00')).toBeTruthy() // unbilled meter
  })

  it('shows the unexplained residual rather than absorbing it', async () => {
    render(<AdminRevenue />)
    expect(await screen.findByText('$2,570.00')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByText(/Unexplained residual/i)).toBeTruthy(),
    )
  })

  it('names past-due as dunning, with something to do about it', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/This is dunning/i)).toBeTruthy(),
    )
  })
})

describe('comped, trialing and past-due are stated in the UI, not just in code', () => {
  it('gives each org state a row saying what it contributes', async () => {
    render(<AdminRevenue />)
    await waitFor(() => expect(screen.getByText('Trialing')).toBeTruthy())
    expect(screen.getByText('Past due')).toBeTruthy()
    expect(screen.getByText('Comped / staff override')).toBeTruthy()
    // The comped count reaches the screen…
    expect(screen.getByText('5')).toBeTruthy()
    // …and the reason a comp carries no dollar figure is stated, not implied.
    expect(
      screen.getByText(/would invent revenue that never existed/i),
    ).toBeTruthy()
  })
})

describe('the accounting positions are STATED, not merely computed', () => {
  it('says a refund is a loss and that Stripe keeps its fee', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(
          /Stripe does not return its processing fee on a refund/i,
        ),
      ).toBeTruthy(),
    )
    // And the reversal figure itself is on screen as a deduction.
    expect(screen.getByText('−$260.00')).toBeTruthy()
  })

  it('says card processing passed through at cost is not revenue', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/It is a recovery, not earnings/i)).toBeTruthy(),
    )
    // The pass-through is subtracted as its own line…
    expect(screen.getByText('−$930.00')).toBeTruthy()
    // …and the storefront take that survives it is a smaller, distinct figure.
    expect(screen.getByText('$410.00')).toBeTruthy()
  })

  it('does not present the storefront fee itself as earnings', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText('$1,340.00')).toBeTruthy(),
    )
    // The fee appears exactly once, on the gross-vs-net table. If it were
    // being reported as earnings it would also appear in the earned
    // breakdown, which instead carries the $410.00 take.
    expect(screen.getAllByText('$1,340.00')).toHaveLength(1)
  })

  it('flags the marketplace processing cost it cannot recover', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/NOT recovered — the commission above is gross of it/i),
      ).toBeTruthy(),
    )
  })

  it('flags storefront renewals that absorb the card cost', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/4 storefront subscription renewals recover no card cost/i),
      ).toBeTruthy(),
    )
  })

  it('says sales tax is the state money, and shows it as a deduction', async () => {
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/Held and remitted, never revenue/i)).toBeTruthy(),
    )
    expect(screen.getByText('−$190.00')).toBeTruthy()
  })
})

describe('a figure that cannot be trusted is never shown as a total', () => {
  it('warns when a sweep was truncated', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, subscriptionsTruncated: true }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/These figures are a lower bound/i)).toBeTruthy(),
    )
  })

  it('says a $0 storefront figure means "not counted" when the query failed', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, commerceQueryFailed: true }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/because the query failed, not because there were no sales/i),
      ).toBeTruthy(),
    )
  })

  it('says undated invoices are invisible to every period', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ...payload,
        attention: { rowsOutsideEveryPeriod: 3, commerceTruncated: false },
      }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/invisible to every period/i),
      ).toBeTruthy(),
    )
  })
})

/**
 * The gap model, and Zach's "this negative number is confusing" (AGL-2486).
 *
 * On July 2026 in production the gap read `$-25.00` with the whole amount as
 * "unexplained residual". The arithmetic was right and the MODEL was wrong:
 * contracted is a run-rate measured today, settled is cash collected during
 * the period, and for a CLOSED period subtracting them measures two different
 * instants. The residual's own copy says a large one means "something this
 * page does not model" — but a subscription that collected and has since
 * ended IS modelled. So the page stops computing a difference it cannot
 * defend, rather than labelling a known artefact "unexplained".
 */
describe('the gap is not computed across two different instants', () => {
  const closed = { ...payload, periodIsClosed: true }

  it('shows no gap figure and no residual for a period that has ended', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => closed })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/No gap is shown for a period that has ended/i)).toBeTruthy(),
    )
    expect(screen.getByText('Not comparable')).toBeTruthy()
    // The residual is the specific thing that confused the reader.
    expect(screen.queryByText(/Unexplained residual/i)).toBeNull()
  })

  it('drops the causes that are measured TODAY rather than over the period', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => closed })) as never
    render(<AdminRevenue />)
    await waitFor(() => expect(screen.getByText('Not comparable')).toBeTruthy())
    // Period-scoped causes stay...
    expect(screen.getByText(/Refunded and charged back/i)).toBeTruthy()
    // ...contracted-derived ones go: they describe the book now, not then.
    expect(screen.queryByText(/Past due — contracted, owed, not collected/i)).toBeNull()
    expect(screen.queryByText(/Trialing — contracted, converts later/i)).toBeNull()
  })

  it('still computes the gap for a period still in progress', async () => {
    // The negative control: the model change must not silently disable the
    // gap everywhere, which would pass every assertion above.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, periodIsClosed: false }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() => expect(screen.getByText(/Unexplained residual/i)).toBeTruthy())
    expect(screen.queryByText('Not comparable')).toBeNull()
    expect(screen.getByText(/Past due — contracted, owed, not collected/i)).toBeTruthy()
  })

  it('defines what a NEGATIVE gap means, not only a positive one', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, periodIsClosed: false }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/Negative means cash arrived that the contracted base does not account for/i),
      ).toBeTruthy(),
    )
  })
})

describe('money renders the sign outside the currency symbol', () => {
  it('renders a negative gap as -$25.00, never $-25.00', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ...payload,
        periodIsClosed: false,
        gap: { ...payload.gap, gapCents: -2500, unexplainedCents: -2500 },
      }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() => expect(screen.getAllByText('-$25.00').length).toBeGreaterThan(0))
    expect(screen.queryByText('$-25.00')).toBeNull()
  })
})

describe('every figure is traceable to the org behind it', () => {
  const withAttribution = {
    ...payload,
    attribution: {
      rows: [
        {
          orgId: 'hz_KgetqSq',
          name: 'Test Org',
          plan: 'free',
          state: 'inactive',
          mrrUsd: 0,
          listPriceUsd: 0,
          settledCents: 2500,
          invoices: 1,
          refundedCents: 0,
        },
        {
          orgId: 'jWmGooWE3L',
          name: 'Aglyn LLC',
          plan: 'enterprise',
          state: 'comped',
          mrrUsd: 0,
          listPriceUsd: 0,
          settledCents: 0,
          invoices: 0,
          refundedCents: 0,
        },
      ],
      omittedOrgs: 0,
      omittedMrrUsd: 0,
      omittedSettledCents: 0,
      totalOrgs: 6,
    },
  }

  it('names the orgs behind the totals, including the comped ones', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => withAttribution,
    })) as never
    render(<AdminRevenue />)
    // TWICE by design: once as a labelled bar in the chart, once as a row in
    // the table beneath it. Asserting both is what stops the chart being
    // wired to a different source than the table it sits above.
    await waitFor(() =>
      expect(screen.getAllByText('Test Org').length).toBe(2),
    )
    // "Comped / staff override: 5" is useless until it names them.
    expect(screen.getAllByText('Aglyn LLC').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Comped \/ staff override/i).length).toBeGreaterThan(0)
  })

  it('says an empty table is a real answer, not a failed read', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, attribution: { rows: [] } }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/real answer, not a failed read/i)).toBeTruthy(),
    )
  })

  it('carries the omitted remainder as figures so the table still adds up', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ...withAttribution,
        attribution: {
          ...withAttribution.attribution,
          omittedOrgs: 3,
          omittedMrrUsd: 42,
          omittedSettledCents: 1234,
        },
      }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getByText(/3 more org\(s\) not listed/i)).toBeTruthy(),
    )
    expect(screen.getByText(/\$42\.00 of contracted/i)).toBeTruthy()
    expect(screen.getByText(/\$12\.34 of\s+settled cash/i)).toBeTruthy()
  })
})

describe('every source is attributed on its own dimension', () => {
  const withSources = {
    ...payload,
    attributionByListing: {
      rows: [
        {
          key: 'ChiOYRKDeI',
          name: 'Office Hours',
          detail: 'Aglyn LLC',
          gainCents: 4_100,
          lossCents: 900,
          count: 3,
        },
      ],
      omittedRows: 0,
      omittedGainCents: 0,
      omittedLossCents: 0,
    },
    attributionByPublisher: {
      rows: [
        {
          key: 'jWmGooWE3L',
          name: 'Aglyn LLC',
          detail: '',
          gainCents: 4_100,
          lossCents: 900,
          count: 3,
        },
      ],
      omittedRows: 0,
      omittedGainCents: 0,
      omittedLossCents: 0,
    },
    attributionByHost: {
      rows: [
        {
          key: '4uYCmrbU5t',
          name: 'Northwind Coffee',
          detail: 'northwind-coffee',
          gainCents: 2_600,
          lossCents: 0,
          count: 5,
        },
      ],
      omittedRows: 0,
      omittedGainCents: 0,
      omittedLossCents: 0,
    },
  }

  it('names the plugin, the publisher and the storefront', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => withSources,
    })) as never
    render(<AdminRevenue />)
    // Chart label and table row, for each dimension.
    await waitFor(() =>
      expect(screen.getAllByText('Office Hours').length).toBe(2),
    )
    expect(screen.getAllByText('Northwind Coffee').length).toBe(2)
    expect(screen.getAllByText(/northwind-coffee/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Marketplace commission by publisher/i)).toBeTruthy()
  })

  it('shows a LOSS beside the gain rather than netting it away', async () => {
    // "A loss with no name on it is the one you most need to chase."
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => withSources,
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(screen.getAllByText('Office Hours').length).toBeGreaterThan(0),
    )
    expect(screen.getAllByText('−$9.00').length).toBeGreaterThan(0)
  })

  it('says an empty source table is a real answer, not a failed read', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, attributionByListing: { rows: [] } }),
    })) as never
    render(<AdminRevenue />)
    await waitFor(() =>
      expect(
        screen.getByText(/no sales means no commission — not a failed read/i),
      ).toBeTruthy(),
    )
  })
})
