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

import type {
  PluginConsoleCronContext,
  PluginConsoleCronReport,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { FieldValue } from 'firebase-admin/firestore'
import { dropOffVerdict, FUNNEL_LEFT_EVENT, funnelLeftPayload } from '../model/drop-off'
import { FUNNEL_JOURNEYS_COLLECTION } from '../model/funnels.types'
import { funnelHostState } from './funnel-host-state'
import { readPersonJourneys } from './journey-people'

/**
 * THE DROP-OFF SWEEP (AGL-3605), on the console's fifteen-minute tick.
 *
 * Reads the identified visits whose `dropOffCheckAt` has come — one query on
 * the `funnelJourneys` collection group, ordered on that field (a declared
 * single-field index), bounded per tick — and for each, judges the person on
 * every visit of theirs the site keeps against the site's watched funnels
 * (`dropOffVerdict`). A watch that came due raises `funnelLeft`, once: the
 * mark is written on the visit BEFORE the event is raised, so a tick that
 * dies between the two loses a follow-up rather than sending one twice.
 * Then the visit's next look is stamped, or the field removed when nothing
 * is left to wait for, which is what takes it out of the query.
 *
 * The event reaches the automation engine through the host event bus; this
 * plugin never imports it. What the automation then sends goes through its
 * own send rules — a suppressed or unsubscribed address gets nothing.
 */

/** The most visits one tick looks at. */
export const DROP_OFF_SWEEP_BATCH = 200

export interface DropOffSweepDeps {
  firestore: any
  emit(hostId: string, event: string, payload: Record<string, string | number>): Promise<void>
}

export async function runDropOffSweep(
  deps: DropOffSweepDeps,
  context: PluginConsoleCronContext,
): Promise<PluginConsoleCronReport> {
  const { firestore } = deps
  const now = context.nowMs
  const page = await firestore
    .collectionGroup(FUNNEL_JOURNEYS_COLLECTION)
    .where('dropOffCheckAt', '<=', now)
    .orderBy('dropOffCheckAt')
    .limit(DROP_OFF_SWEEP_BATCH)
    .get()
  let looked = 0
  let raised = 0
  let cleared = 0
  let failed = 0
  for (const doc of page.docs) {
    if (Date.now() > context.deadlineMs) break
    looked += 1
    try {
      const hostId = doc.ref.parent.parent?.id
      const email = String(doc.get('personEmail') ?? '')
      const state = hostId ? await funnelHostState(firestore, hostId, now) : null
      if (!hostId || !email || !state?.recording || !state.watched.length) {
        await doc.ref.update({ dropOffCheckAt: FieldValue.delete() })
        cleared += 1
        continue
      }
      const person = await readPersonJourneys(firestore, hostId, email)
      const steps = person.flatMap((one) => one.steps)
      const fired = new Set(person.flatMap((one) => one.fired))
      const lastAt = Math.max(0, ...person.map((one) => one.lastAt))
      const verdict = dropOffVerdict({ funnels: state.watched, steps, fired, lastAt, now })
      for (const drop of verdict.due) {
        await doc.ref.update({ [`left.${drop.key}`]: now })
        await deps.emit(hostId, FUNNEL_LEFT_EVENT, funnelLeftPayload(drop, email))
        raised += 1
      }
      if (verdict.nextCheckAt === null) cleared += 1
      await doc.ref.update({
        dropOffCheckAt: verdict.nextCheckAt === null ? FieldValue.delete() : verdict.nextCheckAt,
      })
    } catch (error) {
      failed += 1
      console.error('[funnels] drop-off check failed', doc.ref.path, error)
      // Looked at again in an hour, so one bad visit cannot hold the queue.
      await doc.ref.update({ dropOffCheckAt: now + 60 * 60 * 1000 }).catch(() => undefined)
    }
  }
  return { looked, raised, cleared, failed, more: page.docs.length === DROP_OFF_SWEEP_BATCH }
}
