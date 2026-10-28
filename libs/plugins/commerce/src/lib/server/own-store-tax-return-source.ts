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
 * The operator's own stores on its sales tax return (AGL-4038).
 *
 * Everything the operator sells from a store of its own — card readers at an
 * event's register, apparel online, anything it sells later — is its OWN
 * sale, so it folds into the filing figures (Items 1–2 for Texas) through
 * the contract's `operatorSales`, one part per store and channel, with the
 * breakdown beside the figures. The rules are `model/own-store-tax-summary.ts`.
 *
 * Which stores: every site of the workspace `POS_HARDWARE_SELLER_ORG_ID`
 * names. None named, and the card says so and folds in nothing; a merchant's
 * store is never read here.
 *
 * Read per store: the orders placed from {@link OWN_STORE_LOOKBACK_MS}
 * before the period to its end, because an order placed earlier can be paid
 * (a draft) or refunded in the period. A refund or a payment more than that
 * after the order was placed is not read, which the card says. A read that
 * reaches the cap marks the section truncated, and orders with no placed
 * stamp are counted as rows no period can reach; the platform blocks on both.
 */

import { firebaseAdmin, hostDisplayName } from '@aglyn/tenant-data-admin'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { centsToDollars } from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'
import type {
  TaxReturnExportBlock,
  TaxReturnFiling,
  TaxReturnFinding,
  TaxReturnSectionFigure,
  TaxReturnSectionTable,
  TaxReturnSourceAnswer,
  TaxReturnSourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import {
  ownStoreTaxSummary,
  platformOwnStoreOrgId,
  type OwnStore,
  type OwnStoreOrderInput,
  type OwnStoreTaxRow,
  type OwnStoreTaxSummary,
} from '../model/own-store-tax-summary'

/** The section's id, unique on the return. */
export const OWN_STORE_TAX_SECTION_ID = 'ownStores'

/** How long before the period an own store's order is still read: a year and a quarter. */
export const OWN_STORE_LOOKBACK_MS = 456 * 24 * 60 * 60 * 1000

/** The most sites of the operator's own workspace read. */
const OWN_STORE_MAX_SITES = 50

/** The operator's own stores, as the deployment names them. */
export interface OwnStores {
  /** The workspace named as the operator's own, or null when none is. */
  orgId: string | null
  stores: OwnStore[]
}

/** Reads the operator's own stores: every site of the named workspace, with its tax origin. */
export async function resolveOwnStores(
  env: Record<string, string | undefined> = process.env,
): Promise<OwnStores> {
  const orgId = platformOwnStoreOrgId(env)
  if (!orgId) return { orgId: null, stores: [] }
  const firestore = firebaseAdmin.app().firestore()
  const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).limit(OWN_STORE_MAX_SITES).get()
  const stores = await Promise.all(
    hosts.docs.map(async (doc: { id: string; data: () => Record<string, unknown> }) => {
      const settings = await firestore
        .collection('hosts')
        .doc(doc.id)
        .collection('settings')
        .doc('store')
        .get()
        .catch(() => null)
      const origin = (settings?.get?.('tax') as { origin?: { country?: unknown; state?: unknown } } | undefined)
        ?.origin
      const country = typeof origin?.country === 'string' ? origin.country.toUpperCase() : null
      const state = typeof origin?.state === 'string' ? origin.state.toUpperCase() : null
      return {
        hostId: doc.id,
        name: hostDisplayName(doc.data(), doc.id),
        origin: country ? { country, state } : null,
      } satisfies OwnStore
    }),
  )
  return { orgId, stores }
}

/** What the own stores' orders read for one period came to. */
export interface OwnStoreRead {
  orders: OwnStoreOrderInput[]
  truncated: boolean
  undatedRows: number
}

/** Reads each own store's orders around the period. See the module note. */
export async function readOwnStoreOrders(
  request: TaxReturnSourceRequest,
  stores: readonly OwnStore[],
): Promise<OwnStoreRead> {
  const firestore = firebaseAdmin.app().firestore()
  const from = request.start.getTime() - OWN_STORE_LOOKBACK_MS
  const until = request.end.getTime()
  const reads = await Promise.all(
    stores.map(async (store) => {
      const orders = firestore.collection('hosts').doc(store.hostId).collection('orders')
      const [placed, undated] = await Promise.all([
        orders.where('createdAtMs', '>=', from).where('createdAtMs', '<', until).limit(request.rowCap + 1).get(),
        orders.where('createdAtMs', '==', null).count().get(),
      ])
      return {
        truncated: placed.size > request.rowCap,
        undated: Number(undated.data().count ?? 0),
        orders: placed.docs.slice(0, request.rowCap).map(
          (doc: { id: string; data: () => Record<string, unknown> }) =>
            ({ ...(doc.data() as Omit<OwnStoreOrderInput, 'hostId' | 'orderId'>), hostId: store.hostId, orderId: doc.id }),
        ),
      }
    }),
  )
  return {
    orders: reads.flatMap((read) => read.orders),
    truncated: reads.some((read) => read.truncated),
    undatedRows: reads.reduce((sum, read) => sum + read.undated, 0),
  }
}

const dollars = (cents: number) => `$${centsToDollars(cents)}`

function ownStoreFindings(summary: OwnStoreTaxSummary, filing: TaxReturnFiling): TaxReturnFinding[] {
  const brand = PLATFORM_BRAND_NAME
  return [
    {
      id: 'ownStoreUntaxed',
      severity: 'review',
      count: summary.attention.untaxedOrders,
      label: `${brand}’s own store sales with no tax charged`,
      detail:
        `In ${filing.figuresName} as sales, with nothing in taxable sales. If any was taxable where it was ` +
        `sold, the tax is still owed, out of ${brand}’s receipt.`,
    },
    {
      id: 'ownStoreMissingRegion',
      severity: 'review',
      count: summary.attention.ordersMissingRegion,
      label: `${brand}’s own store sales with no region`,
      detail:
        'Listed as Not stated, and in no jurisdiction’s figures: a register sale whose store has no tax ' +
        'address, or an online one with no shipping or billing address. If it was sold in ' +
        `${filing.label}, the figures understate it.`,
    },
    {
      id: 'ownStoreCanceledWithoutRefund',
      severity: 'review',
      count: summary.attention.canceledWithoutRefund,
      label: `Canceled ${brand} own store orders with no refund recorded`,
      detail: 'Counted as sales: the order is canceled, but no refund was recorded on it. Check the payment.',
    },
  ]
}

function ownStoreTables(summary: OwnStoreTaxSummary, filing: TaxReturnFiling): TaxReturnSectionTable[] {
  const rows = summary.parts.flatMap((part) =>
    Object.entries(part.byJurisdiction).map(([jurisdiction, figures]) => ({ part, jurisdiction, figures })),
  )
  return [
    {
      description:
        'Each store’s sales by where they are taxed — at the counter where the store is, online where the ' +
        'order shipped — with the refunds made in this period beside them. All of it is folded into the ' +
        'filing figures above.',
      columns: [
        { label: 'Store and channel' },
        { label: 'State' },
        { label: 'Sales', numeric: true },
        { label: 'Total sales', numeric: true, money: true },
        { label: 'Taxable sales', numeric: true, money: true },
        { label: 'Tax collected', numeric: true, money: true },
        { label: 'Refunded in period', numeric: true, money: true },
      ],
      rows: rows
        .sort(
          (a, b) =>
            Number(b.jurisdiction === filing.code) - Number(a.jurisdiction === filing.code) ||
            a.part.label.localeCompare(b.part.label) ||
            a.jurisdiction.localeCompare(b.jurisdiction),
        )
        .map(({ part, jurisdiction, figures }) => ({
          key: `${part.id}:${jurisdiction}`,
          cells: [
            {
              text: part.label,
              ...(figures.refundCount
                ? { caption: `${figures.refundCount} refund${figures.refundCount === 1 ? '' : 's'} in this period` }
                : {}),
            },
            {
              text: jurisdiction === 'unknown' ? 'Not stated' : jurisdiction,
              ...(jurisdiction === filing.code ? { tag: { label: 'Registered', tone: 'attention' as const } } : {}),
            },
            { text: String(figures.transactionCount) },
            { text: dollars(figures.totalSalesCents), strong: jurisdiction === filing.code },
            { text: dollars(figures.taxableSalesCents) },
            { text: dollars(figures.taxCollectedCents) },
            { text: dollars(figures.refundedSalesCents) },
          ],
        })),
      empty: 'Nothing was sold or refunded at the operator’s own stores in this period.',
      footnote:
        'A sale is in the period it was paid and a refund in the period it was made, never netted. Taxable ' +
        'sales are the base Stripe stated where it computed the tax, else the whole sale less tax when tax ' +
        'was charged. Test-mode sales are in no figure.',
    },
  ]
}

function ownStoreFigures(own: OwnStores, summary: OwnStoreTaxSummary): TaxReturnSectionFigure[] {
  const figures: TaxReturnSectionFigure[] = [
    {
      label: 'Stores read',
      value: own.stores.length ? own.stores.map((store) => store.name).join(', ') : 'None named',
      note: own.orgId
        ? 'Every site of the workspace named as the operator’s own (POS_HARDWARE_SELLER_ORG_ID).'
        : 'No workspace is named as the operator’s own (POS_HARDWARE_SELLER_ORG_ID), so no store’s sales are folded in.',
    },
    {
      label: 'Sales paid in this period',
      value: String(summary.orders),
      note:
        'Every store, channel and state. Live sales only. Orders placed up to 15 months before the period ' +
        'are read for a payment or refund made in it; one later than that is not.',
    },
  ]
  if (summary.excluded.testModeOrders) {
    figures.push({
      label: 'Test-mode sales left out',
      value: String(summary.excluded.testModeOrders),
      note: 'Made with Stripe’s test keys, so not sales: in no figure.',
    })
  }
  if (summary.excluded.marketplaceRemitted) {
    figures.push({
      label: 'Outside marketplace sales left out',
      value: String(summary.excluded.marketplaceRemitted),
      note: 'Sold on an outside marketplace that collects and remits the tax itself.',
    })
  }
  return figures
}

function ownStoreExports(rows: readonly OwnStoreTaxRow[]): TaxReturnExportBlock[] {
  return [
    {
      placement: 'sections',
      rows: [
        [`${PLATFORM_BRAND_NAME}’s own store orders in this period — folded into the filing figures above`],
        [
          'Store',
          'Order',
          'Channel',
          'Paid (UTC)',
          'Status',
          'Jurisdiction',
          'Total sales (USD)',
          'Taxable sales (USD)',
          'Taxable base',
          'Tax collected (USD)',
          'Refunded (USD)',
          'Refunded at (UTC)',
          'In this period as',
        ],
        ...rows.map((row) => [
          row.store,
          row.orderId,
          row.channel === 'in-person' ? 'in person' : 'online',
          row.paidAt ?? '',
          row.status ?? '',
          row.jurisdiction,
          centsToDollars(row.totalSalesCents),
          centsToDollars(row.taxableSalesCents),
          row.taxableBase,
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
 * The own-stores section for one period, from records already read. Pure,
 * so the section a preparer reads can be proved from fixtures.
 */
export function ownStoreTaxReturnAnswer(
  input: { own: OwnStores; read: OwnStoreRead; statedBases?: ReadonlyMap<string, number> },
  request: TaxReturnSourceRequest,
): TaxReturnSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { filing } = request
  const { summary, rows } = ownStoreTaxSummary({
    stores: input.own.stores,
    orders: input.read.orders,
    period: { start: request.start, end: request.end },
    statedBases: input.statedBases,
  })
  return {
    id: OWN_STORE_TAX_SECTION_ID,
    name: 'Own store',
    title: `${brand}’s own stores — its own sales`,
    help:
      `Everything ${brand} sold from a store of its own, in person and online: card readers, apparel and ` +
      'anything else. These are its own sales, folded into the filing figures above.',
    intro:
      `${brand} sold these itself, from its own stores, so they are its OWN sales and are folded into ` +
      `${filing.figuresName}, one line per store and channel in the breakdown beside the figures. ` +
      'A merchant’s store is never here.',
    truncated: input.read.truncated,
    undatedRows: input.read.undatedRows,
    findings: ownStoreFindings(summary, filing),
    filingLines: [],
    operatorSales: summary.parts,
    tables: ownStoreTables(summary, filing),
    figures: ownStoreFigures(input.own, summary),
    exports: ownStoreExports(rows),
    summary,
    rows,
  }
}
