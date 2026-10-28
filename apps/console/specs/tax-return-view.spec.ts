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
 * THE SALES TAX RETURN, PREPARED FOR THE STAFF APPS (AGL-3667).
 *
 * The apps draw no HTML, so `/api/admin/tax-return?view=prepared` runs the
 * page's own derivations (the verdict, the registration, the filing lines, the
 * jurisdiction table, the sources' tables) over the payload and sends what the
 * page prints. These pin that the view says what the page says: a blocking
 * finding withholds the "ready" reading, Item 3 reads "not computed" until it
 * is entered, the jurisdictions the return is not for stay off it, and a
 * source that could not be read says not to file.
 *
 * Every identifier is SYNTHETIC.
 */

import {
  TAX_RETURN_COPY,
  taxReturnExcludedNote,
  taxReturnView,
} from '../utils/tax-return-view'
import type { TaxReturnPayload } from '../utils/tx-return-webfile'

function payload(overrides: Partial<TaxReturnPayload> = {}): TaxReturnPayload {
  return {
    period: '2026-Q3',
    truncated: false,
    undatedRows: 0,
    rows: [],
    registration: {
      jurisdiction: 'US-TX',
      registrationId: 'REG-SYNTHETIC-4242',
      filingId: 'FILE-SYNTHETIC-9090',
    },
    sources: [],
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 3,
      totalSalesCents: 30000,
      taxableSalesCents: 24000,
      taxCollectedCents: 1980,
      byJurisdiction: {
        'US-TX': {
          transactionCount: 2,
          totalSalesCents: 20000,
          taxableSalesCents: 16000,
          taxCollectedCents: 1320,
          taxabilityReasons: {},
          rates: [],
        },
        'US-CA': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
          taxabilityReasons: {},
          rates: [],
        },
      },
      refunds: {
        rowsRefundedInPeriod: 1,
        refundedGrossCents: 2500,
        estimatedRefundedTaxCents: 206,
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
        untaxedRows: 0,
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

const options = { now: new Date('2026-10-13T12:00:00Z'), floor: '2026-09', defaultPeriod: '2026-Q3' }

describe('the prepared sales tax return', () => {
  it('says a period with no invoices has none, never "All 0 invoices … fully readable"', () => {
    expect(TAX_RETURN_COPY.cleanMessage(0)).toBe(
      'There are no invoices in this period, so no invoice row was read or dropped.',
    )
    expect(TAX_RETURN_COPY.cleanMessage(1)).toMatch(/^The one invoice in this period was fully readable/)
    expect(TAX_RETURN_COPY.cleanMessage(3)).toMatch(/^All 3 invoices in this period were fully readable/)
  })

  it('reads cleanly when every row was readable, and lists the periods the menu offers', () => {
    const view = taxReturnView(payload(), options)
    expect(view.verdict).toMatchObject({
      state: 'clean',
      title: TAX_RETURN_COPY.cleanTitle,
      message: TAX_RETURN_COPY.cleanMessage(3),
    })
    expect(view.title).toBe('Texas Sales Tax Return')
    expect(view.defaultPeriod).toBe('2026-Q3')
    // The quarter in progress leads the menu; the page opens on the last one that ended.
    expect(view.periods[0]).toEqual({ value: '2026-Q4', label: '2026 Q4' })
    expect(view.periods).toContainEqual({ value: '2026-Q3', label: '2026 Q3' })
    expect(view.registration).toMatchObject({
      configured: true,
      lines: expect.arrayContaining([expect.stringContaining('REG-SYNTHETIC-4242'), expect.stringContaining('FILE-SYNTHETIC-9090')]),
    })
  })

  it('withholds the ready reading while a blocking finding stands', () => {
    const view = taxReturnView(payload({ undatedRows: 2 }), options)
    expect(view.verdict.state).toBe('blocking')
    expect(view.verdict.title).toBe(TAX_RETURN_COPY.blockingTitle(2))
    expect(view.verdict.items.some((item) => item.severity === 'blocking')).toBe(true)
    expect(view.figures.blocked).toBe(true)
    expect(view.figures.blockedNote).toBe(TAX_RETURN_COPY.blockedNote(true))
    expect(view.findings.map((finding) => finding.id)).toContain('undatedRows')
    expect(view.findingLabels['undatedRows']).toBe('Rows outside every period')
  })

  it('states Item 3 as not computed until somebody enters it, and as entered after', () => {
    const open = taxReturnView(payload(), options).figures.lines.find((line) => line.item === 'Item 3')
    expect(open).toMatchObject({ value: 'not computed', entered: false })
    const entered = taxReturnView(
      payload({
        taxablePurchases: {
          period: '2026-Q3',
          amountDollars: '123.45',
          note: 'From the Q3 expense ledger',
          enteredBy: 'staff@example.test',
          enteredAt: '2026-10-02T00:00:00.000Z',
        },
      } as Partial<TaxReturnPayload>),
      options,
    ).figures.lines.find((line) => line.item === 'Item 3')
    expect(entered).toMatchObject({ value: '123.45', entered: true })
    expect(entered?.note).toContain('ENTERED, not computed')
  })

  it('keeps the other jurisdictions off the return and says what it excluded', () => {
    const view = taxReturnView(payload(), options)
    const rows = view.ownSales.rows
    expect(rows.find((row) => row.jurisdiction === 'US-TX')).toMatchObject({ onReturn: true, tax: '$13.20' })
    expect(rows.find((row) => row.jurisdiction === 'US-CA')).toMatchObject({ onReturn: false, total: '$100.00' })
    expect(view.refunds.lines).toEqual([
      { label: 'Rows refunded', value: '1' },
      { label: 'Refunded gross', value: '$25.00' },
      { label: 'Estimated refunded tax', value: '$2.06' },
    ])
    const withInternal = payload()
    withInternal.summary.internal = { ...withInternal.summary.internal, transactionCount: 2 }
    expect(taxReturnExcludedNote(withInternal)).toContain('2 rows are Aglyn’s own purchases')
  })

  it('says not to file from a source it could not read', () => {
    const view = taxReturnView(
      payload({ sources: [{ outcome: 'refused', pluginId: 'commerce', id: 'sales', reason: 'The plugin did not answer.' }] } as Partial<TaxReturnPayload>),
      options,
    )
    expect(view.sources[0]).toMatchObject({ refused: true, error: TAX_RETURN_COPY.sourceRefused('The plugin did not answer.') })
    expect(view.verdict.state).toBe('blocking')
  })

  it('sends the apps what the figures are made of, the folded own sales included (AGL-4038)', () => {
    const own = {
      outcome: 'answered',
      pluginId: 'commerce',
      id: 'posHardware',
      name: 'Card reader hardware',
      title: 'Card reader hardware',
      help: '',
      intro: '',
      truncated: false,
      undatedRows: 0,
      findings: [],
      filingLines: [],
      tables: [],
      figures: [],
      exports: [],
      summary: {},
      rows: [],
      operatorSales: [
        {
          id: 'posHardwareShop',
          label: 'Card reader shop (online)',
          byJurisdiction: {
            'US-TX': {
              transactionCount: 1,
              totalSalesCents: 30000,
              taxableSalesCents: 30000,
              taxCollectedCents: 2475,
              refundCount: 0,
              refundedSalesCents: 0,
              refundedTaxCents: 0,
            },
          },
        },
      ],
    }
    const view = taxReturnView(payload({ sources: [own] } as Partial<TaxReturnPayload>), options)
    expect(view.figures.lines[0]).toMatchObject({ item: 'Item 1', value: '500.00' })
    expect(view.figures.breakdown.header).toBe(TAX_RETURN_COPY.breakdownHeader(true))
    expect(view.figures.breakdown.rows.map((row) => [row.source, row.jurisdiction, row.inFigures, row.totalSales, row.refunded])).toEqual([
      ['Aglyn invoices (subscriptions and add-ons)', 'US-TX', true, '$200.00', 'On the refunds card'],
      ['Card reader shop (online)', 'US-TX', true, '$300.00', '$0.00'],
      ['Aglyn invoices (subscriptions and add-ons)', 'US-CA', false, '$100.00', 'On the refunds card'],
    ])
  })

  it('is a breakdown, not a form, for a jurisdiction with no known form', () => {
    const view = taxReturnView(
      payload({ registration: { jurisdiction: 'US-CA', registrationId: 'REG-SYNTHETIC-1', filingId: null } } as Partial<TaxReturnPayload>),
      options,
    )
    expect(view.figures.banner).toEqual({ title: TAX_RETURN_COPY.breakdownTitle('US-CA'), text: TAX_RETURN_COPY.breakdownText })
    expect(view.purchases.applies).toBe(false)
  })
})
