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
 * ALL THREE BUCKETS REACH THE SCREEN (AGL-2163).
 *
 * `/api/admin/tax-return` computes three separate sets of figures — Aglyn's
 * own invoices (AGL-1811), merchants' storefront sales (AGL-1904) and
 * marketplace purchases (AGL-2137) — and the page read only `payload.summary`.
 * The storefront bucket reached the screen as an attention count and two
 * Webfile footnotes; the marketplace bucket did not reach it at all. Two of
 * the three buckets a human files this return from existed only in a JSON
 * response nobody sees.
 *
 * ASSERTED BY RENDERING, not by reading the helpers. A helper that returns the
 * right rows and a page that never calls it is the exact state this defect was
 * in, so every figure below is looked up in the rendered DOM. The fixture
 * amounts are deliberately distinct per bucket so no assertion can be
 * satisfied by another bucket's number.
 */

import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { TaxReturnPayload } from '../utils/tx-return-webfile'

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
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
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
  Route: { ADMIN_OVERVIEW: 'ADMIN_OVERVIEW', ADMIN_TAX_RETURN: 'ADMIN_TAX_RETURN' },
}))

import AdminTaxReturn from '../app/(app)/admin/tax-return/page'

/**
 * Distinct magnitudes per bucket on purpose — $12.00 subscription tax,
 * $34.00 storefront-under-Aglyn, $57.00 merchant-manual, $78.00 marketplace
 * net — so a figure appearing on screen can only have come from its own
 * bucket.
 */
const payload: TaxReturnPayload = {
  period: '2026-Q3',
  truncated: false,
  undatedRows: 0,
  rows: [],
  summary: {
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    transactionCount: 3,
    totalSalesCents: 100_000,
    taxableSalesCents: 100_000,
    taxCollectedCents: 1_200,
    byJurisdiction: {
      'US-TX': {
        transactionCount: 3,
        totalSalesCents: 100_000,
        taxableSalesCents: 100_000,
        taxCollectedCents: 1_200,
      },
    },
    refunds: {
      rowsRefundedInPeriod: 0,
      refundedGrossCents: 0,
      estimatedRefundedTaxCents: 0,
    },
    attention: {
      untaxedRows: 0,
      rowsMissingTaxableBase: 0,
      rowsMissingAddress: 0,
      nonUsdRows: 0,
      rowsMissingPaidAt: 0,
    },
  } as never,
  storefront: {
    truncated: false,
    undatedRows: 0,
    rows: [],
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 9,
      aglynLiable: {
        transactionCount: 5,
        grossCents: 500_000,
        taxableSalesCents: 400_000,
        taxCollectedCents: 3_400,
        // The Texas SLICE is smaller than the bucket, as it is in reality —
        // which is also what keeps $34.00 unique to the new card, since the
        // Webfile footnote prints the Texas figure ($20.00) instead.
        byJurisdiction: {
          'US-TX': {
            transactionCount: 3,
            totalSalesCents: 300_000,
            taxableSalesCents: 240_000,
            taxCollectedCents: 2_000,
          },
        },
      },
      merchantManual: {
        transactionCount: 4,
        grossCents: 200_000,
        taxableSalesCents: 190_000,
        taxCollectedCents: 5_700,
        byJurisdiction: {},
      },
      connectedAccountLiable: {
        transactionCount: 0,
        grossCents: 0,
        taxableSalesCents: 0,
        taxCollectedCents: 0,
        byJurisdiction: {},
      },
      attention: {
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
        rowsUnclassified: 0,
      },
    },
  } as never,
  marketplace: {
    truncated: false,
    rows: [],
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 11,
      grossCents: 300_000,
      taxableSalesCents: 292_200,
      taxChargedCents: 9_000,
      taxRefundedCents: 1_200,
      taxCollectedCents: 7_800,
      attention: {
        rowsMissingJurisdiction: 11,
        rowsMissingCreatedAt: 0,
        rowsOverRefunded: 0,
      },
    },
  } as never,
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as never
})

const rendered = async () => {
  render(<AdminTaxReturn />)
  // Waits for a FIGURE, not for a heading: the headings render immediately
  // with "Loading…" underneath, so waiting on one would assert against an
  // empty card and pass for the wrong reason.
  await waitFor(() => expect(screen.getByText('$78.00')).toBeTruthy())
  return document.body.textContent ?? ''
}

describe('the staff tax-return page renders all three buckets (AGL-2163)', () => {
  it('shows the STOREFRONT bucket split by who owes the tax', async () => {
    const text = await rendered()
    // $34.00 is only in `storefront.aglynLiable`.
    expect(text).toContain('$34.00')
    // …and the merchant's own rate is shown SEPARATELY, never summed with it.
    expect(text).toContain('$57.00')
    expect(text).not.toContain('$91.00') // 34 + 57, the total nobody may print
    expect(screen.getByText(/Aglyn holds this/i)).toBeTruthy()
    expect(text).toMatch(/never touched an Aglyn registration/i)
  })

  it('shows the MARKETPLACE bucket, charged and refunded stated apart', async () => {
    const text = await rendered()
    expect(text).toContain('$90.00') // tax charged
    expect(text).toContain('$12.00') // tax refunded
    expect(text).toContain('$78.00') // net, the remittable figure
    expect(text).toMatch(/Tax collected, net/i)
    // Why part of it may carry no jurisdiction, said on screen rather than
    // left for someone to wonder about when a period does not fully break
    // down by state. This fixture is a pre-AGL-2137 payload — 11 rows, all
    // of them unattributed and no `byJurisdiction` at all — so it also pins
    // that the page still renders an older response without inventing one.
    expect(text).toMatch(/carry no jurisdiction and are counted as such/i)
    expect(text).toMatch(/Marketplace rows with no stated jurisdiction/i)
  })

  it("says plainly that neither bucket is in the Webfile figures", async () => {
    // The failure this page exists to prevent is a qualified figure reading
    // as a final one. Two buckets of tax that are Aglyn's to remit sitting
    // beside the Webfile lines, with nothing saying they are not in them,
    // would be that failure with more numbers.
    const text = await rendered()
    expect(text).toMatch(/None of this is in the Webfile figures above/i)
    expect(text).toMatch(/in NO Webfile line above/i)
  })

  it('raises BOTH as blocking findings above the figures', async () => {
    const text = await rendered()
    expect(text).toMatch(/Do not file/i)
    expect(text).toMatch(
      /Texas storefront tax collected under Aglyn’s registration/i,
    )
    expect(text).toMatch(/Marketplace tax collected under Aglyn’s registration/i)
  })

  it('THE NEGATIVE CONTROL: a payload predating either bucket still renders', async () => {
    // `storefront` and `marketplace` are optional precisely because an older
    // response is a legitimate shape. A page that threw on one would take the
    // whole return off the air for the periods that need it most.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ...payload, storefront: null, marketplace: null }),
    })) as never
    render(<AdminTaxReturn />)
    await waitFor(() =>
      expect(screen.getByText(/carries no marketplace figures/i)).toBeTruthy(),
    )
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/carries no storefront figures/i)
    expect(text).toMatch(/carries no marketplace figures/i)
    // …and the figures that DO exist are untouched, so the empty state is not
    // hiding a crash.
    expect(text).toContain('$12.00')
  })
})

/**
 * THE BY-STATE TABLE IS ACTUALLY ON THE SCREEN (AGL-1956).
 *
 * `storefrontTaxSummary` had been computing `byJurisdiction` for every bucket,
 * and the API had been serialising it whole, since AGL-1904. Nothing rendered
 * it — so Aglyn could not answer "how much did we facilitate into this state"
 * from any surface, while the one by-state table on the page was sourced from
 * `platformRevenue` and labelled the nexus early-warning list.
 *
 * This asserts the DOM, because a view-model unit test would have passed just
 * as happily while the table stayed unrendered — which is precisely the state
 * the code was already in.
 */
describe('facilitated sales by buyer state reach the screen (AGL-1956)', () => {
  it('renders the Texas storefront slice, not the bucket total', async () => {
    const text = await rendered()
    expect(text).toContain('Facilitated sales by buyer state')
    // $3000.00 is `storefront.aglynLiable.byJurisdiction['US-TX']
    // .totalSalesCents` and appears nowhere else in the payload — the bucket
    // table prints the $5000.00 gross instead. So this figure can only have
    // arrived through the new by-state view model.
    expect(text).toContain('$3000.00')
    expect(text).toContain('US-TX')
  })

  it('relabels the platformRevenue table so it stops claiming to be the nexus list', async () => {
    const text = await rendered()
    // The old header promised facilitated-sales nexus data over Aglyn's own
    // SaaS invoices. Both halves are asserted: the honest name is present and
    // the misleading one is gone.
    expect(text).toContain('Aglyn’s own sales by jurisdiction')
    expect(text).not.toContain('All jurisdictions')
  })
})
