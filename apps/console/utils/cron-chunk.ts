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
 * Resumable chunking for the sweep crons (AGL-1141).
 *
 * `report-usage` walked every org in one invocation and 504'd on Vercel's
 * function limit. Raising `maxDuration` buys headroom; it does not make the
 * sweep finishable, because the ceiling is fixed and the org count is not.
 *
 * So a sweep processes a bounded chunk and hands back a cursor, and the caller
 * loops until it is done. Two properties matter more than the chunking itself:
 *
 * - **The cursor is the last id actually FINISHED**, never the last attempted.
 *   Handing back an id whose work failed silently skips it forever, which is
 *   the partial-month bug wearing a cursor.
 * - **A stable total order.** Ids are sorted, so "everything after the cursor"
 *   means the same thing across invocations even as orgs are created and
 *   deleted mid-sweep. Firestore's default iteration order is not a promise.
 */

/** How many subjects one invocation handles unless told otherwise. */
export const CRON_CHUNK_SIZE = 10

export interface CronChunk<T> {
  /** The subjects this invocation should process, in order. */
  items: T[]
  /** Cursor for the next call, or null when this chunk finishes the sweep. */
  nextCursor: string | null
  /** True when nothing remains after this chunk. */
  done: boolean
  /** Total subjects in the sweep, for a log line that means something. */
  total: number
}

/**
 * The next slice of a sweep.
 *
 * @param ids every subject in the sweep; sorted internally, so callers may
 *            pass them in whatever order the query returned.
 * @param cursor the last id FINISHED by the previous call; null to start.
 * @param limit chunk size; clamped to at least 1 so a bad input cannot
 *              produce a sweep that makes no progress and loops forever.
 */
export function selectCronChunk(
  ids: readonly string[],
  cursor: string | null | undefined,
  limit: number = CRON_CHUNK_SIZE,
): CronChunk<string> {
  const ordered = [...new Set(ids)].sort()
  const size = Math.max(1, Math.floor(Number(limit) || CRON_CHUNK_SIZE))
  // Strictly greater than: the cursor names work already done, so including
  // it would redo the last subject on every resume.
  const remaining = cursor
    ? ordered.filter((id) => id > String(cursor))
    : ordered
  const items = remaining.slice(0, size)
  const done = items.length === remaining.length
  return {
    items,
    // Null when done, so a caller that keys "keep going" off the cursor's
    // presence agrees with `done` instead of looping one extra time.
    nextCursor: done ? null : (items[items.length - 1] ?? null),
    done,
    total: ordered.length,
  }
}
