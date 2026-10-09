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

import {
  connectionId,
  deliveryId,
  readConnection,
  readDelivery,
  type CourierStore,
  type StoredConnection,
  type StoredDelivery,
} from '../server/store'

/**
 * An in-memory {@link CourierStore} for specs (AGL-3695). Every value goes
 * through a JSON round trip and the store's own readers, as Firestore's would,
 * and `updateDelivery` runs one change at a time, as a transaction does.
 */
export function createMemoryCourierStore() {
  const connections = new Map<string, unknown>()
  const deliveries = new Map<string, unknown>()
  let queue: Promise<unknown> = Promise.resolve()
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const strip = (value: { id: string }) => {
    const rest: Record<string, unknown> = { ...value }
    delete rest['id']
    return copy(rest)
  }

  const store: CourierStore & {
    connections: Map<string, unknown>
    deliveries: Map<string, unknown>
    delivery(hostId: string, orderId: string): StoredDelivery | null
  } = {
    connections,
    deliveries,
    delivery: (hostId, orderId) => {
      const id = deliveryId(hostId, orderId)
      return deliveries.has(id) ? readDelivery(id, deliveries.get(id)) : null
    },
    async getConnection(hostId, provider) {
      const id = connectionId(hostId, provider)
      return connections.has(id) ? readConnection(id, connections.get(id)) : null
    },
    async putConnection(connection: StoredConnection) {
      connections.set(connection.id, strip(connection))
    },
    async patchConnection(id, patch) {
      connections.set(id, { ...((connections.get(id) as object) ?? {}), ...copy(patch) })
    },
    async deleteConnection(id) {
      connections.delete(id)
    },
    async getDelivery(hostId, orderId) {
      return store.delivery(hostId, orderId)
    },
    updateDelivery(hostId, orderId, change) {
      const run = queue.then(() => {
        const { next, result } = change(store.delivery(hostId, orderId))
        if (next) deliveries.set(deliveryId(hostId, orderId), strip(next))
        return result
      })
      queue = run.catch(() => undefined)
      return run
    },
    async dueDeliveries(nowMs, limit) {
      return [...deliveries.entries()]
        .map(([id, data]) => readDelivery(id, data))
        .filter((delivery): delivery is StoredDelivery => Boolean(delivery?.open && delivery.nextCheckAtMs <= nowMs))
        .sort((a, b) => a.nextCheckAtMs - b.nextCheckAtMs)
        .slice(0, limit)
    },
    async hasOpenRun(hostId) {
      return [...deliveries.entries()].some(([id, data]) => {
        const delivery = readDelivery(id, data)
        return delivery?.hostId === hostId && delivery.open
      })
    },
  }
  return store
}

export type MemoryCourierStore = ReturnType<typeof createMemoryCourierStore>
