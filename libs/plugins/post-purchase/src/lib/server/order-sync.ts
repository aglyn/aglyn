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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import {
  PACKAGE_PROTECTION_KEY,
  POST_PURCHASE_COLLECTIONS,
  POST_PURCHASE_PLUGIN_ID,
  type PostPurchaseVendor,
} from '../constants/bundle-common'
import type { PostPurchaseOrderView } from '../model/post-purchase-settings'
import { createAftershipTracking } from '../providers/aftership'
import { PostPurchaseProviderError } from '../providers/http'
import { upsertNarvarOrder, type NarvarOrder } from '../providers/narvar'
import { cancelRouteOrder, createRouteOrder, createRouteShipment } from '../providers/route'
import { readPostPurchaseConfig, type PostPurchaseConfig } from './config'
import { orgRef, postPurchaseDb } from './db'
import { openVendor, readStoredSettings, type StoredPostPurchaseSettings } from './settings-store'
import { resolvePostPurchaseSite } from './site-context'

/**
 * WHAT EACH SERVICE IS TOLD ABOUT AN ORDER (AGL-3635), from the seller's own
 * order events — `order.paid`, `order.fulfilled`, `order.refunded`,
 * `order.cancelled` — subscribed by name. The seller is never imported and
 * its documents are never read: everything below comes off the event's
 * `order`, which is the public API's shape.
 *
 * Delivery is at least once and each subscriber is retried alone, so every
 * handler is idempotent on its own record
 * (`orgs/{orgId}/postPurchaseOrders/{hostId}__{recordId}`):
 *
 * - a Route policy is claimed in a transaction before it is opened, so two
 *   deliveries open one; Route also refuses a second policy for one order
 *   id, which covers a process that died between the call and the write;
 * - a parcel is told to each service once, keyed by its shipment;
 * - Narvar takes the whole order each time, so a repeat is a repeat.
 *
 * A vendor's PERMANENT refusal (a revoked token, a body it rejects) is
 * recorded on the order for the merchant and not retried; anything else
 * throws, and the event bus retries with backoff.
 */

/** The order as the seller's events carry it: only the fields read here. */
export interface PostPurchaseEventOrder {
  id: string
  number: number | null
  status: string | null
  currency: string
  customerEmail: string | null
  customerName: string | null
  lineItems?: unknown
  shippingAddress?: Record<string, unknown> | null
  fulfillments?: Array<{
    id: string | null
    status?: string
    carrier: string | null
    trackingNumber: string | null
    lines?: Array<{ lineItemId: number; quantity: number }>
    at?: string | null
  }>
  extras?: Array<{ id: string; pluginId: string; key: string; label: string; amountCents: number; quoteRef: string | null }>
  created?: unknown
}

export interface OrderEventPayload {
  order: PostPurchaseEventOrder
}
export interface OrderFulfilledPayload extends OrderEventPayload {
  fulfillment: {
    id: string
    lines: Array<{ lineItemId: number; quantity: number }>
    carrier: string | null
    trackingNumber: string | null
  }
}
export interface OrderRefundedPayload extends OrderEventPayload {
  refund: { full: boolean }
}

/** What this plugin keeps about one order. */
export interface StoredPostPurchaseOrder {
  orgId: string
  hostId: string
  recordId: string
  route?: {
    status: 'registering' | 'registered' | 'cancelled' | 'failed'
    premiumCents: number
    policyId: string | null
    claimedAtMs?: number
    error?: string | null
    /** Shipment id → tracking number, for parcels Route was told about. */
    shipments?: Record<string, string>
  }
  /** Tracking number → which service follows it. */
  parcels?: Record<string, { vendor: PostPurchaseVendor; atMs: number }>
  narvar?: { syncedAtMs: number; error: string | null }
}

/** How long a claimed policy blocks a second delivery before it is tried again. */
const CLAIM_STALE_MS = 2 * 60 * 1000

/** One order's record id: the site and the order, so each pair has exactly one. */
export function orderStateKey(hostId: string, recordId: string): string {
  return `${hostId}__${recordId}`
}

export function orderStateRef(orgId: string, hostId: string, recordId: string) {
  return orgRef(orgId).collection(POST_PURCHASE_COLLECTIONS.orders).doc(orderStateKey(hostId, recordId))
}

interface Context {
  orgId: string
  hostId: string
  config: PostPurchaseConfig
  stored: StoredPostPurchaseSettings
}

async function contextFor(hostId: string): Promise<Context | null> {
  const configured = readPostPurchaseConfig()
  if (!configured.configured) return null
  const site = await resolvePostPurchaseSite(hostId)
  if (!site) return null
  return { orgId: site.orgId, hostId, config: configured.config, stored: await readStoredSettings(site.orgId, hostId) }
}

interface Line {
  id: string
  name: string
  sku: string | null
  quantity: number
  unitCents: number
  physical: boolean
}

function linesOf(order: PostPurchaseEventOrder): Line[] {
  const raw = Array.isArray(order.lineItems) ? (order.lineItems as Array<Record<string, unknown>>) : []
  return raw.map((line, index) => ({
    id: String(line?.['productId'] ?? `line-${index}`),
    name: String(line?.['name'] ?? 'Item'),
    sku: typeof line?.['sku'] === 'string' ? (line['sku'] as string) : null,
    quantity: Math.max(0, Math.round(Number(line?.['quantity']) || 0)),
    unitCents: Math.max(0, Math.round(Number(line?.['unitAmountCents']) || 0)),
    physical: String(line?.['productType'] ?? 'physical') === 'physical',
  }))
}

function shipToOf(order: PostPurchaseEventOrder): NarvarOrder['shipTo'] {
  const address = order.shippingAddress
  if (!address || typeof address !== 'object') return null
  const pick = (key: string) => (typeof address[key] === 'string' ? (address[key] as string) : undefined)
  return {
    line1: pick('line1'),
    line2: pick('line2'),
    city: pick('city'),
    state: pick('state'),
    postalCode: pick('postalCode'),
    country: pick('country'),
  }
}

function orderNumberOf(order: PostPurchaseEventOrder): string {
  return order.number ? String(order.number) : order.id
}

function createdAtOf(order: PostPurchaseEventOrder, fallback: number): number {
  return Date.parse(String(order.created ?? '')) || fallback
}

/** The protection line this plugin offered, when the buyer took it. */
export function protectionBought(order: PostPurchaseEventOrder) {
  return (order.extras ?? []).find(
    (extra) => extra?.pluginId === POST_PURCHASE_PLUGIN_ID && extra?.key === PACKAGE_PROTECTION_KEY && extra.amountCents > 0,
  )
}

function refusalText(error: unknown): string {
  if (error instanceof PostPurchaseProviderError) return `${error.vendor} refused it (${error.status}).`
  return 'The service refused it.'
}

function isPermanent(error: unknown): boolean {
  return error instanceof PostPurchaseProviderError && error.permanent
}

/** `order.paid` → open the Route policy the buyer paid for. */
export async function openProtectionPolicy(envelope: PluginDomainEventEnvelope<OrderEventPayload>): Promise<void> {
  const order = envelope.payload?.order
  const bought = order ? protectionBought(order) : undefined
  if (!order || !bought) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const ref = orderStateRef(context.orgId, context.hostId, order.id)
  const nowMs = Date.now()
  const claim = await postPurchaseDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const state = snapshot.data() as StoredPostPurchaseOrder | undefined
    const route = state?.route
    if (route && (route.status === 'registered' || route.status === 'cancelled')) return 'done' as const
    if (route?.status === 'failed' && route.error && !route.error.startsWith('retry:')) return 'done' as const
    if (route?.status === 'registering' && nowMs - Number(route.claimedAtMs ?? 0) < CLAIM_STALE_MS) return 'busy' as const
    transaction.set(
      ref,
      {
        orgId: context.orgId,
        hostId: context.hostId,
        recordId: order.id,
        route: { status: 'registering', premiumCents: bought.amountCents, policyId: null, claimedAtMs: nowMs, error: null },
      },
      { merge: true },
    )
    return 'claimed' as const
  })
  if (claim === 'done') return
  if (claim === 'busy') throw new Error(`protection policy for ${order.id} is being opened by another delivery`)
  // Bought means it is owed even if the merchant switched Route off since:
  // the buyer paid for cover on THIS order.
  const route = openVendor(context.stored, context.config, 'route', { ignoreSwitch: true })
  if (!route) {
    await ref.set(
      { route: { status: 'failed', error: 'Route is not connected for this site, so the policy could not be opened.' } },
      { merge: true },
    )
    return
  }
  const lines = linesOf(order).filter((line) => line.physical && line.quantity > 0)
  try {
    const opened = await createRouteOrder(
      { token: route.token, apiBase: context.config.routeApiBase, fetchImpl: context.config.fetchImpl },
      {
        sourceOrderId: order.id,
        sourceOrderNumber: orderNumberOf(order),
        createdAtMs: createdAtOf(order, envelope.occurredAtMs),
        currency: order.currency || 'usd',
        subtotalCents: lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0),
        premiumCents: bought.amountCents,
        quoteId: bought.quoteRef,
        customer: { name: order.customerName, email: order.customerEmail },
        shipTo: shipToOf(order),
        items: lines,
      },
    )
    await ref.set({ route: { status: 'registered', policyId: opened.policyId, error: null } }, { merge: true })
  } catch (error) {
    if (isPermanent(error)) {
      await ref.set({ route: { status: 'failed', error: refusalText(error) } }, { merge: true })
      return
    }
    await ref.set({ route: { status: 'failed', error: `retry: ${refusalText(error)}` } }, { merge: true })
    throw error
  }
}

/** `order.fulfilled` → tell Route which parcel the covered goods left in. */
export async function tellRouteShipment(envelope: PluginDomainEventEnvelope<OrderFulfilledPayload>): Promise<void> {
  const order = envelope.payload?.order
  const fulfillment = envelope.payload?.fulfillment
  if (!order || !fulfillment?.trackingNumber || !protectionBought(order)) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const ref = orderStateRef(context.orgId, context.hostId, order.id)
  const state = (await ref.get()).data() as StoredPostPurchaseOrder | undefined
  const route = state?.route
  if (!route || route.status === 'cancelled') return
  if (route.status === 'failed' && route.error && !route.error.startsWith('retry:')) return
  // The policy is not open yet: its own delivery is still being retried.
  if (route.status !== 'registered') throw new Error(`protection policy for ${order.id} is not open yet`)
  if (route.shipments?.[fulfillment.id]) return
  const opened = openVendor(context.stored, context.config, 'route', { ignoreSwitch: true })
  if (!opened) return
  const lines = linesOf(order)
  try {
    await createRouteShipment(
      { token: opened.token, apiBase: context.config.routeApiBase, fetchImpl: context.config.fetchImpl },
      {
        sourceOrderId: order.id,
        trackingNumber: fulfillment.trackingNumber,
        carrier: fulfillment.carrier,
        itemIds: fulfillment.lines.map((line) => lines[line.lineItemId]?.id).filter((id): id is string => Boolean(id)),
      },
    )
  } catch (error) {
    if (!isPermanent(error)) throw error
    console.error(`[post-purchase] Route refused a shipment for ${order.id}`, error)
    return
  }
  await ref.set({ route: { shipments: { [fulfillment.id]: fulfillment.trackingNumber } } }, { merge: true })
}

/** `order.refunded` (whole) and `order.cancelled` → end the policy. */
export async function endProtectionPolicy(
  envelope: PluginDomainEventEnvelope<OrderEventPayload & Partial<OrderRefundedPayload>>,
): Promise<void> {
  const order = envelope.payload?.order
  if (!order || !protectionBought(order)) return
  if (envelope.event === 'order.refunded' && envelope.payload?.refund?.full !== true) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const ref = orderStateRef(context.orgId, context.hostId, order.id)
  const state = (await ref.get()).data() as StoredPostPurchaseOrder | undefined
  const route = state?.route
  if (!route || route.status === 'cancelled') return
  if (route.status === 'registering') throw new Error(`protection policy for ${order.id} is still being opened`)
  if (route.status !== 'registered' || !route.policyId) {
    // Nothing open at Route to end; record that cover is not owed.
    await ref.set({ route: { status: 'cancelled' } }, { merge: true })
    return
  }
  const opened = openVendor(context.stored, context.config, 'route', { ignoreSwitch: true })
  if (!opened) {
    await ref.set({ route: { error: 'Route is not connected, so the policy could not be canceled there.' } }, { merge: true })
    return
  }
  try {
    await cancelRouteOrder(
      { token: opened.token, apiBase: context.config.routeApiBase, fetchImpl: context.config.fetchImpl },
      route.policyId,
    )
  } catch (error) {
    if (!isPermanent(error)) throw error
    await ref.set({ route: { error: refusalText(error) } }, { merge: true })
    return
  }
  await ref.set({ route: { status: 'cancelled', error: null } }, { merge: true })
}

/** `order.fulfilled` → AfterShip follows the parcel. */
export async function followParcel(envelope: PluginDomainEventEnvelope<OrderFulfilledPayload>): Promise<void> {
  const order = envelope.payload?.order
  const fulfillment = envelope.payload?.fulfillment
  const trackingNumber = String(fulfillment?.trackingNumber ?? '').replace(/\s+/g, '')
  if (!order || !trackingNumber) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const aftership = openVendor(context.stored, context.config, 'aftership')
  if (!aftership) return
  const ref = orderStateRef(context.orgId, context.hostId, order.id)
  const state = (await ref.get()).data() as StoredPostPurchaseOrder | undefined
  if (state?.parcels?.[trackingNumber]) return
  try {
    await createAftershipTracking({
      apiKey: aftership.apiKey,
      trackingNumber,
      carrier: fulfillment?.carrier,
      hostId: context.hostId,
      recordId: order.id,
      orderNumber: orderNumberOf(order),
      customerName: order.customerName,
      fetchImpl: context.config.fetchImpl,
    })
  } catch (error) {
    if (!isPermanent(error)) throw error
    console.error(`[post-purchase] AfterShip refused ${trackingNumber} for ${order.id}`, error)
    return
  }
  await ref.set(
    {
      orgId: context.orgId,
      hostId: context.hostId,
      recordId: order.id,
      parcels: { [trackingNumber]: { vendor: 'aftership', atMs: Date.now() } },
    },
    { merge: true },
  )
}

function narvarStatus(event: string, order: PostPurchaseEventOrder): NarvarOrder['status'] {
  if (event === 'order.cancelled' || order.status === 'cancelled') return 'CANCELLED'
  if (order.status === 'delivered') return 'DELIVERED'
  if (order.status === 'partially_fulfilled') return 'PARTIAL'
  if (order.status === 'fulfilled') return 'SHIPPED'
  return 'PROCESSING'
}

/** `order.paid`, `order.fulfilled`, `order.cancelled` → Narvar has the whole order. */
export async function syncNarvarOrder(envelope: PluginDomainEventEnvelope<OrderEventPayload>): Promise<void> {
  const order = envelope.payload?.order
  if (!order) return
  const context = await contextFor(envelope.hostId)
  if (!context) return
  const narvar = openVendor(context.stored, context.config, 'narvar')
  if (!narvar) return
  const lines = linesOf(order)
  const ref = orderStateRef(context.orgId, context.hostId, order.id)
  try {
    await upsertNarvarOrder(
      { accountId: narvar.accountId, authToken: narvar.authToken, apiBase: context.config.narvarApiBase, fetchImpl: context.config.fetchImpl },
      {
        orderNumber: orderNumberOf(order),
        createdAtMs: createdAtOf(order, envelope.occurredAtMs),
        status: narvarStatus(envelope.event, order),
        currency: order.currency || 'usd',
        customer: { name: order.customerName, email: order.customerEmail },
        shipTo: shipToOf(order),
        items: lines.filter((line) => line.quantity > 0),
        shipments: (order.fulfillments ?? [])
          .filter((entry) => entry && entry.status !== 'cancelled' && entry.trackingNumber)
          .map((entry) => ({
            carrier: entry.carrier,
            trackingNumber: String(entry.trackingNumber),
            atMs: Date.parse(String(entry.at ?? '')) || envelope.occurredAtMs,
            lines: (entry.lines ?? []).map((line) => ({
              itemId: lines[line.lineItemId]?.id ?? `line-${line.lineItemId}`,
              sku: lines[line.lineItemId]?.sku ?? null,
              quantity: line.quantity,
            })),
          })),
      },
    )
  } catch (error) {
    if (!isPermanent(error)) throw error
    await ref.set(
      { orgId: context.orgId, hostId: context.hostId, recordId: order.id, narvar: { syncedAtMs: Date.now(), error: refusalText(error) } },
      { merge: true },
    )
    return
  }
  await ref.set(
    { orgId: context.orgId, hostId: context.hostId, recordId: order.id, narvar: { syncedAtMs: Date.now(), error: null } },
    { merge: true },
  )
}

/** The order widget's view of one order. */
export function toOrderView(state: StoredPostPurchaseOrder | undefined): PostPurchaseOrderView {
  const route = state?.route
  return {
    protection: route
      ? {
          status: route.status,
          premiumCents: Number(route.premiumCents) || 0,
          policyId: route.policyId ?? null,
          error: route.error ? route.error.replace(/^retry: /, '') : null,
        }
      : null,
    trackedParcels: Object.entries(state?.parcels ?? {})
      .map(([trackingNumber, entry]) => ({ trackingNumber, vendor: entry.vendor, atMs: entry.atMs }))
      .sort((a, b) => a.atMs - b.atMs),
    narvar: state?.narvar ?? null,
  }
}
