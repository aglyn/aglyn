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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  FULFILLMENT_NETWORK_CONNECTIONS_COLLECTION,
  FULFILLMENT_NETWORK_LOG_SUBCOLLECTION,
  FULFILLMENT_NETWORK_ORDERS_COLLECTION,
  LOG_ROWS_KEPT,
} from '../constants'
import type {
  AmazonShippingSpeed,
  NetworkConnectionStatus,
  NetworkConnectionView,
  NetworkInventorySummary,
  NetworkLogEntry,
  NetworkMarketplace,
  NetworkOrderLine,
  NetworkOrderStatus,
  NetworkOrderView,
  NetworkProviderId,
  NetworkRoutingMode,
} from '../model/networks'

/**
 * Where connections and hand-offs are kept (AGL-3634):
 * `fulfillmentNetworkConnections/{hostId}_{provider}` with its `log`, and
 * `fulfillmentNetworkOrders/{hostId}_{orderId}_{provider}`. The rules refuse
 * every client all of them; this module, the routes and the console job are
 * the only writers, through the Admin SDK.
 *
 * Plain fields, epoch-ms numbers rather than server timestamps: the engine
 * compares them with its own clock, and a spec drives that clock.
 */

/** A connection as stored. The sealed fields carry `token` in their names, which the data export redacts by. */
export interface StoredConnection {
  orgId: string
  hostId: string
  provider: NetworkProviderId
  status: NetworkConnectionStatus
  sandbox: boolean
  accountName: string | null
  /** ShipBob: the channel the grant created. */
  channelId: string | null
  /** Amazon: the marketplaces the seller takes part in, and the one that ships. */
  marketplaces: NetworkMarketplace[]
  marketplaceId: string | null
  routing: NetworkRoutingMode
  shippingMethod: string
  shippingSpeed: AmazonShippingSpeed
  syncInventory: boolean
  sealedAccessToken: string | null
  sealedRefreshToken: string | null
  accessTokenExpiresAtMs: number | null
  tokenKeyId: string | null
  /** SHA-256 of the token ShipBob's webhook addresses carry. */
  webhookTokenHash: string | null
  /** The network's last count, by SKU, for the hold a queued order is shown with. */
  stock: Record<string, number>
  inventory: NetworkInventorySummary
  inventoryDueAtMs: number
  inventoryLeaseUntilMs: number
  lastError: string | null
  totals: NetworkConnectionView['totals']
  connectedAtMs: number | null
  connectedByUid: string | null
  pendingOAuth: PendingOAuth | null
  updatedAtMs: number
}

/** A connect between its start and the network's redirect back: the nonce's hash, never the nonce. */
export interface PendingOAuth {
  nonceHash: string
  expMs: number
  uid: string
  returnTo: string
}

/** A parcel read back from the network, and the shipment it became on the order. */
export interface StoredShipment {
  /** The order's shipment id the seller answered; empty until the write landed. */
  recordedShipmentId: string
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  trackingStatus: string | null
  packageNumber: string | null
  atMs: number
}

/** One order's hand-off to one network. */
export interface StoredRouting {
  orgId: string
  hostId: string
  recordId: string
  provider: NetworkProviderId
  connectionId: string
  displayRef: string
  status: NetworkOrderStatus
  /** Sends so far: the reference's suffix, so a re-send after a cancel is a new order at the network. */
  attempt: number
  reference: string | null
  providerOrderId: string | null
  lines: NetworkOrderLine[]
  /** By the network's parcel id. */
  shipments: Record<string, StoredShipment>
  note: string | null
  cancelRequested: boolean
  /** Whether the job still has something to do: send, read back, follow, or cancel. */
  active: boolean
  nextRunAtMs: number
  leaseUntilMs: number
  failures: number
  testMode: boolean
  lastShippedAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
}

export const EMPTY_INVENTORY: NetworkInventorySummary = {
  syncedAtMs: null,
  skus: 0,
  updated: 0,
  unchanged: 0,
  unknown: 0,
  untracked: 0,
  perLocation: 0,
}

export function emptyConnection(input: {
  orgId: string
  hostId: string
  provider: NetworkProviderId
  sandbox: boolean
  nowMs: number
}): StoredConnection {
  return {
    orgId: input.orgId,
    hostId: input.hostId,
    provider: input.provider,
    status: 'reconnect',
    sandbox: input.sandbox,
    accountName: null,
    channelId: null,
    marketplaces: [],
    marketplaceId: null,
    routing: 'automatic',
    shippingMethod: 'Standard',
    shippingSpeed: 'Standard',
    syncInventory: false,
    sealedAccessToken: null,
    sealedRefreshToken: null,
    accessTokenExpiresAtMs: null,
    tokenKeyId: null,
    webhookTokenHash: null,
    stock: {},
    inventory: { ...EMPTY_INVENTORY },
    inventoryDueAtMs: input.nowMs,
    inventoryLeaseUntilMs: 0,
    lastError: null,
    totals: { sent: 0, shipped: 0, canceled: 0 },
    connectedAtMs: null,
    connectedByUid: null,
    pendingOAuth: null,
    updatedAtMs: input.nowMs,
  }
}

/** The console's view of a connection: never a credential, a lease, a token hash or the stock map. */
export function connectionView(id: string, stored: StoredConnection): NetworkConnectionView {
  return {
    id,
    provider: stored.provider,
    hostId: stored.hostId,
    status: stored.status,
    sandbox: stored.sandbox === true,
    accountName: stored.accountName ?? null,
    routing: stored.routing === 'manual' ? 'manual' : 'automatic',
    shippingMethod: stored.shippingMethod || 'Standard',
    shippingSpeed: stored.shippingSpeed || 'Standard',
    marketplaceId: stored.marketplaceId ?? null,
    marketplaces: Array.isArray(stored.marketplaces) ? stored.marketplaces : [],
    syncInventory: stored.syncInventory === true,
    inventory: { ...EMPTY_INVENTORY, ...(stored.inventory ?? {}) },
    lastError: stored.lastError ?? null,
    connectedAtMs: stored.connectedAtMs ?? null,
    totals: {
      sent: stored.totals?.sent ?? 0,
      shipped: stored.totals?.shipped ?? 0,
      canceled: stored.totals?.canceled ?? 0,
    },
  }
}

/** The console's view of a hand-off. */
export function routingView(stored: StoredRouting): NetworkOrderView {
  return {
    provider: stored.provider,
    status: stored.status,
    reference: stored.reference ?? null,
    lines: Array.isArray(stored.lines) ? stored.lines : [],
    shipments: Object.entries(stored.shipments ?? {})
      .map(([id, shipment]) => ({
        id,
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: shipment.trackingUrl,
        trackingStatus: shipment.trackingStatus,
        atMs: shipment.atMs,
      }))
      .sort((a, b) => a.atMs - b.atMs),
    note: stored.note ?? null,
    cancelRequested: stored.cancelRequested === true,
    updatedAtMs: stored.updatedAtMs,
  }
}

/** The storage the engine, the intake and the routes use. A spec supplies an in-memory one. */
export interface NetworkStore {
  getConnection(id: string): Promise<StoredConnection | null>
  /** Creates or merges fields. */
  patchConnection(id: string, patch: Partial<StoredConnection>): Promise<void>
  removeConnection(id: string): Promise<void>
  connectionsForHost(hostId: string): Promise<Array<{ id: string; connection: StoredConnection }>>
  /** Active connections whose stock count is due, oldest first. */
  inventoryDue(nowMs: number, limit: number): Promise<string[]>
  /** Takes a connection's stock-count lease; `null` when another run holds it or it is not due. */
  leaseInventory(id: string, nowMs: number, leaseMs: number): Promise<StoredConnection | null>
  appendLog(id: string, entry: Omit<NetworkLogEntry, 'id'>): Promise<void>
  readLog(id: string, limit: number): Promise<NetworkLogEntry[]>

  getRouting(id: string): Promise<StoredRouting | null>
  /** Creates a hand-off; `false` when one already exists under that id. */
  createRouting(id: string, routing: StoredRouting): Promise<boolean>
  patchRouting(id: string, patch: Partial<StoredRouting>): Promise<void>
  /** Hand-offs with work due, oldest first. */
  dueRoutings(nowMs: number, limit: number): Promise<string[]>
  /** Takes a hand-off's lease; `null` when another run holds it or nothing is due. */
  leaseRouting(id: string, nowMs: number, leaseMs: number, options?: { force?: boolean }): Promise<StoredRouting | null>
  /** A connection's hand-offs the job still works on. */
  activeRoutingsForConnection(connectionId: string, limit: number): Promise<Array<{ id: string; routing: StoredRouting }>>
  /** The hand-off a network order id belongs to, within one connection. */
  routingByProviderOrder(connectionId: string, providerOrderId: string): Promise<{ id: string; routing: StoredRouting } | null>
}

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreNetworkStore(firestore: () => any): NetworkStore {
  const connections = () => firestore().collection(FULFILLMENT_NETWORK_CONNECTIONS_COLLECTION)
  const routings = () => firestore().collection(FULFILLMENT_NETWORK_ORDERS_COLLECTION)
  const alreadyExists = (error: any) => error?.code === 6 || /already exists/i.test(String(error?.message ?? ''))

  return {
    async getConnection(id) {
      const snapshot = await connections().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredConnection) : null
    },

    async patchConnection(id, patch) {
      await connections().doc(id).set(patch, { merge: true })
    },

    async removeConnection(id) {
      const ref = connections().doc(id)
      const log = await ref.collection(FULFILLMENT_NETWORK_LOG_SUBCOLLECTION).limit(500).get()
      await Promise.all(log.docs.map((doc: any) => doc.ref.delete()))
      await ref.delete()
    },

    async connectionsForHost(hostId) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, connection: doc.data() as StoredConnection }))
    },

    async inventoryDue(nowMs, limit) {
      const snapshot = await connections()
        .where('status', '==', 'active')
        .where('inventoryDueAtMs', '<=', nowMs)
        .orderBy('inventoryDueAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.id)
    },

    async leaseInventory(id, nowMs, leaseMs) {
      const ref = connections().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const stored = snapshot.data() as StoredConnection
        if (stored.status !== 'active') return null
        if ((stored.inventoryDueAtMs ?? 0) > nowMs || (stored.inventoryLeaseUntilMs ?? 0) > nowMs) return null
        transaction.set(ref, { inventoryLeaseUntilMs: nowMs + leaseMs }, { merge: true })
        return { ...stored, inventoryLeaseUntilMs: nowMs + leaseMs }
      })
    },

    async appendLog(id, entry) {
      const log = connections().doc(id).collection(FULFILLMENT_NETWORK_LOG_SUBCOLLECTION)
      await log.doc(createResourceUid()).set(entry)
      const stale = await log.orderBy('atMs', 'desc').offset(LOG_ROWS_KEPT).limit(50).get()
      await Promise.all(stale.docs.map((doc: any) => doc.ref.delete()))
    },

    async readLog(id, limit) {
      const snapshot = await connections()
        .doc(id)
        .collection(FULFILLMENT_NETWORK_LOG_SUBCOLLECTION)
        .orderBy('atMs', 'desc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as Omit<NetworkLogEntry, 'id'>) }))
    },

    async getRouting(id) {
      const snapshot = await routings().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredRouting) : null
    },

    async createRouting(id, routing) {
      try {
        await routings().doc(id).create(routing)
        return true
      } catch (error) {
        if (alreadyExists(error)) return false
        throw error
      }
    },

    async patchRouting(id, patch) {
      await routings().doc(id).set(patch, { merge: true })
    },

    async dueRoutings(nowMs, limit) {
      const snapshot = await routings()
        .where('active', '==', true)
        .where('nextRunAtMs', '<=', nowMs)
        .orderBy('nextRunAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.id)
    },

    async leaseRouting(id, nowMs, leaseMs, options) {
      const ref = routings().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const stored = snapshot.data() as StoredRouting
        if ((stored.leaseUntilMs ?? 0) > nowMs) return null
        if (!options?.force && (!stored.active || (stored.nextRunAtMs ?? 0) > nowMs)) return null
        transaction.set(ref, { leaseUntilMs: nowMs + leaseMs }, { merge: true })
        return { ...stored, leaseUntilMs: nowMs + leaseMs }
      })
    },

    async activeRoutingsForConnection(connectionId, limit) {
      const snapshot = await routings()
        .where('connectionId', '==', connectionId)
        .where('active', '==', true)
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, routing: doc.data() as StoredRouting }))
    },

    async routingByProviderOrder(connectionId, providerOrderId) {
      const snapshot = await routings()
        .where('connectionId', '==', connectionId)
        .where('providerOrderId', '==', providerOrderId)
        .limit(1)
        .get()
      const doc = snapshot.docs[0]
      return doc ? { id: doc.id, routing: doc.data() as StoredRouting } : null
    },
  }
}
