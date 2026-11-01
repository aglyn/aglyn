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

/**
 * How long a sweep's later chunks may keep using its listing.
 *
 * Far longer than a sweep takes (23 chunks took about 90 s on 2026-11-01) and
 * far shorter than the gap between two scheduled sweeps. This is a backstop:
 * what normally replaces a listing is the next sweep's first chunk.
 */
const SWEEP_LISTING_MAX_AGE_MS = 10 * 60_000

const sweepListings = new Map<string, { at: number; listing: Promise<unknown> }>()

/**
 * A sweep's subjects, listed once per sweep rather than once per chunk
 * (AGL-4121).
 *
 * `report-usage` read every `orgs` and `hosts` document on each chunk, then
 * took ten orgs from them: 423 documents, 23 times, about 9,700 of the 15,000
 * reads a run costs, twice a day.
 *
 * Paging those collections with a cursor, as `usage-alerts` does, is not an
 * option there. Its subjects are the org ids AND every org id a site names, so
 * a site whose org has no document is still swept, and a cursor over `orgs`
 * would never reach it. That miss would be a month unbilled with nothing to say
 * so. Holding the list changes what a chunk costs and nothing about what the
 * sweep covers:
 *
 * - **A first chunk always lists.** Only the start of a sweep has no cursor, so
 *   no sweep ever starts from another sweep's list.
 * - **A later chunk with nothing to reuse lists for itself**, on a cold instance
 *   or past the age limit. That is what every chunk used to do, so losing the
 *   listing costs reads and never coverage.
 * - **A failed listing is not kept**, or every later chunk would fail with it.
 *
 * @param sweep names the sweep; sweeps never share a listing.
 * @param cursor the cursor this invocation resumes from, if any.
 * @param list reads the subjects.
 */
export function listOncePerSweep<T>(
  sweep: string,
  cursor: string | null | undefined,
  list: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  const held = sweepListings.get(sweep)
  if (cursor && held && now - held.at < SWEEP_LISTING_MAX_AGE_MS) {
    return held.listing as Promise<T>
  }
  const listing = list()
  sweepListings.set(sweep, { at: now, listing })
  listing.catch(() => {
    if (sweepListings.get(sweep)?.listing === listing) {
      sweepListings.delete(sweep)
    }
  })
  return listing
}
