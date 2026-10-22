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

import {
  ANALYTICS_LIVE_DAY_TTL_MS,
  readAnalyticsDays,
  recentDayIds,
  resetAnalyticsDayCache,
  sumAssetUsage,
  type MediaDayMedia,
} from './analytics-day-cache'

/**
 * The cost claim this file exists to pin (AGL-1440): a run of day-docs is read
 * once per WINDOW, not once per asset, panel, or range change. The counted
 * quantity is `read` calls — a Firestore document read is exactly one of those.
 */
describe('analytics day-doc reads', () => {
  const NOW = Date.parse('2026-08-12T09:00:00Z')
  const DAYS = recentDayIds(NOW, 30)
  const LIVE = DAYS[0]

  beforeEach(() => resetAnalyticsDayCache())

  const reader = () => {
    const calls: string[] = []
    const read = async (day: string): Promise<MediaDayMedia> => {
      calls.push(day)
      return {
        'asset-a': { serves: 1, bytes: 10 },
        'asset-b': { serves: 2, bytes: 20 },
      }
    }
    return { calls, read }
  }

  const media = (calls: { read: (day: string) => Promise<MediaDayMedia> }) => ({
    scopeKey: 'hosts/h1',
    field: 'media',
    dayIds: DAYS,
    liveDay: LIVE,
    now: NOW,
    read: calls.read,
    fallback: {} as MediaDayMedia,
  })

  it('reads every day once on the first open', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    expect(source.calls).toHaveLength(30)
  })

  it('costs ZERO further reads for the next asset in the same window', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    source.calls.length = 0
    // Same drawer, different asset — the day-docs are not per-asset.
    await readAnalyticsDays(media(source))
    expect(source.calls).toEqual([])
  })

  it('re-reads ONLY the live day once its TTL lapses', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    source.calls.length = 0
    await readAnalyticsDays({
      ...media(source),
      now: NOW + ANALYTICS_LIVE_DAY_TTL_MS + 1,
    })
    // The other 29 are closed counters and can never change.
    expect(source.calls).toEqual([LIVE])
  })

  it('serves a narrower window out of a wider one it already paid for', async () => {
    // The traffic panel's range switch — 30 days then 14 — must not re-read.
    const source = reader()
    await readAnalyticsDays(media(source))
    source.calls.length = 0
    await readAnalyticsDays({ ...media(source), dayIds: recentDayIds(NOW, 14) })
    expect(source.calls).toEqual([])
  })

  it('never serves one scope the counters of another', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    source.calls.length = 0
    await readAnalyticsDays({ ...media(source), scopeKey: 'orgs/o1' })
    expect(source.calls).toHaveLength(30)
  })

  it('never serves one panel the field another panel read', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    source.calls.length = 0
    await readAnalyticsDays({ ...media(source), field: 'traffic' })
    expect(source.calls).toHaveLength(30)
  })

  it('does not pin an empty day when the read fails', async () => {
    let attempts = 0
    const read = async (): Promise<MediaDayMedia> => {
      attempts += 1
      throw Object.assign(new Error('denied'), { code: 'permission-denied' })
    }
    const first = await readAnalyticsDays({ ...media({ read }), read })
    expect(first.every((day) => Object.keys(day).length === 0)).toBe(true)
    attempts = 0
    await readAnalyticsDays({ ...media({ read }), read })
    expect(attempts).toBe(30)
  })

  it('drops days that have fallen out of the retention window', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    // Well past RETENTION_DAYS, so August's entries are genuinely evicted
    // rather than merely unasked-for.
    const laterNow = Date.parse('2027-03-01T09:00:00Z')
    const later = recentDayIds(laterNow, 30)
    source.calls.length = 0
    await readAnalyticsDays({
      ...media(source),
      dayIds: later,
      liveDay: later[0],
      now: laterNow,
    })
    expect(source.calls.filter((day) => DAYS.includes(day))).toEqual([])
    expect(source.calls).toHaveLength(30)
    // Ask for August again: every one of its days is a miss, which is the
    // only way to observe that the map is not still holding them.
    source.calls.length = 0
    await readAnalyticsDays({ ...media(source), now: laterNow })
    expect(source.calls).toHaveLength(30)
  })

  /**
   * AGL-1890. `prune` swept the WHOLE map against the current call's oldest
   * day, so a narrower window evicted the wider one that had already been
   * paid for — the opposite of what this module is for. These two are the
   * reds that shape proved.
   */
  it('does not evict a wider window when a narrower one is read', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    // The traffic panel's range switch, 30 → 7 → 30.
    await readAnalyticsDays({ ...media(source), dayIds: recentDayIds(NOW, 7) })
    source.calls.length = 0
    await readAnalyticsDays(media(source))
    expect(source.calls).toEqual([])
  })

  it('never evicts another panel or scope when it prunes', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    // The traffic card's 14 days, in its own field, and another scope's.
    const narrow = recentDayIds(NOW, 14)
    await readAnalyticsDays({
      ...media(source),
      field: 'traffic',
      dayIds: narrow,
    })
    await readAnalyticsDays({
      ...media(source),
      scopeKey: 'orgs/o1',
      dayIds: narrow,
    })
    source.calls.length = 0
    await readAnalyticsDays(media(source))
    expect(source.calls).toEqual([])
  })

  it('sums one asset out of the shared day maps', () => {
    const days: MediaDayMedia[] = [
      { 'asset-a': { serves: 3, bytes: 30 }, 'asset-b': { serves: 9, bytes: 90 } },
      { 'asset-a': { serves: 4, bytes: 40 } },
      {},
    ]
    expect(sumAssetUsage(days, 'asset-a')).toEqual({ serves: 7, bytes: 70 })
    expect(sumAssetUsage(days, 'missing')).toEqual({ serves: 0, bytes: 0 })
  })

  it('puts the live UTC day first', () => {
    expect(recentDayIds(NOW, 30)[0]).toBe('2026-08-12')
    expect(recentDayIds(NOW, 14)).toHaveLength(14)
  })

  /**
   * AGL-1890. The ids must be whole UTC days back from `now`, because that is
   * what the day-docs are keyed by. Local-calendar arithmetic keeps the local
   * wall clock across a DST transition, so one step back is 23 or 25 hours,
   * and the UTC day it prints skips or repeats.
   *
   * `America/Chicago` is chosen because it observes DST; the instant is 18:30
   * on 1 Nov LOCAL, the evening after the 2026 fall-back, and the UTC day has
   * already rolled to the 2nd. The old implementation answered
   * `2026-11-02, 2026-10-31, 2026-10-30, 2026-10-29` — `2026-11-01` was never
   * read, and every older day was mislabelled by one.
   */
  it('counts back in UTC days, not local ones', () => {
    const previous = process.env.TZ
    process.env.TZ = 'America/Chicago'
    try {
      const at = Date.parse('2026-11-02T00:30:00Z')
      // Guard the premise: if changing TZ did not take, this test cannot see
      // the bug it exists for and its green would mean nothing.
      expect(new Date(at).getDate()).toBe(1)
      expect(recentDayIds(at, 4)).toEqual([
        '2026-11-02',
        '2026-11-01',
        '2026-10-31',
        '2026-10-30',
      ])
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })
})
