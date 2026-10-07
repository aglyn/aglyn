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

import { apportionCents, type HostOrder } from './commerce-orders'
import { orderPayments } from './commerce-pos'
import type { PrintReport } from './commerce-printers'
import { receiptDataFromOrder } from './commerce-receipt'

/*==========================================
 * RUNNING THE REGISTER (AGL-3609): shifts and the cash drawer, register
 * returns and the receipt. Pure and client-safe: the routes, the register
 * and the reports all compute from these, so a drawer's expected cash is one
 * formula wherever it is shown.
 *
 * Where each thing lives:
 *
 *   hosts/{hostId}/registers/{registerId}
 *       `openShiftId` — the one open shift, claimed in a transaction
 *   hosts/{hostId}/registers/{registerId}/shifts/{shiftId}   {@link PosShift}
 *   hosts/{hostId}/registers/{registerId}/returns/{returnId} {@link PosRegisterReturn}
 *   hosts/{hostId}/posStaffPins/{uid}                         server-only
 *
 * Everything under `registers` is written by the Admin SDK only (the
 * register pool is billed), and every member of the site may read it.
 *=========================================*/

/** How one payment toward a sale was taken, in the register's tender words. */
export type PosTenderMethod =
  | 'cash'
  | 'card_present'
  | 'card_keyed'
  | 'card_link'
  | 'gift_card'
  | 'folio'

export const POS_TENDER_METHODS: readonly PosTenderMethod[] = [
  'cash',
  'card_present',
  'card_keyed',
  'card_link',
  'gift_card',
  'folio',
]

/** What each tender is called on a report, a receipt and a refund. */
export const POS_TENDER_LABELS: Readonly<Record<PosTenderMethod, string>> = {
  cash: 'Cash',
  card_present: 'Card',
  card_keyed: 'Card (keyed)',
  card_link: 'Card (payment link)',
  gift_card: 'Gift card',
  folio: 'Room charge',
}

/** The tenders whose money moved through Stripe and goes back through it. */
export const POS_STRIPE_TENDERS: ReadonlySet<PosTenderMethod> = new Set([
  'card_present',
  'card_keyed',
  'card_link',
])

/**
 * One settled payment toward a sale, as the shift report and a register
 * return read it.
 */
export interface PosOrderTender {
  /** The payment's id on the order, or `legacy` for an order before the tender ledger. */
  id: string
  method: PosTenderMethod
  /** Cents put toward the sale; never the tip, never the change. */
  amountCents: number
  tipCents: number
  paymentIntentId?: string
  giftCardId?: string
  reservationId?: string
  cardBrand?: string
  last4?: string
  cashTenderedCents?: number
  changeCents?: number
}

const wholeCents = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}


const isTenderMethod = (value: unknown): value is PosTenderMethod =>
  typeof value === 'string' && (POS_TENDER_METHODS as readonly string[]).includes(value)

/** The order fields the tender reader looks at. */
export interface PosTenderSource {
  payments?: unknown
  channel?: string
  status?: string
  totals?: { totalCents?: number; tipCents?: number } | null
  amountCents?: number
  reservationId?: string
  checkoutSessionId?: string
  paymentIntentId?: string
}

/**
 * THE ONE PLACE THE TENDER LEDGER IS READ (AGL-3609).
 *
 * A register sale may carry `payments[]` — one entry per tender, the ledger
 * the split-tender register writes (AGL-3607) — and only the payments that
 * SUCCEEDED count: a declined card or a voided gift card took nothing. An
 * order written before that ledger is one payment, inferred the way the
 * ledger's own reader infers it: a folio when it names a reservation, a card
 * link when Stripe saw it (or it came through the storefront), cash otherwise.
 *
 * The ledger's own reader (`orderPayments`) does both; this narrows it to the
 * settled payments and the fields a report or a refund reads.
 */
export function posOrderTenders(order: PosTenderSource | null | undefined): PosOrderTender[] {
  if (!order) return []
  return orderPayments(order as Parameters<typeof orderPayments>[0])
    .filter((payment) => payment.status === 'succeeded' && isTenderMethod(payment.method))
    .map((payment) => ({
      id: payment.id,
      method: payment.method as PosTenderMethod,
      amountCents: wholeCents(payment.amountCents),
      tipCents: wholeCents(payment.tipCents ?? (payment.id === 'legacy' ? order.totals?.tipCents : 0)),
      ...(payment.paymentIntentId ? { paymentIntentId: payment.paymentIntentId } : {}),
      ...(payment.giftCardId ? { giftCardId: payment.giftCardId } : {}),
      ...(payment.reservationId ? { reservationId: payment.reservationId } : {}),
      ...(payment.cardBrand ? { cardBrand: payment.cardBrand } : {}),
      ...(payment.last4 ? { last4: payment.last4 } : {}),
      ...(payment.cashTenderedCents != null ? { cashTenderedCents: wholeCents(payment.cashTenderedCents) } : {}),
      ...(payment.changeCents != null ? { changeCents: wholeCents(payment.changeCents) } : {}),
    }))
}

/** A tender as one line of a receipt: `Card •• 4242`. */
export function posTenderLabel(tender: Pick<PosOrderTender, 'method' | 'cardBrand' | 'last4'>): string {
  const base = POS_TENDER_LABELS[tender.method] ?? tender.method
  if (tender.last4) {
    return `${tender.cardBrand ? capitalize(tender.cardBrand) : base} •• ${tender.last4}`
  }
  return base
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

/*==========================================
 * SHIFTS AND THE CASH DRAWER
 *=========================================*/

/**
 * Cash that moved through the drawer without a sale: money put in, money
 * paid out for a reason (a delivery, petty cash), a drop to the safe, and
 * a register return paid out in cash.
 */
export type PosCashEventType = 'paid_in' | 'paid_out' | 'drop' | 'refund'

export const POS_CASH_EVENT_LABELS: Readonly<Record<PosCashEventType, string>> = {
  paid_in: 'Paid in',
  paid_out: 'Paid out',
  drop: 'Safe drop',
  refund: 'Cash refund',
}

export interface PosCashEvent {
  /** The register's attempt id, so a retried tap records one event. */
  id: string
  type: PosCashEventType
  amountCents: number
  reason: string
  /** The member who moved the cash. */
  by: string
  atMs: number
  /** The order a `refund` paid out against. */
  orderId?: string
}

/** Sales, refunds and cash movements over one shift. */
export interface PosShiftReport {
  orderCount: number
  /** What customers paid for the goods: order totals, tax in, tips out. */
  grossSalesCents: number
  discountsCents: number
  taxCents: number
  tipsCents: number
  salesByTender: Partial<Record<PosTenderMethod, number>>
  refundCount: number
  refundsCents: number
  refundsByTender: Partial<Record<PosTenderMethod, number>>
  /** Gross sales less refunds. */
  netSalesCents: number
  openingFloatCents: number
  cashSalesCents: number
  paidInCents: number
  paidOutCents: number
  dropsCents: number
  cashRefundsCents: number
  /** float + cash sales + paid in − paid out − drops − cash refunds. */
  expectedCashCents: number
  /** More sales were stamped with the shift than the report could read. */
  truncated?: boolean
}

/** `hosts/{hostId}/registers/{registerId}/shifts/{shiftId}`. */
export interface PosShift {
  hostId: string
  registerId: string
  status: 'open' | 'closed'
  openedBy: string
  /** The member's name when the shift opened, for the history and the export. */
  openedByName?: string
  openedAtMs: number
  openingFloatCents: number
  cashEvents: PosCashEvent[]
  closedBy?: string
  closedByName?: string
  closedAtMs?: number
  /** What the closing cashier counted in the drawer. */
  countedCashCents?: number
  expectedCashCents?: number
  /** counted − expected: positive is over, negative is short. */
  varianceCents?: number
  closingNote?: string
  /** The Z report, frozen when the shift closed. */
  report?: PosShiftReport
}

/** The cash-event sums one formula reads. */
export function posCashEventTotals(events: readonly PosCashEvent[] | null | undefined): {
  paidInCents: number
  paidOutCents: number
  dropsCents: number
  cashRefundsCents: number
} {
  const sum = (type: PosCashEventType) =>
    (events ?? [])
      .filter((event) => event?.type === type)
      .reduce((total, event) => total + wholeCents(event.amountCents), 0)
  return {
    paidInCents: sum('paid_in'),
    paidOutCents: sum('paid_out'),
    dropsCents: sum('drop'),
    cashRefundsCents: sum('refund'),
  }
}

/**
 * THE DRAWER'S EXPECTED CASH: what should be in it when it is counted.
 *
 *   opening float + cash sales + paid in − paid out − safe drops − cash refunds
 *
 * Cash SALES are the cash tender's `amountCents`, which is what the sale took
 * and never what the customer handed over: the change went straight back out
 * of the same drawer. A tip left in cash is in the drawer too, so it counts.
 */
export function posExpectedCashCents(input: {
  openingFloatCents: number
  cashSalesCents: number
  paidInCents: number
  paidOutCents: number
  dropsCents: number
  cashRefundsCents: number
}): number {
  return (
    wholeCents(input.openingFloatCents) +
    wholeCents(input.cashSalesCents) +
    wholeCents(input.paidInCents) -
    wholeCents(input.paidOutCents) -
    wholeCents(input.dropsCents) -
    wholeCents(input.cashRefundsCents)
  )
}

/** A sale as the shift report reads it. */
export interface PosShiftSale extends PosTenderSource {
  totals?: {
    totalCents?: number
    discountCents?: number
    taxCents?: number
    tipCents?: number
  } | null
}

/** A register return as the shift report reads it. */
export interface PosShiftRefund {
  refundedCents: number
  tenders: Array<{ method: PosTenderMethod; amountCents: number }>
}

/**
 * The X report (mid-shift) and the Z report (at close) are this one function
 * over the sales stamped with the shift, the returns rung at the register
 * during it and the shift's own cash events. A pending sale took no money and
 * a cancelled one gave it back, so neither counts; a sale refunded LATER
 * still counts as a sale, and its refund is counted where it was paid out.
 */
export function computePosShiftReport(input: {
  shift: Pick<PosShift, 'openingFloatCents' | 'cashEvents'>
  sales: readonly PosShiftSale[]
  refunds: readonly PosShiftRefund[]
  truncated?: boolean
}): PosShiftReport {
  const salesByTender: Partial<Record<PosTenderMethod, number>> = {}
  const refundsByTender: Partial<Record<PosTenderMethod, number>> = {}
  let orderCount = 0
  let grossSalesCents = 0
  let discountsCents = 0
  let taxCents = 0
  let tipsCents = 0
  let cashSalesCents = 0
  for (const sale of input.sales) {
    if (sale.status === 'pending' || sale.status === 'cancelled') continue
    const tenders = posOrderTenders(sale)
    orderCount += 1
    grossSalesCents += wholeCents(sale.totals?.totalCents ?? sale.amountCents)
    discountsCents += wholeCents(sale.totals?.discountCents)
    taxCents += wholeCents(sale.totals?.taxCents)
    const tenderTips = tenders.reduce((sum, tender) => sum + tender.tipCents, 0)
    tipsCents += Math.max(wholeCents(sale.totals?.tipCents), tenderTips)
    for (const tender of tenders) {
      salesByTender[tender.method] = (salesByTender[tender.method] ?? 0) + tender.amountCents
      if (tender.method === 'cash') cashSalesCents += tender.amountCents + tender.tipCents
    }
  }
  let refundsCents = 0
  for (const refund of input.refunds) {
    refundsCents += wholeCents(refund.refundedCents)
    for (const tender of refund.tenders ?? []) {
      if (!isTenderMethod(tender.method)) continue
      refundsByTender[tender.method] =
        (refundsByTender[tender.method] ?? 0) + wholeCents(tender.amountCents)
    }
  }
  const cash = posCashEventTotals(input.shift.cashEvents)
  const openingFloatCents = wholeCents(input.shift.openingFloatCents)
  return {
    orderCount,
    grossSalesCents,
    discountsCents,
    taxCents,
    tipsCents,
    salesByTender,
    refundCount: input.refunds.length,
    refundsCents,
    refundsByTender,
    netSalesCents: grossSalesCents - refundsCents,
    openingFloatCents,
    cashSalesCents,
    ...cash,
    expectedCashCents: posExpectedCashCents({ openingFloatCents, cashSalesCents, ...cash }),
    ...(input.truncated ? { truncated: true } : {}),
  }
}

/** counted − expected; positive is over, negative is short. */
export function posCashVarianceCents(countedCashCents: number, expectedCashCents: number): number {
  return Math.round(Number(countedCashCents) || 0) - Math.round(Number(expectedCashCents) || 0)
}

/** `$12.34`, `-$0.50` — the register's money format, store currency USD. */
export function posMoney(cents: number): string {
  const value = Math.round(Number(cents) || 0)
  return `${value < 0 ? '-' : ''}$${(Math.abs(value) / 100).toFixed(2)}`
}

/** One CSV cell, quoted when it needs to be and never read as a formula. */
function csvCell(value: unknown): string {
  let cell = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = `'${cell}`
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

const dollars = (cents: number | undefined): string =>
  cents == null ? '' : (Math.round(cents) / 100).toFixed(2)

/** The shift history as a spreadsheet: one row per shift, money in dollars. */
export function posShiftsCsv(
  shifts: ReadonlyArray<PosShift & { id: string; registerName?: string }>,
  memberName: (uid: string) => string = (uid) => uid,
): string {
  const header = [
    'Shift',
    'Register',
    'Opened',
    'Opened by',
    'Closed',
    'Closed by',
    'Orders',
    'Gross sales',
    'Refunds',
    'Net sales',
    'Discounts',
    'Tax',
    'Tips',
    'Cash sales',
    'Card sales',
    'Gift card sales',
    'Room charges',
    'Opening float',
    'Paid in',
    'Paid out',
    'Safe drops',
    'Cash refunds',
    'Expected cash',
    'Counted cash',
    'Variance',
  ]
  const iso = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : '')
  const rows = shifts.map((shift) => {
    const report = shift.report
    const card = report
      ? (report.salesByTender.card_present ?? 0) +
        (report.salesByTender.card_keyed ?? 0) +
        (report.salesByTender.card_link ?? 0)
      : undefined
    return [
      shift.id,
      shift.registerName ?? shift.registerId,
      iso(shift.openedAtMs),
      shift.openedByName ?? memberName(shift.openedBy),
      iso(shift.closedAtMs),
      shift.closedBy ? (shift.closedByName ?? memberName(shift.closedBy)) : '',
      report?.orderCount ?? '',
      dollars(report?.grossSalesCents),
      dollars(report?.refundsCents),
      dollars(report?.netSalesCents),
      dollars(report?.discountsCents),
      dollars(report?.taxCents),
      dollars(report?.tipsCents),
      dollars(report?.cashSalesCents),
      dollars(card),
      dollars(report ? (report.salesByTender.gift_card ?? 0) : undefined),
      dollars(report ? (report.salesByTender.folio ?? 0) : undefined),
      dollars(shift.openingFloatCents),
      dollars(report?.paidInCents),
      dollars(report?.paidOutCents),
      dollars(report?.dropsCents),
      dollars(report?.cashRefundsCents),
      dollars(shift.expectedCashCents ?? report?.expectedCashCents),
      dollars(shift.countedCashCents),
      dollars(shift.varianceCents),
    ]
  })
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/*==========================================
 * RETURNS AT THE REGISTER
 *=========================================*/

/** One line picked for return: its index on the order and how many units. */
export interface PosReturnPick {
  index: number
  quantity: number
}

/** The order fields a return reads. */
export interface PosReturnSource extends PosTenderSource {
  lineItems?: Array<{ unitAmountCents?: number; quantity?: number; name?: string }> | null
  totals?: {
    totalCents?: number
    discountCents?: number
    taxCents?: number
    shippingCents?: number
    tipCents?: number
  } | null
  refundedCents?: number
  refundedLineItemIds?: number[]
  /** Units of each line already returned at a register, by line index. */
  returnedQuantities?: Record<string, number>
  /** Cents already refunded to each payment by a register return. */
  posPaymentRefunds?: Record<string, number>
}

/**
 * What each line is worth back, whole: its price less its share of the
 * order's discount, plus its share of the order's tax — the same
 * apportionment `orderLineRefundCents` uses for the discount, extended to the
 * tax a register sale charged on top. Shipping and tips are not a line's.
 */
export function posReturnLineValues(order: PosReturnSource): number[] {
  const lines = order.lineItems ?? []
  const gross = lines.map(
    (line) =>
      Math.max(0, Math.round(Number(line?.unitAmountCents ?? 0))) *
      Math.max(1, Math.round(Number(line?.quantity ?? 1))),
  )
  const discountShares = apportionCents(gross, wholeCents(order.totals?.discountCents))
  const net = gross.map((cents, index) => Math.max(0, cents - (discountShares[index] ?? 0)))
  const taxShares = apportionCents(net, wholeCents(order.totals?.taxCents))
  return net.map((cents, index) => cents + (taxShares[index] ?? 0))
}

/** Units of each line already returned, a line refunded whole counting as all of it. */
export function posReturnedQuantities(order: PosReturnSource): number[] {
  const lines = order.lineItems ?? []
  const wholeLines = new Set(order.refundedLineItemIds ?? [])
  return lines.map((line, index) => {
    const quantity = Math.max(1, Math.round(Number(line?.quantity ?? 1)))
    if (wholeLines.has(index)) return quantity
    const returned = Math.round(Number(order.returnedQuantities?.[String(index)] ?? 0))
    return Math.min(quantity, Math.max(0, Number.isFinite(returned) ? returned : 0))
  })
}

export type PosReturnPlan =
  | {
      ok: true
      refundCents: number
      /** Cents per picked line, in the order picked. */
      lineCents: number[]
      /** The order's per-line returned quantities after this return. */
      returnedQuantities: Record<string, number>
      /** Lines this return finishes, for `refundedLineItemIds`. */
      completedLines: number[]
    }
  | { ok: false; error: string }

/**
 * What a return of these picks refunds, to the cent.
 *
 * Each line's value is split across its units CUMULATIVELY: returning `k` of
 * `n` units already returned `r` refunds `round(V·(r+k)/n) − round(V·r/n)`,
 * so returning a line one unit at a time refunds exactly what returning it
 * whole would have, and the rounding never strands or invents a cent. The
 * sum is capped at what is left to refund on the order — a refund given
 * from the order dialog already took its share.
 */
export function planPosReturn(order: PosReturnSource, picks: readonly PosReturnPick[]): PosReturnPlan {
  const lines = order.lineItems ?? []
  if (!picks.length) return { ok: false, error: 'Pick at least one item to return.' }
  const values = posReturnLineValues(order)
  const returned = posReturnedQuantities(order)
  const seen = new Set<number>()
  const lineCents: number[] = []
  const nextReturned: Record<string, number> = {}
  for (const [index, count] of returned.entries()) if (count > 0) nextReturned[String(index)] = count
  const completedLines: number[] = []
  for (const pick of picks) {
    const index = Number(pick.index)
    const quantity = Number(pick.quantity)
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
      return { ok: false, error: `Line ${pick.index} is not on this order.` }
    }
    if (seen.has(index)) return { ok: false, error: 'Each line can be picked once.' }
    seen.add(index)
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, error: 'Return at least one of each line you pick.' }
    }
    const total = Math.max(1, Math.round(Number(lines[index]?.quantity ?? 1)))
    const already = returned[index] ?? 0
    if (already + quantity > total) {
      const left = total - already
      return {
        ok: false,
        error:
          left > 0
            ? `Only ${left} of "${lines[index]?.name ?? 'that item'}" can still be returned.`
            : `"${lines[index]?.name ?? 'That item'}" has already been returned.`,
      }
    }
    const value = values[index] ?? 0
    lineCents.push(
      Math.round((value * (already + quantity)) / total) - Math.round((value * already) / total),
    )
    nextReturned[String(index)] = already + quantity
    if (already + quantity === total) completedLines.push(index)
  }
  const remaining = Math.max(
    0,
    wholeCents(order.totals?.totalCents) - wholeCents(order.refundedCents),
  )
  const asked = lineCents.reduce((sum, cents) => sum + cents, 0)
  const refundCents = Math.min(asked, remaining)
  if (!(refundCents > 0)) return { ok: false, error: 'Nothing is left to refund on this order.' }
  return { ok: true, refundCents, lineCents, returnedQuantities: nextReturned, completedLines }
}

/** One slice of a refund, sent back to one of the sale's payments. */
export interface PosRefundAllocation {
  paymentId: string
  method: PosTenderMethod
  amountCents: number
}

/**
 * What each payment can still take back: what it put toward the sale, less
 * what register returns already sent to it. A refund given from the order
 * dialog refunds through Stripe without naming a payment, so whatever it
 * took that no payment accounts for comes off the Stripe payments first.
 */
export function posRefundableByTender(order: PosReturnSource): Array<PosOrderTender & { refundableCents: number }> {
  const tenders = posOrderTenders(order)
  const attributed = Object.values(order.posPaymentRefunds ?? {}).reduce(
    (sum, cents) => sum + wholeCents(cents),
    0,
  )
  let unattributed = Math.max(0, wholeCents(order.refundedCents) - attributed)
  const ordered = [...tenders].sort(
    (a, b) => Number(POS_STRIPE_TENDERS.has(b.method)) - Number(POS_STRIPE_TENDERS.has(a.method)),
  )
  const refundable = new Map<string, number>()
  for (const tender of ordered) {
    let left = Math.max(0, tender.amountCents - wholeCents(order.posPaymentRefunds?.[tender.id]))
    if (POS_STRIPE_TENDERS.has(tender.method) && unattributed > 0) {
      const taken = Math.min(left, unattributed)
      left -= taken
      unattributed -= taken
    }
    refundable.set(tender.id, left)
  }
  return tenders.map((tender) => ({ ...tender, refundableCents: refundable.get(tender.id) ?? 0 }))
}

/**
 * The order a refund goes back in, when the cashier does not split it by
 * hand: the cards first, then store credit, then the room, and the drawer
 * LAST — so cash leaves the till only for what the customer paid in cash.
 */
const REFUND_ORDER: readonly PosTenderMethod[] = [
  'card_present',
  'card_keyed',
  'card_link',
  'gift_card',
  'folio',
  'cash',
]

export type PosRefundSplit =
  | { ok: true; allocations: PosRefundAllocation[] }
  | { ok: false; error: string }

/**
 * Sends `amountCents` back to the sale's own payments.
 *
 * With no `requested` split, each payment takes what it can in
 * {@link REFUND_ORDER}. With one, every slice must name a payment of this
 * sale and fit what that payment can still take, and the slices must add up
 * to the refund exactly — a refund is never sent to a tender the sale was
 * not paid with.
 */
export function splitPosRefund(
  order: PosReturnSource,
  amountCents: number,
  requested?: ReadonlyArray<{ paymentId: string; amountCents: number }> | null,
): PosRefundSplit {
  const amount = wholeCents(amountCents)
  const tenders = posRefundableByTender(order)
  if (!tenders.length) return { ok: false, error: 'This order has no payment to refund to.' }
  if (requested && requested.length) {
    const allocations: PosRefundAllocation[] = []
    const used = new Set<string>()
    for (const slice of requested) {
      const tender = tenders.find((candidate) => candidate.id === slice.paymentId)
      if (!tender) return { ok: false, error: 'That payment is not on this order.' }
      if (used.has(tender.id)) return { ok: false, error: 'Each payment can be named once.' }
      used.add(tender.id)
      const cents = Math.round(Number(slice.amountCents))
      if (!Number.isFinite(cents) || cents < 0) return { ok: false, error: 'Refund amounts must be positive.' }
      if (cents === 0) continue
      if (cents > tender.refundableCents) {
        return {
          ok: false,
          error: `${posTenderLabel(tender)} can take back at most ${posMoney(tender.refundableCents)}.`,
        }
      }
      allocations.push({ paymentId: tender.id, method: tender.method, amountCents: cents })
    }
    const total = allocations.reduce((sum, slice) => sum + slice.amountCents, 0)
    if (total !== amount) {
      return {
        ok: false,
        error: `The refund is ${posMoney(amount)}; the split adds up to ${posMoney(total)}.`,
      }
    }
    return { ok: true, allocations }
  }
  const ordered = [...tenders].sort(
    (a, b) => REFUND_ORDER.indexOf(a.method) - REFUND_ORDER.indexOf(b.method),
  )
  const allocations: PosRefundAllocation[] = []
  let left = amount
  for (const tender of ordered) {
    if (!(left > 0)) break
    const cents = Math.min(left, tender.refundableCents)
    if (!(cents > 0)) continue
    allocations.push({ paymentId: tender.id, method: tender.method, amountCents: cents })
    left -= cents
  }
  if (left > 0) {
    return {
      ok: false,
      error: `Only ${posMoney(amount - left)} can go back to this sale's payments.`,
    }
  }
  return { ok: true, allocations }
}

/** `hosts/{hostId}/registers/{registerId}/returns/{returnId}`. */
export interface PosRegisterReturn {
  hostId: string
  registerId: string
  orderId: string
  orderNumber?: number
  /** The shift the drawer was in when the return was rung, if one was open. */
  shiftId?: string
  lines: Array<{ index: number; quantity: number; name: string; refundCents: number }>
  refundedCents: number
  tenders: Array<PosRefundAllocation & { status: 'refunded' | 'failed'; refundId?: string; error?: string }>
  restocked: boolean
  locationId?: string
  /** The member at the register (by PIN or by sign-in). */
  cashierId: string
  /** The manager whose PIN allowed a refund above the cashier's limit. */
  approvedBy?: string
  reason?: string
  status: 'refunded' | 'partial'
  atMs: number
}

/*==========================================
 * STAFF PINS
 *=========================================*/

/** How long a cashier PIN switch lasts before the register asks again. */
export const POS_CASHIER_ASSERTION_TTL_MS = 15 * 60 * 1000
/** A manager's approval is for the one refund in front of them. */
export const POS_MANAGER_ASSERTION_TTL_MS = 2 * 60 * 1000
/** Wrong PINs in a row before the member is locked out. */
export const POS_PIN_MAX_ATTEMPTS = 5
/** How long a lockout lasts. */
export const POS_PIN_LOCKOUT_MS = 15 * 60 * 1000

/**
 * Why a PIN cannot be used, or `null` when it can: 4 to 6 digits, and not
 * one a stranger tries first — every digit the same, or a straight run.
 */
export function posPinProblem(pin: unknown): string | null {
  const value = typeof pin === 'string' ? pin : ''
  if (!/^\d{4,6}$/.test(value)) return 'A PIN is 4 to 6 digits.'
  if (/^(\d)\1+$/.test(value)) return 'Pick a PIN that is not one digit repeated.'
  const digits = [...value].map(Number)
  const step = (digits[1] ?? 0) - (digits[0] ?? 0)
  if (
    (step === 1 || step === -1) &&
    digits.every((digit, index) => index === 0 || digit - (digits[index - 1] ?? 0) === step)
  ) {
    return 'Pick a PIN that is not a straight run like 1234.'
  }
  return null
}

/*==========================================
 * THE THERMAL RECEIPT
 *=========================================*/

export interface PosReceiptLine {
  name: string
  variantLabel?: string
  quantity: number
  unitAmountCents: number
  lineCents: number
}

export interface PosReceipt {
  storeName: string
  logoUrl?: string
  addressLines: string[]
  orderNumber: string
  /** The digits the barcode encodes and the register's return lookup reads. */
  barcodeValue: string
  dateLabel: string
  cashierName?: string
  registerName?: string
  customerName?: string
  lines: PosReceiptLine[]
  subtotalCents: number
  discountCents: number
  taxCents: number
  totalCents: number
  tipCents: number
  tenders: Array<{ label: string; amountCents: number }>
  changeCents: number
  refundedCents: number
  footer?: string
  returnPolicy?: string
  /** A gift receipt: the items and nothing about what they cost. */
  gift: boolean
}

/** The order fields a receipt prints. */
export interface PosReceiptOrder extends PosReturnSource {
  number?: number
  createdAtMs?: number
  customerName?: string | null
  lineItems?: Array<{
    name?: string
    variantLabel?: string
    unitAmountCents?: number
    quantity?: number
  }> | null
}

/**
 * The receipt for one sale, from the order alone plus what the store prints
 * on every receipt. The sale's lines, totals, tenders and change are the
 * receipt model's (`receiptDataFromOrder`, the one the cloud printers print
 * from), so a browser print and a cloud print never disagree; this adds the
 * logo, the address, the return policy and the gift receipt. A gift receipt
 * keeps the lines and the barcode — the recipient's way to return — and
 * drops every price, total and tender.
 */
export function buildPosReceipt(input: {
  orderId: string
  order: PosReceiptOrder
  store: {
    name: string
    logoUrl?: string
    address?: string
    footer?: string
    returnPolicy?: string
  }
  cashierName?: string
  registerName?: string
  gift?: boolean
  /** How the date prints; the register's own locale by default. */
  formatDate?: (ms: number) => string
}): PosReceipt {
  const { order } = input
  const gift = input.gift === true
  const data = receiptDataFromOrder(input.orderId, order as unknown as HostOrder & Record<string, any>, {
    storeName: input.store.name,
  })
  const lines: PosReceiptLine[] = data.lines.map((line) => ({
    name: line.name,
    ...(line.detail ? { variantLabel: line.detail } : {}),
    quantity: line.quantity,
    unitAmountCents: gift ? 0 : line.unitCents,
    lineCents: gift ? 0 : line.totalCents,
  }))
  const number = Number(order.number)
  const digits = Number.isInteger(number) && number > 0 ? String(number) : ''
  const createdAtMs = Number(order.createdAtMs) || 0
  const formatDate =
    input.formatDate ?? ((ms: number) => (ms ? new Date(ms).toLocaleString() : ''))
  const money = (cents: number | undefined) => (gift ? 0 : wholeCents(cents))
  return {
    storeName: input.store.name,
    ...(input.store.logoUrl ? { logoUrl: input.store.logoUrl } : {}),
    addressLines: String(input.store.address ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    orderNumber: digits ? `#${digits}` : `#${input.orderId.slice(0, 8)}`,
    barcodeValue: digits || input.orderId,
    dateLabel: formatDate(createdAtMs),
    ...(input.cashierName ? { cashierName: input.cashierName } : {}),
    ...(input.registerName ? { registerName: input.registerName } : {}),
    ...(order.customerName ? { customerName: String(order.customerName) } : {}),
    lines,
    subtotalCents: money(data.subtotalCents),
    discountCents: money(data.discountCents),
    taxCents: money(data.taxCents),
    totalCents: money(data.totalCents),
    tipCents: money(data.tipCents),
    tenders: gift ? [] : (data.tenders ?? []),
    changeCents: money(data.changeCents),
    refundedCents: money(data.refundedCents),
    ...(input.store.footer ? { footer: input.store.footer } : {}),
    ...(input.store.returnPolicy ? { returnPolicy: input.store.returnPolicy } : {}),
    gift,
  }
}

/** One titled block of an X or Z report: what the screen, the browser print and a cloud printer all show. */
export interface PosShiftReportSection {
  section: string
  rows: Array<{ label: string; value: string; strong?: boolean }>
}

/** The rows of an X or Z report, in the order a manager reads them. */
export function posShiftReportRows(
  report: PosShiftReport,
  shift?: Pick<PosShift, 'countedCashCents' | 'varianceCents'>,
): PosShiftReportSection[] {
  const tenders = POS_TENDER_METHODS.filter(
    (method) => (report.salesByTender[method] ?? 0) > 0 || (report.refundsByTender[method] ?? 0) > 0,
  )
  return [
    {
      section: 'Sales',
      rows: [
        { label: 'Orders', value: String(report.orderCount) },
        { label: 'Gross sales', value: posMoney(report.grossSalesCents) },
        { label: 'Discounts', value: posMoney(report.discountsCents) },
        { label: 'Tax', value: posMoney(report.taxCents) },
        { label: 'Tips', value: posMoney(report.tipsCents) },
        { label: `Refunds (${report.refundCount})`, value: `-${posMoney(report.refundsCents)}` },
        { label: 'Net sales', value: posMoney(report.netSalesCents), strong: true },
      ],
    },
    {
      section: 'By tender',
      rows: tenders.length
        ? tenders.map((method) => ({
            label: POS_TENDER_LABELS[method],
            value:
              posMoney(report.salesByTender[method] ?? 0) +
              ((report.refundsByTender[method] ?? 0) > 0
                ? ` (−${posMoney(report.refundsByTender[method] ?? 0)})`
                : ''),
          }))
        : [{ label: 'No sales yet', value: '' }],
    },
    {
      section: 'Cash drawer',
      rows: [
        { label: 'Starting cash', value: posMoney(report.openingFloatCents) },
        { label: 'Cash sales', value: posMoney(report.cashSalesCents) },
        { label: 'Paid in', value: posMoney(report.paidInCents) },
        { label: 'Paid out', value: `-${posMoney(report.paidOutCents)}` },
        { label: 'Safe drops', value: `-${posMoney(report.dropsCents)}` },
        { label: 'Cash refunds', value: `-${posMoney(report.cashRefundsCents)}` },
        { label: 'Expected in drawer', value: posMoney(report.expectedCashCents), strong: true },
        ...(shift?.countedCashCents != null
          ? [
              { label: 'Counted', value: posMoney(shift.countedCashCents) },
              {
                label: (shift.varianceCents ?? 0) < 0 ? 'Short' : (shift.varianceCents ?? 0) > 0 ? 'Over' : 'Balanced',
                value: posMoney(shift.varianceCents ?? 0),
                strong: true,
              },
            ]
          : []),
      ],
    },
  ]
}

/** A shift's X or Z report as the receipt printer prints it. */
export function posShiftPrintReport(input: {
  title: 'X REPORT' | 'Z REPORT'
  storeName: string
  registerName?: string
  report: PosShiftReport
  shift?: Pick<PosShift, 'countedCashCents' | 'varianceCents'>
  subtitle?: string
}): PrintReport {
  return {
    title: input.title,
    storeName: input.storeName,
    ...(input.subtitle || input.registerName
      ? { subtitle: [input.registerName, input.subtitle].filter(Boolean).join(' - ') }
      : {}),
    sections: posShiftReportRows(input.report, input.shift),
  }
}
