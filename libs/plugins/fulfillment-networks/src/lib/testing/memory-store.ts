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

import type { NetworkLogEntry } from '../model/networks'
import type { NetworkStore, StoredConnection, StoredRouting } from '../server/store'

/** An in-memory {@link NetworkStore} for specs, with the Firestore store's semantics. */
export interface MemoryNetworkStore extends NetworkStore {
  connections: Map<string, StoredConnection>
  routings: Map<string, StoredRouting>
  logs: Map<string, NetworkLogEntry[]>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function createMemoryNetworkStore(): MemoryNetworkStore {
  const connections = new Map<string, StoredConnection>()
  const routings = new Map<string, StoredRouting>()
  const logs = new Map<string, NetworkLogEntry[]>()
  let logId = 0

  return {
    connections,
    routings,
    logs,

    async getConnection(id) {
      const stored = connections.get(id)
      return stored ? clone(stored) : null
    },
    async patchConnection(id, patch) {
      connections.set(id, clone({ ...(connections.get(id) ?? {}), ...patch } as StoredConnection))
    },
    async removeConnection(id) {
      connections.delete(id)
      logs.delete(id)
    },
    async connectionsForHost(hostId) {
      return [...connections]
        .filter(([, connection]) => connection.hostId === hostId)
        .map(([id, connection]) => ({ id, connection: clone(connection) }))
    },
    async inventoryDue(nowMs, limit) {
      return [...connections]
        .filter(([, connection]) => connection.status === 'active' && connection.inventoryDueAtMs <= nowMs)
        .sort(([, a], [, b]) => a.inventoryDueAtMs - b.inventoryDueAtMs)
        .slice(0, limit)
        .map(([id]) => id)
    },
    async leaseInventory(id, nowMs, leaseMs) {
      const stored = connections.get(id)
      if (!stored || stored.status !== 'active') return null
      if (stored.inventoryDueAtMs > nowMs || (stored.inventoryLeaseUntilMs ?? 0) > nowMs) return null
      stored.inventoryLeaseUntilMs = nowMs + leaseMs
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

    async getRouting(id) {
      const stored = routings.get(id)
      return stored ? clone(stored) : null
    },
    async createRouting(id, routing) {
      if (routings.has(id)) return false
      routings.set(id, clone(routing))
      return true
    },
    async patchRouting(id, patch) {
      routings.set(id, clone({ ...(routings.get(id) ?? {}), ...patch } as StoredRouting))
    },
    async dueRoutings(nowMs, limit) {
      return [...routings]
        .filter(([, routing]) => routing.active && routing.nextRunAtMs <= nowMs)
        .sort(([, a], [, b]) => a.nextRunAtMs - b.nextRunAtMs)
        .slice(0, limit)
        .map(([id]) => id)
    },
    async leaseRouting(id, nowMs, leaseMs, options) {
      const stored = routings.get(id)
      if (!stored || (stored.leaseUntilMs ?? 0) > nowMs) return null
      if (!options?.force && (!stored.active || stored.nextRunAtMs > nowMs)) return null
      stored.leaseUntilMs = nowMs + leaseMs
      return clone(stored)
    },
    async activeRoutingsForConnection(connectionId, limit) {
      return [...routings]
        .filter(([, routing]) => routing.connectionId === connectionId && routing.active)
        .slice(0, limit)
        .map(([id, routing]) => ({ id, routing: clone(routing) }))
    },
    async routingByProviderOrder(connectionId, providerOrderId) {
      const found = [...routings].find(
        ([, routing]) => routing.connectionId === connectionId && routing.providerOrderId === providerOrderId,
      )
      return found ? { id: found[0], routing: clone(found[1]) } : null
    },
  }
}
