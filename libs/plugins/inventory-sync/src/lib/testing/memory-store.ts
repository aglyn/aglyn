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

import type { InventoryLogEntry } from '../model/inventory-sync'
import type { InventoryStore, StoredConnection, StoredOrder, StoredProductLink } from '../server/store'

/** An in-memory {@link InventoryStore} for specs, with the Firestore store's semantics. */
export interface MemoryInventoryStore extends InventoryStore {
  connections: Map<string, StoredConnection>
  orders: Map<string, StoredOrder>
  links: Map<string, StoredProductLink>
  logs: Map<string, InventoryLogEntry[]>
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

export function createMemoryInventoryStore(): MemoryInventoryStore {
  const connections = new Map<string, StoredConnection>()
  const orders = new Map<string, StoredOrder>()
  const links = new Map<string, StoredProductLink>()
  const logs = new Map<string, InventoryLogEntry[]>()
  let logId = 0
  const dueField = { stock: 'stockDueAtMs', products: 'productsDueAtMs' } as const
  const leaseField = { stock: 'stockLeaseUntilMs', products: 'productsLeaseUntilMs' } as const

  return {
    connections,
    orders,
    links,
    logs,

    async getConnection(id) {
      const stored = connections.get(id)
      return stored ? clone(stored) : null
    },
    async patchConnection(id, patch) {
      connections.set(id, clone({ ...(connections.get(id) ?? {}), ...patch } as StoredConnection))
    },
    async removeConnection(id) {
      const stored = connections.get(id)
      connections.delete(id)
      logs.delete(id)
      if (stored) for (const [key, link] of links) if (link.hostId === stored.hostId) links.delete(key)
    },
    async dueConnections(work, nowMs, limit) {
      return [...connections]
        .filter(([, connection]) => connection.status === 'active' && connection[dueField[work]] <= nowMs)
        .sort(([, a], [, b]) => a[dueField[work]] - b[dueField[work]])
        .slice(0, limit)
        .map(([id]) => id)
    },
    async leaseConnection(id, work, nowMs, leaseMs, options) {
      const stored = connections.get(id)
      if (!stored || stored.status !== 'active') return null
      if ((stored[leaseField[work]] ?? 0) > nowMs) return null
      if (!options?.force && stored[dueField[work]] > nowMs) return null
      stored[leaseField[work]] = nowMs + leaseMs
      return clone(stored)
    },
    async appendLog(id, entry) {
      const list = logs.get(id) ?? []
      list.unshift({ id: `log${++logId}`, ...entry })
      logs.set(id, list.slice(0, 50))
    },
    async readLog(id, limit) {
      return clone((logs.get(id) ?? []).slice(0, limit))
    },

    async getOrder(id) {
      const stored = orders.get(id)
      return stored ? clone(stored) : null
    },
    async createOrder(id, order) {
      if (orders.has(id)) return false
      orders.set(id, clone(order))
      return true
    },
    async patchOrder(id, patch) {
      orders.set(id, clone({ ...(orders.get(id) ?? {}), ...patch } as StoredOrder))
    },
    async dueOrders(nowMs, limit) {
      return [...orders]
        .filter(([, order]) => order.active && order.nextRunAtMs <= nowMs)
        .sort(([, a], [, b]) => a.nextRunAtMs - b.nextRunAtMs)
        .slice(0, limit)
        .map(([id]) => id)
    },
    async leaseOrder(id, nowMs, leaseMs, options) {
      const stored = orders.get(id)
      if (!stored || (stored.leaseUntilMs ?? 0) > nowMs) return null
      if (!options?.force && (!stored.active || stored.nextRunAtMs > nowMs)) return null
      stored.leaseUntilMs = nowMs + leaseMs
      return clone(stored)
    },
    async activeOrdersForHost(hostId, limit) {
      return [...orders]
        .filter(([, order]) => order.hostId === hostId && order.active)
        .slice(0, limit)
        .map(([id, order]) => ({ id, order: clone(order) }))
    },
    async failedOrdersForHost(hostId, limit) {
      return [...orders.values()]
        .filter((order) => order.hostId === hostId && order.status === 'failed')
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .slice(0, limit)
        .map(clone)
    },

    async getLink(id) {
      const stored = links.get(id)
      return stored ? clone(stored) : null
    },
    async putLink(id, link) {
      links.set(id, clone(link))
    },
  }
}
