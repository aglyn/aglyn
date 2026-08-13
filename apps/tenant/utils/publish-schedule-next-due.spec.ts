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
 * The publish-schedule beat's due-query memo (AGL-1440).
 *
 * Before the memo, `apply-publish-schedules` ran its collection-group query
 * on every 1-minute beat unconditionally — one billed read per beat on an
 * idle platform, 43,200/month, the largest scheduled line in the AGL-1440
 * decomposition after the state-doc read (fixed in 0a84b5770). These specs
 * measure queries per simulated hour of beats, because that is the unit the
 * issue counts in — and they hold the two promises the memo must not break:
 * a schedule the probe has SEEN publishes on its exact beat, and a schedule
 * it has never seen waits at most the memo age.
 */

import {
  NEXT_DUE_MAX_AGE_MS,
  readDueSchedules,
  resetPublishScheduleNextDue,
} from './publish-schedule-next-due'

const BEAT_MS = 60_000

interface Row {
  id: string
  at: number | null
}

describe('publish-schedule next-due memo (AGL-1440)', () => {
  beforeEach(() => resetPublishScheduleNextDue())

  /**
   * Run `beats` one-minute beats against a store, counting queries. The
   * store is a function so a test can change what is pending mid-run, and
   * rows returned as due leave it — the executor flips a published
   * schedule's status, so it stops matching the pending query.
   */
  const runBeats = async (
    beats: number,
    startAt: number,
    store: (now: number) => readonly Row[],
  ): Promise<{ queries: number; published: Array<{ id: string; atBeat: number }> }> => {
    let queries = 0
    const published: Array<{ id: string; atBeat: number }> = []
    const publishedIds = new Set<string>()
    for (let beat = 0; beat < beats; beat += 1) {
      const now = startAt + beat * BEAT_MS
      const due = await readDueSchedules<Row>({
        now,
        read: async () => {
          queries += 1
          // Ascending by publishAt, like the Firestore query.
          return store(now)
            .filter((row) => !publishedIds.has(row.id))
            .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
        },
        publishAtMs: (row) => row.at,
      })
      for (const row of due) {
        published.push({ id: row.id, atBeat: beat })
        publishedIds.add(row.id)
      }
    }
    return { queries, published }
  }

  /**
   * THE measurement. An idle platform — no schedules at all — over one hour
   * of beats: 60 queries before the memo, 12 after (one per 5-minute
   * window). 5x fewer reads, and on the recorded 30-day window that is
   * 43,200 → 8,640.
   */
  it('an idle hour costs 12 queries, not 60', async () => {
    const { queries, published } = await runBeats(60, 1_000_000, () => [])
    expect(queries).toBe(12)
    expect(published).toEqual([])
  })

  /**
   * The promise that justifies the 1-minute beat: a schedule the probe has
   * seen publishes on the exact beat its time arrives, not at the memo age.
   */
  it('publishes a seen schedule on its exact beat', async () => {
    const start = 1_000_000
    // Due 7.5 beats in — between beats, like a real "9:07:30" schedule.
    const at = start + 7.5 * BEAT_MS
    const { published } = await runBeats(20, start, () => [{ id: 's', at }])
    // First beat at-or-after the publish time is beat 8.
    expect(published).toEqual([{ id: 's', atBeat: 8 }])
  })

  /**
   * The staleness bound, stated as behaviour: a schedule CREATED after a
   * probe (another process — the console — so no signal can arrive) is
   * picked up by the next probe, at most the memo age later. The lazy ISR
   * executor stays the backstop below even that.
   */
  it('a schedule it has never seen waits at most the memo age', async () => {
    const start = 1_000_000
    // Created just after the probe at beat 0, already due.
    const createdAt = start + 1
    const { published } = await runBeats(20, start, (now) =>
      now >= createdAt ? [{ id: 'new', at: createdAt }] : [],
    )
    expect(published).toHaveLength(1)
    const lateMs = published[0].atBeat * BEAT_MS
    expect(lateMs).toBeLessThanOrEqual(NEXT_DUE_MAX_AGE_MS)
    expect(lateMs).toBeGreaterThan(0)
  })

  /**
   * Due work invalidates the memo: processing changes the set and the batch
   * may have been clipped, so the beat after a publish must look again.
   */
  it('re-queries on the beat after finding due work', async () => {
    const start = 1_000_000
    let rows: Row[] = [{ id: 'a', at: start - 1 }]
    let queries = 0
    const read = async () => {
      queries += 1
      return rows
    }
    const first = await readDueSchedules<Row>({
      now: start,
      read,
      publishAtMs: (row) => row.at,
    })
    expect(first).toHaveLength(1)
    rows = []
    await readDueSchedules<Row>({
      now: start + BEAT_MS,
      read,
      publishAtMs: (row) => row.at,
    })
    expect(queries).toBe(2)
  })

  /**
   * A probe that throws leaves the memo untouched — the beat fails, the
   * next one retries, exactly the pre-memo behaviour. Swallowing it would
   * memoize "nothing due" off an answer that never arrived.
   */
  it('a failed probe does not memoize anything', async () => {
    const start = 1_000_000
    await expect(
      readDueSchedules<Row>({
        now: start,
        read: async () => {
          throw new Error('index missing')
        },
        publishAtMs: (row) => row.at,
      }),
    ).rejects.toThrow('index missing')

    // The very next beat queries again rather than trusting a memo.
    let queried = false
    await readDueSchedules<Row>({
      now: start + BEAT_MS,
      read: async () => {
        queried = true
        return []
      },
      publishAtMs: (row) => row.at,
    })
    expect(queried).toBe(true)
  })

  /** Rows with no readable time are neither due nor the next-due marker. */
  it('skips rows without a publish time', async () => {
    const start = 1_000_000
    const due = await readDueSchedules<Row>({
      now: start,
      read: async () => [
        { id: 'broken', at: null },
        { id: 'later', at: start + BEAT_MS * 2 },
      ],
      publishAtMs: (row) => row.at,
    })
    expect(due).toEqual([])
  })
})
