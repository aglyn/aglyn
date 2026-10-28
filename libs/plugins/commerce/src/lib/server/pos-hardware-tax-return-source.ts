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
 * are its OWN sales, unlike the storefront's facilitated ones beside them.
 * They FOLD INTO the filing figures (Items 1–2 for Texas) as the operator's
 * own sales outside its invoices, through the contract's `operatorSales`:
 *
 *   - **sold online from the shop** — on the platform's own account — under
 *     "Card reader shop (online)";
 *   - **sold in person** at the operator's own store's register: already in
 *     that store's register sale, which the own-stores section folds in
 *     (`own-store-tax-return-source.ts`), so NOT again here. Only a sale whose
 *     store is not one of the operator's own (the store was moved, or no
 *     workspace is named as the operator's own) is folded in from its record
 *     here, and a review finding says so.
 *
 * This card states, worded for the filing jurisdiction:
 *
 *   - **every card reader sale by ship-to state** (in person: where the store
 *     is), with the refunds of the period beside them — the figure an
 *     economic-nexus threshold elsewhere is measured against;
 *   - **every order in the period** in the working papers, each with where it
 *     is folded in.
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
  TaxReturnFinding,
  TaxReturnOperatorSalesPart,
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

/** The part the shop's online sales fold into the filing figures under. */
export const POS_HARDWARE_SHOP_PART_ID = 'posHardwareShop'
/** The part an in-person sale at a store that is not the operator's own folds in under. */
export const POS_HARDWARE_IN_PERSON_PART_ID = 'posHardwareInPerson'

/** Where an order is folded into the filing figures. */
export type PosHardwareFoldedAs = 'shop' | 'store register sale' | 'in-person record'

/** Who decides where a record folds in: the operator's own stores, by site id. */
export interface PosHardwareFoldOptions {
  /** The sites of the operator's own stores, whose register sales the own-stores section folds in. */
  ownHostIds?: ReadonlySet<string>
}

/** Where one retained sale record folds into the filing figures. See the module note. */
export function posHardwareFoldedAs(
  row: Pick<PosHardwareTaxRowInput, 'source' | 'posHostId'>,
  options: PosHardwareFoldOptions = {},
): PosHardwareFoldedAs {
  if (row.source !== 'in_person') return 'shop'
  const host = typeof row.posHostId === 'string' ? row.posHostId : ''
  return host && options.ownHostIds?.has(host) ? 'store register sale' : 'in-person record'
}

/**
 * The operator's own hardware sales the filing figures fold in from this
 * section: the shop's online sales, and any in-person sale whose store is not
 * the operator's own. Every figure is the summary's own math over that part's
 * records, so the card and the figures cannot disagree.
 */
export function posHardwareOperatorSales(
  rows: readonly PosHardwareTaxRowInput[],
  period: { start: Date; end: Date },
  options: PosHardwareFoldOptions = {},
): TaxReturnOperatorSalesPart[] {
  const parts: Array<{ id: string; label: string; foldedAs: PosHardwareFoldedAs }> = [
    { id: POS_HARDWARE_SHOP_PART_ID, label: 'Card reader shop (online)', foldedAs: 'shop' },
    {
      id: POS_HARDWARE_IN_PERSON_PART_ID,
      label: 'Card readers sold in person (store not read)',
      foldedAs: 'in-person record',
    },
  ]
  return parts.flatMap(({ id, label, foldedAs }) => {
    const summary = posHardwareTaxSummary(
      rows.filter((row) => posHardwareFoldedAs(row, options) === foldedAs),
      period,
    )
    const byJurisdiction = Object.fromEntries(
      Object.entries(summary.byJurisdiction).map(([jurisdiction, figures]) => [
        jurisdiction,
        {
          transactionCount: figures.transactionCount,
          totalSalesCents: figures.totalSalesCents,
          taxableSalesCents: figures.taxableSalesCents,
          taxCollectedCents: figures.taxCollectedCents,
          refundCount: figures.refundedOrders,
          refundedSalesCents: figures.refundedSalesCents,
          refundedTaxCents: figures.refundedTaxCents,
        },
      ]),
    )
    // The shop's part is always stated, so its zero is a figure; an empty
    // in-person part is simply not there.
    return foldedAs === 'shop' || Object.keys(byJurisdiction).length ? [{ id, label, byJurisdiction }] : []
  })
}

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
  /** Where it is folded into the filing figures. */
  foldedAs: PosHardwareFoldedAs
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
  operatorSales: readonly TaxReturnOperatorSalesPart[] = [],
): TaxReturnFinding[] {
  const brand = PLATFORM_BRAND_NAME
  const figures = posHardwareFilingFigures(summary, filing)
  const unread = operatorSales.find((part) => part.id === POS_HARDWARE_IN_PERSON_PART_ID)
  return [
    {
      // REVIEW: the sales ARE in the figures, from their hardware records;
      // the rest of that store's sales are not, because it is not one of the
      // operator's own stores.
      id: 'posHardwareInPersonStoreNotRead',
      severity: 'review',
      count: Object.values(unread?.byJurisdiction ?? {}).reduce((sum, part) => sum + part.transactionCount, 0),
      label: `Card readers sold in person at a store that is not one of ${brand}’s own`,
      detail:
        `Folded into ${filing.figuresName} from their hardware records. The store that sold them is not a ` +
        `site of the workspace named as ${brand}’s own (POS_HARDWARE_SELLER_ORG_ID), so its other sales are ` +
        'not in the figures. Name the workspace, or check the store was moved on purpose.',
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
        'Every card reader sale, online and in person. The online ones are folded into the filing figures ' +
        'as “Card reader shop (online)”; one sold in person is in its store’s register sale there. ' +
        'Test-mode orders are in no figure. A refund is counted in the period it was made, whenever the ' +
        'order was paid.',
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
function projectRow(
  row: PosHardwareTaxRowInput,
  period: { start: Date; end: Date },
  options: PosHardwareFoldOptions,
): PosHardwareTaxRow {
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
    foldedAs: posHardwareFoldedAs(row, options),
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
        [`Card reader hardware — ${brand}’s OWN sales by ship-to state (folded into the filing figures above, by source)`],
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
        ['Card reader hardware orders in this period (posHardwareSales) — folded into the filing figures as each says'],
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
          'Folded in as',
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
          row.foldedAs === 'shop'
            ? 'Card reader shop (online)'
            : row.foldedAs === 'store register sale'
              ? 'its store’s register sale'
              : 'Card readers sold in person (store not read)',
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
  options: PosHardwareFoldOptions = {},
): TaxReturnSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { filing } = request
  const period = { start: request.start, end: request.end }
  const summary = posHardwareTaxSummary(read.rows, period)
  const operatorSales = posHardwareOperatorSales(read.rows, period, options)
  const seen = new Set<string>()
  const rows = read.rows
    .filter((row) => {
      if (!row?.orderId || seen.has(row.orderId) || row.livemode !== true) return false
      seen.add(row.orderId)
      const placed = posHardwareRowInPeriod(row, period)
      return placed.sale || placed.refund
    })
    .map((row) => projectRow(row, period, options))
  return {
    id: POS_HARDWARE_TAX_SECTION_ID,
    name: 'Card reader hardware',
    title: `Card reader hardware — ${brand}’s own sales`,
    help:
      `Card readers and accessories ${brand} sold to workspaces, online from the POS hardware shop and ` +
      `in person at its own store. ${brand} is the seller, so these are its own sales, folded into the ` +
      'filing figures above.',
    intro:
      `${brand} is the seller of record for every card reader order, so these are ` +
      `${brand}’s OWN sales, not facilitated ones, and they are folded into ${filing.figuresName}: ` +
      'the online ones as “Card reader shop (online)”, one sold in person in its store’s register sale. ' +
      'Refunds are counted in the period they were made and never netted.',
    truncated: read.truncated,
    undatedRows: read.undatedRows,
    findings: posHardwareTaxFindings(summary, filing, operatorSales),
    filingLines: [],
    operatorSales,
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
  options: PosHardwareFoldOptions = {},
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
    options,
  )
}
