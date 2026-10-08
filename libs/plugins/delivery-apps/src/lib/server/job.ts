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
import type { DeliveryStore } from './store'

/**
 * One tick of the console job (AGL-3644): every order with work due — a
 * call to the service that failed and is due again, or a ready order the
 * courier has long since taken, closed as picked up. Nothing new starts past
 * the tick's deadline; what is left is due again on the next tick.
 */
export async function runDeliveryAppsTick(
  input: { engine: Engine; store: DeliveryStore; now(): number },
  context: { deadlineMs: number },
): Promise<Record<string, number>> {
  const report: Record<string, number> = { orders: 0 }
  for (const id of await input.store.dueOrders(input.now(), ORDERS_PER_TICK)) {
    if (input.now() >= context.deadlineMs) break
    try {
      const outcome = await input.engine.runDue(id)
      report[outcome] = (report[outcome] ?? 0) + 1
    } catch (error) {
      console.error('[delivery-apps] order run failed', id, error)
      report['failed'] = (report['failed'] ?? 0) + 1
    }
    report['orders'] += 1
  }
  return report
}
