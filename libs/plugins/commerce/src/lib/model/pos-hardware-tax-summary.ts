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
 * THE PLATFORM'S OWN HARDWARE SALES, SUMMED FOR ONE FILING PERIOD (AGL-4038).
 *
 * The platform is the seller of record for every card reader order, so these
 * are its OWN sales, not facilitated ones, and they belong on its sales tax
 * return. They are recorded in `posHardwareSales` — apart from the invoices
 * the return sums (`platformRevenue`, written only for a paid invoice, which a
 * hardware checkout never makes) and apart from the storefront's tax rows
 * (`storefrontTaxCollected`, whose recorder does not take a hardware session)
 * — so nothing here is already in another figure on the return. The return
 * folds them into its filing figures as the operator's own sales
 * (`server/pos-hardware-tax-return-source.ts`), each sale once.
 *
 * THE RULES, each pinned by `pos-hardware-tax-summary.spec.ts`:
 *
 * - **A sale is in the period it was PAID**, by `paidAtMs`, half-open: the
 *   first instant of the period is in, the first instant of the next is not.
 *   Its status today does not move it: an order paid in the period and
 *   canceled later is still a sale of the period it was paid in.
 * - **Total sales** are receipts excluding the tax itself: the total less
 *   the tax (the items and the shipping).
 * - **Taxable sales** are the base Stripe Tax applied its rate to, read from
 *   the order's stored breakdown and never inferred. One order's lines are
 *   one base taxed at several levels (state, county, city), each line
 *   stating the same base, so the order's base is the LARGEST stated, never
 *   their sum. An order taxed with no stated base adds nothing and is counted
 *   out loud.
 * - **A refund is in the period it was MADE**, by the stamp of the status
 *   that refunded it (`refundedAtMs`, or `canceledAtMs` for a cancel), and
 *   is stated beside the sales, never netted from them — the platform's own
 *   rule for its invoices. Hardware refunds are whole, so the refunded tax is
 *   the order's own tax; a partial one is split in the order's own ratio.
 * - **A canceled order with no refund recorded** stays a sale and is counted
 *   out loud: the record says canceled and nobody recorded the money coming
 *   back.
 * - **Test-mode orders are not sales.** An order made with Stripe's test keys
 *   is left out of every figure and counted, never dropped silently.
 * - **Where it shipped decides the jurisdiction**: a shipped sale is sourced
 *   to its destination. No ship-to region is `unknown`, counted out loud.
 *
 * Integer cents throughout. Pure and total: no Firestore, no clock.
 */

import {
  accumulateTaxWorkingPapers,
  emptyTaxJurisdiction,
  taxJurisdictionKey,
  type TaxLineInput,
  type TaxReturnJurisdiction,
} from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'

/** A `posHardwareSales/{orderId}` record as the return reads it. */
export interface PosHardwareTaxRowInput {
  orderId: string
  totalCents?: unknown
  taxCents?: unknown
  currency?: unknown
  shipTo?: { country?: unknown; state?: unknown; postalCode?: unknown } | null
  automaticTax?: unknown
  taxLines?: TaxLineInput[] | null
  status?: unknown
  livemode?: unknown
  paidAtMs?: unknown
  refundedCents?: unknown
  refundedAtMs?: unknown
  canceledAtMs?: unknown
  /** `in_person` for a reader sold at a store's register (AGL-4038), else sold online. */
  source?: unknown
  /** The store whose register sold it, for an in-person sale. */
  posHostId?: unknown
}

/** One ship-to jurisdiction: the sales paid in the period and the refunds made in it. */
export interface PosHardwareTaxJurisdiction extends TaxReturnJurisdiction {
  /** Sales with no tax computed: sold without Stripe Tax. */
  untaxedOrders: number
  refundedOrders: number
  /** Refunded receipts excluding tax. */
  refundedSalesCents: number
  refundedTaxCents: number
}

export interface PosHardwareTaxSummary {
  periodStart: string
  periodEnd: string
  /** Live sales paid in the period, in every jurisdiction. */
  orders: number
  totalSalesCents: number
  taxableSalesCents: number
  taxCollectedCents: number
  byJurisdiction: Record<string, PosHardwareTaxJurisdiction>
  refunds: {
    orders: number
    /** Everything refunded, tax included. */
    refundedCents: number
    refundedSalesCents: number
    refundedTaxCents: number
  }
  excluded: {
    /** Test-mode orders paid in the period: in no figure. */
    testModeOrders: number
  }
  attention: {
    untaxedOrders: number
    ordersMissingTaxableBase: number
    ordersMissingShipTo: number
    canceledWithoutRefund: number
  }
}

const cents = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

const stamp = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function emptyJurisdiction(): PosHardwareTaxJurisdiction {
  return {
    ...emptyTaxJurisdiction(),
    untaxedOrders: 0,
    refundedOrders: 0,
    refundedSalesCents: 0,
    refundedTaxCents: 0,
  }
}

/**
 * The base Stripe stated for one order, or null when no line states one: the
 * largest of the stated bases, because each jurisdiction level restates the
 * same base (see the module note).
 */
export function posHardwareTaxableBase(lines: readonly (TaxLineInput | undefined)[] | null | undefined): number | null {
  let base: number | null = null
  for (const line of lines ?? []) {
    const stated = line?.taxableAmountCents
    if (stated === null || stated === undefined || !Number.isFinite(Number(stated))) continue
    const rounded = Math.round(Number(stated))
    base = base === null ? rounded : Math.max(base, rounded)
  }
  return base
}

/** When the order's refund was made: the stamp of the status that made it. */
export function posHardwareRefundStamp(row: PosHardwareTaxRowInput): number | null {
  if (row.status === 'refunded') return stamp(row.refundedAtMs) ?? stamp(row.canceledAtMs)
  if (row.status === 'canceled') return stamp(row.canceledAtMs) ?? stamp(row.refundedAtMs)
  return stamp(row.refundedAtMs) ?? stamp(row.canceledAtMs)
}

/** How a row counts in the period: as a sale, as a refund, as both, or not at all. */
export function posHardwareRowInPeriod(
  row: PosHardwareTaxRowInput,
  period: { start: Date; end: Date },
): { sale: boolean; refund: boolean } {
  const startMs = period.start.getTime()
  const endMs = period.end.getTime()
  const within = (at: number | null) => at !== null && at >= startMs && at < endMs
  return {
    sale: within(stamp(row.paidAtMs)),
    refund: cents(row.refundedCents) > 0 && within(posHardwareRefundStamp(row)),
  }
}

/** The period's figures from the records read for it. See the module note. */
export function posHardwareTaxSummary(
  rows: readonly PosHardwareTaxRowInput[],
  period: { start: Date; end: Date },
): PosHardwareTaxSummary {
  const summary: PosHardwareTaxSummary = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    orders: 0,
    totalSalesCents: 0,
    taxableSalesCents: 0,
    taxCollectedCents: 0,
    byJurisdiction: {},
    refunds: { orders: 0, refundedCents: 0, refundedSalesCents: 0, refundedTaxCents: 0 },
    excluded: { testModeOrders: 0 },
    attention: {
      untaxedOrders: 0,
      ordersMissingTaxableBase: 0,
      ordersMissingShipTo: 0,
      canceledWithoutRefund: 0,
    },
  }

  // The reader merges three queries, so an order can arrive twice.
  const seen = new Set<string>()
  for (const row of rows ?? []) {
    if (!row?.orderId || seen.has(row.orderId)) continue
    seen.add(row.orderId)
    const placed = posHardwareRowInPeriod(row, period)
    if (!placed.sale && !placed.refund) continue
    if (row.livemode !== true) {
      if (placed.sale) summary.excluded.testModeOrders += 1
      continue
    }

    const total = cents(row.totalCents)
    const tax = cents(row.taxCents)
    const jurisdiction = taxJurisdictionKey(row.shipTo)
    const bucket = (summary.byJurisdiction[jurisdiction] ??= emptyJurisdiction())

    if (placed.sale) {
      const lines = Array.isArray(row.taxLines) ? row.taxLines : []
      const base = posHardwareTaxableBase(lines)
      const sales = total - tax
      summary.orders += 1
      summary.totalSalesCents += sales
      summary.taxableSalesCents += base ?? 0
      summary.taxCollectedCents += tax
      bucket.transactionCount += 1
      bucket.totalSalesCents += sales
      bucket.taxableSalesCents += base ?? 0
      bucket.taxCollectedCents += tax
      accumulateTaxWorkingPapers(bucket, lines)
      if (tax === 0 && row.automaticTax !== true) {
        bucket.untaxedOrders += 1
        summary.attention.untaxedOrders += 1
      }
      if (tax > 0 && base === null) summary.attention.ordersMissingTaxableBase += 1
      if (jurisdiction === 'unknown') summary.attention.ordersMissingShipTo += 1
      if ((row.status === 'canceled' || row.status === 'refunded') && cents(row.refundedCents) <= 0) {
        summary.attention.canceledWithoutRefund += 1
      }
    }

    if (placed.refund) {
      const refunded = cents(row.refundedCents)
      // Whole refunds give back the order's own tax; a partial one is split
      // in the order's own ratio, and a row with no total states no ratio.
      const refundedTax =
        refunded >= total ? tax : total > 0 && tax > 0 ? Math.round((refunded * tax) / total) : 0
      const refundedSales = refunded - refundedTax
      summary.refunds.orders += 1
      summary.refunds.refundedCents += refunded
      summary.refunds.refundedSalesCents += refundedSales
      summary.refunds.refundedTaxCents += refundedTax
      bucket.refundedOrders += 1
      bucket.refundedSalesCents += refundedSales
      bucket.refundedTaxCents += refundedTax
    }
  }
  return summary
}

/*==========================================
 * AN IN-PERSON SALE IS ON THE RETURN ONCE (AGL-4038).
 *
 * A card reader the platform sells at its own store's register is the
 * platform's own hardware sale, and the hardware section counts it from its
 * `posHardwareSales` record. A register sale paid by a payment link ALSO
 * files a storefront tax row for the whole register sale, under the link's
 * Checkout Session id — which the record names as `storefrontTaxRowId`. So
 * the storefront section takes the hardware's part out of that row: what is
 * left is the rest of the register sale, and a sale of hardware alone leaves
 * nothing. A sale paid in cash, on a reader or offline files no storefront
 * row, and the hardware section is its only line.
 *
 * Only a record the hardware section counts is taken out — a live one — so
 * a test sale is not removed from one section without being in the other.
 * The row is matched by its id, not by period, so a sale and its row that
 * fall either side of a period's edge still meet.
 *=========================================*/

/** The part of a storefront row an in-person hardware record accounts for. */
export interface PosHardwareStorefrontPart {
  storefrontTaxRowId: string
  /** The hardware's share of the register sale, tax included. */
  totalCents: number
  taxCents: number
}

/** The parts the hardware section counts, from its records. */
export function posHardwareStorefrontParts(
  records: ReadonlyArray<{
    source?: unknown
    storefrontTaxRowId?: unknown
    totalCents?: unknown
    taxCents?: unknown
    livemode?: unknown
  }>,
): PosHardwareStorefrontPart[] {
  return records.flatMap((record) =>
    record.source === 'in_person' &&
    record.livemode === true &&
    typeof record.storefrontTaxRowId === 'string' &&
    record.storefrontTaxRowId
      ? [{ storefrontTaxRowId: record.storefrontTaxRowId, totalCents: cents(record.totalCents), taxCents: cents(record.taxCents) }]
      : [],
  )
}

/**
 * The storefront rows with each in-person hardware part taken out: a row's
 * receipts and tax less the hardware's, and a row left with nothing dropped.
 * A row's stated tax lines are kept as they are: a register sale's row is a
 * manual-rate row, which states none.
 */
export function storefrontRowsWithoutInPersonHardware<
  Row extends { id: string; grossCents?: unknown; taxCents?: unknown },
>(rows: readonly Row[], parts: readonly PosHardwareStorefrontPart[]): Row[] {
  const byRow = new Map<string, { totalCents: number; taxCents: number }>()
  for (const part of parts) {
    const held = byRow.get(part.storefrontTaxRowId) ?? { totalCents: 0, taxCents: 0 }
    byRow.set(part.storefrontTaxRowId, {
      totalCents: held.totalCents + part.totalCents,
      taxCents: held.taxCents + part.taxCents,
    })
  }
  return rows.flatMap((row) => {
    const part = byRow.get(row.id)
    if (!part) return [row]
    const gross = cents(row.grossCents) - part.totalCents
    if (gross <= 0) return []
    return [{ ...row, grossCents: gross, taxCents: Math.max(0, cents(row.taxCents) - part.taxCents) }]
  })
}
