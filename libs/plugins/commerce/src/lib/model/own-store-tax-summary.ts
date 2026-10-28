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

/*==========================================
 * THE PLATFORM'S OWN STORES, SUMMED FOR ONE FILING PERIOD (AGL-4038).
 *
 * The platform can sell from a store of its own like any merchant: card
 * readers at an event's register, apparel online, anything it decides to
 * sell later. Every one of those sales is the platform's OWN sale, so they
 * fold into its return's filing figures beside its invoices, whatever the
 * product. This module turns the orders of those stores into the figures the
 * return folds in, one part per store and channel.
 *
 * WHICH STORES ARE THE PLATFORM'S OWN is configuration, never an id in code:
 * every site of the workspace `POS_HARDWARE_SELLER_ORG_ID` names, the
 * workspace the deployment already names as owning its own store
 * ({@link platformOwnStoreOrgId}). A merchant's store is never one of them,
 * so a merchant's sale is never folded in: it stays a facilitated sale on
 * the storefront card.
 *
 * THE RULES, each pinned by `own-store-tax-summary.spec.ts`, the same as the
 * hardware shop's (`pos-hardware-tax-summary.ts`) so the two read alike:
 *
 * - **A sale is in the period it was PAID**, half-open: the order's
 *   `paidAtMs`, else its `paid` timeline event, else when it was placed for
 *   an order that was paid. Its status today does not move it: an order paid
 *   in the period and canceled later is still a sale of that period. An
 *   order that was never paid (a voided register sale, a lapsed draft) is no
 *   sale at all.
 * - **Total sales** are the receipts excluding the tax: the total less the
 *   tax. A tip is outside the total already and is never a sale.
 * - **Taxable sales** are the base Stripe Tax stated for the sale where its
 *   tax row is in hand, else the whole sale less tax when tax was charged
 *   (the store taxes what it sells), else nothing — and an untaxed sale is
 *   counted out loud.
 * - **A refund is in the period it was MADE**, by the latest refund on the
 *   order's timeline, stated beside the sales and never netted from them. An
 *   order keeps only its latest refund stamp, as the platform's invoices do.
 *   The refunded tax is the order's own tax in the refund's share of the
 *   total.
 * - **Test-mode sales are not sales**: left out and counted.
 * - **A sale on an outside marketplace that remits the tax itself** is the
 *   marketplace's to report: left out and counted.
 * - **Where it is taxed**: a register or pickup sale where the store is; any
 *   other where it ships, or the billing address; neither is `unknown`,
 *   counted out loud.
 *
 * A card reader sold at the register is in its register sale here, and the
 * hardware section does not fold it in again (`pos-hardware-tax-return-
 * source.ts`); the store's tax rows leave the storefront card
 * (`tax-return-source.ts`). Each sale is counted once.
 *
 * Integer cents throughout. Pure and total: no Firestore, no clock.
 *=========================================*/

import {
  emptyTaxReturnOperatorFigures,
  type TaxReturnOperatorFigures,
  type TaxReturnOperatorSalesPart,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { taxJurisdictionKey } from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'
import { orderIsTestMode } from './commerce-orders'
import { POS_HARDWARE_ENV } from './pos-hardware'

const ORG_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The workspace whose stores are the platform's own, from the environment,
 * or `null` when none is named: `POS_HARDWARE_SELLER_ORG_ID`, read whether or
 * not the in-person hardware sale is on, because the workspace is the
 * platform's own either way.
 */
export function platformOwnStoreOrgId(env: Record<string, string | undefined>): string | null {
  const orgId = String(env[POS_HARDWARE_ENV.sellerOrgId] ?? '').trim()
  return ORG_ID.test(orgId) ? orgId : null
}

/** One of the platform's own stores, as the return reads it. */
export interface OwnStore {
  hostId: string
  /** How the breakdown names it. */
  name: string
  /** Where the store taxes its counter sales from: its own address's region. */
  origin: { country?: string | null; state?: string | null } | null
}

/** An order of an own store, as the return reads it. */
export interface OwnStoreOrderInput {
  hostId: string
  orderId: string
  status?: unknown
  channel?: unknown
  fulfillmentMethod?: unknown
  channelSource?: { taxRemittedByChannel?: unknown } | null
  totals?: { totalCents?: unknown; taxCents?: unknown } | null
  /** Legacy single-product orders. */
  amountCents?: unknown
  refundedCents?: unknown
  paidAtMs?: unknown
  createdAtMs?: unknown
  cancelledAtMs?: unknown
  updatedAtMs?: unknown
  timeline?: Array<{ atMs?: unknown; event?: unknown }> | null
  livemode?: unknown
  checkoutSessionId?: unknown
  payments?: Array<{ status?: unknown; livemode?: unknown }> | null
  shippingAddress?: { country?: unknown; state?: unknown } | null
  billingAddress?: { country?: unknown; state?: unknown } | null
}

export type OwnStoreChannel = 'online' | 'in-person'

/** How a row counts in the period. */
export type OwnStoreInPeriod = 'sale' | 'refund' | 'sale and refund'

/** One order as the working papers carry it: amounts and the region, no buyer. */
export interface OwnStoreTaxRow {
  hostId: string
  store: string
  orderId: string
  channel: OwnStoreChannel
  status: string | null
  paidAt: string | null
  jurisdiction: string
  totalSalesCents: number
  taxableSalesCents: number
  /** Whether the base is the one Stripe stated, or the whole sale less tax. */
  taxableBase: 'stated' | 'whole sale' | 'untaxed'
  taxCents: number
  refundedCents: number
  refundedAt: string | null
  inPeriodAs: OwnStoreInPeriod
}

export interface OwnStoreTaxSummary {
  periodStart: string
  periodEnd: string
  /** Live sales paid in the period. */
  orders: number
  totalSalesCents: number
  /** The parts the return folds into its filing figures, one per store and channel. */
  parts: TaxReturnOperatorSalesPart[]
  excluded: {
    testModeOrders: number
    /** Sold on an outside marketplace that remits the tax itself. */
    marketplaceRemitted: number
  }
  attention: {
    untaxedOrders: number
    ordersMissingRegion: number
    canceledWithoutRefund: number
  }
}

const cents = (value: unknown): number => {
  const parsed = Math.round(Number(value ?? 0))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const stamp = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/** The latest stamp of a timeline event named one of `names`, or null. */
function latestEvent(order: OwnStoreOrderInput, names: readonly string[]): number | null {
  let latest: number | null = null
  for (const event of Array.isArray(order.timeline) ? order.timeline : []) {
    if (!names.includes(String(event?.event ?? ''))) continue
    const at = stamp(event?.atMs)
    if (at !== null && (latest === null || at > latest)) latest = at
  }
  return latest
}

/** The first `paid` event, which is when the sale was paid. */
function firstPaidEvent(order: OwnStoreOrderInput): number | null {
  let first: number | null = null
  for (const event of Array.isArray(order.timeline) ? order.timeline : []) {
    if (event?.event !== 'paid') continue
    const at = stamp(event?.atMs)
    if (at !== null && (first === null || at < first)) first = at
  }
  return first
}

/** When the order was paid, or null for one that never was. See the module note. */
export function ownStoreOrderPaidAt(order: OwnStoreOrderInput): number | null {
  const paid = stamp(order.paidAtMs) ?? firstPaidEvent(order)
  if (paid !== null) return paid
  const status = String(order.status ?? '')
  const neverPaid = status === 'pending' || (status === 'cancelled' && cents(order.refundedCents) <= 0)
  return neverPaid ? null : stamp(order.createdAtMs)
}

/** When the order's latest refund was made, or null when nothing was refunded. */
export function ownStoreOrderRefundedAt(order: OwnStoreOrderInput): number | null {
  if (cents(order.refundedCents) <= 0) return null
  return (
    latestEvent(order, ['refund', 'refunded']) ??
    stamp(order.cancelledAtMs) ??
    stamp(order.updatedAtMs) ??
    ownStoreOrderPaidAt(order)
  )
}

/**
 * Whether a sale was made in test mode. A register payment states its mode,
 * and every one must be live for the sale to be; otherwise the order's own
 * reading applies, where an order nothing marks is live.
 */
export function ownStoreOrderIsTestMode(order: OwnStoreOrderInput): boolean {
  const modes = (Array.isArray(order.payments) ? order.payments : [])
    .filter((payment) => payment?.status === 'succeeded' && typeof payment?.livemode === 'boolean')
    .map((payment) => payment.livemode as boolean)
  if (modes.length) return !modes.every(Boolean)
  return orderIsTestMode({
    livemode: order.livemode,
    checkoutSessionId: text(order.checkoutSessionId) ?? undefined,
    $id: order.orderId,
  })
}

/** Which of a store's parts an order is in. */
export function ownStoreOrderChannel(order: OwnStoreOrderInput): OwnStoreChannel {
  return order.channel === 'pos' ? 'in-person' : 'online'
}

/** Where an order is taxed. See the module note. */
export function ownStoreOrderJurisdiction(order: OwnStoreOrderInput, store: OwnStore | undefined): string {
  if (ownStoreOrderChannel(order) === 'in-person' || order.fulfillmentMethod === 'pickup') {
    return taxJurisdictionKey(store?.origin ?? null)
  }
  const shipped = taxJurisdictionKey(order.shippingAddress ?? null)
  return shipped !== 'unknown' ? shipped : taxJurisdictionKey(order.billingAddress ?? null)
}

/** The part id a store's channel folds in under. */
export function ownStorePartId(hostId: string, channel: OwnStoreChannel): string {
  return `ownStore:${hostId}:${channel}`
}

function partLabel(store: OwnStore | undefined, hostId: string, channel: OwnStoreChannel): string {
  const name = store?.name || hostId
  return channel === 'in-person' ? `${name} — sold in person` : `${name} — sold online`
}

/**
 * The period's figures from the own stores' orders read for it.
 * `statedBases` maps an order id to the taxable base Stripe stated for it,
 * where its tax row is in hand.
 */
export function ownStoreTaxSummary(input: {
  stores: readonly OwnStore[]
  orders: readonly OwnStoreOrderInput[]
  period: { start: Date; end: Date }
  statedBases?: ReadonlyMap<string, number>
}): { summary: OwnStoreTaxSummary; rows: OwnStoreTaxRow[] } {
  const { period } = input
  const startMs = period.start.getTime()
  const endMs = period.end.getTime()
  const within = (at: number | null) => at !== null && at >= startMs && at < endMs
  const stores = new Map(input.stores.map((store) => [store.hostId, store]))
  const parts = new Map<string, TaxReturnOperatorSalesPart>()
  const summary: OwnStoreTaxSummary = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    orders: 0,
    totalSalesCents: 0,
    parts: [],
    excluded: { testModeOrders: 0, marketplaceRemitted: 0 },
    attention: { untaxedOrders: 0, ordersMissingRegion: 0, canceledWithoutRefund: 0 },
  }
  const rows: OwnStoreTaxRow[] = []
  const seen = new Set<string>()

  for (const order of input.orders ?? []) {
    // Only an own store's order, and each once: the reader merges queries.
    if (!order?.orderId || !stores.has(order.hostId)) continue
    const key = `${order.hostId}/${order.orderId}`
    if (seen.has(key)) continue
    seen.add(key)

    const paidAt = ownStoreOrderPaidAt(order)
    const refundedAt = ownStoreOrderRefundedAt(order)
    const sale = within(paidAt)
    const refund = within(refundedAt)
    if (!sale && !refund) continue
    if (ownStoreOrderIsTestMode(order)) {
      if (sale) summary.excluded.testModeOrders += 1
      continue
    }
    if (order.channel === 'marketplace' && order.channelSource?.taxRemittedByChannel === true) {
      if (sale) summary.excluded.marketplaceRemitted += 1
      continue
    }

    const store = stores.get(order.hostId)
    const channel = ownStoreOrderChannel(order)
    const jurisdiction = ownStoreOrderJurisdiction(order, store)
    const partId = ownStorePartId(order.hostId, channel)
    const part =
      parts.get(partId) ??
      (() => {
        const created: TaxReturnOperatorSalesPart = {
          id: partId,
          label: partLabel(store, order.hostId, channel),
          byJurisdiction: {},
        }
        parts.set(partId, created)
        return created
      })()
    const bucket: TaxReturnOperatorFigures = (part.byJurisdiction[jurisdiction] ??= emptyTaxReturnOperatorFigures())

    const total = cents(order.totals?.totalCents ?? order.amountCents)
    const tax = Math.min(cents(order.totals?.taxCents), total)
    const sales = total - tax
    const stated = input.statedBases?.get(order.orderId)
    const taxableBase: OwnStoreTaxRow['taxableBase'] =
      typeof stated === 'number' && Number.isFinite(stated) ? 'stated' : tax > 0 ? 'whole sale' : 'untaxed'
    const taxable =
      taxableBase === 'stated' ? Math.min(cents(stated), sales) : taxableBase === 'whole sale' ? sales : 0

    if (sale) {
      summary.orders += 1
      summary.totalSalesCents += sales
      bucket.transactionCount += 1
      bucket.totalSalesCents += sales
      bucket.taxableSalesCents += taxable
      bucket.taxCollectedCents += tax
      if (tax === 0) summary.attention.untaxedOrders += 1
      if (jurisdiction === 'unknown') summary.attention.ordersMissingRegion += 1
      const status = String(order.status ?? '')
      if ((status === 'cancelled' || status === 'refunded') && cents(order.refundedCents) <= 0) {
        summary.attention.canceledWithoutRefund += 1
      }
    }

    const refunded = Math.min(cents(order.refundedCents), total)
    if (refund) {
      // A whole refund gives back the order's own tax; a partial one is split
      // in the order's own ratio.
      const refundedTax = refunded >= total ? tax : total > 0 ? Math.round((refunded * tax) / total) : 0
      bucket.refundCount += 1
      bucket.refundedSalesCents += refunded - refundedTax
      bucket.refundedTaxCents += refundedTax
    }

    rows.push({
      hostId: order.hostId,
      store: store?.name || order.hostId,
      orderId: order.orderId,
      channel,
      status: text(order.status),
      paidAt: paidAt === null ? null : new Date(paidAt).toISOString(),
      jurisdiction,
      totalSalesCents: sales,
      taxableSalesCents: taxable,
      taxableBase,
      taxCents: tax,
      refundedCents: refunded,
      refundedAt: refundedAt === null ? null : new Date(refundedAt).toISOString(),
      inPeriodAs: sale && refund ? 'sale and refund' : sale ? 'sale' : 'refund',
    })
  }
  summary.parts = [...parts.values()]
  return { summary, rows }
}

/** The taxable base a Stripe tax row states: the largest line's, since each level restates one base. */
export function statedTaxableBase(
  lines: ReadonlyArray<{ taxableAmountCents?: unknown } | null | undefined> | null | undefined,
): number | null {
  let base: number | null = null
  for (const line of lines ?? []) {
    const value = Number(line?.taxableAmountCents)
    if (line?.taxableAmountCents === null || line?.taxableAmountCents === undefined || !Number.isFinite(value)) continue
    base = base === null ? Math.round(value) : Math.max(base, Math.round(value))
  }
  return base
}
