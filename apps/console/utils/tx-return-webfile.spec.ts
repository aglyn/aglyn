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
  centsToDollars,
  defaultTaxReturnPeriod,
  taxReturnAttention,
  taxReturnCsv,
  taxReturnCsvFilename,
  taxReturnJurisdictionRows,
  taxReturnPeriodOptions,
  taxReturnWebfileLines,
  TX_JURISDICTION,
  type TaxReturnPayload,
} from './tx-return-webfile'

/** A clean period: two Texas invoices, nothing unreadable. */
function cleanPayload(): TaxReturnPayload {
  return {
    period: '2026-Q3',
    truncated: false,
    undatedRows: 0,
    summary: {
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      transactionCount: 2,
      totalSalesCents: 20000,
      taxableSalesCents: 16000,
      taxCollectedCents: 1320,
      byJurisdiction: {
        'US-TX': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
        },
        'US-CA': {
          transactionCount: 1,
          totalSalesCents: 10000,
          taxableSalesCents: 8000,
          taxCollectedCents: 660,
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
    },
    rows: [
      {
        invoiceId: 'in_tx',
        orgId: 'org_a',
        paidAt: '2026-09-02T00:00:00.000Z',
        grossCents: 10660,
        taxCents: 660,
        taxableSalesCents: 8000,
        state: 'TX',
        country: 'US',
        automaticTax: true,
        refundedCents: 0,
      },
      {
        invoiceId: 'in_ca',
        orgId: 'org_b',
        paidAt: '2026-09-03T00:00:00.000Z',
        grossCents: 10660,
        taxCents: 660,
        taxableSalesCents: 8000,
        state: 'CA',
        country: 'US',
        automaticTax: true,
        refundedCents: 0,
      },
    ],
  }
}

describe('centsToDollars', () => {
  it('states cents as filing dollars', () => {
    expect(centsToDollars(123456)).toBe('1234.56')
    expect(centsToDollars(0)).toBe('0.00')
    expect(centsToDollars(5)).toBe('0.05')
  })

  it('answers 0.00 rather than NaN for an unreadable figure', () => {
    // A return that prints "NaN" is a return nobody can file.
    expect(centsToDollars(undefined)).toBe('0.00')
    expect(centsToDollars('not a number')).toBe('0.00')
  })
})

describe('taxReturnAttention', () => {
  it('reads a clean period as clean, with nothing to render', () => {
    const verdict = taxReturnAttention(cleanPayload())
    expect(verdict.clean).toBe(true)
    expect(verdict.total).toBe(0)
    expect(verdict.items).toEqual([])
  })

  // The guard, proven able to fail: flip ONE field on the clean fixture and
  // the verdict must stop being clean. Without this, `clean: true` would be
  // a constant nobody notices.
  it.each([
    ['truncated', (p: TaxReturnPayload) => (p.truncated = true), 'blocking'],
    ['undatedRows', (p: TaxReturnPayload) => (p.undatedRows = 3), 'blocking'],
    [
      'untaxedRows',
      (p: TaxReturnPayload) => (p.summary.attention.untaxedRows = 1),
      'review',
    ],
    [
      'rowsMissingTaxableBase',
      (p: TaxReturnPayload) => (p.summary.attention.rowsMissingTaxableBase = 1),
      'review',
    ],
    [
      'rowsMissingAddress',
      (p: TaxReturnPayload) => (p.summary.attention.rowsMissingAddress = 1),
      'review',
    ],
    [
      'nonUsdRows',
      (p: TaxReturnPayload) => (p.summary.attention.nonUsdRows = 1),
      'review',
    ],
    [
      'rowsMissingPaidAt',
      (p: TaxReturnPayload) => (p.summary.attention.rowsMissingPaidAt = 1),
      'review',
    ],
  ])('surfaces %s as a %s finding', (id, mutate, severity) => {
    const payload = cleanPayload()
    mutate(payload)
    const verdict = taxReturnAttention(payload)
    expect(verdict.clean).toBe(false)
    const item = verdict.items.find((entry) => entry.id === id)
    expect(item).toBeTruthy()
    expect(item.severity).toBe(severity)
    expect(item.detail.length).toBeGreaterThan(0)
  })

  it('counts undated rows at their real count, not as a flag', () => {
    const payload = cleanPayload()
    payload.undatedRows = 7
    const verdict = taxReturnAttention(payload)
    expect(verdict.blocking).toBe(7)
    expect(verdict.total).toBe(7)
  })

  it('orders blocking findings ahead of review findings', () => {
    const payload = cleanPayload()
    payload.summary.attention.nonUsdRows = 4
    payload.undatedRows = 1
    const verdict = taxReturnAttention(payload)
    expect(verdict.items.map((item) => item.id)).toEqual([
      'undatedRows',
      'nonUsdRows',
    ])
    expect(verdict.blocking).toBe(1)
    expect(verdict.review).toBe(4)
  })

  it('does NOT call "no data loaded" clean', () => {
    // Nothing read is not the same as nothing wrong.
    const verdict = taxReturnAttention(null)
    expect(verdict.clean).toBe(false)
    expect(verdict.total).toBe(0)
  })
})

describe('taxReturnWebfileLines', () => {
  it('files the TEXAS bucket, not the platform totals', () => {
    const lines = taxReturnWebfileLines(cleanPayload())
    const byLabel = Object.fromEntries(
      lines.map((line) => [line.label, line.dollars]),
    )
    // Platform totals are 200.00/160.00/13.20 across TX and CA; the return
    // must carry only Texas's half.
    expect(byLabel['Total Texas sales']).toBe('100.00')
    expect(byLabel['Taxable sales']).toBe('80.00')
    expect(byLabel['Tax collected (reconciliation)']).toBe('6.60')
    expect(byLabel['Texas transactions']).toBe('1')
  })

  it('states taxable purchases as not computed rather than as zero', () => {
    const line = taxReturnWebfileLines(cleanPayload()).find(
      (entry) => entry.label === 'Taxable purchases',
    )
    expect(line.dollars).toBeNull()
    expect(line.note).toContain('NOT COMPUTED')
  })

  it('reports 0.00 for a period with no Texas sales at all', () => {
    const payload = cleanPayload()
    delete payload.summary.byJurisdiction[TX_JURISDICTION]
    const byLabel = Object.fromEntries(
      taxReturnWebfileLines(payload).map((line) => [line.label, line.dollars]),
    )
    expect(byLabel['Total Texas sales']).toBe('0.00')
    expect(byLabel['Texas transactions']).toBe('0')
  })
})

describe('taxReturnJurisdictionRows', () => {
  it('puts Texas first, then the rest by receipts', () => {
    const payload = cleanPayload()
    payload.summary.byJurisdiction['US-NY'] = {
      transactionCount: 1,
      totalSalesCents: 90000,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
    }
    const rows = taxReturnJurisdictionRows(payload)
    expect(rows.map((row) => row.jurisdiction)).toEqual([
      'US-TX',
      'US-NY',
      'US-CA',
    ])
    expect(rows[0].isTexas).toBe(true)
    expect(rows[1].isTexas).toBe(false)
  })
})

describe('taxReturnCsv', () => {
  it('carries the figures, the credentials and the findings', () => {
    const payload = cleanPayload()
    payload.summary.attention.rowsMissingAddress = 2
    payload.truncated = true
    const csv = taxReturnCsv(payload)
    expect(csv).toContain('2026-Q3')
    expect(csv).toContain('RT974186')
    expect(csv).toContain('32077682212')
    expect(csv).toContain('Total Texas sales,100.00')
    expect(csv).toContain('Rows needing attention,3')
    expect(csv).toContain('BLOCKING,1,Period exceeded the row cap')
    expect(csv).toContain('REVIEW,2,Rows with no readable address')
    expect(csv).toContain('in_tx')
    expect(csv).toContain('in_ca')
  })

  it('says so in the file when nothing needs attention', () => {
    const csv = taxReturnCsv(cleanPayload())
    expect(csv).toContain('Rows needing attention,0')
    expect(csv).toContain('None — every row read cleanly')
    expect(csv).not.toContain('BLOCKING')
  })

  it('quotes a cell containing a comma so columns do not shift', () => {
    const payload = cleanPayload()
    payload.rows[0].orgId = 'Acme, Inc'
    expect(taxReturnCsv(payload)).toContain('"Acme, Inc"')
  })

  it('is empty with no payload rather than emitting a header that looks filed', () => {
    expect(taxReturnCsv(null)).toBe('')
  })
})

describe('taxReturnCsvFilename', () => {
  it('names the period', () => {
    expect(taxReturnCsvFilename('2026-Q4')).toBe(
      'aglyn-tx-sales-tax-2026-Q4.csv',
    )
  })

  it('refuses path characters from a period it did not choose', () => {
    expect(taxReturnCsvFilename('../../etc/passwd')).toBe(
      'aglyn-tx-sales-tax-etcpasswd.csv',
    )
  })
})

describe('taxReturnPeriodOptions', () => {
  it('starts at the registration first-taxable-sales quarter', () => {
    const options = taxReturnPeriodOptions(new Date('2026-10-15T00:00:00Z'))
    const quarters = options
      .filter((option) => option.kind === 'quarter')
      .map((option) => option.value)
    expect(quarters).toEqual(['2026-Q4', '2026-Q3'])
    // Nothing before the collection obligation — those cannot be filed.
    expect(options.some((option) => option.value.startsWith('2025'))).toBe(false)
    expect(options).not.toContainEqual(
      expect.objectContaining({ value: '2026-Q2' }),
    )
  })

  it('offers months from September 2026 only, newest first', () => {
    const months = taxReturnPeriodOptions(new Date('2026-11-05T00:00:00Z'))
      .filter((option) => option.kind === 'month')
      .map((option) => option.value)
    expect(months).toEqual(['2026-11', '2026-10', '2026-09'])
  })

  it('never offers a period that has not started', () => {
    const options = taxReturnPeriodOptions(new Date('2026-09-01T00:00:00Z'))
    expect(options.map((option) => option.value)).toEqual([
      '2026-Q3',
      '2026-09',
    ])
  })

  it('extends into the following year without losing the earlier ones', () => {
    const options = taxReturnPeriodOptions(new Date('2027-02-10T00:00:00Z'))
    const quarters = options
      .filter((option) => option.kind === 'quarter')
      .map((option) => option.value)
    expect(quarters).toEqual(['2027-Q1', '2026-Q4', '2026-Q3'])
    const months = options
      .filter((option) => option.kind === 'month')
      .map((option) => option.value)
    expect(months[0]).toBe('2027-02')
    expect(months[months.length - 1]).toBe('2026-09')
  })
})

describe('defaultTaxReturnPeriod', () => {
  it('lands on the last quarter that has fully ended', () => {
    expect(defaultTaxReturnPeriod(new Date('2027-02-10T00:00:00Z'))).toBe(
      '2026-Q4',
    )
  })

  it('falls back to the launch quarter while it is still the only one', () => {
    expect(defaultTaxReturnPeriod(new Date('2026-09-15T00:00:00Z'))).toBe(
      '2026-Q3',
    )
  })
})
