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
 * The POS hardware shop's sales on the operator's sales tax return (AGL-4038).
 *
 * The operator is the seller of record for every card reader order, so these
 * are its OWN sales, unlike the storefront's facilitated ones beside them —
 * and still not in the filing figures, which sum its invoices alone (see
 * `model/pos-hardware-tax-summary.ts` for why nothing here is counted twice).
 * So this section states, worded for the filing jurisdiction:
 *
 *   - **the lines to ADD to the filing figures** — the jurisdiction's hardware
 *     sales, taxable sales and tax, and the refunds made in the period —
 *     beneath the figures, never folded into them: the platform's figures stay
 *     the sum of what the platform reads;
 *   - **a review finding while any hardware sold into the jurisdiction**, so
 *     the figures above are never read as the whole of the operator's sales;
 *   - **the sales by ship-to state**, the figure an economic-nexus threshold
 *     elsewhere is measured against, with the refunds of the period beside
 *     them;
 *   - **every order in the period** in the working papers.
 *
 * Truncation and rows no period can reach are reported, and the platform
 * raises each as a blocking finding of its own.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { centsToDollars } from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'
import type {
  TaxReturnExportBlock,
  TaxReturnFiling,
  TaxReturnFilingLine,
  TaxReturnFinding,
  TaxReturnSectionFigure,
  TaxReturnSectionTable,
  TaxReturnSourceAnswer,
  TaxReturnSourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { POS_HARDWARE_SALES_COLLECTION } from '../model/pos-hardware'
import {
  posHardwareRefundStamp,
  posHardwareRowInPeriod,
  posHardwareTaxableBase,
  posHardwareTaxSummary,
  type PosHardwareTaxJurisdiction,
  type PosHardwareTaxRowInput,
  type PosHardwareTaxSummary,
} from '../model/pos-hardware-tax-summary'

/** The section's id, unique on the return. */
export const POS_HARDWARE_TAX_SECTION_ID = 'posHardware'

/** One order as the working papers carry it: amounts and the region, no buyer. */
export interface PosHardwareTaxRow {
  orderId: string
  paidAt: string | null
  status: string | null
  state: string | null
  country: string | null
  totalSalesCents: number
  taxableSalesCents: number | null
  taxCents: number
  refundedCents: number
  refundedAt: string | null
  /** How the order counts in this period. */
  inPeriodAs: 'sale' | 'refund' | 'sale and refund'
}

const isoOrNull = (value: number | null): string | null =>
  value === null ? null : new Date(value).toISOString()

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

const emptyFigures = (): PosHardwareTaxJurisdiction => ({
  transactionCount: 0,
  totalSalesCents: 0,
  taxableSalesCents: 0,
  taxCollectedCents: 0,
  taxabilityReasons: {},
  rates: [],
  untaxedOrders: 0,
  refundedOrders: 0,
  refundedSalesCents: 0,
  refundedTaxCents: 0,
})

/** The filing jurisdiction's hardware figures, or zeros when none sold there. */
export function posHardwareFilingFigures(
  summary: PosHardwareTaxSummary,
  filing: TaxReturnFiling,
): PosHardwareTaxJurisdiction {
  return summary.byJurisdiction[filing.code] ?? emptyFigures()
}

/** The section's findings. The platform raises the non-zero ones. */
export function posHardwareTaxFindings(
  summary: PosHardwareTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnFinding[] {
  const brand = PLATFORM_BRAND_NAME
  const figures = posHardwareFilingFigures(summary, filing)
  return [
    {
      // REVIEW, not blocking: nothing is wrong with the figures above, they
      // are simply not the whole of the operator's sales while this is not
      // zero. The lines beneath them say what to add.
      id: 'posHardwareSalesNotInFigures',
      severity: 'review',
      count: figures.totalSalesCents,
      label: `${filing.label} card reader hardware sales are not in ${filing.figuresName}`,
      detail:
        `Cents. ${brand} sold these card readers itself, so they are its own ` +
        `sales, recorded apart from its invoices and NOT included in ` +
        `${filing.figuresName}. Add the card reader hardware lines beneath ` +
        'the figures before filing.',
    },
    {
      id: 'posHardwareUntaxed',
      severity: 'review',
      count: figures.untaxedOrders,
      label: `Card reader hardware sold into ${filing.label} without tax`,
      detail:
        'Sold while Stripe Tax was off for the hardware shop, so no tax was ' +
        `collected. If the sale was taxable in ${filing.label}, the tax is ` +
        `still owed, out of ${brand}’s receipt.`,
    },
    {
      id: 'posHardwareMissingTaxableBase',
      severity: 'review',
      count: summary.attention.ordersMissingTaxableBase,
      label: 'Card reader hardware orders with tax but no stated base',
      detail:
        'Tax was collected but Stripe’s taxable_amount was not recorded on the ' +
        'order, so the hardware taxable-sales line understates the base. Read ' +
        'the Checkout Session in Stripe with the tax breakdown expanded.',
    },
    {
      id: 'posHardwareMissingShipTo',
      severity: 'review',
      count: summary.attention.ordersMissingShipTo,
      label: 'Card reader hardware orders with no ship-to region',
      detail:
        'Listed as Not stated, and in no state’s figures. If the order shipped ' +
        `to ${filing.label}, the hardware lines understate its sales.`,
    },
    {
      id: 'posHardwareCanceledWithoutRefund',
      severity: 'review',
      count: summary.attention.canceledWithoutRefund,
      label: 'Canceled card reader hardware orders with no refund recorded',
      detail:
        'Counted as sales: the order is marked canceled or refunded, but no ' +
        'refund was recorded on it. Check the payment in Stripe.',
    },
  ]
}

/** The lines beneath the filing figures: what to add, and the period's refunds. */
export function posHardwareFilingLines(
  summary: PosHardwareTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnFilingLine[] {
  const brand = PLATFORM_BRAND_NAME
  const figures = posHardwareFilingFigures(summary, filing)
  const webfile = filing.form === 'tx-webfile'
  const refunds =
    `${filing.label} card reader hardware refunds made in this period (stated, not netted)`
  const refundsNote =
    `Receipts excluding tax refunded in this period, on orders paid in this ` +
    `or an earlier period; the tax refunded with them was $${centsToDollars(figures.refundedTaxCents)}. ` +
    'Stated beside the sales, as the invoices’ refunds are, and applying ' +
    'them is the preparer’s decision.'
  if (webfile) {
    return [
      {
        item: 'Item 1 (add)',
        label: `${filing.label} card reader hardware sales (NOT in Item 1 above)`,
        dollars: centsToDollars(figures.totalSalesCents),
        note:
          `${brand}’s own sales of card readers shipped to ${filing.label}, ` +
          'excluding the tax: the items and the shipping. Add to Item 1.',
      },
      {
        item: 'Item 2 (add)',
        label: `${filing.label} card reader hardware taxable sales (NOT in Item 2 above)`,
        dollars: centsToDollars(figures.taxableSalesCents),
        note: 'Stripe’s taxable_amount on each order, once per order. Add to Item 2.',
      },
      {
        item: '—',
        label: `${filing.label} card reader hardware tax collected (NOT in the reconciliation above)`,
        dollars: centsToDollars(figures.taxCollectedCents),
        note: 'What Stripe Tax charged on those orders. Add it to the tax collected above before reconciling.',
      },
      { item: '—', label: refunds, dollars: centsToDollars(figures.refundedSalesCents), note: refundsNote },
    ]
  }
  return [
    {
      item: '—',
      label: `${filing.code} card reader hardware sales (NOT in the figures above)`,
      dollars: centsToDollars(figures.totalSalesCents),
      note: `The operator’s own sales of card readers shipped to ${filing.code}, excluding the tax. Add to total sales.`,
    },
    {
      item: '—',
      label: `${filing.code} card reader hardware taxable sales (NOT in the figures above)`,
      dollars: centsToDollars(figures.taxableSalesCents),
      note: 'Stripe’s taxable_amount on each order, once per order. Add to taxable sales.',
    },
    {
      item: '—',
      label: `${filing.code} card reader hardware tax collected (NOT in the figures above)`,
      dollars: centsToDollars(figures.taxCollectedCents),
      note: 'What Stripe Tax charged on those orders. Add to tax collected.',
    },
    { item: '—', label: refunds, dollars: centsToDollars(figures.refundedSalesCents), note: refundsNote },
  ]
}

/** One ship-to state's row, ready to print. */
export interface PosHardwareJurisdictionRow {
  jurisdiction: string
  isFilingJurisdiction: boolean
  orders: number
  totalSalesCents: number
  taxableSalesCents: number
  taxCollectedCents: number
  refundedOrders: number
  refundedSalesCents: number
  refundedTaxCents: number
}

/** Every ship-to state, the filing jurisdiction first, then by sales. */
export function posHardwareJurisdictionRows(
  summary: PosHardwareTaxSummary,
  filing: TaxReturnFiling,
): PosHardwareJurisdictionRow[] {
  return Object.entries(summary.byJurisdiction)
    .map(([jurisdiction, figures]) => ({
      jurisdiction,
      isFilingJurisdiction: jurisdiction === filing.code,
      orders: figures.transactionCount,
      totalSalesCents: figures.totalSalesCents,
      taxableSalesCents: figures.taxableSalesCents,
      taxCollectedCents: figures.taxCollectedCents,
      refundedOrders: figures.refundedOrders,
      refundedSalesCents: figures.refundedSalesCents,
      refundedTaxCents: figures.refundedTaxCents,
    }))
    .sort(
      (a, b) =>
        Number(b.isFilingJurisdiction) - Number(a.isFilingJurisdiction) ||
        b.totalSalesCents - a.totalSalesCents ||
        a.jurisdiction.localeCompare(b.jurisdiction),
    )
}

const dollars = (centsValue: number) => `$${centsToDollars(centsValue)}`

function posHardwareTables(summary: PosHardwareTaxSummary, filing: TaxReturnFiling): TaxReturnSectionTable[] {
  return [
    {
      description:
        'Sales by where each order shipped, which is where its sales tax is ' +
        'sourced, and the refunds made in this period beside them. A state ' +
        'other than the one filed here is the figure an economic-nexus ' +
        'threshold there is measured against.',
      columns: [
        { label: 'Ship-to state' },
        { label: 'Orders', numeric: true },
        { label: 'Total sales', numeric: true, money: true },
        { label: 'Taxable sales', numeric: true, money: true },
        { label: 'Tax collected', numeric: true, money: true },
        { label: 'Refunded in period', numeric: true, money: true },
        { label: 'Tax refunded', numeric: true, money: true },
      ],
      rows: posHardwareJurisdictionRows(summary, filing).map((row) => ({
        key: row.jurisdiction,
        cells: [
          {
            text: row.jurisdiction === 'unknown' ? 'Not stated' : row.jurisdiction,
            ...(row.isFilingJurisdiction ? { tag: { label: 'Registered', tone: 'attention' as const } } : {}),
            ...(row.refundedOrders
              ? { caption: `${row.refundedOrders} refund${row.refundedOrders === 1 ? '' : 's'} in this period` }
              : {}),
          },
          { text: String(row.orders) },
          { text: dollars(row.totalSalesCents), strong: row.isFilingJurisdiction },
          { text: dollars(row.taxableSalesCents) },
          { text: dollars(row.taxCollectedCents) },
          { text: dollars(row.refundedSalesCents) },
          { text: dollars(row.refundedTaxCents) },
        ],
      })),
      empty: 'No card reader hardware was sold or refunded in this period.',
      footnote:
        'Test-mode orders are in no figure. A refund is counted in the period ' +
        'it was made, whenever the order was paid.',
    },
  ]
}

function posHardwareFigures(summary: PosHardwareTaxSummary): TaxReturnSectionFigure[] {
  const figures: TaxReturnSectionFigure[] = [
    {
      label: 'Orders paid in this period',
      value: String(summary.orders),
      note: 'Every ship-to state. Live orders only.',
    },
  ]
  if (summary.excluded.testModeOrders) {
    figures.push({
      label: 'Test-mode orders left out',
      value: String(summary.excluded.testModeOrders),
      note: 'Made with Stripe’s test keys, so not sales: in no figure above.',
    })
  }
  return figures
}

/** One record as the working papers carry it, for an order the period counts. */
function projectRow(row: PosHardwareTaxRowInput, period: { start: Date; end: Date }): PosHardwareTaxRow {
  const placed = posHardwareRowInPeriod(row, period)
  const total = Number(row.totalCents ?? 0) || 0
  const tax = Number(row.taxCents ?? 0) || 0
  return {
    orderId: row.orderId,
    paidAt: isoOrNull(numberOrNull(row.paidAtMs)),
    status: textOrNull(row.status),
    state: textOrNull(row.shipTo?.state),
    country: textOrNull(row.shipTo?.country),
    totalSalesCents: total - tax,
    taxableSalesCents: posHardwareTaxableBase(Array.isArray(row.taxLines) ? row.taxLines : []),
    taxCents: tax,
    refundedCents: Number(row.refundedCents ?? 0) || 0,
    refundedAt: isoOrNull(posHardwareRefundStamp(row)),
    inPeriodAs: placed.sale && placed.refund ? 'sale and refund' : placed.sale ? 'sale' : 'refund',
  }
}

function posHardwareExports(
  summary: PosHardwareTaxSummary,
  filing: TaxReturnFiling,
  rows: readonly PosHardwareTaxRow[],
): TaxReturnExportBlock[] {
  const brand = PLATFORM_BRAND_NAME
  const states = posHardwareJurisdictionRows(summary, filing)
  return [
    {
      placement: 'jurisdictions',
      rows: [
        [`Card reader hardware — ${brand}’s OWN sales by ship-to state (NOT in the filing figures above)`],
        [
          'Ship-to state',
          'Orders',
          'Total sales (USD)',
          'Taxable sales (USD)',
          'Tax collected (USD)',
          'Refunded in period (USD)',
          'Tax refunded (USD)',
        ],
        ...(states.length
          ? states.map((row) => [
              row.jurisdiction,
              String(row.orders),
              centsToDollars(row.totalSalesCents),
              centsToDollars(row.taxableSalesCents),
              centsToDollars(row.taxCollectedCents),
              centsToDollars(row.refundedSalesCents),
              centsToDollars(row.refundedTaxCents),
            ])
          : [['—', '0', '0.00', '0.00', '0.00', '0.00', '0.00']]),
      ],
    },
    {
      placement: 'sections',
      rows: [
        ['Card reader hardware orders in this period (posHardwareSales) — NOT in the filing figures above'],
        [
          'Order',
          'Paid (UTC)',
          'Status',
          'Ship-to state',
          'Country',
          'Total sales (USD)',
          'Taxable sales (USD)',
          'Tax collected (USD)',
          'Refunded (USD)',
          'Refunded at (UTC)',
          'In this period as',
        ],
        ...rows.map((row) => [
          row.orderId,
          row.paidAt ?? '',
          row.status ?? '',
          row.state ?? '',
          row.country ?? '',
          centsToDollars(row.totalSalesCents),
          row.taxableSalesCents === null ? 'not stated' : centsToDollars(row.taxableSalesCents),
          centsToDollars(row.taxCents),
          centsToDollars(row.refundedCents),
          row.refundedAt ?? '',
          row.inPeriodAs,
        ]),
      ],
    },
  ]
}

/**
 * The hardware section for one period, from records already read. Pure, so
 * the section a preparer reads can be proved from fixtures.
 */
export function posHardwareTaxReturnAnswer(
  read: { rows: readonly PosHardwareTaxRowInput[]; truncated: boolean; undatedRows: number },
  request: TaxReturnSourceRequest,
): TaxReturnSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { filing } = request
  const period = { start: request.start, end: request.end }
  const summary = posHardwareTaxSummary(read.rows, period)
  const seen = new Set<string>()
  const rows = read.rows
    .filter((row) => {
      if (!row?.orderId || seen.has(row.orderId) || row.livemode !== true) return false
      seen.add(row.orderId)
      const placed = posHardwareRowInPeriod(row, period)
      return placed.sale || placed.refund
    })
    .map((row) => projectRow(row, period))
  return {
    id: POS_HARDWARE_TAX_SECTION_ID,
    name: 'Card reader hardware',
    title: `Card reader hardware — ${brand}’s own sales`,
    help:
      `Card readers and accessories ${brand} sold to workspaces from the POS hardware shop. ` +
      `${brand} is the seller, so these are its own sales; they are recorded apart from its ` +
      'invoices and are not in the filing figures above.',
    intro:
      `${brand} is the seller of record for every card reader order, so these are ` +
      `${brand}’s OWN sales, not facilitated ones. They are recorded apart from its ` +
      `invoices, so none of this is in the ${filing.form === 'tx-webfile' ? 'Webfile' : 'breakdown'} ` +
      'figures above: the card reader hardware lines beneath them say what to add. ' +
      'Refunds are counted in the period they were made and never netted.',
    truncated: read.truncated,
    undatedRows: read.undatedRows,
    findings: posHardwareTaxFindings(summary, filing),
    filingLines: posHardwareFilingLines(summary, filing),
    tables: posHardwareTables(summary, filing),
    figures: posHardwareFigures(summary),
    exports: posHardwareExports(summary, filing, rows),
    summary,
    rows,
  }
}

/**
 * Reads the period's hardware records and answers for them.
 *
 * Three range queries, because a record counts in a period two ways — paid
 * in it, or refunded in it (by the stamp of the status that refunded it) —
 * and a fourth, the honesty check: a range query cannot match a record whose
 * `paidAtMs` is null, so those are counted over all of them and the platform
 * blocks the return on any. Each is a single-field range, served by
 * Firestore's automatic index. A query that reaches the row cap marks the
 * section truncated, and the platform blocks on that too.
 */
export async function readPosHardwareTaxReturn(
  request: TaxReturnSourceRequest,
): Promise<TaxReturnSourceAnswer> {
  const collection = firebaseAdmin.app().firestore().collection(POS_HARDWARE_SALES_COLLECTION)
  const startMs = request.start.getTime()
  const endMs = request.end.getTime()
  const inRange = (field: string) =>
    collection.where(field, '>=', startMs).where(field, '<', endMs).limit(request.rowCap + 1).get()
  const [paid, refunded, canceled, undated] = await Promise.all([
    inRange('paidAtMs'),
    inRange('refundedAtMs'),
    inRange('canceledAtMs'),
    collection.where('paidAtMs', '==', null).count().get(),
  ])
  const byId = new Map<string, PosHardwareTaxRowInput>()
  for (const snapshot of [paid, refunded, canceled]) {
    for (const doc of snapshot.docs.slice(0, request.rowCap)) {
      if (!byId.has(doc.id)) {
        byId.set(doc.id, { ...(doc.data() as Omit<PosHardwareTaxRowInput, 'orderId'>), orderId: doc.id })
      }
    }
  }
  return posHardwareTaxReturnAnswer(
    {
      rows: [...byId.values()],
      truncated: [paid, refunded, canceled].some((snapshot) => snapshot.size > request.rowCap),
      undatedRows: Number(undated.data().count ?? 0),
    },
    request,
  )
}
