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
  computePosDayReport,
  posDayAmount,
  posDayRangeLabel,
  posDayReportCsv,
  posDayReportIsEmpty,
  posDayReportRange,
  posDayReportSections,
  POS_DAY_REPORT_MAX_DAYS,
  type PosDayReportInput,
} from './commerce-pos-day-report'
import { computePosShiftReport } from './commerce-pos-ops'

/** The day report's arithmetic (AGL-4037), each figure against worked numbers. */

describe('the range', () => {
  const now = Date.UTC(2026, 9, 24, 3) // 22:00 on Oct 23 in Chicago (UTC−5 in October)

  it('is today in the store zone when no day is named', () => {
    const range = posDayReportRange({ nowMs: now, timeZone: 'America/Chicago' })
    expect(range).toEqual({
      ok: true,
      from: '2026-10-23',
      to: '2026-10-23',
      startMs: Date.UTC(2026, 9, 23, 5),
      endMs: Date.UTC(2026, 9, 24, 5),
      days: 1,
    })
    // The same instant is already the 24th in UTC.
    expect(posDayReportRange({ nowMs: now, timeZone: 'UTC' })).toMatchObject({ from: '2026-10-24' })
  })

  it('counts a day the clocks change in by the calendar: 25 hours in November', () => {
    const range = posDayReportRange({ from: '2026-11-01', nowMs: now, timeZone: 'America/Chicago' })
    expect('endMs' in range && range.endMs - range.startMs).toBe(25 * 3_600_000)
  })

  it(`allows ${POS_DAY_REPORT_MAX_DAYS} days and no more`, () => {
    expect(posDayReportRange({ from: '2026-10-01', to: '2026-10-31', nowMs: now, timeZone: 'UTC' })).toMatchObject({
      ok: true,
      days: 31,
    })
    expect(posDayReportRange({ from: '2026-10-01', to: '2026-11-01', nowMs: now, timeZone: 'UTC' }).ok).toBe(false)
  })

  it('refuses a malformed or impossible day and a backward range', () => {
    expect(posDayReportRange({ from: '2026-13-01', nowMs: now, timeZone: 'UTC' }).ok).toBe(false)
    expect(posDayReportRange({ from: '2026-2-1', nowMs: now, timeZone: 'UTC' }).ok).toBe(false)
    expect(posDayReportRange({ from: '2026-10-02', to: '2026-10-01', nowMs: now, timeZone: 'UTC' }).ok).toBe(false)
  })

  it('reads as one day or a span', () => {
    expect(posDayRangeLabel({ from: '2026-10-24', to: '2026-10-24' })).toBe('2026-10-24')
    expect(posDayRangeLabel({ from: '2026-10-24', to: '2026-10-25' })).toBe('2026-10-24 to 2026-10-25')
  })
})

function input(overrides: Partial<PosDayReportInput> = {}): PosDayReportInput {
  const range = posDayReportRange({ from: '2026-10-24', nowMs: 0, timeZone: 'UTC' })
  if ('error' in range) throw new Error('range')
  return {
    hostId: 'shop',
    storeName: 'Corner Shop',
    currency: 'usd',
    timeZone: 'UTC',
    range,
    generatedAtMs: range.startMs,
    sales: [],
    returns: [],
    shifts: [],
    registerNames: { front: 'Front', back: 'Back' },
    memberNames: { a: 'Alex', b: 'Blair' },
    ...overrides,
  }
}

const DAY = Date.UTC(2026, 9, 24)

describe('the figures', () => {
  it('is the shift calculator over the whole range', () => {
    const sales = [
      { channel: 'pos', registerId: 'front', cashierId: 'a', status: 'paid', totals: { totalCents: 1000, taxCents: 80 } },
      {
        registerId: 'back',
        cashierId: 'b',
        status: 'paid',
        totals: { totalCents: 2500, tipCents: 300 },
        payments: [
          { id: 'x', method: 'folio', amountCents: 1000, status: 'succeeded', reservationId: 'r' },
          { id: 'y', method: 'card_keyed', amountCents: 1500, tipCents: 300, status: 'succeeded' },
        ],
      },
    ]
    const report = computePosDayReport(input({ sales }))
    const shift = computePosShiftReport({ shift: { openingFloatCents: 0, cashEvents: [] }, sales, refunds: [] })
    expect(report.totals.grossSalesCents).toBe(shift.grossSalesCents)
    expect(report.totals.tipsCents).toBe(300)
    expect(report.totals.salesByTender).toEqual({ cash: 1000, folio: 1000, card_keyed: 1500 })
    expect(report.byTender.map((row) => row.label)).toEqual(['Cash', 'Card (keyed)', 'Room charge'])
    expect(report.byRegister.map((row) => row.name)).toEqual(['Back', 'Front'])
    expect(report.byCashier.map((row) => row.name)).toEqual(['Blair', 'Alex'])
  })

  it('names a removed register by its id and a sale with no cashier honestly', () => {
    const report = computePosDayReport(
      input({ sales: [{ registerId: 'gone', status: 'paid', totals: { totalCents: 500 } }] }),
    )
    expect(report.byRegister[0]).toMatchObject({ registerId: 'gone', name: 'gone' })
    expect(report.byCashier[0]).toMatchObject({ memberId: '', name: 'No cashier recorded' })
  })

  it('counts only the cash moved inside the range, and floats on the day their shift opened', () => {
    const report = computePosDayReport(
      input({
        shifts: [
          {
            id: 's-yesterday',
            registerId: 'front',
            status: 'closed',
            openedAtMs: DAY - 3_600_000,
            openedBy: 'a',
            openingFloatCents: 10_000,
            closedAtMs: DAY + 3_600_000,
            countedCashCents: 10_500,
            expectedCashCents: 10_000,
            varianceCents: 500,
            netSalesCents: 0,
            cashEvents: [
              { id: 'e1', type: 'paid_in', amountCents: 700, reason: 'x', by: 'a', atMs: DAY - 60_000 },
              { id: 'e2', type: 'drop', amountCents: 400, reason: '', by: 'a', atMs: DAY + 60_000 },
            ],
          },
        ],
      }),
    )
    expect(report.cash).toMatchObject({
      openingFloatCents: 0,
      paidInCents: 0,
      dropsCents: 400,
      closedShiftCount: 1,
      expectedCashCents: 10_000,
      countedCashCents: 10_500,
      varianceCents: 500,
    })
    expect(report.shifts[0]).toMatchObject({ openedByName: 'Alex', closedByName: null })
  })

  it('is empty with nothing to report', () => {
    expect(posDayReportIsEmpty(computePosDayReport(input()))).toBe(true)
    expect(
      posDayReportIsEmpty(computePosDayReport(input({ sales: [{ status: 'paid', totals: { totalCents: 1 } }] }))),
    ).toBe(false)
  })
})

describe('the export', () => {
  it('writes amounts in the store currency’s own minor units', () => {
    expect(posDayAmount(1234, 'usd')).toBe('12.34')
    expect(posDayAmount(1200, 'jpy')).toBe('1200')
    expect(posDayAmount(-50, 'usd')).toBe('-0.50')
    expect(posDayAmount(null, 'usd')).toBe('')
  })

  it('never lets a register name run as a formula', () => {
    const csv = posDayReportCsv(
      computePosDayReport(
        input({
          registerNames: { front: '=HYPERLINK("x")' },
          sales: [{ registerId: 'front', status: 'paid', totals: { totalCents: 100 } }],
        }),
      ),
    )
    expect(csv).toContain(`Register,"'=HYPERLINK(""x"")"`)
  })

  it('prints the sections a manager reads, with Short when the drawers came up short', () => {
    const report = computePosDayReport(
      input({
        shifts: [
          {
            id: 's1',
            registerId: 'front',
            status: 'closed',
            openedAtMs: DAY + 1,
            openedBy: 'a',
            openingFloatCents: 0,
            closedAtMs: DAY + 2,
            countedCashCents: 900,
            expectedCashCents: 1000,
            varianceCents: -100,
            netSalesCents: 1000,
            cashEvents: [],
          },
        ],
      }),
    )
    const sections = posDayReportSections(report, (cents) => String(cents))
    expect(sections.map((section) => section.section)).toEqual(['Sales', 'By tender', 'Cash drawers'])
    expect(sections[2]!.rows.find((row) => row.strong)).toEqual({ label: 'Short', value: '-100', strong: true })
  })
})
