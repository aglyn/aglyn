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

import type {
  PluginFulfillmentHolds,
} from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import type {
  PluginShipmentRecords,
  PluginShippableRecord,
  PluginTrackingStatus,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import type { PluginStockLevels } from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { createHash } from 'node:crypto'
import {
  INVENTORY_INTERVAL_MS,
  INVENTORY_MAX_SKUS,
  LEASE_MS,
  ORDER_POLL_MS,
  ORDERS_PER_TICK,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  SEND_MAX_ATTEMPTS,
  TRACKING_FOLLOW_MS,
  TRACKING_POLL_MS,
} from '../constants'
import {
  NETWORK_PROVIDERS,
  networkOrderId,
  type NetworkOrderLine,
  type NetworkOrderStatus,
  type NetworkProviderId,
} from '../model/networks'
import { allocateParcel, keptReasonLabel, planLines, retryDelayMs, routingHolds } from '../model/routing'
import { isProviderError, ProviderError } from '../providers/http'
import type {
  FulfillmentNetworkProvider,
  NetworkAddress,
  NetworkCredential,
  NetworkOrder,
  NetworkShipment,
} from '../providers/provider'
import type { NetworkStore, StoredConnection, StoredRouting, StoredShipment } from './store'

/**
 * THE HAND-OFF ENGINE (AGL-3634): sends a paid order's lines to a network,
 * reads its shipments back onto the order, follows each parcel, cancels on
 * request, and counts the network's stock into the store.
 *
 * Every run of one hand-off holds its lease, so two ticks (or a tick and a
 * "Send now") never send one order twice; and the network itself dedupes on
 * our reference, which is looked up before every create, so a create that
 * timed out after the network took it is adopted rather than repeated.
 *
 * The order is only ever written through core's `core.shipment-records`: a
 * parcel becomes a shipment under the seller's own rules, keyed by
 * `{network}:{parcel id}` so a second read of the same parcel is `already`,
 * and its tracking moves the order to delivered the way the seller does.
 */

export interface EngineDeps {
  now(): number
  store: NetworkStore
  provider(id: NetworkProviderId): FulfillmentNetworkProvider
  credential(connectionId: string, connection: StoredConnection): Promise<NetworkCredential>
  /** The seller's orders; `null` when nothing on the deployment sells. */
  records(): PluginShipmentRecords | null
  /** What other plugins' fulfillers hold of one order. */
  otherHolds(hostId: string, recordId: string): Promise<PluginFulfillmentHolds>
  stockLevels(): PluginStockLevels | null
  /** Whether the site may run this plugin now: entitled, switched on, selling, not locked. */
  siteOpen(hostId: string): Promise<boolean>
}

/** Our reference for one order at a network: stable per order and send, at most 40 characters. */
export function referenceFor(hostId: string, recordId: string, attempt: number): string {
  const digest = createHash('sha256').update(`${hostId}/${recordId}`).digest('hex').slice(0, 30)
  return attempt > 1 ? `ag${digest}-${attempt}` : `ag${digest}`
}

const label = (provider: NetworkProviderId) => NETWORK_PROVIDERS[provider].label
const shortLabel = (provider: NetworkProviderId) => NETWORK_PROVIDERS[provider].shortLabel

/** The order's address, when the network has every field it needs. */
export function networkAddress(record: PluginShippableRecord): NetworkAddress | null {
  const to = record.shipTo
  const name = String(to?.name ?? '').trim()
  const line1 = String(to?.line1 ?? '').trim()
  const city = String(to?.city ?? '').trim()
  const postalCode = String(to?.postalCode ?? '').trim()
  const country = String(to?.country ?? '').trim().toUpperCase()
  const state = String(to?.state ?? '').trim()
  if (!name || !line1 || !city || !postalCode || !/^[A-Z]{2}$/.test(country)) return null
  if ((country === 'US' || country === 'CA') && !state) return null
  return {
    name,
    line1,
    ...(to?.line2 ? { line2: String(to.line2) } : {}),
    city,
    ...(state ? { state } : {}),
    postalCode,
    country,
    ...(to?.phone ? { phone: String(to.phone) } : {}),
    ...(record.customerEmail ? { email: record.customerEmail } : {}),
  }
}

/** What one run of a hand-off came to. */
export type RoutingRunOutcome =
  | 'leased_elsewhere'
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'deferred'
  | 'read'
  | 'canceled'
  | 'retry'

const DEFER_MS = 60 * 60 * 1000

export function createEngine(deps: EngineDeps) {
  const log = (connectionId: string, kind: Parameters<NetworkStore['appendLog']>[1]['kind'], message: string, recordId?: string) =>
    deps.store
      .appendLog(connectionId, { atMs: deps.now(), kind, message: message.slice(0, 300), ...(recordId ? { recordId } : {}) })
      .catch((error) => console.error('[fulfillment-networks] log not written', error))

  const bumpTotals = async (connectionId: string, key: 'sent' | 'shipped' | 'canceled', by = 1) => {
    const current = await deps.store.getConnection(connectionId)
    if (!current) return
    const totals = { sent: 0, shipped: 0, canceled: 0, ...(current.totals ?? {}) }
    totals[key] += by
    await deps.store.patchConnection(connectionId, { totals })
  }

  /** Ends a run: writes the patch, releases the lease. */
  const settle = async (id: string, patch: Partial<StoredRouting>) => {
    await deps.store.patchRouting(id, { ...patch, leaseUntilMs: 0, updatedAtMs: deps.now() })
  }

  const finish = (status: NetworkOrderStatus, note: string | null): Partial<StoredRouting> => ({
    status,
    note,
    active: false,
    cancelRequested: false,
  })

  /** A failure talking to the network: the grant, a refusal, or a blip to retry. */
  const onError = async (
    id: string,
    routing: StoredRouting,
    connectionId: string,
    error: unknown,
  ): Promise<RoutingRunOutcome> => {
    const network = label(routing.provider)
    if (isProviderError(error) && error.kind === 'auth') {
      await deps.store.patchConnection(connectionId, {
        status: 'reconnect',
        lastError: `${network} refused the connection. Connect again to keep orders moving.`,
        updatedAtMs: deps.now(),
      })
      await log(connectionId, 'error', `${network} refused the connection: ${error.message}`, routing.recordId)
      await settle(id, { nextRunAtMs: deps.now() + DEFER_MS })
      return 'deferred'
    }
    if (isProviderError(error) && (error.kind === 'invalid' || error.kind === 'not-found') && routing.status === 'queued') {
      await log(connectionId, 'error', `${network} refused order ${routing.displayRef}: ${error.message}`, routing.recordId)
      await settle(id, { ...finish('failed', `${network} refused the order: ${error.message}`), failures: routing.failures + 1 })
      return 'failed'
    }
    const failures = (routing.failures ?? 0) + 1
    const message = isProviderError(error) ? error.message : 'Something went wrong'
    if (!isProviderError(error)) console.error('[fulfillment-networks] hand-off failed', routing.recordId, error)
    if (routing.status === 'queued' && failures >= SEND_MAX_ATTEMPTS) {
      await log(connectionId, 'error', `Order ${routing.displayRef} was not sent after ${failures} tries: ${message}`, routing.recordId)
      await settle(id, { ...finish('failed', `${network} could not be reached after ${failures} tries: ${message}`), failures })
      return 'failed'
    }
    const waitMs =
      isProviderError(error) && error.kind === 'rate-limit' && error.retryAfterMs
        ? Math.max(error.retryAfterMs, 60_000)
        : retryDelayMs(failures, RETRY_BASE_MS, RETRY_MAX_MS)
    await settle(id, { failures, nextRunAtMs: deps.now() + waitMs })
    return 'retry'
  }

  /** The units the plugin's own other hand-offs of this order hold, and whether one goes first. */
  const siblings = async (routing: StoredRouting, connection: StoredConnection) => {
    const held = new Map<number, number>()
    let waitFor: string | null = null
    for (const other of Object.keys(NETWORK_PROVIDERS) as NetworkProviderId[]) {
      if (other === routing.provider) continue
      const sibling = await deps.store.getRouting(networkOrderId(routing.hostId, routing.recordId, other))
      if (!sibling) continue
      if (sibling.status === 'queued') {
        const siblingConnection = await deps.store.getConnection(sibling.connectionId)
        // The network connected first sends first: one order is never offered to two at once.
        if ((siblingConnection?.connectedAtMs ?? Infinity) < (connection.connectedAtMs ?? Infinity)) waitFor = label(other)
        continue
      }
      for (const hold of routingHolds(sibling)) held.set(hold.lineIndex, (held.get(hold.lineIndex) ?? 0) + hold.quantity)
    }
    return { held, waitFor }
  }

  async function send(id: string, routing: StoredRouting, connection: StoredConnection, forced: boolean): Promise<RoutingRunOutcome> {
    const network = label(routing.provider)
    if (connection.status === 'paused' && !forced) {
      await settle(id, finish('skipped', `Not sent: the ${network} connection was paused.`))
      return 'skipped'
    }
    const records = deps.records()
    const record = records ? await records.read(routing.hostId, routing.recordId) : null
    if (!record) {
      await settle(id, finish('skipped', 'The order was not found.'))
      return 'skipped'
    }
    if (!record.shippable) {
      await settle(id, finish('skipped', `Not sent: the order is ${record.status}.`))
      return 'skipped'
    }
    if (record.testMode === true && !connection.sandbox) {
      await settle(id, { ...finish('skipped', `A test order: nothing is sent to ${network} for it.`), testMode: true })
      return 'skipped'
    }
    if (record.testMode !== true && connection.sandbox) {
      await settle(id, finish('skipped', `Not sent: this site is connected to the ${network} sandbox, where nothing real ships.`))
      return 'skipped'
    }
    const address = networkAddress(record)
    if (!address) {
      await settle(id, finish('failed', `Not sent: the order has no complete shipping address. Fix it, then send it to ${network}.`))
      return 'failed'
    }
    if (routing.provider === 'amazon-mcf' && !connection.marketplaceId) {
      await settle(id, finish('failed', 'Not sent: choose the Amazon marketplace whose inventory ships, then send it again.'))
      return 'failed'
    }
    if (routing.provider === 'shipmonk' && !connection.storeId) {
      await settle(id, finish('failed', 'Not sent: connect ShipMonk again with its store id, then send it again.'))
      return 'failed'
    }
    const others = await deps.otherHolds(routing.hostId, routing.recordId)
    if (others.unanswered.length) {
      await settle(id, { nextRunAtMs: deps.now() + RETRY_BASE_MS })
      return 'deferred'
    }
    const own = await siblings(routing, connection)
    if (own.waitFor) {
      await settle(id, { nextRunAtMs: deps.now() + 60_000 })
      return 'deferred'
    }
    const held = new Map(own.held)
    for (const hold of others.holds) held.set(hold.lineIndex, (held.get(hold.lineIndex) ?? 0) + hold.quantity)

    const credential = await deps.credential(routing.connectionId, connection)
    const provider = deps.provider(routing.provider)
    const skus = record.lines.map((line) => String(line.sku ?? '').trim()).filter(Boolean)
    const stock = new Map((skus.length ? await provider.stock(credential, skus) : []).map((entry) => [entry.sku, entry.fulfillable]))
    const plan = planLines({ lines: record.lines, held, stock })
    const keptNote = plan.keep.length
      ? `Kept for you to ship: ${plan.keep
          .map((line) => `${line.name} (${keptReasonLabel(line.reason, network)})`)
          .join('; ')}.`
      : null
    if (!plan.send.length) {
      await settle(id, { ...finish('skipped', keptNote ?? 'Nothing on the order is left to ship.'), lines: [] })
      return 'skipped'
    }
    const attempt = Math.max(1, routing.attempt || 1)
    const reference = referenceFor(routing.hostId, routing.recordId, attempt)
    const existing = await provider.findOrder(credential, reference)
    const order: NetworkOrder =
      existing && existing.state !== 'canceled'
        ? existing
        : await provider.createOrder(credential, {
            reference,
            displayRef: record.displayRef,
            orderedAtMs: record.createdAtMs ?? deps.now(),
            currency: record.currency || 'usd',
            address,
            items: plan.send.map((line) => ({
              lineIndex: line.lineIndex,
              sku: line.sku,
              name: line.name,
              quantity: line.quantity,
              unitValueCents: line.unitValueCents,
            })),
            shippingMethod: connection.shippingMethod || 'Standard',
            shippingSpeed: connection.shippingSpeed || 'Standard',
          })
    await settle(id, {
      status: 'accepted',
      reference,
      attempt,
      providerOrderId: order.id || reference,
      lines: plan.send.map((line) => ({
        lineIndex: line.lineIndex,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        shippedQuantity: 0,
      })),
      note: keptNote,
      failures: 0,
      active: true,
      nextRunAtMs: deps.now() + ORDER_POLL_MS,
    })
    await bumpTotals(routing.connectionId, 'sent')
    await log(
      routing.connectionId,
      'sent',
      `Order ${routing.displayRef} sent to ${network}: ${plan.send.reduce((sum, line) => sum + line.quantity, 0)} items.`,
      routing.recordId,
    )
    return 'sent'
  }

  /** Writes a parcel onto the order, once; answers what to keep about it, or `null` to try again later. */
  async function recordParcel(
    routing: StoredRouting,
    lines: NetworkOrderLine[],
    parcel: NetworkShipment,
  ): Promise<StoredShipment | null> {
    if (!parcel.trackingNumber) return null
    const allocation = allocateParcel(lines, parcel.items)
    const stored: StoredShipment = {
      recordedShipmentId: '',
      carrier: parcel.carrier,
      trackingNumber: parcel.trackingNumber,
      trackingUrl: parcel.trackingUrl,
      trackingStatus: parcel.trackingStatus,
      packageNumber: parcel.packageNumber ?? null,
      atMs: parcel.shippedAtMs ?? deps.now(),
    }
    if (!allocation.length) return stored
    const records = deps.records()
    if (!records) return null
    const outcome = await records.recordShipment({
      hostId: routing.hostId,
      recordId: routing.recordId,
      lines: allocation,
      carrier: parcel.carrier || shortLabel(routing.provider),
      trackingNumber: parcel.trackingNumber,
      ...(parcel.trackingUrl ? { trackingUrl: parcel.trackingUrl } : {}),
      labelRef: `${routing.provider}:${parcel.id}`,
    })
    if (outcome.outcome === 'recorded' || outcome.outcome === 'already') {
      for (const part of allocation) {
        const line = lines.find((entry) => entry.lineIndex === part.lineIndex)
        if (line) line.shippedQuantity = Math.min(line.quantity, line.shippedQuantity + part.quantity)
      }
      return { ...stored, recordedShipmentId: outcome.shipmentId ?? '' }
    }
    if (outcome.outcome === 'blocked') {
      await log(
        routing.connectionId,
        'error',
        `${label(routing.provider)} shipped part of order ${routing.displayRef}, but the order is ${outcome.from}, so the shipment was not recorded.`,
        routing.recordId,
      )
      return stored
    }
    return stored
  }

  /** Records a tracking word on the order when it moved. */
  async function track(routing: StoredRouting, shipment: StoredShipment, status: PluginTrackingStatus, detail: string | null) {
    if (shipment.trackingStatus === status || !shipment.trackingNumber || !shipment.recordedShipmentId) {
      shipment.trackingStatus = status
      return
    }
    const records = deps.records()
    if (!records) return
    await records.recordTracking({
      hostId: routing.hostId,
      recordId: routing.recordId,
      trackingNumber: shipment.trackingNumber,
      status,
      ...(detail ? { detail } : {}),
      atMs: deps.now(),
    })
    shipment.trackingStatus = status
  }

  async function readBack(id: string, routing: StoredRouting, connection: StoredConnection): Promise<RoutingRunOutcome> {
    const network = label(routing.provider)
    const credential = await deps.credential(routing.connectionId, connection)
    const provider = deps.provider(routing.provider)
    const reference = routing.reference ?? referenceFor(routing.hostId, routing.recordId, routing.attempt || 1)
    const order = await provider.getOrder(credential, routing.providerOrderId ?? reference, reference)
    const lines = (routing.lines ?? []).map((line) => ({ ...line }))
    const shipments: Record<string, StoredShipment> = { ...(routing.shipments ?? {}) }
    let newlyShipped = 0
    let lastShippedAtMs = routing.lastShippedAtMs ?? null
    for (const parcel of order.shipments) {
      if (shipments[parcel.id]) continue
      const stored = await recordParcel(routing, lines, parcel)
      if (!stored) continue
      shipments[parcel.id] = stored
      newlyShipped += 1
      lastShippedAtMs = Math.max(lastShippedAtMs ?? 0, stored.atMs)
    }
    if (provider.tracking) {
      for (const parcel of order.shipments) {
        const stored = shipments[parcel.id]
        if (!stored || stored.trackingStatus === 'delivered' || stored.trackingStatus === 'returned') continue
        const latest = await provider.tracking(credential, parcel)
        if (latest) await track(routing, stored, latest.status, latest.detail)
      }
    }
    if (newlyShipped) {
      await bumpTotals(routing.connectionId, 'shipped', newlyShipped)
      await log(routing.connectionId, 'shipped', `${network} shipped ${newlyShipped === 1 ? 'a parcel' : `${newlyShipped} parcels`} of order ${routing.displayRef}.`, routing.recordId)
    }
    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    const shippedUnits = lines.reduce((sum, line) => sum + line.shippedQuantity, 0)
    const base: Partial<StoredRouting> = { lines, shipments, lastShippedAtMs, failures: 0 }
    if (order.state === 'canceled') {
      const status: NetworkOrderStatus = shippedUnits === 0 ? 'canceled' : 'partially_shipped'
      await settle(id, {
        ...base,
        ...finish(status, shippedUnits === 0 ? `${network} canceled the order.` : `${network} canceled what had not shipped.`),
      })
      if (shippedUnits === 0) await bumpTotals(routing.connectionId, 'canceled')
      await log(routing.connectionId, 'canceled', `${network} canceled order ${routing.displayRef}.`, routing.recordId)
      return 'canceled'
    }
    if (order.state === 'refused') {
      await settle(id, { ...base, ...finish('failed', order.detail ?? `${network} could not fulfill the order.`) })
      await log(routing.connectionId, 'error', order.detail ?? `${network} could not fulfill order ${routing.displayRef}.`, routing.recordId)
      return 'failed'
    }
    const status: NetworkOrderStatus = shippedUnits >= units && units > 0 ? 'shipped' : shippedUnits > 0 ? 'partially_shipped' : 'accepted'
    if (status !== 'shipped') {
      await settle(id, { ...base, status, note: order.detail ?? routing.note ?? null, active: true, nextRunAtMs: deps.now() + ORDER_POLL_MS })
      return 'read'
    }
    // Every unit has shipped: follow the parcels until they arrive, where
    // the network reports tracking; ShipBob reports a delivery by webhook.
    const settled = Object.values(shipments).every(
      (shipment) => shipment.trackingStatus === 'delivered' || shipment.trackingStatus === 'returned',
    )
    const stale = deps.now() - (lastShippedAtMs ?? deps.now()) > TRACKING_FOLLOW_MS
    const follow = Boolean(provider.tracking) && !settled && !stale
    await settle(id, {
      ...base,
      status,
      note: null,
      active: follow,
      nextRunAtMs: deps.now() + TRACKING_POLL_MS,
    })
    return 'read'
  }

  async function cancel(id: string, routing: StoredRouting, connection: StoredConnection): Promise<RoutingRunOutcome> {
    const network = label(routing.provider)
    if (routing.status === 'queued' || !routing.providerOrderId) {
      await settle(id, finish('canceled', 'Canceled before it was sent.'))
      return 'canceled'
    }
    const credential = await deps.credential(routing.connectionId, connection)
    const reference = routing.reference ?? referenceFor(routing.hostId, routing.recordId, routing.attempt || 1)
    const outcome = await deps.provider(routing.provider).cancelOrder(credential, routing.providerOrderId, reference)
    if (outcome === 'canceled') {
      const shipped = (routing.lines ?? []).some((line) => line.shippedQuantity > 0)
      await settle(id, finish(shipped ? 'partially_shipped' : 'canceled', `Canceled at ${network}.`))
      if (!shipped) await bumpTotals(routing.connectionId, 'canceled')
      await log(routing.connectionId, 'canceled', `Order ${routing.displayRef} canceled at ${network}.`, routing.recordId)
      return 'canceled'
    }
    if (outcome === 'requested') {
      // The warehouse confirms it: read back until the network says canceled or shipped.
      await log(routing.connectionId, 'canceled', `Cancellation of order ${routing.displayRef} requested at ${network}.`, routing.recordId)
      await settle(id, {
        cancelRequested: false,
        note: `A cancellation was requested at ${network}; its warehouse confirms it. Anything that ships anyway comes back to the order.`,
        active: true,
        nextRunAtMs: deps.now() + ORDER_POLL_MS,
      })
      return 'read'
    }
    await log(routing.connectionId, 'error', `${network} could not cancel order ${routing.displayRef}: it was already being packed.`, routing.recordId)
    await settle(id, {
      cancelRequested: false,
      note: `${network} could not cancel it: it was already being packed or had shipped. Anything that ships comes back to the order.`,
      nextRunAtMs: deps.now(),
    })
    return 'read'
  }

  /** One run of one hand-off under its lease. `force` runs it now, due or not (a member's "Send now"). */
  async function runRouting(id: string, options: { force?: boolean } = {}): Promise<RoutingRunOutcome> {
    const routing = await deps.store.leaseRouting(id, deps.now(), LEASE_MS, { force: options.force === true })
    if (!routing) return 'leased_elsewhere'
    const connection = await deps.store.getConnection(routing.connectionId)
    if (!connection) {
      await settle(id, finish(routing.status === 'queued' ? 'skipped' : 'failed', `${label(routing.provider)} was disconnected. Check the order there.`))
      return 'skipped'
    }
    if (connection.status === 'reconnect') {
      await settle(id, { nextRunAtMs: deps.now() + DEFER_MS })
      return 'deferred'
    }
    if (!(await deps.siteOpen(routing.hostId))) {
      await settle(id, { nextRunAtMs: deps.now() + DEFER_MS })
      return 'deferred'
    }
    try {
      if (routing.cancelRequested) return await cancel(id, routing, connection)
      if (routing.status === 'queued') return await send(id, routing, connection, options.force === true)
      return await readBack(id, routing, connection)
    } catch (error) {
      if (isProviderError(error) && error.kind === 'not-found' && routing.status !== 'queued') {
        await settle(id, finish('failed', `${label(routing.provider)} no longer has this order. Check it there.`))
        return 'failed'
      }
      return onError(id, routing, routing.connectionId, error)
    }
  }

  /** The job's pass over every hand-off with work due. */
  async function runDue(limit = ORDERS_PER_TICK): Promise<Record<RoutingRunOutcome, number>> {
    const counts = {} as Record<RoutingRunOutcome, number>
    for (const id of await deps.store.dueRoutings(deps.now(), limit)) {
      let outcome: RoutingRunOutcome
      try {
        outcome = await runRouting(id)
      } catch (error) {
        console.error('[fulfillment-networks] hand-off run failed', id, error)
        outcome = 'retry'
      }
      counts[outcome] = (counts[outcome] ?? 0) + 1
    }
    return counts
  }

  /** Counts a connection's stock at the network, and — when the merchant asked — sets the store's counts to it. */
  async function runInventory(connectionId: string, options: { force?: boolean } = {}): Promise<'counted' | 'skipped' | 'failed'> {
    const nowMs = deps.now()
    let connection: StoredConnection | null
    if (options.force) {
      connection = await deps.store.getConnection(connectionId)
      if (!connection || connection.status !== 'active') return 'skipped'
    } else {
      connection = await deps.store.leaseInventory(connectionId, nowMs, LEASE_MS)
      if (!connection) return 'skipped'
    }
    const network = label(connection.provider)
    try {
      if (!(await deps.siteOpen(connection.hostId))) {
        await deps.store.patchConnection(connectionId, { inventoryDueAtMs: nowMs + INVENTORY_INTERVAL_MS, inventoryLeaseUntilMs: 0 })
        return 'skipped'
      }
      if (connection.provider === 'amazon-mcf' && !connection.marketplaceId) {
        await deps.store.patchConnection(connectionId, { inventoryDueAtMs: nowMs + INVENTORY_INTERVAL_MS, inventoryLeaseUntilMs: 0 })
        return 'skipped'
      }
      const credential = await deps.credential(connectionId, connection)
      const counted = await deps.provider(connection.provider).allStock(credential, INVENTORY_MAX_SKUS)
      const stock: Record<string, number> = {}
      for (const entry of counted) stock[entry.sku] = entry.fulfillable
      const summary = { syncedAtMs: nowMs, skus: counted.length, updated: 0, unchanged: 0, unknown: 0, untracked: 0, perLocation: 0 }
      const levels = deps.stockLevels()
      if (connection.syncInventory && levels && counted.length) {
        // An order queued here and not yet sent is already off the store's
        // count but still on the network's; take it off what is set.
        const pending = new Map<string, number>()
        for (const { routing } of await deps.store.activeRoutingsForConnection(connectionId, 500)) {
          if (routing.status !== 'queued') continue
          for (const line of routing.lines ?? []) pending.set(line.sku, (pending.get(line.sku) ?? 0) + line.quantity)
        }
        const results = await levels.setAvailable({
          hostId: connection.hostId,
          source: shortLabel(connection.provider),
          levels: counted.map((entry) => ({ sku: entry.sku, quantity: Math.max(0, entry.fulfillable - (pending.get(entry.sku) ?? 0)) })),
        })
        for (const result of results) {
          if (result.outcome === 'updated') summary.updated += 1
          else if (result.outcome === 'unchanged') summary.unchanged += 1
          else if (result.outcome === 'untracked') summary.untracked += 1
          else if (result.outcome === 'per_location') summary.perLocation += 1
          else if (result.outcome === 'unknown_sku') summary.unknown += 1
        }
      }
      await deps.store.patchConnection(connectionId, {
        stock,
        inventory: summary,
        inventoryDueAtMs: nowMs + INVENTORY_INTERVAL_MS,
        inventoryLeaseUntilMs: 0,
        lastError: null,
        updatedAtMs: nowMs,
      })
      if (connection.syncInventory && summary.updated) {
        await log(connectionId, 'stock', `Stock counts set from ${network} for ${summary.updated} SKU${summary.updated === 1 ? '' : 's'}.`)
      }
      return 'counted'
    } catch (error) {
      const auth = isProviderError(error) && error.kind === 'auth'
      if (!isProviderError(error)) console.error('[fulfillment-networks] stock count failed', connectionId, error)
      await deps.store.patchConnection(connectionId, {
        ...(auth ? { status: 'reconnect' as const } : {}),
        lastError: auth
          ? `${network} refused the connection. Connect again to keep orders moving.`
          : `The stock count failed: ${isProviderError(error) ? error.message : 'something went wrong'}. It runs again within the hour.`,
        inventoryDueAtMs: nowMs + (auth ? INVENTORY_INTERVAL_MS : RETRY_BASE_MS * 6),
        inventoryLeaseUntilMs: 0,
        updatedAtMs: nowMs,
      })
      await log(connectionId, 'error', `Stock count failed: ${isProviderError(error) ? error.message : 'something went wrong'}`)
      return 'failed'
    }
  }

  /**
   * A ShipBob webhook for one of our orders (its address verified by the
   * caller): read the order back now, and apply a delivery or an exception
   * to a parcel already on it. The payload only says WHICH parcel; what is
   * written comes from that parcel being ours.
   */
  async function applyShipbobEvent(
    connectionId: string,
    topic: string,
    payload: { orderId: string | null; shipmentId: string | null },
  ): Promise<'applied' | 'unknown_order'> {
    if (!payload.orderId) return 'unknown_order'
    const found = await deps.store.routingByProviderOrder(connectionId, payload.orderId)
    if (!found) return 'unknown_order'
    const status: PluginTrackingStatus | null =
      topic === 'shipment_delivered' ? 'delivered' : topic === 'shipment_exception' ? 'exception' : null
    const parcel = payload.shipmentId ? found.routing.shipments?.[payload.shipmentId] : undefined
    if (status && parcel) {
      const shipments = { ...found.routing.shipments }
      const copy = { ...parcel }
      await track(found.routing, copy, status, status === 'exception' ? 'ShipBob reported a delivery exception' : null)
      shipments[payload.shipmentId as string] = copy
      await deps.store.patchRouting(found.id, { shipments, updatedAtMs: deps.now() })
    }
    if (found.routing.active) await runRouting(found.id, { force: true })
    return 'applied'
  }

  /**
   * A network's webhook naming one of our orders (its signature verified by
   * the caller, AGL-3697): read the order back now. The payload only says
   * WHICH order; what is written comes from reading it at the network.
   */
  async function applyOrderWebhook(connectionId: string, providerOrderId: string | null): Promise<'applied' | 'unknown_order'> {
    if (!providerOrderId) return 'unknown_order'
    const found = await deps.store.routingByProviderOrder(connectionId, providerOrderId)
    if (!found) return 'unknown_order'
    if (found.routing.active) await runRouting(found.id, { force: true })
    return 'applied'
  }

  return { runRouting, runDue, runInventory, applyShipbobEvent, applyOrderWebhook }
}

export type Engine = ReturnType<typeof createEngine>

/** Whether a thrown value is the network refusing the grant. */
export const isAuthError = (error: unknown): boolean => error instanceof ProviderError && error.kind === 'auth'
