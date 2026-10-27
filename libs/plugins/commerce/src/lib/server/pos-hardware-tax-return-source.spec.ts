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
 *
 * @jest-environment node
 */

/**
 * The hardware shop's section of the operator's sales tax return (AGL-4038):
 * what a preparer reads, worded for the filing jurisdiction, and what the
 * reader takes from `posHardwareSales` for one period.
 */

const mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockQuery(name, []),
      }),
    }),
  },
}))

/** The few query shapes the reader uses, over numbers and nulls. */
function mockQuery(name: string, filters: Array<(data: Record<string, unknown>) => boolean>): any {
  const matched = () =>
    [...mockDocs.entries()]
      .filter(([path]) => path.startsWith(`${name}/`))
      .filter(([, data]) => filters.every((filter) => filter(data)))
  return {
    where: (field: string, op: string, value: unknown) =>
      mockQuery(name, [
        ...filters,
        (data) => {
          const held = data[field] ?? null
          if (op === '==') return held === value
          if (typeof held !== 'number' || typeof value !== 'number') return false
          if (op === '>=') return held >= value
          if (op === '<') return held < value
          return false
        },
      ]),
    count: () => ({ get: async () => ({ data: () => ({ count: matched().length }) }) }),
    limit: (count: number) => ({
      get: async () => {
        const rows = matched().slice(0, count)
        return { size: rows.length, docs: rows.map(([path, data]) => ({ id: path.split('/').pop(), data: () => data })) }
      },
    }),
  }
}

import type { TaxReturnSourceRequest } from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import type { PosHardwareTaxRowInput, PosHardwareTaxSummary } from '../model/pos-hardware-tax-summary'
import { posHardwareTaxReturnAnswer, readPosHardwareTaxReturn } from './pos-hardware-tax-return-source'

const TEXAS: TaxReturnSourceRequest = {
  period: '2026-Q4',
  start: new Date(Date.UTC(2026, 9, 1)),
  end: new Date(Date.UTC(2027, 0, 1)),
  filing: { code: 'US-TX', label: 'Texas', form: 'tx-webfile', figuresName: 'Items 1–3' },
  rowCap: 2000,
}

const ms = (iso: string) => Date.parse(iso)

const texasSale: PosHardwareTaxRowInput = {
  orderId: 'hw_tx',
  totalCents: 25_027,
  taxCents: 1_907,
  shipTo: { country: 'US', state: 'TX', postalCode: '78701' },
  automaticTax: true,
  taxLines: [{ amountCents: 1_907, taxableAmountCents: 23_120, taxRateId: 'txr_tx' }],
  status: 'delivered',
  livemode: true,
  paidAtMs: ms('2026-11-03T15:00:00Z'),
}

const illinoisRefund: PosHardwareTaxRowInput = {
  orderId: 'hw_il',
  totalCents: 14_000,
  taxCents: 0,
  shipTo: { country: 'US', state: 'IL' },
  automaticTax: true,
  taxLines: [{ amountCents: 0, taxableAmountCents: 0, taxabilityReason: 'not_collecting' }],
  status: 'canceled',
  livemode: true,
  paidAtMs: ms('2026-09-20T00:00:00Z'),
  refundedCents: 14_000,
  canceledAtMs: ms('2026-10-02T00:00:00Z'),
}

const answerFor = (rows: PosHardwareTaxRowInput[], request = TEXAS) =>
  posHardwareTaxReturnAnswer({ rows, truncated: false, undatedRows: 0 }, request)

beforeEach(() => mockDocs.clear())

describe('the hardware section of the return', () => {
  it('is its own card, the operator’s own sales, and says none of it is in the figures', () => {
    const answer = answerFor([texasSale])
    expect(answer).toMatchObject({ id: 'posHardware', name: 'Card reader hardware', truncated: false, undatedRows: 0 })
    expect(answer.title).toContain('own sales')
    expect(answer.intro).toContain('none of this is in the Webfile figures above')
  })

  it('states what to add to Items 1 and 2, the tax, and the period’s refunds, from the Texas orders alone', () => {
    const answer = answerFor([texasSale, illinoisRefund])
    expect(answer.filingLines.map((line) => [line.item, line.dollars])).toEqual([
      ['Item 1 (add)', '231.20'],
      ['Item 2 (add)', '231.20'],
      ['—', '19.07'],
      // The Illinois cancel is a refund of this period, but not a Texas one.
      ['—', '0.00'],
    ])
    expect(answer.filingLines[0].label).toBe('Texas card reader hardware sales (NOT in Item 1 above)')
  })

  it('raises a review finding while hardware sold into Texas, so the figures are never read as the whole', () => {
    const findings = answerFor([texasSale]).findings
    expect(findings.find((finding) => finding.id === 'posHardwareSalesNotInFigures')).toMatchObject({
      severity: 'review',
      count: 23_120,
    })
    // Nothing else to say about a clean Texas sale.
    expect(findings.filter((finding) => finding.count > 0).map((finding) => finding.id)).toEqual([
      'posHardwareSalesNotInFigures',
    ])
    expect(answerFor([illinoisRefund]).findings.every((finding) => finding.count === 0)).toBe(true)
  })

  it('lists every ship-to state, Texas first, with the period’s refunds beside the sales', () => {
    const [table] = answerFor([illinoisRefund, texasSale]).tables
    expect(table.columns.map((column) => column.label)).toEqual([
      'Ship-to state',
      'Orders',
      'Total sales',
      'Taxable sales',
      'Tax collected',
      'Refunded in period',
      'Tax refunded',
    ])
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ['US-TX', '1', '$231.20', '$231.20', '$19.07', '$0.00', '$0.00'],
      ['US-IL', '0', '$0.00', '$0.00', '$0.00', '$140.00', '$0.00'],
    ])
    expect(table.rows[0].cells[0].tag).toEqual({ label: 'Registered', tone: 'attention' })
  })

  it('words the lines for a jurisdiction with no form of its own', () => {
    const answer = answerFor([{ ...texasSale, shipTo: { country: 'GB' } }], {
      ...TEXAS,
      filing: { code: 'GB', label: 'GB', form: 'breakdown', figuresName: 'the breakdown' },
    })
    expect(answer.filingLines.map((line) => [line.item, line.label, line.dollars])[0]).toEqual([
      '—',
      'GB card reader hardware sales (NOT in the figures above)',
      '231.20',
    ])
  })

  it('carries every order of the period in the working papers, and no buyer', () => {
    const answer = answerFor([texasSale, illinoisRefund, { ...texasSale, orderId: 'hw_test', livemode: false }])
    expect(answer.rows).toEqual([
      expect.objectContaining({ orderId: 'hw_tx', state: 'TX', totalSalesCents: 23_120, taxableSalesCents: 23_120, inPeriodAs: 'sale' }),
      expect.objectContaining({ orderId: 'hw_il', refundedCents: 14_000, inPeriodAs: 'refund' }),
    ])
    const papers = answer.exports.find((block) => block.placement === 'sections')
    expect(papers?.rows.slice(2).map((row) => row[0])).toEqual(['hw_tx', 'hw_il'])
    expect(answer.figures).toEqual([
      expect.objectContaining({ label: 'Orders paid in this period', value: '1' }),
      expect.objectContaining({ label: 'Test-mode orders left out', value: '1' }),
    ])
  })
})

describe('reading the period from posHardwareSales', () => {
  it('reads what was paid in the period and what was refunded in it, once each', async () => {
    mockDocs.set('posHardwareSales/hw_tx', { ...texasSale })
    mockDocs.set('posHardwareSales/hw_il', { ...illinoisRefund })
    mockDocs.set('posHardwareSales/hw_old', { ...texasSale, orderId: 'hw_old', paidAtMs: ms('2026-08-01T00:00:00Z') })
    // Paid AND refunded inside the period: one order, found by two queries.
    mockDocs.set('posHardwareSales/hw_both', {
      ...texasSale,
      orderId: 'hw_both',
      status: 'refunded',
      refundedCents: 25_027,
      refundedAtMs: ms('2026-11-20T00:00:00Z'),
    })
    const answer = await readPosHardwareTaxReturn(TEXAS)
    const summary = answer.summary as PosHardwareTaxSummary
    expect(summary.orders).toBe(2)
    expect(summary.refunds.orders).toBe(2)
    expect((answer.rows as Array<{ orderId: string }>).map((row) => row.orderId).sort()).toEqual([
      'hw_both',
      'hw_il',
      'hw_tx',
    ])
    expect(answer.truncated).toBe(false)
    expect(answer.undatedRows).toBe(0)
  })

  it('reports a read past the cap, and records no period can reach', async () => {
    mockDocs.set('posHardwareSales/a', { ...texasSale })
    mockDocs.set('posHardwareSales/b', { ...texasSale })
    mockDocs.set('posHardwareSales/undated', { ...texasSale, paidAtMs: null })
    const answer = await readPosHardwareTaxReturn({ ...TEXAS, rowCap: 1 })
    // Both are the platform's to BLOCK on; the section's job is to say so.
    expect(answer.truncated).toBe(true)
    expect(answer.undatedRows).toBe(1)
  })
})
