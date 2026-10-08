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

import type { MarketplaceLogEntry } from '../model/marketplaces'
import {
  settledOrderPatch,
  settledPatch,
  type ListingStateChunk,
  type MarketplaceStore,
  type StoredConnection,
  type StoredMarketplaceOrder,
} from '../server/store'

/** An in-memory {@link MarketplaceStore} for specs, with the Firestore store's semantics (merge writes deep-merge maps). */
export interface MemoryMarketplaceStore extends MarketplaceStore {
  connections: Map<string, StoredConnection>
  orders: Map<string, StoredMarketplaceOrder>
  logs: Map<string, MarketplaceLogEntry[]>
  listingState: Map<string, Record<string, ListingStateChunk>>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const isMap = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** `set(…, { merge: true })`: nested maps merge key by key, everything else replaces. */
function mergeDeep(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isMap(value) && isMap(out[key]) ? mergeDeep(out[key] as Record<string, unknown>, value) : value
  }
  return out
}

export function createMemoryMarketplaceStore(): MemoryMarketplaceStore {
  const connections = new Map<string, StoredConnection>()
  const orders = new Map<string, StoredMarketplaceOrder>()
  const logs = new Map<string, MarketplaceLogEntry[]>()
  const listingState = new Map<string, Record<string, ListingStateChunk>>()
  let logId = 0
  const patchConnection = (id: string, patch: Partial<StoredConnection>) =>
    connections.set(id, clone(mergeDeep((connections.get(id) ?? {}) as never, clone(patch) as never)) as never)
  const patchOrder = (id: string, patch: Partial<StoredMarketplaceOrder>) =>
    orders.set(id, clone(mergeDeep((orders.get(id) ?? {}) as never, clone(patch) as never)) as never)

  return {
    connections,
    orders,
    logs,
    listingState,

    async getConnection(id) {
      const stored = connections.get(id)
      return stored ? clone(stored) : null
    },
    async patchConnection(id, patch) {
      patchConnection(id, patch)
    },
    async removeConnection(id) {
      connections.delete(id)
      logs.delete(id)
      listingState.delete(id)
    },
    async connectionsForHost(hostId) {
      return [...connections]
        .filter(([, connection]) => connection.hostId === hostId)
        .map(([id, connection]) => ({ id, connection: clone(connection) }))
    },
    async dueConnections(nowMs, limit) {
      return [...connections]
        .filter(([, connection]) => connection.status === 'active' && connection.dueAtMs <= nowMs)
        .sort(([, a], [, b]) => a.dueAtMs - b.dueAtMs)
        .slice(0, limit)
        .map(([id]) => id)
    },
    async leaseConnection(id, nowMs, leaseMs, options) {
      const stored = connections.get(id)
      if (!stored || stored.status !== 'active') return null
      if ((stored.leaseUntilMs ?? 0) > nowMs) return null
      if (!options?.force && (stored.dueAtMs ?? 0) > nowMs) return null
      stored.leaseUntilMs = nowMs + leaseMs
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
    async readListingState(id) {
      return clone(listingState.get(id) ?? {})
    },
    async writeListingState(id, chunks) {
      listingState.set(id, { ...(listingState.get(id) ?? {}), ...clone(chunks) })
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
      patchOrder(id, patch)
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
    async settleOrder(id, patch, nowMs, knownShipments) {
      const current = orders.get(id)
      if (!current) return
      patchOrder(id, settledOrderPatch(clone(current), patch, nowMs, knownShipments))
    },
    async orderByRecord(hostId, recordId) {
      const found = [...orders].find(([, order]) => order.hostId === hostId && order.recordId === recordId)
      return found ? { id: found[0], order: clone(found[1]) } : null
    },
    async markListingsDue(hostId, nowMs) {
      let count = 0
      for (const [id, connection] of connections) {
        if (connection.hostId !== hostId || connection.status !== 'active') continue
        if ((connection.settings?.listingMode ?? 'link') === 'off') continue
        patchConnection(id, { listingsDirtyAtMs: nowMs, listingsDueAtMs: nowMs, dueAtMs: nowMs })
        count += 1
      }
      return count
    },
    async settleConnection(id, patch, startedAtMs, nowMs) {
      const current = connections.get(id)
      if (!current) return
      patchConnection(id, settledPatch(clone(current), patch, startedAtMs, nowMs))
    },
  }
}
