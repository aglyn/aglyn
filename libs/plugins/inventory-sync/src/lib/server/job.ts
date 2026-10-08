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

import { ORDERS_PER_TICK } from '../constants'
import type { Engine } from './engine'
import type { InventoryStore } from './store'

/**
 * One tick of the console job (AGL-3642): every order hand-off with work due
 * — a paid order to send, a cancel to make — then every connection whose
 * stock run, then product run, is due. Nothing new starts past the tick's
 * deadline; what is left is due again on the next tick.
 */
export async function runInventoryTick(
  input: { engine: Engine; store: InventoryStore; now(): number },
  context: { deadlineMs: number },
): Promise<Record<string, number>> {
  const report: Record<string, number> = { orders: 0, stock: 0, products: 0 }
  const count = (key: string) => {
    report[key] = (report[key] ?? 0) + 1
  }
  for (const id of await input.store.dueOrders(input.now(), ORDERS_PER_TICK)) {
    if (input.now() >= context.deadlineMs) break
    try {
      count(`order_${await input.engine.runOrder(id)}`)
    } catch (error) {
      console.error('[inventory-sync] order run failed', id, error)
      count('order_error')
    }
    report['orders'] += 1
  }
  for (const work of ['stock', 'products'] as const) {
    for (const id of await input.store.dueConnections(work, input.now(), 25)) {
      if (input.now() >= context.deadlineMs) break
      try {
        const outcome = work === 'stock' ? await input.engine.runStock(id) : await input.engine.runProducts(id)
        count(`${work}_${outcome}`)
      } catch (error) {
        console.error(`[inventory-sync] ${work} run failed`, id, error)
        count(`${work}_error`)
      }
      report[work] += 1
    }
  }
  return report
}
