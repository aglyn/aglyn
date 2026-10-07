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
  heldQuantitiesByLine,
  pluginFulfillmentHolds,
  type PluginFulfillmentHold,
} from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import { pluginShipmentRecords } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { notifyHostManagers } from '@aglyn/tenant-data-admin'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import type { SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { createHash } from 'node:crypto'
import { POD_COLLECTIONS, POD_PLUGIN_ID } from '../constants/bundle-common'
import { POD_PROVIDER_LABELS, type PodOrderStatus, type PodProviderId } from '../model/print-on-demand'
import { PodProviderError } from '../providers/http'
import type { PodRecipient, PodSourceOrder } from '../providers/types'
import { podProviderFor, readPodKeyring } from './config'
import { resolvePodSite } from './site-context'
import {
  isDocumentId,
  openCredentials,
  podDb,
  podOrderId,
  podOrderRef,
  readConnection,
  readConnections,
  readLinksForProducts,
  readStoredPodOrder,
  type PodOrderWork,
  type StoredPodConnection,
  type StoredPodOrder,
  type StoredPodOrderLine,
  type StoredPodShipment,
} from './store'

/**
 * Sending a store's paid orders to the service that makes them, and writing
 * what it ships back onto the order (AGL-3641).
 *
 * ## In through commerce's events, out through core's shipment seam
 *
 * Commerce raises `order.paid`, `order.cancelled` and `order.refunded` from
 * every door that changes an order, through an outbox that retries a
 * subscriber that throws; this plugin never imports it. A paid order's lines
 * whose product was imported from a connected service become one part per
 * service, `podOrders/{hostId}__{orderId}__{provider}`, created with
 * `create()` so a redelivered event cannot make a second. The address is read
 * from the order through `core.shipment-records` at the moment the part is
 * sent, so no copy of it is kept here; each parcel the service ships is
 * written back through the same seam, keyed by the service's shipment so a
 * retry cannot add it twice, and commerce's own rules, timeline and buyer
 * emails apply to it as to a parcel shipped by hand.
 *
 * ## Sent once
 *
 * The part carries the store's key for the order at the service
 * (`externalId`, derived from the site and the order). Before every send the
 * service is asked whether it already holds an order under that key, so a
 * send that reached the service but whose answer was lost is found, never
 * repeated. A lease taken in a transaction keeps the paid-event delivery, the
 * job and a member's retry from sending at the same moment.
 *
 * ## Test orders, and the merchant's say
 *
 * An order paid in test mode is sent as a DRAFT and never confirmed: the
 * merchant sees it at the service, and nothing is made or charged. A live
 * order is confirmed for production at once, or left a draft for the
 * merchant to confirm when the connection says `review`.
 *
 * ## Failures
 *
 * A failure a retry might cure (the network, a timeout, a 429, a 5xx) is
 * tried again with backoff by the console job; anything else, or the last
 * try, leaves the part `failed` with the service's sentence, shown on the
 * order with a retry, and the site's managers are told. A locked workspace's
 * orders wait, untouched, for the lock to lift.
 */

/** Tries before a part is left `failed`. */
export const POD_MAX_SEND_ATTEMPTS = 6

/** Delay before the next send, indexed by tries already made. */
export const POD_SEND_BACKOFF_MS: readonly number[] = [60_000, 300_000, 900_000, 3_600_000, 21_600_000]

/** How long a send in flight holds a part. */
export const POD_LEASE_MS = 120_000

/** How often the job asks after a part, by where it stands. */
const POLL_MS: Partial<Record<PodOrderStatus, number>> = {
  draft: 24 * 3_600_000,
  submitted: 3 * 3_600_000,
  on_hold: 3 * 3_600_000,
  in_production: 3 * 3_600_000,
  partially_shipped: 3 * 3_600_000,
  shipped: 12 * 3_600_000,
}

/** A part is no longer asked after once it is this old. */
const POLL_HORIZON_MS = 60 * 24 * 3_600_000

/** How long a locked site's part waits before the job looks again. */
const LOCKED_WAIT_MS = 3_600_000

/** The order as commerce's events carry it: the public API's shape, the fields read here. */
export interface PodPaidOrderView {
  id: string
  number?: number | null
  status?: string | null
  currency?: string
  testMode?: boolean
  lineItems?: unknown
}

interface OrderLineView {
  productId?: string
  variantId?: string
  name?: string
  variantLabel?: string
  quantity?: number
  unitAmountCents?: number
}

/** The store's key for an order at a service: unique per site and order, 32 characters. */
export function podExternalId(hostId: string, orderId: string): string {
  return `ag${createHash('sha256').update(`${hostId}\n${orderId}`).digest('hex').slice(0, 30)}`
}

function orderRefOf(order: PodPaidOrderView): string {
  return typeof order.number === 'number' ? `#${order.number}` : `#${String(order.id).slice(-8)}`
}

function errorText(error: unknown): string {
  return String((error as Error)?.message ?? error).slice(0, 400)
}

function nextPoll(status: PodOrderStatus, createdAtMs: number, now: number): { work: PodOrderWork; dueAtMs: number } {
  const interval = POLL_MS[status]
  if (!interval || now - createdAtMs > POLL_HORIZON_MS) return { work: null, dueAtMs: 0 }
  return { work: 'poll', dueAtMs: now + interval }
}

async function siteLocked(hostId: string): Promise<'locked' | 'off' | 'open'> {
  const site = await resolvePodSite(hostId)
  if (!site) return 'off'
  const verdict = await getLockdownVerdict({ org: site.org as never, host: site.host as never, request: { method: 'POST' } }).catch(
    () => null,
  )
  return verdict ? 'locked' : 'open'
}

/**
 * Tells the site's managers. No link: the pages that show an order are the
 * commerce plugin's to address, and it publishes no record route for one, so
 * the notice opens on the notifications list and names the order instead.
 */
async function tell(hostId: string, title: string, body: string): Promise<void> {
  await notifyHostManagers(hostId, { type: 'content.order', title, body }).catch(() => undefined)
}

/* ------------------------------------------------------------------ route */

/**
 * `order.paid`: the order's lines made by a connected service become one
 * part per service, and each is sent at once.
 */
export async function onOrderPaid(envelope: PluginDomainEventEnvelope<{ order?: PodPaidOrderView }>): Promise<void> {
  const order = envelope.payload?.order
  const hostId = envelope.hostId
  if (!order?.id || !isDocumentId(hostId) || !isDocumentId(order.id)) return
  const keyring = readPodKeyring()
  if (!keyring) return
  const site = await resolvePodSite(hostId)
  if (!site) return
  const connections = await readConnections(hostId)
  if (connections.length === 0) return
  const lines: OrderLineView[] = Array.isArray(order.lineItems) ? (order.lineItems as OrderLineView[]) : []
  const links = await readLinksForProducts(
    hostId,
    lines.map((line) => String(line?.productId ?? '')),
  )
  if (links.size === 0) return
  const connected = new Map(connections.map((connection) => [connection.provider, connection]))
  // Units another fulfiller already holds are not sent a second time.
  const elsewhere = heldQuantitiesByLine(
    (await pluginFulfillmentHolds(hostId, order.id, { exceptPluginId: POD_PLUGIN_ID })).holds,
  )
  const parts = new Map<PodProviderId, StoredPodOrderLine[]>()
  lines.forEach((line, lineIndex) => {
    const found = links.get(String(line?.productId ?? ''))
    if (!found || !connected.has(found.link.provider)) return
    const quantity = Math.floor(Number(line?.quantity) || 0) - (elsewhere.get(lineIndex) ?? 0)
    if (quantity <= 0) return
    const variant =
      found.link.variants.find((entry) => entry.variantId === String(line?.variantId ?? '')) ??
      (found.link.variants.length === 1 && !line?.variantId ? found.link.variants[0] : undefined)
    if (!variant) return
    const list = parts.get(found.link.provider) ?? []
    list.push({
      lineIndex,
      name: [line?.name, line?.variantLabel].filter(Boolean).join(' — ').slice(0, 200) || found.link.name,
      quantity,
      sourceProductId: found.link.sourceProductId,
      sourceVariantId: variant.sourceVariantId,
      retailMinor: Math.max(0, Math.round(Number(line?.unitAmountCents) || 0)),
      costMinor: variant.costMinor,
    })
    parts.set(found.link.provider, list)
  })
  const now = Date.now()
  const created: string[] = []
  for (const [provider, partLines] of parts) {
    const connection = connected.get(provider) as StoredPodConnection
    const id = podOrderId(hostId, order.id, provider)
    try {
      await podOrderRef(id).create({
        orgId: site.orgId,
        hostId,
        orderId: order.id,
        orderRef: orderRefOf(order),
        provider,
        storeId: connection.storeId,
        status: 'queued',
        testMode: order.testMode === true,
        externalId: podExternalId(hostId, order.id),
        sourceOrderId: null,
        sourceOrderKey: null,
        rawStatus: null,
        dashboardUrl: null,
        lines: partLines,
        retailCurrency: String(order.currency ?? 'usd').toUpperCase(),
        costs: null,
        shipments: [],
        attempts: 0,
        lastError: null,
        work: 'submit',
        dueAtMs: now,
        leaseUntilMs: 0,
        createdAtMs: now,
        updatedAtMs: now,
      })
      created.push(id)
    } catch (error) {
      // gRPC ALREADY_EXISTS: a redelivered event. Anything else is the
      // outbox's to retry.
      if ((error as { code?: number })?.code !== 6) throw error
    }
  }
  for (const id of created) {
    await sendPodOrder(id, { keyring }).catch((error) => console.error(`[print-on-demand] send ${id} failed`, error))
  }
}

/* ------------------------------------------------------------------- send */

type Claim = { order: StoredPodOrder } | { skipped: string }

async function claim(id: string, accept: (order: StoredPodOrder) => string | null, now: number): Promise<Claim> {
  const ref = podOrderRef(id)
  return podDb().runTransaction(async (tx) => {
    const order = readStoredPodOrder((await tx.get(ref)).data())
    if (!order) return { skipped: 'missing' }
    const refusal = accept(order)
    if (refusal) return { skipped: refusal }
    if (order.leaseUntilMs > now) return { skipped: 'leased' }
    tx.update(ref, { leaseUntilMs: now + POD_LEASE_MS, updatedAtMs: now })
    return { order }
  })
}

/**
 * Lets the part go with what the call learned. A cancellation asked for
 * while the call was in flight wins over the next step the call chose, so
 * the job cancels what was just sent.
 */
async function release(id: string, patch: Record<string, unknown>): Promise<void> {
  const ref = podOrderRef(id)
  await podDb().runTransaction(async (tx) => {
    const current = readStoredPodOrder((await tx.get(ref)).data())
    const now = Date.now()
    const owed = current?.work === 'cancel' && patch['status'] !== 'canceled'
    tx.update(ref, {
      ...patch,
      ...(owed ? { work: 'cancel', dueAtMs: now } : {}),
      leaseUntilMs: 0,
      updatedAtMs: now,
    })
  })
}

function sourcePatch(order: StoredPodOrder, source: PodSourceOrder): Record<string, unknown> {
  return {
    sourceOrderId: source.id || order.sourceOrderId,
    sourceOrderKey: source.id ? `${order.provider}:${order.storeId}:${source.id}` : order.sourceOrderKey,
    status: source.status,
    rawStatus: source.rawStatus,
    costs: source.costs ?? order.costs,
    dashboardUrl: source.dashboardUrl ?? order.dashboardUrl,
  }
}

function recipientOf(record: Awaited<ReturnType<NonNullable<ReturnType<typeof pluginShipmentRecords>>['read']>>): PodRecipient | string {
  const to = record?.shipTo
  if (!to || !to.line1 || !to.city || !to.postalCode || !to.country) {
    return 'The order has no complete shipping address, so it cannot be sent to be made.'
  }
  return {
    name: to.name || 'Customer',
    line1: to.line1,
    ...(to.line2 ? { line2: to.line2 } : {}),
    city: to.city,
    ...(to.state ? { state: to.state } : {}),
    postalCode: to.postalCode,
    country: to.country.toUpperCase(),
    ...(to.phone ? { phone: to.phone } : {}),
    ...((to.email || record?.customerEmail) ? { email: to.email || String(record?.customerEmail) } : {}),
  }
}

export type PodSendOutcome = 'sent' | 'found' | 'retry' | 'failed' | 'waiting' | 'skipped'

/**
 * Sends one part, or finds it already sent. Never throws for the service's
 * answer: the part records it. `force` lets a member retry a failed part.
 */
export async function sendPodOrder(
  id: string,
  options: { keyring?: SecretBoxKeyring | null; force?: boolean; now?: number } = {},
): Promise<PodSendOutcome> {
  const keyring = options.keyring ?? readPodKeyring()
  if (!keyring) return 'skipped'
  const now = options.now ?? Date.now()
  const claimed = await claim(
    id,
    (order) => {
      if (order.sourceOrderId) return 'already-sent'
      if (order.work === 'cancel' || order.status === 'canceled') return 'canceled'
      if (order.status === 'queued') return null
      if (order.status === 'failed' && options.force) return null
      return 'not-queued'
    },
    now,
  )
  if ('skipped' in claimed) return 'skipped'
  const order = claimed.order
  // A member's retry of a failed part starts a fresh budget of tries.
  const attempts = (options.force && order.status === 'failed' ? 0 : order.attempts) + 1
  const providerLabel = POD_PROVIDER_LABELS[order.provider]

  const state = await siteLocked(order.hostId)
  if (state !== 'open') {
    await release(id, {
      status: 'queued',
      work: 'submit',
      dueAtMs: now + LOCKED_WAIT_MS,
      lastError:
        state === 'locked'
          ? 'The workspace is locked, so the order waits to be sent until the lock is lifted.'
          : 'Print on demand or commerce is switched off for this site, so the order waits to be sent.',
    })
    return 'waiting'
  }

  const fail = async (message: string, transient: boolean): Promise<PodSendOutcome> => {
    if (transient && attempts < POD_MAX_SEND_ATTEMPTS) {
      await release(id, {
        status: 'queued',
        attempts,
        work: 'submit',
        dueAtMs: now + POD_SEND_BACKOFF_MS[Math.min(attempts - 1, POD_SEND_BACKOFF_MS.length - 1)],
        lastError: message,
      })
      return 'retry'
    }
    await release(id, { status: 'failed', attempts, work: null, dueAtMs: 0, lastError: message })
    await tell(
      order.hostId,
      `Order ${order.orderRef} not sent to ${providerLabel}`,
      `Order ${order.orderRef} on {site} could not be sent to ${providerLabel} to be made (${message}). ` +
        'Nothing has been made. Fix the problem and send it again from the order, or fulfill it yourself.',
    )
    return 'failed'
  }

  const connection = await readConnection(order.hostId, order.provider)
  if (!connection) return fail(`${providerLabel} is no longer connected. Connect it again, then send the order.`, false)
  const records = pluginShipmentRecords()
  if (!records) return fail('The store’s orders cannot be read on this server.', true)
  const record = await records.read(order.hostId, order.orderId)
  if (!record) return fail('The order no longer exists.', false)
  const recipient = recipientOf(record)
  if (typeof recipient === 'string') return fail(recipient, false)
  // Paid in test mode, by the event's word or the order's own: a draft, never made.
  const testMode = order.testMode || record.testMode === true

  try {
    const credentials = openCredentials(connection, keyring)
    const provider = podProviderFor(order.provider)
    const existing = await provider.findOrder(credentials, order.externalId)
    const confirm = !testMode && connection.submitMode === 'automatic'
    const source =
      existing ??
      (await provider.createOrder(credentials, {
        externalId: order.externalId,
        label: order.orderRef,
        recipient,
        lines: order.lines.map((line) => ({
          lineIndex: line.lineIndex,
          sourceProductId: line.sourceProductId,
          sourceVariantId: line.sourceVariantId,
          quantity: line.quantity,
          retailMinor: line.retailMinor,
          name: line.name,
        })),
        retailCurrency: order.retailCurrency,
        confirm,
      }))
    const after = { ...order, ...sourcePatch(order, source) } as StoredPodOrder
    await release(id, {
      ...sourcePatch(order, source),
      testMode,
      attempts,
      lastError: null,
      ...nextPoll(after.status, order.createdAtMs, now),
    })
    return existing ? 'found' : 'sent'
  } catch (error) {
    if (error instanceof PodProviderError) return fail(error.message, error.transient)
    return fail(errorText(error), true)
  }
}

/* ------------------------------------------------------------------- sync */

export type PodRefreshOutcome = 'refreshed' | 'unsent' | 'failed' | 'skipped'

/** Units of each of the part's lines no parcel written onto the order has carried. */
export function unshippedPodLines(
  order: Pick<StoredPodOrder, 'lines'>,
  shipments: readonly StoredPodShipment[],
): Map<number, number> {
  const left = new Map(order.lines.map((line) => [line.lineIndex, line.quantity]))
  for (const shipment of shipments) {
    if (!shipment.recorded) continue
    for (const line of shipment.lines ?? []) {
      left.set(line.lineIndex, Math.max(0, (left.get(line.lineIndex) ?? 0) - line.quantity))
    }
  }
  return left
}

/**
 * The lines a parcel carried, when the service does not say which: the
 * part's lines the service reports done and no parcel carried yet, or —
 * once the whole part has shipped — everything still left. `null` when it
 * cannot yet be told; the parcel waits rather than being written onto the
 * merchant's own lines.
 */
function inferredLines(
  order: StoredPodOrder,
  shipments: readonly StoredPodShipment[],
  source: PodSourceOrder,
): Array<{ lineIndex: number; quantity: number }> | null {
  const left = unshippedPodLines(order, shipments)
  const remaining = order.lines
    .map((line) => ({ lineIndex: line.lineIndex, quantity: left.get(line.lineIndex) ?? 0, variant: line.sourceVariantId }))
    .filter((line) => line.quantity > 0)
  const done = new Set(source.fulfilledVariantIds)
  const reported = remaining.filter((line) => done.has(line.variant))
  const chosen = reported.length ? reported : source.status === 'shipped' ? remaining : []
  return chosen.length ? chosen.map(({ lineIndex, quantity }) => ({ lineIndex, quantity })) : null
}

/**
 * Asks the service how one part stands, and writes every new parcel onto
 * the store's order. Safe to repeat: a parcel already written is skipped.
 */
export async function refreshPodOrder(
  id: string,
  options: { keyring?: SecretBoxKeyring | null; now?: number } = {},
): Promise<PodRefreshOutcome> {
  const keyring = options.keyring ?? readPodKeyring()
  if (!keyring) return 'skipped'
  const now = options.now ?? Date.now()
  const claimed = await claim(id, (order) => (order.sourceOrderId ? null : 'unsent'), now)
  if ('skipped' in claimed) return claimed.skipped === 'unsent' ? 'unsent' : 'skipped'
  const order = claimed.order
  const connection = await readConnection(order.hostId, order.provider)
  if (!connection) {
    await release(id, { work: null, dueAtMs: 0, lastError: `${POD_PROVIDER_LABELS[order.provider]} is no longer connected.` })
    return 'failed'
  }
  let source: PodSourceOrder
  try {
    source = await podProviderFor(order.provider).getOrder(openCredentials(connection, keyring), String(order.sourceOrderId))
  } catch (error) {
    const transient = error instanceof PodProviderError ? error.transient : true
    await release(id, {
      lastError: errorText(error),
      ...(transient ? { work: 'poll', dueAtMs: now + 900_000 } : { work: null, dueAtMs: 0 }),
    })
    return 'failed'
  }
  const records = pluginShipmentRecords()
  const shipments: StoredPodShipment[] = order.shipments.map((entry) => ({ ...entry }))
  for (const parcel of source.shipments) {
    let stored = shipments.find((entry) => entry.id === parcel.id)
    if (!stored) {
      stored = {
        id: parcel.id,
        carrier: parcel.carrier,
        trackingNumber: parcel.trackingNumber,
        trackingUrl: parcel.trackingUrl,
        recorded: false,
        refusal: null,
        deliveredAtMs: null,
        deliveredRecorded: false,
      }
      shipments.push(stored)
    }
    stored.deliveredAtMs = parcel.deliveredAtMs ?? stored.deliveredAtMs
    // A parcel is written with the lines it carried, never without: a write
    // naming no lines would ship the merchant's own lines too.
    const lines = stored.recorded ? null : (parcel.lines ?? inferredLines(order, shipments, source))
    if (!stored.recorded && records && lines) {
      const outcome = await records.recordShipment({
        hostId: order.hostId,
        recordId: order.orderId,
        lines,
        carrier: parcel.carrier,
        trackingNumber: parcel.trackingNumber,
        ...(parcel.trackingUrl ? { trackingUrl: parcel.trackingUrl } : {}),
        labelRef: `pod:${order.provider}:${parcel.id}`,
      })
      if (outcome.outcome === 'recorded' || outcome.outcome === 'already') {
        stored.recorded = true
        stored.refusal = null
        stored.lines = lines
      } else {
        stored.refusal =
          outcome.outcome === 'blocked'
            ? `The order is ${outcome.from}${outcome.reason ? ` (${outcome.reason})` : ''}, so the parcel was not added to it.`
            : 'The order no longer exists.'
      }
    }
    if (stored.recorded && stored.deliveredAtMs && !stored.deliveredRecorded && records) {
      const tracked = await records.recordTracking({
        hostId: order.hostId,
        recordId: order.orderId,
        trackingNumber: stored.trackingNumber,
        status: 'delivered',
        atMs: stored.deliveredAtMs,
      })
      stored.deliveredRecorded = tracked.outcome === 'recorded' || tracked.outcome === 'unchanged'
    }
  }
  const after = { ...order, ...sourcePatch(order, source) } as StoredPodOrder
  const settled =
    after.status === 'canceled' ||
    (after.status === 'shipped' && shipments.every((entry) => entry.recorded && (order.provider === 'printful' || entry.deliveredRecorded)))
  await release(id, {
    ...sourcePatch(order, source),
    shipments,
    lastError: shipments.find((entry) => entry.refusal)?.refusal ?? null,
    ...(settled ? { work: null, dueAtMs: 0 } : nextPoll(after.status, order.createdAtMs, now)),
  })
  return 'refreshed'
}

/* ------------------------------------------------------- confirm / cancel */

export interface PodChangeOutcome {
  ok: boolean
  /** Why not, when `ok` is false. */
  message?: string
}

/** Confirms a live draft for production. A test order's draft is never confirmed. */
export async function confirmPodOrder(id: string, keyring: SecretBoxKeyring): Promise<PodChangeOutcome> {
  const now = Date.now()
  const claimed = await claim(
    id,
    (order) => (order.testMode ? 'test' : order.status !== 'draft' || !order.sourceOrderId ? 'not-draft' : null),
    now,
  )
  if ('skipped' in claimed) {
    return {
      ok: false,
      message: claimed.skipped === 'test' ? 'A test order is never sent for production.' : 'Only a draft can be confirmed.',
    }
  }
  const order = claimed.order
  const connection = await readConnection(order.hostId, order.provider)
  if (!connection) {
    await release(id, {})
    return { ok: false, message: `${POD_PROVIDER_LABELS[order.provider]} is no longer connected.` }
  }
  try {
    const source = await podProviderFor(order.provider).confirmOrder(openCredentials(connection, keyring), String(order.sourceOrderId))
    const after = { ...order, ...sourcePatch(order, source) } as StoredPodOrder
    await release(id, { ...sourcePatch(order, source), lastError: null, ...nextPoll(after.status, order.createdAtMs, now) })
    return { ok: true }
  } catch (error) {
    await release(id, { lastError: errorText(error) })
    return { ok: false, message: errorText(error) }
  }
}

/**
 * Cancels a part at the service, or — never sent — here. A part being sent
 * is marked so the job cancels it once the send settles. A service that has
 * started making it refuses, and the merchant is told.
 */
export async function cancelPodOrder(id: string, keyring: SecretBoxKeyring, reason: string): Promise<PodChangeOutcome> {
  const now = Date.now()
  const ref = podOrderRef(id)
  const decided = await podDb().runTransaction(async (tx) => {
    const order = readStoredPodOrder((await tx.get(ref)).data())
    if (!order) return { done: 'missing' as const }
    if (order.status === 'canceled') return { done: 'already' as const }
    if (['in_production', 'partially_shipped', 'shipped'].includes(order.status)) return { done: 'too-late' as const, order }
    if (order.leaseUntilMs > now) {
      tx.update(ref, { work: 'cancel', dueAtMs: order.leaseUntilMs, updatedAtMs: now })
      return { done: 'deferred' as const }
    }
    if (!order.sourceOrderId) {
      tx.update(ref, { status: 'canceled', work: null, dueAtMs: 0, lastError: null, updatedAtMs: now })
      return { done: 'here' as const }
    }
    tx.update(ref, { leaseUntilMs: now + POD_LEASE_MS, updatedAtMs: now })
    return { done: 'claimed' as const, order }
  })
  if (decided.done === 'missing') return { ok: false, message: 'Nothing was sent to a service for this order.' }
  if (decided.done === 'already' || decided.done === 'here' || decided.done === 'deferred') return { ok: true }
  const order = decided.order as StoredPodOrder
  const label = POD_PROVIDER_LABELS[order.provider]
  if (decided.done === 'too-late') {
    const message = `${label} has already started making order ${order.orderRef}, so it cannot be canceled here. Ask ${label} directly.`
    await tell(order.hostId, `Order ${order.orderRef} is already in production at ${label}`, `${reason} ${message}`)
    return { ok: false, message }
  }
  const connection = await readConnection(order.hostId, order.provider)
  if (!connection) {
    await release(id, { lastError: `${label} is no longer connected, so the order could not be canceled there.` })
    return { ok: false, message: `${label} is no longer connected.` }
  }
  try {
    const source = await podProviderFor(order.provider).cancelOrder(openCredentials(connection, keyring), String(order.sourceOrderId))
    await release(id, { ...sourcePatch(order, source), work: null, dueAtMs: 0, lastError: null })
    return { ok: true }
  } catch (error) {
    const message = `${label} could not cancel it: ${errorText(error)}`
    const transient = error instanceof PodProviderError && error.transient
    await release(id, { lastError: message, ...(transient ? { work: 'cancel', dueAtMs: now + 900_000 } : {}) })
    if (!transient) await tell(order.hostId, `Order ${order.orderRef} not canceled at ${label}`, `${reason} ${message}`)
    return { ok: false, message }
  }
}

/** The parts of one order, one per service. */
export function podOrderIdsFor(hostId: string, orderId: string): string[] {
  return (['printful', 'printify'] as const).map((provider) => podOrderId(hostId, orderId, provider))
}

async function cancelAll(hostId: string, orderId: string, reason: string): Promise<void> {
  const keyring = readPodKeyring()
  if (!keyring || !isDocumentId(hostId) || !isDocumentId(orderId)) return
  for (const id of podOrderIdsFor(hostId, orderId)) {
    const snapshot = await podOrderRef(id).get()
    if (!snapshot.exists) continue
    const outcome = await cancelPodOrder(id, keyring, reason)
    if (!outcome.ok) console.warn(`[print-on-demand] cancel ${id}: ${outcome.message}`)
  }
}

/** `order.cancelled`: the store canceled the order, so the service should not make it. */
export async function onOrderCancelled(envelope: PluginDomainEventEnvelope<{ order?: PodPaidOrderView }>): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id) return
  await cancelAll(envelope.hostId, order.id, `The order was canceled in the store.`)
}

/** `order.refunded`: a refund of everything means the buyer will not get it; a part refund changes nothing. */
export async function onOrderRefunded(
  envelope: PluginDomainEventEnvelope<{ order?: PodPaidOrderView; refund?: { full?: boolean } }>,
): Promise<void> {
  const order = envelope.payload?.order
  if (!order?.id || envelope.payload?.refund?.full !== true) return
  await cancelAll(envelope.hostId, order.id, `The order was refunded in full.`)
}

/* -------------------------------------------------------------------- job */

const BATCH = 25

/** Due parts of one kind, oldest first. */
async function due(work: Exclude<PodOrderWork, null>, now: number): Promise<string[]> {
  const snapshot = await podDb()
    .collection(POD_COLLECTIONS.orders)
    .where('work', '==', work)
    .where('dueAtMs', '<=', now)
    .orderBy('dueAtMs')
    .limit(BATCH)
    .get()
  return snapshot.docs.map((doc: { id: string }) => doc.id)
}

/**
 * One tick of the console job: sends what is owed, cancels what was asked
 * to be canceled, and asks after what was sent — each part on its own, so
 * one merchant's refusal never stops another's.
 */
export async function runPodOrderTick(context: { nowMs: number; deadlineMs: number }): Promise<Record<string, number>> {
  const keyring = readPodKeyring()
  const counts: Record<string, number> = { sent: 0, retried: 0, failed: 0, canceled: 0, refreshed: 0 }
  if (!keyring) return counts
  const now = context.nowMs
  for (const id of await due('submit', now)) {
    if (Date.now() >= context.deadlineMs) return counts
    const outcome = await sendPodOrder(id, { keyring, now }).catch(() => 'failed' as const)
    if (outcome === 'sent' || outcome === 'found') counts['sent'] += 1
    else if (outcome === 'retry') counts['retried'] += 1
    else if (outcome === 'failed') counts['failed'] += 1
  }
  for (const id of await due('cancel', now)) {
    if (Date.now() >= context.deadlineMs) return counts
    const outcome = await cancelPodOrder(id, keyring, 'The order was canceled in the store.').catch(() => null)
    if (outcome?.ok) counts['canceled'] += 1
  }
  for (const id of await due('poll', now)) {
    if (Date.now() >= context.deadlineMs) return counts
    const outcome = await refreshPodOrder(id, { keyring, now }).catch(() => 'failed' as const)
    if (outcome === 'refreshed') counts['refreshed'] += 1
  }
  return counts
}

/* ------------------------------------------------------------------ holds */

/** The statuses in which a service holds what it has not shipped. */
const HOLDING: readonly PodOrderStatus[] = ['queued', 'draft', 'submitted', 'on_hold', 'in_production', 'partially_shipped']

/**
 * What one service holds of one order (AGL-3641), for core's
 * `core.fulfillment-providers`: each of its lines' units no parcel has yet
 * carried, so a label bought for the rest of the order leaves them off.
 * `pending` until the service has the order, `accepted` after. A canceled,
 * failed or fully shipped part holds nothing.
 */
export async function podFulfillmentHolds(
  hostId: string,
  recordId: string,
  provider: PodProviderId,
): Promise<PluginFulfillmentHold[]> {
  if (!isDocumentId(hostId) || !isDocumentId(recordId)) return []
  const order = readStoredPodOrder((await podOrderRef(podOrderId(hostId, recordId, provider)).get()).data())
  if (!order || !HOLDING.includes(order.status)) return []
  const left = unshippedPodLines(order, order.shipments)
  return order.lines
    .map((line) => ({
      providerId: provider,
      providerLabel: POD_PROVIDER_LABELS[provider],
      lineIndex: line.lineIndex,
      quantity: left.get(line.lineIndex) ?? 0,
      state: order.sourceOrderId && order.status !== 'queued' ? ('accepted' as const) : ('pending' as const),
      ...(order.sourceOrderId ? { reference: order.sourceOrderId } : {}),
    }))
    .filter((hold) => hold.quantity > 0)
}
