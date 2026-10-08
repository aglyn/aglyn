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
  INVENTORY_SYNC_CONNECTIONS_COLLECTION,
  INVENTORY_SYNC_LOG_SUBCOLLECTION,
  INVENTORY_SYNC_ORDERS_COLLECTION,
  INVENTORY_SYNC_PRODUCTS_COLLECTION,
  LOG_ROWS_KEPT,
} from '../constants'
import type {
  InventoryConnectionStatus,
  InventoryConnectionView,
  InventoryLogEntry,
  InventoryOrderLine,
  InventoryOrderStatus,
  InventoryOrderView,
  InventoryProductSummary,
  InventoryProductSync,
  InventoryProviderId,
  InventoryStockSource,
  InventoryStockSummary,
} from '../model/inventory-sync'
import type { SystemAddress } from '../providers/provider'

/**
 * Where connections, order hand-offs and product links are kept (AGL-3642):
 * `inventorySyncConnections/{hostId}` with its `log`,
 * `inventorySyncOrders/{hostId}_{recordId}` and
 * `inventorySyncProducts/{hostId}_{provider}_{key}`. The rules refuse every
 * client all of them; this module, the routes, the event intake and the
 * console job are the only writers, through the Admin SDK.
 *
 * Plain fields, epoch-ms numbers rather than server timestamps: the engine
 * compares them with its own clock, and a spec drives that clock.
 */

/** A connection as stored. The sealed credential's field names carry `credential`, which the data export redacts by. */
export interface StoredConnection {
  orgId: string
  hostId: string
  provider: InventoryProviderId
  status: InventoryConnectionStatus
  accountName: string | null
  stockSource: InventoryStockSource
  productSync: InventoryProductSync
  sendOrders: boolean
  locationId: string | null
  orderCustomer: string
  taxRule: string
  /** The secret half, sealed: API keys, or Brightpearl's tokens. */
  sealedCredential: string | null
  credentialKeyId: string | null
  /** Brightpearl: the account code and the datacenter its grant named. Not secrets. */
  accountCode: string | null
  apiDomain: string | null
  accessTokenExpiresAtMs: number | null
  /** The system said to slow down: no call for this connection before then. */
  holdUntilMs: number
  stock: InventoryStockSummary
  /** The count last set or seen per SKU, so a run writes only what changed. */
  lastCounts: Record<string, number>
  stockDueAtMs: number
  stockFullDueAtMs: number
  stockLeaseUntilMs: number
  products: InventoryProductSummary
  productsDueAtMs: number
  productsLeaseUntilMs: number
  /** Where an unfinished product run continues. */
  productsCursor: string | null
  /** Import: products changed since this are read; the start of the last finished run. */
  productsSinceMs: number | null
  /** When the run that `productsCursor` belongs to started. */
  productsRunStartedAtMs: number | null
  lastError: string | null
  totals: InventoryConnectionView['totals']
  connectedAtMs: number | null
  connectedByUid: string | null
  pendingOAuth: PendingOAuth | null
  updatedAtMs: number
}

/** A Brightpearl connect between its start and the redirect back: the nonce's hash, never the nonce. */
export interface PendingOAuth {
  nonceHash: string
  expMs: number
  uid: string
  returnTo: string
  accountCode: string
}

/** What an order's hand-off sends, kept so a retry sends what the first attempt tried to. */
export interface StoredOrderSnapshot {
  orderedAtMs: number
  /** ISO 4217, upper case. */
  currency: string
  buyerName: string | null
  buyerEmail: string | null
  shippingAddress: SystemAddress | null
  shippingCents: number
  discountCents: number
  taxCents: number
  totalCents: number
}

/** One paid order's hand-off to the site's connected system. */
export interface StoredOrder {
  orgId: string
  hostId: string
  recordId: string
  provider: InventoryProviderId
  connectionId: string
  displayRef: string
  reference: string
  status: InventoryOrderStatus
  lines: InventoryOrderLine[]
  /** Lines that had no SKU, kept off what is sent and named in the note. */
  skippedLines: string[]
  snapshot: StoredOrderSnapshot
  externalId: string | null
  externalNumber: string | null
  note: string | null
  cancelRequested: boolean
  /** Whether the job still has something to do: send, or cancel. */
  active: boolean
  nextRunAtMs: number
  leaseUntilMs: number
  attempts: number
  createdAtMs: number
  updatedAtMs: number
}

/** One product linked between the store and the system. */
export interface StoredProductLink {
  orgId: string
  hostId: string
  provider: InventoryProviderId
  direction: 'import' | 'export'
  externalId: string
  sku: string
  /** The system's version or modified time last written. */
  version: string
  /** The store's product, when one was written or matched. */
  productId: string | null
  variantId: string | null
  error: string | null
  updatedAtMs: number
}

export const EMPTY_STOCK: InventoryStockSummary = {
  syncedAtMs: null,
  direction: 'off',
  skus: 0,
  updated: 0,
  unchanged: 0,
  unknown: 0,
  untracked: 0,
  perLocation: 0,
  failed: 0,
}

export const EMPTY_PRODUCTS: InventoryProductSummary = {
  syncedAtMs: null,
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
  more: false,
}

export function emptyConnection(input: {
  orgId: string
  hostId: string
  provider: InventoryProviderId
  nowMs: number
}): StoredConnection {
  return {
    orgId: input.orgId,
    hostId: input.hostId,
    provider: input.provider,
    status: 'reconnect',
    accountName: null,
    // Nothing is written on either side until the merchant chooses.
    stockSource: 'off',
    productSync: 'off',
    sendOrders: false,
    locationId: null,
    orderCustomer: '',
    taxRule: '',
    sealedCredential: null,
    credentialKeyId: null,
    accountCode: null,
    apiDomain: null,
    accessTokenExpiresAtMs: null,
    holdUntilMs: 0,
    stock: { ...EMPTY_STOCK },
    lastCounts: {},
    stockDueAtMs: input.nowMs,
    stockFullDueAtMs: input.nowMs,
    stockLeaseUntilMs: 0,
    products: { ...EMPTY_PRODUCTS },
    productsDueAtMs: input.nowMs,
    productsLeaseUntilMs: 0,
    productsCursor: null,
    productsSinceMs: null,
    productsRunStartedAtMs: null,
    lastError: null,
    totals: { ordersSent: 0, ordersFailed: 0 },
    connectedAtMs: null,
    connectedByUid: null,
    pendingOAuth: null,
    updatedAtMs: input.nowMs,
  }
}

/** The console's view of a connection: never a credential, a lease, a cursor or the count map. */
export function connectionView(stored: StoredConnection): InventoryConnectionView {
  return {
    hostId: stored.hostId,
    provider: stored.provider,
    status: stored.status,
    accountName: stored.accountName ?? null,
    stockSource: stored.stockSource ?? 'off',
    productSync: stored.productSync ?? 'off',
    sendOrders: stored.sendOrders === true,
    locationId: stored.locationId ?? null,
    orderCustomer: stored.orderCustomer ?? '',
    taxRule: stored.taxRule ?? '',
    stock: { ...EMPTY_STOCK, ...(stored.stock ?? {}) },
    products: { ...EMPTY_PRODUCTS, ...(stored.products ?? {}) },
    lastError: stored.lastError ?? null,
    connectedAtMs: stored.connectedAtMs ?? null,
    totals: {
      ordersSent: stored.totals?.ordersSent ?? 0,
      ordersFailed: stored.totals?.ordersFailed ?? 0,
    },
  }
}

/** The console's view of a hand-off. */
export function orderView(stored: StoredOrder): InventoryOrderView {
  return {
    recordId: stored.recordId,
    displayRef: stored.displayRef,
    provider: stored.provider,
    status: stored.status,
    reference: stored.reference,
    externalNumber: stored.externalNumber ?? null,
    lines: Array.isArray(stored.lines) ? stored.lines : [],
    note: stored.note ?? null,
    attempts: stored.attempts ?? 0,
    updatedAtMs: stored.updatedAtMs,
  }
}

export type ConnectionWork = 'stock' | 'products'

const DUE_FIELD: Record<ConnectionWork, 'stockDueAtMs' | 'productsDueAtMs'> = {
  stock: 'stockDueAtMs',
  products: 'productsDueAtMs',
}
const LEASE_FIELD: Record<ConnectionWork, 'stockLeaseUntilMs' | 'productsLeaseUntilMs'> = {
  stock: 'stockLeaseUntilMs',
  products: 'productsLeaseUntilMs',
}

/** The storage the engine, the intake and the routes use. A spec supplies an in-memory one. */
export interface InventoryStore {
  getConnection(id: string): Promise<StoredConnection | null>
  /** Creates or merges fields. */
  patchConnection(id: string, patch: Partial<StoredConnection>): Promise<void>
  /** Removes the connection, its log and its product links. */
  removeConnection(id: string): Promise<void>
  /** Active connections whose stock or product run is due, oldest first. */
  dueConnections(work: ConnectionWork, nowMs: number, limit: number): Promise<string[]>
  /** Takes a connection's stock or product lease; `null` when another run holds it, or (unforced) it is not due. */
  leaseConnection(
    id: string,
    work: ConnectionWork,
    nowMs: number,
    leaseMs: number,
    options?: { force?: boolean },
  ): Promise<StoredConnection | null>
  appendLog(id: string, entry: Omit<InventoryLogEntry, 'id'>): Promise<void>
  readLog(id: string, limit: number): Promise<InventoryLogEntry[]>

  getOrder(id: string): Promise<StoredOrder | null>
  /** Creates a hand-off; `false` when one already exists under that id. */
  createOrder(id: string, order: StoredOrder): Promise<boolean>
  patchOrder(id: string, patch: Partial<StoredOrder>): Promise<void>
  /** Hand-offs with work due, oldest first. */
  dueOrders(nowMs: number, limit: number): Promise<string[]>
  /** Takes a hand-off's lease; `null` when another run holds it or (unforced) nothing is due. */
  leaseOrder(id: string, nowMs: number, leaseMs: number, options?: { force?: boolean }): Promise<StoredOrder | null>
  /** A site's hand-offs the job still works on. */
  activeOrdersForHost(hostId: string, limit: number): Promise<Array<{ id: string; order: StoredOrder }>>
  /** A site's failed hand-offs, newest first: what needs the merchant. */
  failedOrdersForHost(hostId: string, limit: number): Promise<StoredOrder[]>

  getLink(id: string): Promise<StoredProductLink | null>
  putLink(id: string, link: StoredProductLink): Promise<void>
}

/** A product link's document id. */
export const productLinkId = (hostId: string, provider: InventoryProviderId, key: string): string =>
  `${hostId}_${provider}_${key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300)}`

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreInventoryStore(firestore: () => any): InventoryStore {
  const connections = () => firestore().collection(INVENTORY_SYNC_CONNECTIONS_COLLECTION)
  const orders = () => firestore().collection(INVENTORY_SYNC_ORDERS_COLLECTION)
  const links = () => firestore().collection(INVENTORY_SYNC_PRODUCTS_COLLECTION)
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
      const stored = await ref.get()
      const log = await ref.collection(INVENTORY_SYNC_LOG_SUBCOLLECTION).limit(500).get()
      await Promise.all(log.docs.map((doc: any) => doc.ref.delete()))
      if (stored.exists) {
        // A link names a product in an account that is no longer connected.
        for (;;) {
          const batch = await links().where('hostId', '==', (stored.data() as StoredConnection).hostId).limit(300).get()
          if (batch.empty) break
          await Promise.all(batch.docs.map((doc: any) => doc.ref.delete()))
          if (batch.size < 300) break
        }
      }
      await ref.delete()
    },

    async dueConnections(work, nowMs, limit) {
      const field = DUE_FIELD[work]
      const snapshot = await connections()
        .where('status', '==', 'active')
        .where(field, '<=', nowMs)
        .orderBy(field, 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.id)
    },

    async leaseConnection(id, work, nowMs, leaseMs, options) {
      const ref = connections().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const stored = snapshot.data() as StoredConnection
        if (stored.status !== 'active') return null
        if ((stored[LEASE_FIELD[work]] ?? 0) > nowMs) return null
        if (!options?.force && (stored[DUE_FIELD[work]] ?? 0) > nowMs) return null
        transaction.set(ref, { [LEASE_FIELD[work]]: nowMs + leaseMs }, { merge: true })
        return { ...stored, [LEASE_FIELD[work]]: nowMs + leaseMs }
      })
    },

    async appendLog(id, entry) {
      const log = connections().doc(id).collection(INVENTORY_SYNC_LOG_SUBCOLLECTION)
      await log.doc(createResourceUid()).set(entry)
      const stale = await log.orderBy('atMs', 'desc').offset(LOG_ROWS_KEPT).limit(50).get()
      await Promise.all(stale.docs.map((doc: any) => doc.ref.delete()))
    },

    async readLog(id, limit) {
      const snapshot = await connections()
        .doc(id)
        .collection(INVENTORY_SYNC_LOG_SUBCOLLECTION)
        .orderBy('atMs', 'desc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as Omit<InventoryLogEntry, 'id'>) }))
    },

    async getOrder(id) {
      const snapshot = await orders().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredOrder) : null
    },

    async createOrder(id, order) {
      try {
        await orders().doc(id).create(order)
        return true
      } catch (error) {
        if (alreadyExists(error)) return false
        throw error
      }
    },

    async patchOrder(id, patch) {
      await orders().doc(id).set(patch, { merge: true })
    },

    async dueOrders(nowMs, limit) {
      const snapshot = await orders()
        .where('active', '==', true)
        .where('nextRunAtMs', '<=', nowMs)
        .orderBy('nextRunAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.id)
    },

    async leaseOrder(id, nowMs, leaseMs, options) {
      const ref = orders().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const stored = snapshot.data() as StoredOrder
        if ((stored.leaseUntilMs ?? 0) > nowMs) return null
        if (!options?.force && (!stored.active || (stored.nextRunAtMs ?? 0) > nowMs)) return null
        transaction.set(ref, { leaseUntilMs: nowMs + leaseMs }, { merge: true })
        return { ...stored, leaseUntilMs: nowMs + leaseMs }
      })
    },

    async activeOrdersForHost(hostId, limit) {
      const snapshot = await orders().where('hostId', '==', hostId).where('active', '==', true).limit(limit).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, order: doc.data() as StoredOrder }))
    },

    async failedOrdersForHost(hostId, limit) {
      const snapshot = await orders()
        .where('hostId', '==', hostId)
        .where('status', '==', 'failed')
        .orderBy('updatedAtMs', 'desc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.data() as StoredOrder)
    },

    async getLink(id) {
      const snapshot = await links().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredProductLink) : null
    },

    async putLink(id, link) {
      await links().doc(id).set(link)
    },
  }
}
