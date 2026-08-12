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
  PLUGIN_JOB_STATE_MAX_AGE_MS,
  readPluginJobLastRuns,
  recordPluginJobRuns,
  resetPluginJobState,
  type PluginJobLastRuns,
} from './plugin-job-state'

const MINUTE = 60_000

describe('plugin job last-run marks', () => {
  beforeEach(() => resetPluginJobState())

  const reader = (marks: PluginJobLastRuns = {}) => {
    let reads = 0
    return {
      get reads() {
        return reads
      },
      read: async () => {
        reads += 1
        return { ...marks }
      },
    }
  }

  it('reads the document once, not once per beat', async () => {
    const source = reader({ 'core:apply-publish-schedules': 0 })
    // Sixty beats — one an hour's worth of ticks at the platform's cadence,
    // capped by the age bound rather than by the tick count.
    for (let minute = 0; minute < 25; minute += 1) {
      await readPluginJobLastRuns({ now: minute * MINUTE, read: source.read })
    }
    expect(source.reads).toBe(1)
  })

  it('re-reads once the age bound lapses', async () => {
    const source = reader()
    await readPluginJobLastRuns({ now: 0, read: source.read })
    await readPluginJobLastRuns({
      now: PLUGIN_JOB_STATE_MAX_AGE_MS - 1,
      read: source.read,
    })
    expect(source.reads).toBe(1)
    await readPluginJobLastRuns({
      now: PLUGIN_JOB_STATE_MAX_AGE_MS,
      read: source.read,
    })
    expect(source.reads).toBe(2)
  })

  it('never lets a job skipped by a cached mark go unrun', async () => {
    // The cache can only hold marks OLDER than the truth, so `now - last` is
    // only ever over-estimated. A six-hour job is the case that matters: it is
    // the only one whose due-ness the marks actually decide.
    const source = reader({ 'bookings:expire-stale-holds': 0 })
    const marks = await readPluginJobLastRuns({ now: 0, read: source.read })
    const due = (key: string, intervalMinutes: number, now: number) =>
      now - Number(marks[key] ?? 0) >= intervalMinutes * 60_000

    expect(due('bookings:expire-stale-holds', 360, 5 * 60 * MINUTE)).toBe(false)
    expect(due('bookings:expire-stale-holds', 360, 6 * 60 * MINUTE)).toBe(true)
    // And a key the document has never seen is due immediately, exactly as it
    // is on a cold read.
    expect(due('core:apply-publish-schedules', 1, MINUTE)).toBe(true)
  })

  it("folds this instance's own runs in, so it does not re-run them", async () => {
    const source = reader({ 'bookings:expire-stale-holds': 0 })
    await readPluginJobLastRuns({ now: 0, read: source.read })
    const ranAt = 10 * MINUTE
    recordPluginJobRuns(['bookings:expire-stale-holds'], ranAt)

    // Still inside the age bound, so no second read — and the mark this
    // instance wrote is the one the next beat sees.
    const marks = await readPluginJobLastRuns({
      now: ranAt + MINUTE,
      read: source.read,
    })
    expect(source.reads).toBe(1)
    expect(marks['bookings:expire-stale-holds']).toBe(ranAt)
  })

  it('does not extend the age bound when a job runs', async () => {
    // The bound measures distance from the last time another instance's work
    // was visible. Running a job here says nothing about that, so refreshing
    // the clock would let drift grow without limit on a busy platform.
    const source = reader()
    await readPluginJobLastRuns({ now: 0, read: source.read })
    recordPluginJobRuns(['core:apply-publish-schedules'], 20 * MINUTE)
    await readPluginJobLastRuns({
      now: PLUGIN_JOB_STATE_MAX_AGE_MS,
      read: source.read,
    })
    expect(source.reads).toBe(2)
  })

  it('rethrows a failed read rather than reporting no marks', async () => {
    // An empty map would make every registered job due at once.
    const boom = async (): Promise<PluginJobLastRuns> => {
      throw new Error('unavailable')
    }
    await expect(
      readPluginJobLastRuns({ now: 0, read: boom }),
    ).rejects.toThrow('unavailable')

    const source = reader({ 'bookings:expire-stale-holds': 42 })
    await expect(
      readPluginJobLastRuns({ now: MINUTE, read: source.read }),
    ).resolves.toEqual({ 'bookings:expire-stale-holds': 42 })
  })
})
