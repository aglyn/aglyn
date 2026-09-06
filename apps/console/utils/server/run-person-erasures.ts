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

import { PERSON_ERASURES_COLLECTION } from '@aglyn/aglyn/server'
import { erasePerson, type ErasePersonResult, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * How many person erasures one run of the daily job executes (AGL-2623).
 *
 * Higher than the workspace batch's five, because a person is a few hundred
 * writes where a workspace is a recursive delete of everything it owns —
 * and lower than "all", because a run has sixty seconds and a request that
 * is not reached tonight is reached tomorrow, still inside any deadline a
 * data-protection officer could hold the workspace to.
 */
export const PERSON_ERASURES_PER_RUN = 25

/**
 * How many waiting requests the preview counts before it stops. Above the
 * batch on purpose, like the workspace preview: the point is to say what
 * is WAITING, including what tonight will not reach.
 */
export const PERSON_ERASURES_COUNTED = 200

export interface PersonErasureRunResult {
  /** Request ids the sweep completed. */
  erased: string[]
  /** Request ids whose sweep threw, with why; each stays queued. */
  failed: Array<{ requestId: string; reason: string }>
  /** How many the run took off the queue to look at. */
  scanned: number
}

export interface PersonErasureRunOptions {
  limit?: number
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
  /** Injectable for tests; defaults to `erasePerson`. */
  erase?: (options: { orgId: string; email: string; firestore?: any; now?: number }) => Promise<ErasePersonResult>
  /** Injectable for tests; defaults to `Date.now()`. */
  now?: number
}

/**
 * Drain the person-erasure queue, oldest first (AGL-2623).
 *
 * Ordered on `pendingSinceMs` — a field only a waiting request carries —
 * which rides the single-field index every collection has, so the query
 * needs nothing deployed and a completed request, having lost the field,
 * simply stops being listed. A `where('status', '==', 'pending')` with an
 * order would want a composite index that is not deployed, and would fail
 * at runtime in production only.
 *
 * Each request is its own try: a throw marks THAT request failed, moves it
 * to the back of the queue by refreshing `pendingSinceMs`, and goes on to
 * the next. A request that failed every night would otherwise lead every
 * run and starve everyone behind it — the shape the workspace runner had to
 * be fixed for once already.
 *
 * On completion the address leaves the document: the sweep needed it and
 * nothing else does, and a completed request that still carried the address
 * would be an erasure that kept the one thing it existed to remove.
 */
export async function runPersonErasures(
  options: PersonErasureRunOptions = {},
): Promise<PersonErasureRunResult> {
  const db = options.firestore ?? firebaseAdmin.app().firestore()
  const erase = options.erase ?? erasePerson
  const limit = options.limit ?? PERSON_ERASURES_PER_RUN
  const now = options.now ?? Date.now()
  const queue = await db
    .collection(PERSON_ERASURES_COLLECTION)
    .orderBy('pendingSinceMs', 'asc')
    .limit(limit)
    .get()

  const erased: string[] = []
  const failed: PersonErasureRunResult['failed'] = []
  for (const request of queue.docs) {
    const requestId = String(request.id)
    const orgId = String(request.get('orgId') ?? '')
    const email = String(request.get('email') ?? '')
    try {
      if (!orgId || !email) throw new Error('request names no workspace or no address')
      const result = await erase({ orgId, email, firestore: db, now })
      if ('skippedReason' in result) throw new Error(result.skippedReason)
      const { ok: _ok, ...counts } = result
      await request.ref.update({
        status: 'erased',
        erasedAtMs: now,
        result: counts,
        email: FieldValue.delete(),
        pendingSinceMs: FieldValue.delete(),
        failedAtMs: FieldValue.delete(),
        lastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      erased.push(requestId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`run-person-erasures: erasure failed for ${requestId}`, error)
      failed.push({ requestId, reason })
      await request.ref
        .update({
          status: 'failed',
          failedAtMs: now,
          failureCount: FieldValue.increment(1),
          lastError: reason.slice(0, 500),
          pendingSinceMs: now,
          updatedAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }
  }
  return { erased, failed, scanned: queue.size }
}

/**
 * How many person erasures are waiting — the staff card's number. Counted
 * one past the ceiling, so "more than this" is a fact rather than a
 * comparison; the probe row is never handed on.
 */
export async function countPendingPersonErasures(
  firestore?: any,
): Promise<{ pending: number; truncated: boolean; maxPerRun: number }> {
  const db = firestore ?? firebaseAdmin.app().firestore()
  const page = await db
    .collection(PERSON_ERASURES_COLLECTION)
    .orderBy('pendingSinceMs', 'asc')
    .limit(PERSON_ERASURES_COUNTED + 1)
    .get()
  return {
    pending: Math.min(page.size, PERSON_ERASURES_COUNTED),
    truncated: page.size > PERSON_ERASURES_COUNTED,
    maxPerRun: PERSON_ERASURES_PER_RUN,
  }
}
