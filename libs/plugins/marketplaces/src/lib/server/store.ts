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
import { createHash } from 'node:crypto'
import {
  LISTING_STATE_CHUNKS,
  LOG_ROWS_KEPT,
  MARKETPLACE_CONNECTIONS_COLLECTION,
  MARKETPLACE_LISTING_STATE_SUBCOLLECTION,
  MARKETPLACE_LOG_SUBCOLLECTION,
  MARKETPLACE_ORDERS_COLLECTION,
} from '../constants'
import {
  DEFAULT_SETTINGS,
  EMPTY_LISTING_SUMMARY,
  type ListingSyncSummary,
  type MarketplaceConnectionStatus,
  type MarketplaceConnectionView,
  type MarketplaceId,
  type MarketplaceLogEntry,
  type MarketplaceOrderView,
  type MarketplaceSettings,
  type MarketplaceSite,
} from '../model/marketplaces'
import type { ListingOutcome, MarketplaceAccountRef } from '../providers/provider'

/**
 * Where connections, listing state and imported orders are kept (AGL-3638):
 * `marketplaceConnections/{hostId}_{marketplace}` with its `log` and
 * `listingState`, and `marketplaceOrders/{hostId}_{marketplace}_{key}`. The
 * rules refuse every client all of them; this module, the routes and the
 * console job are the only writers, through the Admin SDK.
 *
 * Plain fields, epoch-ms numbers rather than server timestamps: the engine
 * compares them with its own clock, and a spec drives that clock.
 */

/** A connect between its start and the marketplace's redirect back: hashes and sealed values only. */
export interface PendingOAuth {
  nonceHash: string
  /** PKCE's verifier, sealed (a secret by name, so the data export redacts it): the marketplace sees only its challenge. */
  sealedVerifierSecret: string
  expMs: number
  uid: string
  returnTo: string
}

/** A connection as stored. The sealed fields carry `token` in their names, which the data export redacts by. */
export interface StoredConnection {
  orgId: string
  hostId: string
  marketplace: MarketplaceId
  status: MarketplaceConnectionStatus
  sandbox: boolean
  accountName: string | null
  account: MarketplaceAccountRef
  sites: MarketplaceSite[]
  settings: MarketplaceSettings
  sealedAccessToken: string | null
  sealedRefreshToken: string | null
  accessTokenExpiresAtMs: number | null
  refreshTokenExpiresAtMs: number | null
  tokenKeyId: string | null
  pendingOAuth: PendingOAuth | null
  /** Orders changed after this instant are read next. */
  ordersSinceMs: number
  /** A page token the last run stopped at, with the instant its query started from. */
  ordersPage: { cursor: string; sinceMs: number; startedAtMs: number } | null
  /** When the marketplace's orders are next read. */
  ordersDueAtMs: number
  /** When the listings are next brought in line; moved to now by any sale or restock. */
  listingsDueAtMs: number
  /** The last time a sale or restock anywhere asked for the listings to be brought in line. */
  listingsDirtyAtMs: number
  /** When the connection next has work: the sooner of its orders and its listings. */
  dueAtMs: number
  leaseUntilMs: number
  failures: number
  listings: ListingSyncSummary
  orders: MarketplaceConnectionView['orders']
  shipments: MarketplaceConnectionView['shipments']
  lastError: string | null
  connectedAtMs: number | null
  connectedByUid: string | null
  updatedAtMs: number
}

/** What a listing was last sent, and what the marketplace answered. Short keys: a state document holds hundreds. */
export interface ListingStateEntry {
  /** The SKU it was sent under. */
  s: string
  /** The product's title, for the console's list of listings to look at. */
  t: string
  /** Quantity sent. */
  q: number
  /** Price sent, when prices were. */
  p: number | null
  o: ListingOutcome
  /** The marketplace's id for the listing. */
  x: string | null
  /** The marketplace's words, for a refusal. */
  m: string | null
  /** When it was sent. */
  at: number
}

export type ListingStateChunk = Record<string, ListingStateEntry>

/** A shipment the merchant recorded on an imported order, and where its confirmation stands. */
export interface StoredShipment {
  lines: Array<{ lineIndex: number; quantity: number }>
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  atMs: number
  state: 'pending' | 'confirmed' | 'failed'
  message: string | null
  attempts: number
}

/** One marketplace order and the Aglyn order it became. */
export interface StoredMarketplaceOrder {
  orgId: string
  hostId: string
  marketplace: MarketplaceId
  connectionId: string
  externalOrderId: string
  displayRef: string
  /** The Aglyn order; empty when the seller refused the import. */
  recordId: string
  status: 'imported' | 'refused' | 'canceled'
  note: string | null
  lines: Array<{ lineIndex: number; externalLineId: string }>
  /** Whether the marketplace has heard the seller took it, where it must. */
  acknowledged: boolean
  currency: string
  fees: Array<{ label: string; amountMinor: number }> | null
  /** Until when the marketplace is asked for the fees, while they are unknown. */
  feesFollowUntilMs: number
  shipments: Record<string, StoredShipment>
  sandbox: boolean
  /** Whether the job still has something to do: acknowledge, confirm a shipment, read the fees. */
  active: boolean
  nextRunAtMs: number
  leaseUntilMs: number
  createdAtMs: number
  updatedAtMs: number
}

/** `{hostId}_{marketplace}_{key}`: the key is a hash of the marketplace's order id, which may hold any character. */
export function marketplaceOrderDocId(hostId: string, marketplace: MarketplaceId, externalOrderId: string): string {
  return `${hostId}_${marketplace}_${createHash('sha256').update(externalOrderId).digest('hex').slice(0, 24)}`
}

/** Which listing-state document an offer's entry lives in. */
export function listingChunkOf(offerId: string): string {
  const byte = createHash('sha256').update(offerId).digest()[0]
  return `c${String(byte % LISTING_STATE_CHUNKS).padStart(2, '0')}`
}

export const LISTING_CHUNK_IDS: readonly string[] = Array.from(
  { length: LISTING_STATE_CHUNKS },
  (_, index) => `c${String(index).padStart(2, '0')}`,
)

export function emptyConnection(input: {
  orgId: string
  hostId: string
  marketplace: MarketplaceId
  sandbox: boolean
  nowMs: number
}): StoredConnection {
  return {
    orgId: input.orgId,
    hostId: input.hostId,
    marketplace: input.marketplace,
    status: 'reconnect',
    sandbox: input.sandbox,
    accountName: null,
    account: {},
    sites: [],
    settings: { ...DEFAULT_SETTINGS },
    sealedAccessToken: null,
    sealedRefreshToken: null,
    accessTokenExpiresAtMs: null,
    refreshTokenExpiresAtMs: null,
    tokenKeyId: null,
    pendingOAuth: null,
    ordersSinceMs: input.nowMs,
    ordersPage: null,
    ordersDueAtMs: input.nowMs,
    listingsDueAtMs: input.nowMs,
    listingsDirtyAtMs: 0,
    dueAtMs: input.nowMs,
    leaseUntilMs: 0,
    failures: 0,
    listings: { ...EMPTY_LISTING_SUMMARY },
    orders: { imported: 0, skipped: 0, lastImportedAtMs: null },
    shipments: { confirmed: 0, failed: 0 },
    lastError: null,
    connectedAtMs: null,
    connectedByUid: null,
    updatedAtMs: input.nowMs,
  }
}

/** The console's view of a connection: never a credential, a lease, a cursor or the account's ids. */
export function connectionView(id: string, stored: StoredConnection): MarketplaceConnectionView {
  return {
    id,
    marketplace: stored.marketplace,
    hostId: stored.hostId,
    status: stored.status,
    sandbox: stored.sandbox === true,
    accountName: stored.accountName ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) },
    sites: Array.isArray(stored.sites) ? stored.sites : [],
    listings: { ...EMPTY_LISTING_SUMMARY, ...(stored.listings ?? {}) },
    orders: {
      imported: stored.orders?.imported ?? 0,
      skipped: stored.orders?.skipped ?? 0,
      lastImportedAtMs: stored.orders?.lastImportedAtMs ?? null,
    },
    shipments: { confirmed: stored.shipments?.confirmed ?? 0, failed: stored.shipments?.failed ?? 0 },
    lastError: stored.lastError ?? null,
    connectedAtMs: stored.connectedAtMs ?? null,
  }
}

/** The console's view of an imported order. */
export function marketplaceOrderView(stored: StoredMarketplaceOrder): MarketplaceOrderView {
  const fees = Array.isArray(stored.fees) ? stored.fees : null
  return {
    marketplace: stored.marketplace,
    externalOrderId: stored.externalOrderId,
    displayRef: stored.displayRef,
    sandbox: stored.sandbox === true,
    fees,
    feesTotalMinor: fees ? fees.reduce((sum, fee) => sum + fee.amountMinor, 0) : null,
    currency: stored.currency,
    shipments: Object.entries(stored.shipments ?? {})
      .map(([fulfillmentId, shipment]) => ({
        fulfillmentId,
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier,
        state: shipment.state,
        message: shipment.message,
        atMs: shipment.atMs,
      }))
      .sort((a, b) => a.atMs - b.atMs),
  }
}

/** The storage the engine, the intake and the routes use. A spec supplies an in-memory one. */
export interface MarketplaceStore {
  getConnection(id: string): Promise<StoredConnection | null>
  /** Creates or merges fields. */
  patchConnection(id: string, patch: Partial<StoredConnection>): Promise<void>
  removeConnection(id: string): Promise<void>
  connectionsForHost(hostId: string): Promise<Array<{ id: string; connection: StoredConnection }>>
  /** Active connections with work due, the longest waiting first. */
  dueConnections(nowMs: number, limit: number): Promise<string[]>
  /** Takes a connection's lease; `null` when another run holds it, or (without `force`) nothing is due. */
  leaseConnection(id: string, nowMs: number, leaseMs: number, options?: { force?: boolean }): Promise<StoredConnection | null>
  appendLog(id: string, entry: Omit<MarketplaceLogEntry, 'id'>): Promise<void>
  readLog(id: string, limit: number): Promise<MarketplaceLogEntry[]>
  /** Every listing-state chunk of a connection, by chunk id. */
  readListingState(id: string): Promise<Record<string, ListingStateChunk>>
  /** Replaces the named chunks. */
  writeListingState(id: string, chunks: Record<string, ListingStateChunk>): Promise<void>

  getOrder(id: string): Promise<StoredMarketplaceOrder | null>
  /** Creates an imported order's record; `false` when one exists under that id. */
  createOrder(id: string, order: StoredMarketplaceOrder): Promise<boolean>
  patchOrder(id: string, patch: Partial<StoredMarketplaceOrder>): Promise<void>
  /** Orders with work due, oldest first. */
  dueOrders(nowMs: number, limit: number): Promise<string[]>
  /** Takes an order's lease; `null` when another run holds it or (without `force`) nothing is due. */
  leaseOrder(id: string, nowMs: number, leaseMs: number, options?: { force?: boolean }): Promise<StoredMarketplaceOrder | null>
  /**
   * Ends an order's run: writes `patch`, releases the lease, and keeps the
   * order active when a shipment was queued while the run worked.
   */
  settleOrder(id: string, patch: Partial<StoredMarketplaceOrder>, nowMs: number, knownShipments: readonly string[]): Promise<void>
  /** The imported order an Aglyn order came from. */
  orderByRecord(hostId: string, recordId: string): Promise<{ id: string; order: StoredMarketplaceOrder } | null>
  /** Marks every active connection of a site due for a listing sync now. */
  markListingsDue(hostId: string, nowMs: number): Promise<number>
  /**
   * Ends a run: writes `patch` and the release of the lease, and keeps the
   * listings due now when a sale marked them while the run (which began at
   * `startedAtMs`) was working, so no mark is lost under the run's own write.
   */
  settleConnection(id: string, patch: Partial<StoredConnection>, startedAtMs: number, nowMs: number): Promise<void>
}

/** When a connection next has work, from what is due when. */
export const nextDue = (connection: Pick<StoredConnection, 'ordersDueAtMs' | 'listingsDueAtMs'>): number =>
  Math.min(connection.ordersDueAtMs ?? 0, connection.listingsDueAtMs ?? 0)

/** The settle step's arithmetic, shared by the Firestore store and the specs' memory store. */
export function settledPatch(
  current: StoredConnection,
  patch: Partial<StoredConnection>,
  startedAtMs: number,
  nowMs: number,
): Partial<StoredConnection> {
  const merged = { ...current, ...patch }
  const listingsDueAtMs = (current.listingsDirtyAtMs ?? 0) >= startedAtMs ? nowMs : merged.listingsDueAtMs
  return { ...patch, listingsDueAtMs, leaseUntilMs: 0, dueAtMs: nextDue({ ...merged, listingsDueAtMs }) }
}

/** The order settle step's arithmetic, shared by the Firestore store and the specs' memory store. */
export function settledOrderPatch(
  current: StoredMarketplaceOrder,
  patch: Partial<StoredMarketplaceOrder>,
  nowMs: number,
  knownShipments: readonly string[],
): Partial<StoredMarketplaceOrder> {
  const shipments = { ...(current.shipments ?? {}), ...(patch.shipments ?? {}) }
  const known = new Set(knownShipments)
  const queuedMeanwhile = Object.entries(current.shipments ?? {}).some(
    ([key, shipment]) => shipment.state === 'pending' && !known.has(key),
  )
  return {
    ...patch,
    shipments,
    leaseUntilMs: 0,
    ...(queuedMeanwhile ? { active: true, nextRunAtMs: nowMs } : {}),
  }
}

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreMarketplaceStore(firestore: () => any): MarketplaceStore {
  const connections = () => firestore().collection(MARKETPLACE_CONNECTIONS_COLLECTION)
  const orders = () => firestore().collection(MARKETPLACE_ORDERS_COLLECTION)
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
      for (const name of [MARKETPLACE_LOG_SUBCOLLECTION, MARKETPLACE_LISTING_STATE_SUBCOLLECTION]) {
        const rows = await ref.collection(name).limit(500).get()
        await Promise.all(rows.docs.map((doc: any) => doc.ref.delete()))
      }
      await ref.delete()
    },

    async connectionsForHost(hostId) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, connection: doc.data() as StoredConnection }))
    },

    async dueConnections(nowMs, limit) {
      const snapshot = await connections()
        .where('status', '==', 'active')
        .where('dueAtMs', '<=', nowMs)
        .orderBy('dueAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.id)
    },

    async leaseConnection(id, nowMs, leaseMs, options) {
      const ref = connections().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const stored = snapshot.data() as StoredConnection
        if (stored.status !== 'active') return null
        if ((stored.leaseUntilMs ?? 0) > nowMs) return null
        if (!options?.force && (stored.dueAtMs ?? 0) > nowMs) return null
        transaction.set(ref, { leaseUntilMs: nowMs + leaseMs }, { merge: true })
        return { ...stored, leaseUntilMs: nowMs + leaseMs }
      })
    },

    async appendLog(id, entry) {
      const log = connections().doc(id).collection(MARKETPLACE_LOG_SUBCOLLECTION)
      await log.doc(createResourceUid()).set(entry)
      const stale = await log.orderBy('atMs', 'desc').offset(LOG_ROWS_KEPT).limit(50).get()
      await Promise.all(stale.docs.map((doc: any) => doc.ref.delete()))
    },

    async readLog(id, limit) {
      const snapshot = await connections()
        .doc(id)
        .collection(MARKETPLACE_LOG_SUBCOLLECTION)
        .orderBy('atMs', 'desc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as Omit<MarketplaceLogEntry, 'id'>) }))
    },

    async readListingState(id) {
      const snapshot = await connections().doc(id).collection(MARKETPLACE_LISTING_STATE_SUBCOLLECTION).limit(LISTING_CHUNK_IDS.length).get()
      const chunks: Record<string, ListingStateChunk> = {}
      for (const doc of snapshot.docs) chunks[doc.id] = ((doc.data() as { entries?: ListingStateChunk }).entries ?? {}) as ListingStateChunk
      return chunks
    },

    async writeListingState(id, chunks) {
      const state = connections().doc(id).collection(MARKETPLACE_LISTING_STATE_SUBCOLLECTION)
      await Promise.all(Object.entries(chunks).map(([chunk, entries]) => state.doc(chunk).set({ entries })))
    },

    async getOrder(id) {
      const snapshot = await orders().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredMarketplaceOrder) : null
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
        const stored = snapshot.data() as StoredMarketplaceOrder
        if ((stored.leaseUntilMs ?? 0) > nowMs) return null
        if (!options?.force && (!stored.active || (stored.nextRunAtMs ?? 0) > nowMs)) return null
        transaction.set(ref, { leaseUntilMs: nowMs + leaseMs }, { merge: true })
        return { ...stored, leaseUntilMs: nowMs + leaseMs }
      })
    },

    async settleOrder(id, patch, nowMs, knownShipments) {
      const ref = orders().doc(id)
      await firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return
        transaction.set(ref, settledOrderPatch(snapshot.data() as StoredMarketplaceOrder, patch, nowMs, knownShipments), { merge: true })
      })
    },

    async orderByRecord(hostId, recordId) {
      const snapshot = await orders().where('hostId', '==', hostId).where('recordId', '==', recordId).limit(1).get()
      const doc = snapshot.docs[0]
      return doc ? { id: doc.id, order: doc.data() as StoredMarketplaceOrder } : null
    },

    async markListingsDue(hostId, nowMs) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      const due = snapshot.docs.filter((doc: any) => {
        const stored = doc.data() as StoredConnection
        return stored.status === 'active' && (stored.settings?.listingMode ?? 'link') !== 'off'
      })
      await Promise.all(
        due.map((doc: any) => doc.ref.set({ listingsDirtyAtMs: nowMs, listingsDueAtMs: nowMs, dueAtMs: nowMs }, { merge: true })),
      )
      return due.length
    },

    async settleConnection(id, patch, startedAtMs, nowMs) {
      const ref = connections().doc(id)
      await firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return
        transaction.set(ref, settledPatch(snapshot.data() as StoredConnection, patch, startedAtMs, nowMs), { merge: true })
      })
    },
  }
}
