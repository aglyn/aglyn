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
import type { DeliveryStore, StoredOrder, StoredStore } from '../server/store'

/**
 * The plugin's store in memory (AGL-3644), for specs: the same answers as the
 * Firestore store, each change applied whole, as a transaction would.
 */
export function memoryDeliveryStore(): DeliveryStore & {
  stores: Map<string, StoredStore>
  orders: Map<string, StoredOrder>
} {
  const stores = new Map<string, StoredStore>()
  const orders = new Map<string, StoredOrder>()
  const copy = <T>(value: T): T => structuredClone(value)
  return {
    stores,
    orders,
    async getStore(id) {
      return stores.has(id) ? copy(stores.get(id) as StoredStore) : null
    },
    async storesForHost(hostId) {
      return [...stores.entries()].filter(([, store]) => store.hostId === hostId).map(([id, store]) => ({ id, store: copy(store) }))
    },
    async connectStore(id, store) {
      const existing = stores.get(id)
      if (existing && existing.hostId !== store.hostId) return 'taken'
      stores.set(id, copy(store))
      return 'saved'
    },
    async updateStore(id, change) {
      const current = stores.get(id)
      if (!current) return null
      const patch = change(copy(current))
      if (!patch) return copy(current)
      const next = { ...current, ...copy(patch) }
      stores.set(id, next)
      return copy(next)
    },
    async deleteStore(id) {
      stores.delete(id)
    },
    async getOrder(id) {
      return orders.has(id) ? copy(orders.get(id) as StoredOrder) : null
    },
    async createOrder(id, order) {
      if (orders.has(id)) return false
      orders.set(id, copy(order))
      return true
    },
    async transitionOrder(id, change) {
      const current = orders.get(id)
      if (!current) return null
      const patch = change(copy(current))
      if (!patch) return null
      const next = { ...current, ...copy(patch) }
      orders.set(id, next)
      return copy(next)
    },
    async openOrders(hostId, limit) {
      return [...orders.entries()]
        .filter(([, order]) => order.hostId === hostId && order.active)
        .sort(([, a], [, b]) => a.placedAtMs - b.placedAtMs)
        .slice(0, limit)
        .map(([id, order]) => ({ id, order: copy(order) }))
    },
    async recentOrders(hostId, limit) {
      return [...orders.entries()]
        .filter(([, order]) => order.hostId === hostId && !order.active)
        .sort(([, a], [, b]) => b.updatedAtMs - a.updatedAtMs)
        .slice(0, limit)
        .map(([id, order]) => ({ id, order: copy(order) }))
    },
    async dueOrders(nowMs, limit) {
      return [...orders.entries()]
        .filter(([, order]) => order.nextRunAtMs !== null && order.nextRunAtMs <= nowMs)
        .sort(([, a], [, b]) => (a.nextRunAtMs ?? 0) - (b.nextRunAtMs ?? 0))
        .slice(0, limit)
        .map(([id]) => id)
    },
  }
}
