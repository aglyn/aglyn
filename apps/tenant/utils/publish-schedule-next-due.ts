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

/**
 * The publish-schedule beat's due-query, gated on a memoized next-due time
 * (AGL-1440). Sibling of `plugin-job-state.ts` and built on its argument.
 *
 * The beat fires every minute because that is the resolution scheduled
 * publishing promises, and `apply-publish-schedules` ran its
 * `collectionGroup('screens')` query on every beat — Firestore bills one
 * read minimum for a query returning nothing, so a completely idle platform
 * paid 1,440 reads a day, 43,200 a month, to be told nothing was scheduled.
 *
 * The query is ordered by `publishAt` ascending WITHOUT the `<= now` bound,
 * so one probe answers two questions at once: which schedules are due, and
 * when the earliest not-yet-due one lands. Until that time — bounded by
 * `NEXT_DUE_MAX_AGE_MS` — subsequent beats skip the query entirely.
 *
 * ## What can be late, and by how much
 *
 * A schedule the probe has SEEN publishes on the exact beat its time
 * arrives: the memo stores its time, and the skip condition yields the
 * moment `now` reaches it. What the memo cannot see is a schedule CREATED
 * (or edited earlier) after the probe, from the console — a different
 * process, so no in-memory signal can arrive. The age bound caps that: the
 * beat re-probes at least every 5 minutes, so a brand-new "publish now"
 * schedule lands at most 5 minutes late on the beat path. The lazy ISR
 * executor (`applyDuePublishSchedule` inside the render) is untouched and
 * remains the backstop it always was, exactly as when the beat is down.
 *
 * ## The error can only go one way
 *
 * A memoized next-due time is only ever from a real probe, and the skip
 * fires only while `now` is BEFORE it — so a stale memo can delay a
 * publish (bounded above), never publish early and never double-publish.
 * Any beat that finds due work forces the next beat to re-probe, because
 * processing changes the set and the batch may have been clipped at its
 * limit. A probe that throws leaves the memo untouched and rethrows: the
 * beat fails and the next one retries, which is what happened before this
 * memo existed.
 *
 * NOTHING here touches entitlements: `applyDuePublishSchedule` re-checks
 * the `scheduledPublishing` entitlement live on every application — the
 * memo decides only WHETHER TO LOOK, never what the answer is.
 */

/**
 * How long "nothing is due" may stand without re-asking. Also the ceiling
 * on how late the beat path publishes a schedule it has never seen.
 */
export const NEXT_DUE_MAX_AGE_MS = 5 * 60_000

/** Epoch ms of the earliest pending-but-not-due schedule; null = none. */
let nextDueAt: number | null = null
let checkedAt = 0

export interface ReadDueSchedulesOptions<T> {
  now: number
  /**
   * Runs the pending-schedules query, ordered by `publishAt` ASCENDING —
   * the ordering is what makes the first not-yet-due row the next-due time.
   * Called only when the memo cannot answer.
   */
  read: () => Promise<readonly T[]>
  /** The schedule's publish time, or null when the row carries none. */
  publishAtMs: (row: T) => number | null
}

/**
 * The schedules due now, from the memo when it is fresh enough and says
 * nothing is. Rows without a readable publish time are skipped: they are
 * not due (nothing can compare), and not the next-due either.
 */
export async function readDueSchedules<T>(
  options: ReadDueSchedulesOptions<T>,
): Promise<readonly T[]> {
  const { now, read, publishAtMs } = options
  if (
    checkedAt &&
    now - checkedAt < NEXT_DUE_MAX_AGE_MS &&
    (nextDueAt === null || now < nextDueAt)
  ) {
    return []
  }

  const pending = await read()
  const due: T[] = []
  let earliestFuture: number | null = null
  for (const row of pending) {
    const at = publishAtMs(row)
    if (at === null) continue
    if (at <= now) {
      due.push(row)
    } else {
      // Ascending order: the first future row is the earliest one.
      earliestFuture = at
      break
    }
  }

  if (due.length === 0) {
    nextDueAt = earliestFuture
    checkedAt = now
  } else {
    // Due work changes the set, and the batch may have been clipped at its
    // limit — the next beat must look again rather than trust this probe.
    nextDueAt = null
    checkedAt = 0
  }
  return due
}

/** Test seam — the memo is module scope by design. */
export function resetPublishScheduleNextDue(): void {
  nextDueAt = null
  checkedAt = 0
}
