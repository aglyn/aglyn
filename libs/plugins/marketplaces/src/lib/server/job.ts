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

import { CONNECTIONS_PER_TICK, ORDERS_PER_TICK } from '../constants'
import type { Engine } from './engine'
import type { MarketplaceStore } from './store'

/**
 * One tick of the console job (AGL-3638): every imported order with work
 * due — an acknowledge, a shipment to confirm, fees to read — then every
 * connection with work due: its new orders, then its listings. Orders go
 * first because a confirmation is what a marketplace measures a seller by.
 * Nothing new starts past the tick's deadline; what is left is due again on
 * the next tick.
 */
export async function runMarketplacesTick(
  input: { engine: Engine; store: MarketplaceStore; now(): number },
  context: { deadlineMs: number },
): Promise<Record<string, number>> {
  const report: Record<string, number> = { orders: 0, connections: 0 }
  for (const id of await input.store.dueOrders(input.now(), ORDERS_PER_TICK)) {
    if (input.now() >= context.deadlineMs) break
    try {
      const outcome = await input.engine.runOrder(id)
      report[`order_${outcome}`] = (report[`order_${outcome}`] ?? 0) + 1
    } catch (error) {
      console.error('[marketplaces] order run failed', id, error)
      report['order_failed'] = (report['order_failed'] ?? 0) + 1
    }
    report['orders'] += 1
  }
  for (const id of await input.store.dueConnections(input.now(), CONNECTIONS_PER_TICK)) {
    if (input.now() >= context.deadlineMs) break
    try {
      const outcome = await input.engine.runConnection(id)
      report[outcome] = (report[outcome] ?? 0) + 1
    } catch (error) {
      console.error('[marketplaces] connection run failed', id, error)
      report['failed'] = (report['failed'] ?? 0) + 1
    }
    report['connections'] += 1
  }
  return report
}
