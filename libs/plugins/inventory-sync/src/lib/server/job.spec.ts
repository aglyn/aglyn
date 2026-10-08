/**
 * @jest-environment node
 */
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

import { createMemoryInventoryStore } from '../testing/memory-store'
import type { Engine } from './engine'
import { runInventoryTick } from './job'
import { emptyConnection, type StoredOrder } from './store'

describe('the console tick (AGL-3642)', () => {
  it('runs due orders, then due stock and product runs, and stops at its deadline', async () => {
    const store = createMemoryInventoryStore()
    store.orders.set('h_o1', { active: true, nextRunAtMs: 0 } as StoredOrder)
    store.orders.set('h_o2', { active: true, nextRunAtMs: 0 } as StoredOrder)
    store.connections.set('h', { ...emptyConnection({ orgId: 'o', hostId: 'h', provider: 'inflow', nowMs: 0 }), status: 'active' })
    const ran: string[] = []
    let now = 0
    const engine = {
      runOrder: async (id: string) => {
        ran.push(id)
        if (id === 'h_o1') throw new Error('boom')
        return 'sent'
      },
      runStock: async (id: string) => {
        ran.push(`stock:${id}`)
        return 'synced'
      },
      runProducts: async (id: string) => {
        ran.push(`products:${id}`)
        now = 100
        return 'skipped'
      },
    } as unknown as Engine
    const report = await runInventoryTick({ engine, store, now: () => now }, { deadlineMs: 50 })
    expect(ran).toEqual(['h_o1', 'h_o2', 'stock:h', 'products:h'])
    expect(report).toMatchObject({ orders: 2, order_error: 1, order_sent: 1, stock_synced: 1, products_skipped: 1 })
  })
})
