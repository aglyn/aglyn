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

import { AsyncLocalStorage } from 'node:async_hooks'
import type { HostEventActor } from '@aglyn/tenant-runtime/host-event-listeners'

/**
 * Who set a run off (AGL-3376), carried beside the engine rather than
 * through it.
 *
 * An event reaches a run-row writer through the listener, the fan-out to
 * workflows and actions, their steps, chained events and nested workflows —
 * a parameter on every one of those frames would be threaded through code
 * that never reads it. The listener runs the engine inside this scope once,
 * and each writer reads the scope, so an event a step raises in turn is
 * credited to whoever caused the first one.
 *
 * A resumed enrollment (a wait that ended on the cron) runs outside any
 * scope and writes no `triggeredBy`: the person who started it is not the
 * one acting now, and the history says it was not recorded.
 */
const scope = new AsyncLocalStorage<HostEventActor | undefined>()

/** Runs `work` with `actor` as the cause of every run it writes. */
export function withRunTriggerActor<T>(
  actor: HostEventActor | undefined,
  work: () => Promise<T>,
): Promise<T> {
  return scope.run(actor, work)
}

/**
 * The `triggeredBy` field for a run row, or nothing outside a scope. Only
 * the keys the door knew — Firestore refuses an `undefined` value.
 */
export function runTriggeredByFields(): {
  triggeredBy?: Record<string, string>
} {
  const actor = scope.getStore()
  if (!actor?.kind) return {}
  const triggeredBy: Record<string, string> = { kind: actor.kind }
  if (actor.uid) triggeredBy['uid'] = actor.uid
  if (actor.email) triggeredBy['email'] = actor.email
  if (actor.apiKeyName) triggeredBy['apiKeyName'] = actor.apiKeyName
  return { triggeredBy }
}
