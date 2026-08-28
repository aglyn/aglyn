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
 * A FINDING NAMES ITS ROWS, AND ITEM 3 SAYS WHERE ITS FIGURE CAME FROM.
 *
 * ASSERTED BY RENDERING, like its sibling suites. A view model that returns
 * the right rows while the page renders none is exactly the state this defect
 * was in: the route had carried `automaticTax` per row since AGL-1811 and the
 * page never read it, so the count reached the screen and the identity did
 * not.
 *
 * Two claims, and both are about a document somebody signs:
 *
 *   1. A count on the banner resolves to invoices on the screen — the invoice
 *      id, where the customer was, the money, the date, and a link into
 *      Stripe.
 *   2. Item 3 reads `not computed` for a period nobody has entered, and reads
 *      an ENTERED figure as entered. A zero would be the false claim the line
 *      exists to refuse.
 *
 * Every identifier is SYNTHETIC and deliberately not a plausible digit run.
 */

import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { TaxReturnPayload, TaxReturnRow } from '../utils/tx-return-webfile'

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
/**
 * ONE user object for the whole suite, not a fresh one per render.
 *
 * The page's fetch effect lists `user` in its dependencies and clears the
 * payload before each fetch, so a hook returning a new object every render
 * makes the page oscillate between "loaded" and "loading" indefinitely — and
 * every assertion below would then pass or fail on which half of that cycle
 * the query happened to land in. The real hook is SWR-backed and hands back
 * the same reference; this double does the same.
 */
const mockUser = { data: { getIdToken: async () => 'token' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => mockUser,
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
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
  Route: {
    ADMIN_OVERVIEW: 'ADMIN_OVERVIEW',
    ADMIN_TAX_RETURN: 'ADMIN_TAX_RETURN',
  },
}))

import AdminTaxReturn from '../app/(app)/admin/tax-return/page'

/** A synthetic Stripe-shaped invoice id — not one that exists anywhere. */
const UNTAXED_INVOICE = 'in_syntheticuntaxedrow'

const UNTAXED_ROW: TaxReturnRow = {
  invoiceId: UNTAXED_INVOICE,
  orgId: 'org-synthetic',
  paidAt: '2026-09-18T00:00:00.000Z',
  grossCents: 2500,
  taxCents: 0,
  taxableSalesCents: 0,
  state: 'TX',
  country: 'US',
  automaticTax: false,
  refundedCents: 0,
  findings: ['untaxedRows'],
}

function payload(overrides: Partial<TaxReturnPayload> = {}): TaxReturnPayload {
  return {
    period: '2026-Q3',
    truncated: false,
    undatedRows: 0,
    rows: [UNTAXED_ROW],
    registration: {
      jurisdiction: 'US-TX',
      registrationId: 'REG-SYNTHETIC-4242',
      filingId: 'FILE-SYNTHETIC-9090',
    },
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 1,
      totalSalesCents: 2500,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
      byJurisdiction: {
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 2500,
          taxableSalesCents: 0,
          taxCollectedCents: 0,
          taxabilityReasons: {},
          rates: [],
        },
      },
      refunds: {
        rowsRefundedInPeriod: 0,
        refundedGrossCents: 0,
        estimatedRefundedTaxCents: 0,
        chargedBackCents: 0,
        rowsChargedBack: 0,
      },
      internal: {
        transactionCount: 0,
        totalSalesCents: 0,
        taxableSalesCents: 0,
        taxCollectedCents: 0,
        byJurisdiction: {},
      },
      attention: {
        internalRows: 0,
        untaxedRows: 1,
        untaxedRowsBeforeObligation: 0,
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
        rowsWithNetMismatch: 0,
      },
    },
    ...overrides,
  } as TaxReturnPayload
}

/**
 * The return on `/api/admin/tax-return`, and the Item 3 entry on
 * `/api/admin/tax-purchases` — two endpoints, so the fake routes by URL. One
 * blanket response would serve the return's shape to the entry card and make
 * every Item 3 assertion below pass or fail for the wrong reason.
 */
function serve(body: TaxReturnPayload, entry: unknown = null) {
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes('/api/admin/tax-purchases')
        ? { role: 'super', period: body.period, entry, limits: { noteMax: 280 } }
        : String(url).includes('/api/admin/tax-filing')
          ? { config: { firstTaxablePeriod: '2026-09' } }
          : body,
  })) as never
}

async function rendered(body: TaxReturnPayload, entry: unknown = null) {
  serve(body, entry)
  render(<AdminTaxReturn />)
  await waitFor(() =>
    expect(screen.getByText('Jurisdiction US-TX')).toBeTruthy(),
  )
  return document.body.textContent ?? ''
}

describe('a finding names the rows it is about', () => {
  it('renders the invoice behind the count, not only the count', async () => {
    const text = await rendered(payload())
    // The banner still states the finding…
    expect(text).toContain('Rows billed without automatic tax')
    // …and now the row it is about is on the screen. This is the whole gap:
    // the count reached the page and the identity did not.
    expect(text).toContain(UNTAXED_INVOICE)
  })

  it('gives the row enough to act on, and a way into Stripe', async () => {
    await rendered(payload())
    const link = screen.getByText(UNTAXED_INVOICE).closest('a')
    expect(link?.getAttribute('href')).toBe(
      `https://dashboard.stripe.com/invoices/${UNTAXED_INVOICE}`,
    )
    // A cross-origin dashboard link must not hand the console's tab over.
    expect(link?.getAttribute('rel')).toContain('noopener')
    const row = screen.getByText(UNTAXED_INVOICE).closest('tr')?.textContent ?? ''
    expect(row).toContain('US-TX')
    expect(row).toContain('25.00')
    expect(row).toContain('2026-09-18')
  })

  it('THE CONTROL: a response with no per-row findings says so', async () => {
    // The one state that must NOT read as a clean finding. A count with no
    // rows beside it and a finding with no rows look identical in a table and
    // mean opposite things, and on this page the difference is money owed to
    // a state.
    const text = await rendered(
      payload({ rows: [{ ...UNTAXED_ROW, findings: undefined }] }),
    )
    expect(text).toContain('This response cannot name these rows')
    expect(text).not.toContain(UNTAXED_INVOICE)
  })

  it('names the rows behind the BLOCKING undated finding too', async () => {
    // Those rows are in no period query by definition, so they are in no other
    // list on the payload. A card that filtered `rows` alone would answer
    // "none" for the finding that stops a return being filed at all.
    const undatedInvoice = 'in_syntheticundatedrow'
    const text = await rendered(
      payload({
        undatedRows: 1,
        undated: {
          rows: [
            {
              ...UNTAXED_ROW,
              invoiceId: undatedInvoice,
              paidAt: null,
              automaticTax: true,
              findings: ['rowsMissingPaidAt'],
            },
          ],
        },
      }),
    )
    expect(text).toContain('Rows outside every period')
    expect(text).toContain(undatedInvoice)
  })
})

describe('rows removed from the return are still accounted for', () => {
  it('says what was excluded rather than letting a count vanish', async () => {
    const text = await rendered(
      payload({
        rows: [],
        summary: {
          ...payload().summary,
          transactionCount: 0,
          totalSalesCents: 0,
          byJurisdiction: {},
          internal: {
            transactionCount: 1,
            totalSalesCents: 2500,
            taxableSalesCents: 0,
            taxCollectedCents: 0,
            byJurisdiction: {
              'US-TX': {
                transactionCount: 1,
                totalSalesCents: 2500,
                taxableSalesCents: 0,
                taxCollectedCents: 0,
                taxabilityReasons: {},
                rates: [],
              },
            },
          },
          attention: {
            ...payload().summary.attention,
            untaxedRows: 0,
            internalRows: 1,
          },
        },
      }),
    )
    // The period is clean — and it says WHY it is clean, rather than leaving
    // an operator who watched a count fall to zero wondering what broke.
    expect(text).toContain('Aglyn’s own purchases')
    expect(text).toContain('excluded from every figure')
    // A jurisdiction whose only rows were internal is in no filed figure, so
    // the audit table must not report the period as having no invoices while
    // an excluded row sits behind it.
    expect(text).toContain('Nothing filed — all internal')
  })
})

describe('Item 3 says whether its figure was computed or typed', () => {
  it('reads “not computed” when nobody has entered one', async () => {
    await rendered(payload(), null)
    const row = screen.getByText('Taxable purchases').closest('tr')?.textContent ?? ''
    expect(row).toContain('not computed')
    // The assertion that matters most in this file: never a zero.
    expect(row).not.toContain('0.00')
  })

  it('reads an entered figure, marked as entered', async () => {
    /*
     * On BOTH surfaces, because both read the same stored document: the form
     * line comes from the return's own payload, and the entry card from
     * `/api/admin/tax-purchases`. A fixture that set only one would assert
     * half the mechanism and pass while the form still printed "not computed"
     * over a figure somebody had entered.
     */
    const entry = {
      period: '2026-Q3',
      amountCents: 41_290,
      amountDollars: '412.90',
      note: 'From the Q3 expense ledger',
      enteredAt: '2026-10-05T00:00:00.000Z',
      enteredBy: 'filer@aglyn.com',
    }
    const text = await rendered(payload({ taxablePurchases: entry }), entry)
    const row = screen.getByText('Taxable purchases').closest('tr')?.textContent ?? ''
    expect(row).toContain('412.90')
    // Provenance travels WITH the figure. Same column, same font, same
    // authority as a computed line — without the mark it is a number somebody
    // later defends as derived.
    expect(row).toContain('Entered, not computed')
    expect(text).toContain('filer@aglyn.com')
  })
})
