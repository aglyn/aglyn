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

  it('drops days that have fallen out of the window', async () => {
    const source = reader()
    await readAnalyticsDays(media(source))
    const laterNow = Date.parse('2026-10-01T09:00:00Z')
    const later = recentDayIds(laterNow, 30)
    source.calls.length = 0
    await readAnalyticsDays({
      ...media(source),
      dayIds: later,
      liveDay: later[0],
      now: laterNow,
    })
    // A month on, none of August's entries are still held.
    expect(source.calls.filter((day) => DAYS.includes(day))).toEqual([])
    expect(source.calls).toHaveLength(30)
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
})
