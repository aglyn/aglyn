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
 * THE PAGE SAYS WHICH AUTHORITY IT IS FOR.
 *
 * This software computes tax for whoever runs it: on a `mode: 'stripe'` store
 * the shopper's tax is computed against the PLATFORM's Stripe registrations
 * and settles into the platform's balance, which makes a self-host operator
 * the marketplace facilitator for those sales exactly as this software's own
 * deployment is. The reporting half assumed one jurisdiction — the heading,
 * the form lines and the export were Texas's, and nothing on the screen said
 * so — so an operator filing in California or the United Kingdom read their
 * own figures under a Comptroller's form and had no way to notice.
 *
 * ASSERTED BY RENDERING. A view model returning the right labels while the
 * page renders the old ones is precisely the state the defect was in, so every
 * claim below is looked up in the DOM.
 *
 * Every identifier here is SYNTHETIC. This repository is public and
 * `check-no-tax-identifiers` refuses real registration numbers in tracked
 * source; what these assert is the mechanism, never a value.
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
// The layout renders its header here, unlike the pass-through the sibling
// suites use: the page title is one of the three surfaces that must name the
// jurisdiction, so a mock that dropped it would leave that claim untested.
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    header,
    children,
  }: {
    header?: { children?: ReactNode }
    children?: ReactNode
  }) => (
    <div>
      <h1>{header?.children}</h1>
      {children}
    </div>
  ),
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

/** Figures distinct per jurisdiction, so a total can only be its own. */
function payloadFor(
  registration: TaxReturnPayload['registration'],
): TaxReturnPayload {
  return {
    period: '2026-Q3',
    truncated: false,
    undatedRows: 0,
    rows: [],
    registration,
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 2,
      totalSalesCents: 30_000,
      taxableSalesCents: 30_000,
      taxCollectedCents: 2_700,
      byJurisdiction: {
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 10_000,
          taxableSalesCents: 10_000,
          taxCollectedCents: 900,
          taxabilityReasons: {},
          rates: [],
        },
        'US-CA': {
          transactionCount: 1,
          totalSalesCents: 20_000,
          taxableSalesCents: 20_000,
          taxCollectedCents: 1_800,
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
        untaxedRows: 0,
        internalRows: 0,
        untaxedRowsBeforeObligation: 0,
        rowsMissingTaxableBase: 0,
        rowsMissingAddress: 0,
        nonUsdRows: 0,
        rowsMissingPaidAt: 0,
        rowsWithNetMismatch: 0,
      },
    },
  } as TaxReturnPayload
}

function serve(payload: TaxReturnPayload) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as never
}

/**
 * Waits for the jurisdiction chip, which renders only once a response has
 * arrived: the headings render immediately with a placeholder underneath, so
 * waiting on one would assert against an empty card and pass for the wrong
 * reason.
 */
async function rendered(payload: TaxReturnPayload, code: string) {
  serve(payload)
  render(<AdminTaxReturn />)
  await waitFor(() =>
    expect(screen.getByText(`Jurisdiction ${code}`)).toBeTruthy(),
  )
  return document.body.textContent ?? ''
}

/** One filing line's own row, so a figure is read against its own label. */
function filingRow(label: string): string {
  return screen.getByText(label).closest('tr')?.textContent ?? ''
}

describe('a jurisdiction with its own exporter — Texas', () => {
  const texas = payloadFor({
    jurisdiction: 'US-TX',
    registrationId: '00000000000',
    filingId: 'RT000000',
  })

  it('files Form 01-114 from the Texas bucket, and names Texas', async () => {
    const text = await rendered(texas, 'US-TX')
    expect(text).toContain('Texas Sales Tax Return')
    expect(text).toContain('Form 01-114 figures — Texas only')
    // 100.00 is the US-TX bucket and 200.00 is US-CA. Read off the line's OWN
    // row rather than the whole page, where both appear on the by-jurisdiction
    // table below and either would satisfy a `toContain`.
    expect(filingRow('Total Texas sales')).toContain('100.00')
    // A jurisdiction that HAS an exporter is not hedged as a breakdown.
    expect(text).not.toContain('A breakdown for manual filing')
  })

  it('labels the registration in the Comptroller’s own words', async () => {
    const text = await rendered(texas, 'US-TX')
    expect(text).toContain('Webfile number RT000000')
    expect(text).toContain('Taxpayer number 00000000000')
  })
})

describe('a jurisdiction with no exporter — the generic breakdown', () => {
  const california = payloadFor({
    jurisdiction: 'US-CA',
    registrationId: 'CDTFA-000000',
    filingId: null,
  })

  it('names the configured jurisdiction in the title and beside the period', async () => {
    const text = await rendered(california, 'US-CA')
    expect(text).toContain('US-CA Sales Tax Return')
  })

  it('renders that jurisdiction’s figures, not Texas’s', async () => {
    const text = await rendered(california, 'US-CA')
    expect(text).toContain('Return breakdown — US-CA only')
    expect(filingRow('Total sales in US-CA')).toContain('200.00')
    // Texas's form and its lines are gone from the return figures entirely.
    expect(text).not.toContain('Form 01-114')
    expect(text).not.toContain('Total Texas sales')
  })

  it('says on the screen that it is NOT a submittable return', async () => {
    // The one thing a breakdown must never be mistaken for. It is stated on
    // the page as well as in the export, because only one of the two gets
    // looked at twice.
    const text = await rendered(california, 'US-CA')
    expect(text).toContain('A breakdown for manual filing — not a US-CA return')
    expect(text).toMatch(/No form for this jurisdiction is known here/i)
  })

  it('labels the registration generically, and omits an absent filing ID', async () => {
    const text = await rendered(california, 'US-CA')
    expect(text).toContain('Registration number CDTFA-000000')
    // No empty "Filing ID" line where the jurisdiction issues none.
    expect(text).not.toContain('Filing ID ')
  })
})

describe('the not-configured state names what to set', () => {
  it('names the generic variables, and the deprecated Texas ones, for Texas', async () => {
    const text = await rendered(payloadFor({ jurisdiction: 'US-TX' }), 'US-TX')
    expect(text).toContain('Registration not configured for US-TX')
    expect(text).toContain('AGLYN_TAX_REGISTRATION_ID')
    expect(text).toContain('AGLYN_TAX_FILING_ID')
    // The live deployment configures these; a message that failed to mention
    // them would read as "your registration is gone" after an upgrade.
    expect(text).toContain('TX_TAXPAYER_NUMBER')
    expect(text).toContain('TX_WEBFILE_NUMBER')
  })

  it('does not send a non-Texas operator hunting for Texas variables', async () => {
    const text = await rendered(payloadFor({ jurisdiction: 'GB' }), 'GB')
    expect(text).toContain('Registration not configured for GB')
    expect(text).toContain('AGLYN_TAX_REGISTRATION_ID')
    expect(text).not.toContain('TX_TAXPAYER_NUMBER')
    expect(text).not.toContain('TX_WEBFILE_NUMBER')
  })

  it('BLOCKS on a jurisdiction key that matches nothing, rather than reading zero', async () => {
    // Every figure on this page is 0.00 under a key no bucket can match, and
    // a page of honest-looking zeros is the worst possible way to say so.
    const text = await rendered(payloadFor({ jurisdiction: 'TEXAS' }), 'TEXAS')
    expect(text).toMatch(/Do not file/i)
    expect(text).toContain(
      'Configured filing jurisdiction is not a jurisdiction key',
    )
    expect(text).toContain('AGLYN_TAX_JURISDICTION')
  })
})
