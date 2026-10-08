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
import { createHash } from 'node:crypto'
import { DELIVERY_APP_ORDERS_COLLECTION, DELIVERY_APP_STORES_COLLECTION } from '../constants'
import {
  DELIVERY_SERVICES,
  type DeliveryOrderStatus,
  type DeliveryOrderView,
  type DeliveryPendingCall,
  type DeliveryServiceId,
  type DeliveryStoreSettings,
  type DeliveryStoreView,
} from '../model/delivery-apps'
import type { IncomingOrderLine } from '../providers/provider'

/**
 * Where connected stores and their orders are kept (AGL-3644):
 * `deliveryAppStores/{service}_{hash}` and `deliveryAppOrders/{service}_{hash}`.
 * The rules refuse every client both; this module, the routes and the
 * console job are the only writers, through the Admin SDK.
 *
 * Every change to an order goes through {@link DeliveryStore.transitionOrder},
 * one transaction that reads the order and decides from what it read, so a
 * webhook's cancel and a cashier's accept landing together cannot both win.
 *
 * Plain fields, epoch-ms numbers rather than server timestamps: the engine
 * compares them with its own clock, and a spec drives that clock.
 */

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24)

/** The document id of a service's store: one service store belongs to one site. */
export const storeDocId = (service: DeliveryServiceId, externalStoreId: string) => `${service}_${digest(externalStoreId)}`

/** The document id of a service's order: the import's idempotency key. */
export const orderDocId = (service: DeliveryServiceId, externalOrderId: string) => `${service}_${digest(externalOrderId)}`

/** The key an item is matched under in a store's maps. */
export const itemKey = (externalItemId: string) => digest(externalItemId)

export interface StoredItemMatch {
  externalItemId: string
  name: string
  productId: string
  variantId: string
  title: string
}

export interface StoredUnmatchedItem {
  externalItemId: string
  name: string
  lastSeenAtMs: number
}

export interface StoredStore {
  orgId: string
  hostId: string
  service: DeliveryServiceId
  externalStoreId: string
  settings: DeliveryStoreSettings
  connectedAtMs: number
  connectedBy: string
  updatedAtMs: number
  itemMatches: Record<string, StoredItemMatch>
  unmatched: Record<string, StoredUnmatchedItem>
  menu: { publishedAtMs: number | null; items: number; error: string | null }
}

export interface StoredOrderLine extends IncomingOrderLine {
  /** Whether the store order's line took stock from a product. */
  matched?: boolean
}

export interface StoredOrder {
  orgId: string
  hostId: string
  service: DeliveryServiceId
  storeId: string
  externalOrderId: string
  externalStoreId: string
  externalRef: string
  status: DeliveryOrderStatus
  /** Open at the counter: `new`, `accepted` or `ready`. What the register's query asks. */
  active: boolean
  handoff: 'courier' | 'customer'
  placedAtMs: number
  pickupAtMs: number | null
  customerName: string | null
  instructions: string | null
  currency: string
  /** The order's items as the service now states them. */
  lines: StoredOrderLine[]
  subtotalCents: number
  taxCents: number
  discountCents: number
  totalCents: number
  refundedCents: number
  /** The service's ids of the changes and refunds already applied. */
  eventIds: string[]
  /** The store order, once accepted, and which of its lines each service line became. */
  recordId: string | null
  displayRef: string | null
  recordLines: Array<{ lineIndex: number; externalLineId: string }>
  oversold: number
  testMode: boolean
  pending: { call: DeliveryPendingCall; attempts: number; reason: string | null } | null
  error: string | null
  /** When the job must look at the order next: a call to retry, or a ready order to close. */
  nextRunAtMs: number | null
  leaseUntilMs: number | null
  readyAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
}

export interface DeliveryStore {
  getStore(id: string): Promise<StoredStore | null>
  storesForHost(hostId: string): Promise<Array<{ id: string; store: StoredStore }>>
  /** Writes a store unless another site holds that service store: `taken` then. */
  connectStore(id: string, store: StoredStore): Promise<'saved' | 'taken'>
  /** One transaction: `change` answers the fields to write, or `null` to write nothing. */
  updateStore(id: string, change: (store: StoredStore) => Partial<StoredStore> | null): Promise<StoredStore | null>
  deleteStore(id: string): Promise<void>
  getOrder(id: string): Promise<StoredOrder | null>
  /** `false` when the order is already there: nothing is written. */
  createOrder(id: string, order: StoredOrder): Promise<boolean>
  /** One transaction: `change` answers the fields to write, or `null` to write nothing; answers the order as written. */
  transitionOrder(id: string, change: (order: StoredOrder) => Partial<StoredOrder> | null): Promise<StoredOrder | null>
  openOrders(hostId: string, limit: number): Promise<Array<{ id: string; order: StoredOrder }>>
  recentOrders(hostId: string, limit: number): Promise<Array<{ id: string; order: StoredOrder }>>
  dueOrders(nowMs: number, limit: number): Promise<string[]>
}

export function storeView(store: StoredStore): DeliveryStoreView {
  return {
    service: store.service,
    externalStoreId: store.externalStoreId,
    settings: store.settings,
    connectedAtMs: store.connectedAtMs,
    menu: store.menu,
    unmatched: Object.keys(store.unmatched ?? {}).length,
  }
}

export function orderView(id: string, order: StoredOrder): DeliveryOrderView {
  return {
    id,
    service: order.service,
    externalRef: order.externalRef,
    status: order.status,
    handoff: order.handoff,
    placedAtMs: order.placedAtMs,
    pickupAtMs: order.pickupAtMs,
    customerName: order.customerName,
    instructions: order.instructions,
    lines: order.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      options: line.options,
      instructions: line.instructions,
      matched: line.matched !== false,
    })),
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    refundedCents: order.refundedCents,
    recordId: order.recordId,
    displayRef: order.displayRef,
    oversold: order.oversold,
    testMode: order.testMode,
    pending: order.pending?.call ?? null,
    error: order.error,
    updatedAtMs: order.updatedAtMs,
  }
}

/** The service's label, for messages. */
export const serviceLabel = (service: DeliveryServiceId) => DELIVERY_SERVICES[service].label

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreDeliveryStore(firestore: () => any): DeliveryStore {
  const stores = () => firestore().collection(DELIVERY_APP_STORES_COLLECTION)
  const orders = () => firestore().collection(DELIVERY_APP_ORDERS_COLLECTION)
  const list = (snapshot: { docs: Array<{ id: string; data(): unknown }> }) =>
    snapshot.docs.map((doc) => ({ id: doc.id, order: doc.data() as StoredOrder }))

  return {
    async getStore(id) {
      const snapshot = await stores().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredStore) : null
    },
    async storesForHost(hostId) {
      const snapshot = await stores().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs.map((doc: { id: string; data(): unknown }) => ({ id: doc.id, store: doc.data() as StoredStore }))
    },
    async connectStore(id, store) {
      const ref = stores().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const existing = await transaction.get(ref)
        if (existing.exists && existing.get('hostId') !== store.hostId) return 'taken' as const
        transaction.set(ref, store)
        return 'saved' as const
      })
    },
    async updateStore(id, change) {
      const ref = stores().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const current = snapshot.data() as StoredStore
        const patch = change(current)
        if (!patch) return current
        transaction.update(ref, patch as Record<string, unknown>)
        return { ...current, ...patch }
      })
    },
    async deleteStore(id) {
      await stores().doc(id).delete()
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
        // ALREADY_EXISTS: a retried webhook. Anything else is a real failure.
        const code = (error as { code?: number | string })?.code
        if (code === 6 || code === 'already-exists' || /already exists/i.test(String((error as Error)?.message ?? ''))) return false
        throw error
      }
    },
    async transitionOrder(id, change) {
      const ref = orders().doc(id)
      return firestore().runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const current = snapshot.data() as StoredOrder
        const patch = change(current)
        if (!patch) return null
        transaction.update(ref, patch as Record<string, unknown>)
        return { ...current, ...patch }
      })
    },
    async openOrders(hostId, limit) {
      return list(
        await orders().where('hostId', '==', hostId).where('active', '==', true).orderBy('placedAtMs', 'asc').limit(limit).get(),
      )
    },
    async recentOrders(hostId, limit) {
      return list(
        await orders().where('hostId', '==', hostId).where('active', '==', false).orderBy('updatedAtMs', 'desc').limit(limit).get(),
      )
    },
    async dueOrders(nowMs, limit) {
      const snapshot = await orders().where('nextRunAtMs', '<=', nowMs).orderBy('nextRunAtMs', 'asc').limit(limit).get()
      return snapshot.docs.map((doc: { id: string }) => doc.id)
    },
  }
}
