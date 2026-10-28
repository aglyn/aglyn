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
  zonedDayKey,
  zonedWallTimeToInstant,
} from '@aglyn/shared-util-timestamp/zoned-time'
import {
  computePosShiftReport,
  posCsvCell,
  posOrderTenders,
  POS_STRIPE_TENDERS,
  POS_TENDER_LABELS,
  POS_TENDER_METHODS,
  type PosCashEvent,
  type PosShift,
  type PosShiftRefund,
  type PosShiftReport,
  type PosShiftSale,
  type PosTenderMethod,
  type PosTenderSource,
} from './commerce-pos-ops'
import { currencyMinorDigits } from './order-fulfillment'

/*==========================================
 * DAY AND EVENT TOTALS (AGL-4037): every register, every shift and every
 * cashier on one site, over one day or a run of days in the store's time zone.
 *
 *   GET /api/commerce/pos-day-report?hostId=…&from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]
 *
 * The figures are the shift report's own (`computePosShiftReport`), run over
 * the range instead of over one shift, and again per register and per
 * cashier, so a day's total and the X/Z reports of its shifts can never
 * disagree on what a gross sale, a tip or a cash sale is.
 *
 * What the range holds:
 *   - SALES: register orders (`channel: 'pos'`) rung in the range, by their
 *     `createdAtMs`; online orders never count. A pending sale took nothing
 *     and a canceled one gave it back, so neither counts, as on a Z report.
 *   - REFUNDS: returns rung at a register in the range, whenever the sale was,
 *     and every other refund of a register sale given in the range: from the
 *     console's order dialog (`refund.ts`) or in the Stripe Dashboard. Those
 *     are stored as {@link PosOrderRefund} records beside the register's
 *     returns, on the day they were given, and counted as stored.
 *   - SHIFTS: every shift that opened or closed in the range, that a sale in
 *     the range was rung in, or that is still open.
 *   - THE DRAWER: the floats of the shifts that opened in the range, and the
 *     paid in, paid out, safe drops and cash refunds recorded in it.
 *
 * Pure and client-safe: the route computes with it, the console renders and
 * exports with it, and the native register mirrors these types.
 *=========================================*/

/** The route, as the console and the native register call it. */
export const POS_DAY_REPORT_ROUTE = '/api/commerce/pos-day-report'
/** The longest range one report covers: a month of trading, or a long event. */
export const POS_DAY_REPORT_MAX_DAYS = 31
/** The most sales one report reads; past it the report says it is partial. */
export const POS_DAY_REPORT_SALES_CEILING = 5000
/** The most returns one report reads per register. */
export const POS_DAY_REPORT_RETURNS_CEILING = 2000
/** The most shifts one report lists. */
export const POS_DAY_REPORT_SHIFTS_CEILING = 500

/** The sales figures every total, register row and cashier row carries. */
export interface PosDayTotals {
  orderCount: number
  /** What customers paid for the goods: order totals, tax in, tips out. */
  grossSalesCents: number
  discountsCents: number
  taxCents: number
  tipsCents: number
  refundCount: number
  refundsCents: number
  /** Gross sales less refunds. */
  netSalesCents: number
  /** Sales by tender, the shift report's keys; a tender with nothing is absent. */
  salesByTender: Partial<Record<PosTenderMethod, number>>
}

/** One tender's line: what it took, what went back to it, and the difference. */
export interface PosDayTenderRow {
  method: PosTenderMethod
  label: string
  salesCents: number
  refundsCents: number
  netCents: number
}

export interface PosDayRegisterRow extends PosDayTotals {
  registerId: string
  /** The register's name, or its id when the register has since been removed. */
  name: string
}

export interface PosDayCashierRow extends PosDayTotals {
  /** The member who rang the sales, or `''` for sales that name nobody. */
  memberId: string
  name: string
}

/** A shift in the range, as the shifts table lists it. */
export interface PosDayShiftRow {
  shiftId: string
  registerId: string
  registerName: string
  status: 'open' | 'closed'
  openedAtMs: number
  closedAtMs: number | null
  openedByName: string
  closedByName: string | null
  openingFloatCents: number
  /** The Z report's net sales, or the X report's so far while it is open. */
  netSalesCents: number
  /** The Z report's expected cash, or what the drawer should hold now while it is open. */
  expectedCashCents: number
  /** What the closing cashier counted; `null` while the shift is open. */
  countedCashCents: number | null
  /** counted − expected: positive is over, negative is short; `null` while open. */
  varianceCents: number | null
}

/** The cash drawers, summed over every register. */
export interface PosDayCash {
  /** The floats of the shifts that opened in the range. */
  openingFloatCents: number
  /** Cash taken by sales in the range (change handed back is not counted), plus cash tips. */
  cashSalesCents: number
  /** Returns paid out of a drawer in the range. */
  cashRefundsCents: number
  paidInCents: number
  paidOutCents: number
  dropsCents: number
  closedShiftCount: number
  openShiftCount: number
  /** What the closed shifts' drawers should have held when they were counted. */
  expectedCashCents: number
  /** What was counted in them. */
  countedCashCents: number
  /** counted − expected over the closed shifts: positive is over, negative is short. */
  varianceCents: number
  /** What the drawers still open should hold right now; not counted yet. */
  openExpectedCashCents: number
}

/** `GET /api/commerce/pos-day-report`'s answer. Every amount is integer minor units. */
export interface PosDayReport {
  hostId: string
  /** The site's name, as the printed report heads it. */
  storeName: string
  /** The store's currency, lower case ISO 4217 (`usd`). */
  currency: string
  /** The zone the days are counted in (the site's, else the workspace's, else UTC). */
  timeZone: string
  /** The first day, `YYYY-MM-DD`, inclusive. */
  from: string
  /** The last day, `YYYY-MM-DD`, inclusive. */
  to: string
  /** The instant the first day starts in `timeZone`. */
  startMs: number
  /** The instant after the last day ends in `timeZone` (exclusive). */
  endMs: number
  days: number
  generatedAtMs: number
  totals: PosDayTotals
  byTender: PosDayTenderRow[]
  byRegister: PosDayRegisterRow[]
  byCashier: PosDayCashierRow[]
  shifts: PosDayShiftRow[]
  cash: PosDayCash
  /** More sales, returns or shifts were in the range than one report reads. */
  truncated?: boolean
}

/*==========================================
 * THE RANGE
 *=========================================*/

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayParts(key: string): { year: number; month: number; day: number } | null {
  const match = DAY_KEY.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

export type PosDayRange =
  | { ok: true; from: string; to: string; startMs: number; endMs: number; days: number }
  | { ok: false; error: string }

/**
 * The days a report covers, as instants in the store's zone. No `from` is
 * today there; no `to` is the same day as `from`. Midnight is found on the
 * zone's own calendar, so a day a clock change falls in is 23 or 25 hours.
 */
export function posDayReportRange(input: {
  from?: unknown
  to?: unknown
  nowMs: number
  timeZone: string
}): PosDayRange {
  const rawFrom = String(input.from ?? '').trim()
  const rawTo = String(input.to ?? '').trim()
  const from = rawFrom || zonedDayKey(input.nowMs, input.timeZone)
  const to = rawTo || from
  const start = dayParts(from)
  const end = dayParts(to)
  if (!start || !end) return { ok: false, error: 'Choose the days as YYYY-MM-DD.' }
  const days =
    Math.round(
      (Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) /
        86_400_000,
    ) + 1
  if (days < 1) return { ok: false, error: 'The last day comes before the first.' }
  if (days > POS_DAY_REPORT_MAX_DAYS) {
    return { ok: false, error: `Choose ${POS_DAY_REPORT_MAX_DAYS} days or fewer.` }
  }
  return {
    ok: true,
    from,
    to,
    startMs: zonedWallTimeToInstant(start, input.timeZone),
    endMs: zonedWallTimeToInstant({ ...end, day: end.day + 1 }, input.timeZone),
    days,
  }
}

/*==========================================
 * THE FIGURES
 *=========================================*/

/** A register sale as the day report reads it. */
export interface PosDaySale extends PosShiftSale {
  registerId?: string
  cashierId?: string
  shiftId?: string
}

/** A register return as the day report reads it: its register and who rang it. */
export interface PosDayReturn extends PosShiftRefund {
  registerId: string
  cashierId?: string
}

/**
 * A refund of a register sale given AWAY from the register (AGL-4037): from
 * the console's order dialog (`refund.ts`) or in the Stripe Dashboard. Stored
 * at `hosts/{hostId}/registers/{registerId}/orderRefunds/{id}` (the register
 * the sale was rung at), written by the server in the same transaction that
 * records the refund on the order, and counted by the day report on the day
 * it was given, in the store's time zone.
 *
 * Not a return: nothing came back over the counter and no drawer moved, so no
 * shift's X or Z report reads it. Only Stripe tenders are refunded this way
 * (a register's cash and gift cards go back at the register), so its tender
 * is always a card.
 */
export interface PosOrderRefund {
  orderId: string
  registerId: string
  /** When it was given. */
  atMs: number
  refundedCents: number
  tenders: Array<{ method: PosTenderMethod; amountCents: number }>
  /** The member who gave it; null for a refund made in Stripe. */
  cashierId: string | null
  /**
   * Where it was given: the order dialog, Stripe, or the platform's staff
   * refunding a card reader sold in person at its own store (AGL-4038).
   */
  source: 'order_dialog' | 'stripe' | 'staff'
  /** Stripe's refund id when it named one. */
  stripeRefundId: string | null
}

/** The collection under a register that holds its {@link PosOrderRefund}s. */
export const POS_ORDER_REFUNDS_COLLECTION = 'orderRefunds'

const REGISTER_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The record a refund of a register sale leaves for the day report, or null
 * when the order is not a register sale (or names no register) or nothing was
 * refunded. The tender is the Stripe payment the money went back to, as the
 * order's tender ledger names it; a card when the ledger cannot say which.
 */
export function posOrderRefundRecord(input: {
  orderId: string
  order: (PosTenderSource & { registerId?: unknown }) | null | undefined
  refundedCents: number
  paymentIntentId: string | null | undefined
  cashierId: string | null
  source: PosOrderRefund['source']
  stripeRefundId?: string | null
  atMs: number
}): PosOrderRefund | null {
  const { order } = input
  if (!order || order.channel !== 'pos') return null
  const registerId = typeof order.registerId === 'string' ? order.registerId : ''
  if (!REGISTER_ID.test(registerId)) return null
  const refundedCents = whole(input.refundedCents)
  if (!(refundedCents > 0)) return null
  const stripeTenders = posOrderTenders(order).filter((tender) => POS_STRIPE_TENDERS.has(tender.method))
  const tender =
    stripeTenders.find((one) => input.paymentIntentId && one.paymentIntentId === input.paymentIntentId) ??
    stripeTenders[0]
  return {
    orderId: input.orderId,
    registerId,
    atMs: whole(input.atMs),
    refundedCents,
    tenders: [{ method: tender?.method ?? 'card_present', amountCents: refundedCents }],
    cashierId: input.cashierId || null,
    source: input.source,
    stripeRefundId: input.stripeRefundId || null,
  }
}

/** A shift in the range, with the X report of an open one already read. */
export type PosDayShift = Pick<
  PosShift,
  | 'registerId'
  | 'status'
  | 'openedAtMs'
  | 'openedBy'
  | 'openedByName'
  | 'openingFloatCents'
  | 'cashEvents'
  | 'closedAtMs'
  | 'closedBy'
  | 'closedByName'
  | 'countedCashCents'
  | 'expectedCashCents'
  | 'varianceCents'
  | 'netSalesCents'
  | 'report'
> & { id: string; liveReport?: PosShiftReport }

export interface PosDayReportInput {
  hostId: string
  storeName: string
  currency: string
  timeZone: string
  range: Extract<PosDayRange, { ok: true }>
  generatedAtMs: number
  sales: readonly PosDaySale[]
  returns: readonly PosDayReturn[]
  shifts: readonly PosDayShift[]
  /** Register id → name. */
  registerNames: Readonly<Record<string, string>>
  /** Member id → display name. */
  memberNames: Readonly<Record<string, string>>
  truncated?: boolean
}

const whole = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? number : 0
}

function totalsOf(report: PosShiftReport): PosDayTotals {
  return {
    orderCount: report.orderCount,
    grossSalesCents: report.grossSalesCents,
    discountsCents: report.discountsCents,
    taxCents: report.taxCents,
    tipsCents: report.tipsCents,
    refundCount: report.refundCount,
    refundsCents: report.refundsCents,
    netSalesCents: report.netSalesCents,
    salesByTender: report.salesByTender,
  }
}

const NO_DRAWER = { openingFloatCents: 0, cashEvents: [] as PosCashEvent[] }

/** Sales figures alone, through the shift report's calculator. */
const salesFigures = (sales: readonly PosShiftSale[], refunds: readonly PosShiftRefund[]) =>
  totalsOf(computePosShiftReport({ shift: NO_DRAWER, sales, refunds }))

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const id = key(item)
    const group = groups.get(id)
    if (group) group.push(item)
    else groups.set(id, [item])
  }
  return groups
}

/** The day report from what the route read. */
export function computePosDayReport(input: PosDayReportInput): PosDayReport {
  const { startMs, endMs } = input.range
  const inRange = (atMs: unknown) => {
    const at = Number(atMs)
    return Number.isFinite(at) && at >= startMs && at < endMs
  }
  const shifts = [...input.shifts].sort((a, b) => a.openedAtMs - b.openedAtMs || a.id.localeCompare(b.id))
  // The drawer over the range: floats counted the day their shift opened,
  // and the cash moved while the range ran.
  const openingFloatCents = shifts
    .filter((shift) => inRange(shift.openedAtMs))
    .reduce((sum, shift) => sum + whole(shift.openingFloatCents), 0)
  const cashEvents = shifts.flatMap((shift) =>
    (shift.cashEvents ?? []).filter((event) => inRange(event?.atMs)),
  )
  const overall = computePosShiftReport({
    shift: { openingFloatCents, cashEvents },
    sales: input.sales,
    refunds: input.returns,
  })

  const byTender: PosDayTenderRow[] = POS_TENDER_METHODS.filter(
    (method) => (overall.salesByTender[method] ?? 0) > 0 || (overall.refundsByTender[method] ?? 0) > 0,
  ).map((method) => {
    const salesCents = overall.salesByTender[method] ?? 0
    const refundsCents = overall.refundsByTender[method] ?? 0
    return {
      method,
      label: POS_TENDER_LABELS[method],
      salesCents,
      refundsCents,
      netCents: salesCents - refundsCents,
    }
  })

  const registerName = (id: string) => input.registerNames[id] || id || 'Unknown register'
  const salesByRegister = groupBy(input.sales, (sale) => String(sale.registerId ?? ''))
  const returnsByRegister = groupBy(input.returns, (refund) => refund.registerId)
  const registerIds = new Set([...salesByRegister.keys(), ...returnsByRegister.keys()])
  const byRegister: PosDayRegisterRow[] = [...registerIds]
    .map((registerId) => ({
      registerId,
      name: registerName(registerId),
      ...salesFigures(salesByRegister.get(registerId) ?? [], returnsByRegister.get(registerId) ?? []),
    }))
    .filter((row) => row.orderCount > 0 || row.refundCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.registerId.localeCompare(b.registerId))

  const memberName = (id: string) => (id ? input.memberNames[id] || 'Staff member' : 'No cashier recorded')
  const salesByCashier = groupBy(input.sales, (sale) => String(sale.cashierId ?? ''))
  const returnsByCashier = groupBy(input.returns, (refund) => String(refund.cashierId ?? ''))
  const cashierIds = new Set([...salesByCashier.keys(), ...returnsByCashier.keys()])
  const byCashier: PosDayCashierRow[] = [...cashierIds]
    .map((memberId) => ({
      memberId,
      name: memberName(memberId),
      ...salesFigures(salesByCashier.get(memberId) ?? [], returnsByCashier.get(memberId) ?? []),
    }))
    .filter((row) => row.orderCount > 0 || row.refundCount > 0)
    .sort((a, b) => b.netSalesCents - a.netSalesCents || a.name.localeCompare(b.name))

  const shiftRows: PosDayShiftRow[] = shifts.map((shift) => {
    const closed = shift.status === 'closed'
    const report = closed ? shift.report : shift.liveReport
    return {
      shiftId: shift.id,
      registerId: shift.registerId,
      registerName: registerName(shift.registerId),
      status: closed ? 'closed' : 'open',
      openedAtMs: whole(shift.openedAtMs),
      closedAtMs: closed && shift.closedAtMs != null ? whole(shift.closedAtMs) : null,
      openedByName: shift.openedByName || memberName(shift.openedBy),
      closedByName: closed ? shift.closedByName || (shift.closedBy ? memberName(shift.closedBy) : null) : null,
      openingFloatCents: whole(shift.openingFloatCents),
      netSalesCents: whole((closed ? shift.netSalesCents : null) ?? report?.netSalesCents),
      expectedCashCents: whole((closed ? shift.expectedCashCents : null) ?? report?.expectedCashCents),
      countedCashCents: closed && shift.countedCashCents != null ? whole(shift.countedCashCents) : null,
      varianceCents: closed && shift.varianceCents != null ? whole(shift.varianceCents) : null,
    }
  })
  const closedRows = shiftRows.filter((row) => row.status === 'closed')
  const openRows = shiftRows.filter((row) => row.status === 'open')
  const sum = (rows: PosDayShiftRow[], pick: (row: PosDayShiftRow) => number | null) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

  return {
    hostId: input.hostId,
    storeName: input.storeName,
    currency: input.currency,
    timeZone: input.timeZone,
    from: input.range.from,
    to: input.range.to,
    startMs,
    endMs,
    days: input.range.days,
    generatedAtMs: input.generatedAtMs,
    totals: totalsOf(overall),
    byTender,
    byRegister,
    byCashier,
    shifts: shiftRows,
    cash: {
      openingFloatCents: overall.openingFloatCents,
      cashSalesCents: overall.cashSalesCents,
      cashRefundsCents: overall.cashRefundsCents,
      paidInCents: overall.paidInCents,
      paidOutCents: overall.paidOutCents,
      dropsCents: overall.dropsCents,
      closedShiftCount: closedRows.length,
      openShiftCount: openRows.length,
      expectedCashCents: sum(closedRows, (row) => row.expectedCashCents),
      countedCashCents: sum(closedRows, (row) => row.countedCashCents),
      varianceCents: sum(closedRows, (row) => row.varianceCents),
      openExpectedCashCents: sum(openRows, (row) => row.expectedCashCents),
    },
    ...(input.truncated ? { truncated: true } : {}),
  }
}

/** Whether the range had nothing to report: no sale, no return, no shift. */
export function posDayReportIsEmpty(report: PosDayReport): boolean {
  return !report.totals.orderCount && !report.totals.refundCount && !report.shifts.length
}

/*==========================================
 * EXPORT
 *=========================================*/

/** Minor units as a spreadsheet number in the store's currency: `12.34`, `1200` for yen. */
export function posDayAmount(cents: number | null | undefined, currency: string): string {
  if (cents == null) return ''
  const digits = currencyMinorDigits(currency)
  return (Math.round(cents) / 10 ** digits).toFixed(digits)
}

/** The range as a reader says it: `2026-10-24` or `2026-10-24 to 2026-10-26`. */
export function posDayRangeLabel(report: Pick<PosDayReport, 'from' | 'to'>): string {
  return report.from === report.to ? report.from : `${report.from} to ${report.to}`
}

/**
 * The report as one spreadsheet: a heading block, the sales by register and
 * cashier under the total, the tenders, the shifts and the drawer — each a
 * block of its own with its own header row, amounts in the store's currency.
 */
export function posDayReportCsv(report: PosDayReport): string {
  const money = (cents: number | null | undefined) => posDayAmount(cents, report.currency)
  const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : '')
  const salesRow = (section: string, name: string, row: PosDayTotals) => [
    section,
    name,
    row.orderCount,
    money(row.grossSalesCents),
    money(row.discountsCents),
    money(row.taxCents),
    money(row.tipsCents),
    row.refundCount,
    money(row.refundsCents),
    money(row.netSalesCents),
  ]
  const blocks: unknown[][][] = [
    [
      ['Report', 'Day totals'],
      ['Days', posDayRangeLabel(report)],
      ['Time zone', report.timeZone],
      ['Currency', report.currency.toUpperCase()],
      ...(report.truncated ? [['Note', 'More activity than one report reads; the figures are partial.']] : []),
    ],
    [
      ['Section', 'Name', 'Orders', 'Gross sales', 'Discounts', 'Tax', 'Tips', 'Refunds', 'Refunded', 'Net sales'],
      salesRow('Total', 'Every register', report.totals),
      ...report.byRegister.map((row) => salesRow('Register', row.name, row)),
      ...report.byCashier.map((row) => salesRow('Cashier', row.name, row)),
    ],
    [
      ['Tender', 'Sales', 'Refunds', 'Net'],
      ...report.byTender.map((row) => [row.label, money(row.salesCents), money(row.refundsCents), money(row.netCents)]),
    ],
    [
      [
        'Shift',
        'Register',
        'Status',
        'Opened',
        'Opened by',
        'Closed',
        'Closed by',
        'Starting cash',
        'Net sales',
        'Expected cash',
        'Counted cash',
        'Variance',
      ],
      ...report.shifts.map((row) => [
        row.shiftId,
        row.registerName,
        row.status === 'open' ? 'Open' : 'Closed',
        iso(row.openedAtMs),
        row.openedByName,
        iso(row.closedAtMs),
        row.closedByName ?? '',
        money(row.openingFloatCents),
        money(row.netSalesCents),
        money(row.expectedCashCents),
        money(row.countedCashCents),
        money(row.varianceCents),
      ]),
    ],
    [
      ['Cash drawers', 'Amount'],
      ['Starting cash', money(report.cash.openingFloatCents)],
      ['Cash sales', money(report.cash.cashSalesCents)],
      ['Paid in', money(report.cash.paidInCents)],
      ['Paid out', money(report.cash.paidOutCents)],
      ['Safe drops', money(report.cash.dropsCents)],
      ['Cash refunds', money(report.cash.cashRefundsCents)],
      ['Expected in closed drawers', money(report.cash.expectedCashCents)],
      ['Counted in closed drawers', money(report.cash.countedCashCents)],
      ['Variance', money(report.cash.varianceCents)],
      ['Expected in open drawers', money(report.cash.openExpectedCashCents)],
    ],
  ]
  return blocks
    .map((rows) => rows.map((row) => row.map(posCsvCell).join(',')).join('\r\n'))
    .join('\r\n\r\n')
}

/** The report's rows as the screen, the browser print and an 80 mm printer all read them. */
export function posDayReportSections(
  report: PosDayReport,
  money: (cents: number) => string,
): Array<{ section: string; rows: Array<{ label: string; value: string; strong?: boolean }> }> {
  const t = report.totals
  const c = report.cash
  return [
    {
      section: 'Sales',
      rows: [
        { label: 'Orders', value: String(t.orderCount) },
        { label: 'Gross sales', value: money(t.grossSalesCents) },
        { label: 'Discounts', value: money(t.discountsCents) },
        { label: 'Tax', value: money(t.taxCents) },
        { label: 'Tips', value: money(t.tipsCents) },
        { label: `Refunds (${t.refundCount})`, value: money(-t.refundsCents) },
        { label: 'Net sales', value: money(t.netSalesCents), strong: true },
      ],
    },
    {
      section: 'By tender',
      rows: report.byTender.length
        ? report.byTender.map((row) => ({ label: row.label, value: money(row.netCents) }))
        : [{ label: 'No sales', value: '' }],
    },
    ...(report.byRegister.length
      ? [
          {
            section: 'By register',
            rows: report.byRegister.map((row) => ({ label: row.name, value: money(row.netSalesCents) })),
          },
        ]
      : []),
    ...(report.byCashier.length
      ? [
          {
            section: 'By cashier',
            rows: report.byCashier.map((row) => ({ label: row.name, value: money(row.netSalesCents) })),
          },
        ]
      : []),
    {
      section: 'Cash drawers',
      rows: [
        { label: 'Starting cash', value: money(c.openingFloatCents) },
        { label: 'Cash sales', value: money(c.cashSalesCents) },
        { label: 'Paid in', value: money(c.paidInCents) },
        { label: 'Paid out', value: money(-c.paidOutCents) },
        { label: 'Safe drops', value: money(-c.dropsCents) },
        { label: 'Cash refunds', value: money(-c.cashRefundsCents) },
        { label: `Expected (${c.closedShiftCount} closed)`, value: money(c.expectedCashCents) },
        { label: 'Counted', value: money(c.countedCashCents) },
        {
          label: c.varianceCents < 0 ? 'Short' : c.varianceCents > 0 ? 'Over' : 'Balanced',
          value: money(c.varianceCents),
          strong: true,
        },
        ...(c.openShiftCount
          ? [{ label: `Still open (${c.openShiftCount})`, value: money(c.openExpectedCashCents) }]
          : []),
      ],
    },
  ]
}
