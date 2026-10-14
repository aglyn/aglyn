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

import { RUNS_PER_TICK } from '../constants'
import type { CourierEngine } from './engine'
import type { CourierStore } from './store'

/**
 * One tick of the couriers job (AGL-3695), on the console's fifteen-minute
 * sweep. Webhooks carry a run's steps as they happen; the job is the net
 * under them: it calls off the runs a refund or a cancel marked, settles a
 * booking whose answer was lost, and reads each open run the courier has
 * said nothing about for a while — so a merchant who never set the webhook
 * up still sees the courier arrive, a sweep late.
 */
export async function runCouriersTick(
  deps: { engine: CourierEngine; store: CourierStore; now(): number },
  options: { deadlineMs: number },
): Promise<Record<string, number>> {
  const due = await deps.store.dueDeliveries(deps.now(), RUNS_PER_TICK)
  const counts: Record<string, number> = { due: due.length, cancelled: 0, settled: 0, checked: 0, failed: 0, skipped: 0 }
  for (const delivery of due) {
    if (deps.now() >= options.deadlineMs) break
    const outcome = await deps.engine.work(delivery)
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }
  return counts
}
