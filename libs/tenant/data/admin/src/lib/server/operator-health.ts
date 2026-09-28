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

import firebaseAdmin from './firebase-admin'

/**
 * HEALTH TRANSITIONS (AGL-3377): the health checks, remembered.
 *
 * Every `/api/health/*` endpoint answers 200 or 503 to whoever asks and
 * forgets the answer. An install with an external uptime monitor hears the
 * 503; an install without one — most self-hosted ones — hears nothing, and
 * a dead cron or a stale backup is found on the day it is needed.
 *
 * `recordHealthState` keeps the last verdict per check in
 * `operatorHealthState/{checkId}` and raises an operator alert on the EDGE:
 * `system.healthDegraded` when a healthy (or never-seen) check goes
 * degraded, `system.healthRecovered` when it comes back. Once each, however
 * many instances and pollers see the same state, because the edge is decided
 * inside a transaction on the check's document.
 *
 * Cheap on the hot path: each instance remembers the last state it wrote, so
 * a poll that finds nothing changed costs no Firestore round trip at all.
 * Never throws.
 */

export const OPERATOR_HEALTH_COLLECTION = 'operatorHealthState'

export type OperatorHealthStatus = 'ok' | 'degraded'

export interface OperatorHealthStateDoc {
  checkId: string
  label: string
  status: OperatorHealthStatus
  /** When the check entered `status`. */
  sinceMs: number
  detail: string
  updatedAtMs: number
}

export type OperatorHealthTransition = 'degraded' | 'recovered' | null

/** The last status this instance wrote per check. */
const lastWritten = new Map<string, OperatorHealthStatus>()

/** Test seam. */
export function resetOperatorHealthCacheForTests(): void {
  lastWritten.clear()
}

/** "3 h 5 min", for a recovery's duration. */
export function describeHealthDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`
  return `${Math.round(hours / 24)} days`
}

export async function recordHealthState(
  checkId: string,
  status: OperatorHealthStatus,
  detail: string,
  options: { label?: string; now?: number } = {},
): Promise<OperatorHealthTransition> {
  const id = String(checkId ?? '').trim()
  if (!id) return null
  if (lastWritten.get(id) === status) return null
  const now = options.now ?? Date.now()
  const label = String(options.label ?? '').trim() || id
  const summary = String(detail ?? '').trim().slice(0, 1_000)
  try {
    const firestore = firebaseAdmin.app().firestore()
    const ref = firestore.collection(OPERATOR_HEALTH_COLLECTION).doc(id)
    const edge = await firestore.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref)
      const prior = (snapshot.exists ? snapshot.data() : null) as
        | Partial<OperatorHealthStateDoc>
        | null
      if (prior?.status === status) {
        transaction.update(ref, { detail: summary, updatedAtMs: now })
        return { transition: null, priorSinceMs: prior.sinceMs ?? now }
      }
      const next: OperatorHealthStateDoc = {
        checkId: id,
        label,
        status,
        sinceMs: now,
        detail: summary,
        updatedAtMs: now,
      }
      transaction.set(ref, next)
      // A check first seen healthy is the ordinary case and says nothing; a
      // check first seen degraded is an install that was broken before
      // anybody watched, which is exactly the one to say out loud.
      const transition: OperatorHealthTransition =
        status === 'degraded' ? 'degraded' : prior ? 'recovered' : null
      return { transition, priorSinceMs: prior?.sinceMs ?? now }
    })
    lastWritten.set(id, status)
    if (edge.transition) {
      const { raiseOperatorAlert } = await import('./operator-alerts')
      if (edge.transition === 'degraded') {
        await raiseOperatorAlert('system.healthDegraded', {
          dedupeKey: id,
          context: { check: label, detail: summary },
        })
      } else {
        await raiseOperatorAlert('system.healthRecovered', {
          dedupeKey: id,
          context: {
            check: label,
            duration: describeHealthDuration(now - edge.priorSinceMs),
          },
        })
      }
    }
    return edge.transition
  } catch (error) {
    console.error(`[operator-health] ${id} could not be recorded`, error)
    return null
  }
}

/** Every recorded check, for the staff page and the sweep's report. */
export async function listHealthStates(): Promise<OperatorHealthStateDoc[]> {
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection(OPERATOR_HEALTH_COLLECTION)
      .get()
    return snapshot.docs.map((doc: any) => doc.data() as OperatorHealthStateDoc)
  } catch (error) {
    console.error('[operator-health] states unreadable', error)
    return []
  }
}

/**
 * One health endpoint's body as a state: `status` is the endpoint's own
 * verdict, and the detail names each failing check and its code.
 */
export function healthStateOfBody(
  body: Record<string, unknown> | null,
  httpStatus: number | null,
): { status: OperatorHealthStatus; detail: string } {
  if (!body) {
    return {
      status: 'degraded',
      detail:
        httpStatus === null
          ? 'The endpoint did not answer.'
          : `The endpoint answered ${httpStatus} with no readable body.`,
    }
  }
  const checks = (body['checks'] ?? {}) as Record<string, Record<string, unknown> | undefined>
  const failing = Object.entries(checks)
    .filter(([, check]) => check && check['ok'] !== true)
    .map(([name, check]) =>
      typeof check?.['code'] === 'string' ? `${name} (${check['code']})` : name,
    )
  const degraded =
    body['status'] === 'degraded' ||
    (body['status'] !== 'ok' && (httpStatus === 503 || failing.length > 0))
  return {
    status: degraded ? 'degraded' : 'ok',
    detail: degraded
      ? failing.length
        ? `Failing: ${failing.join(', ')}.`
        : `The endpoint answered ${httpStatus ?? 'nothing'}.`
      : 'All checks pass.',
  }
}
