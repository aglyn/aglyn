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

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

import { FakeFirestore } from '../testing/fake-firestore'
import type { FunnelStep } from '../model/funnels.types'
import { CLOSED_RESULT_TTL_MS, funnelResult, funnelResultKey, LIVE_RESULT_TTL_MS, readJourneys } from './funnel-results.server'

const DAY = 86_400_000
const START = Date.parse('2026-10-01T00:00:00Z')
const STEPS: FunnelStep[] = [
  { type: 'page', key: '/a', match: 'exact' },
  { type: 'page', key: '/b', match: 'exact' },
]

function seedVisits(db: FakeFirestore, count: number, offsetMs = 0) {
  for (let index = 0; index < count; index += 1) {
    const at = START + offsetMs + index * 1000
    db.seed(`hosts/h1/funnelJourneys/v${index}`, {
      startedAt: { toMillis: () => at },
      steps: [{ t: 'page', k: '/a', at }, ...(index % 2 ? [{ t: 'page', k: '/b', at: at + 500 }] : [])],
      source: null,
    })
  }
}

describe('funnel results (AGL-3605)', () => {
  it('reads only visits that started in the range', async () => {
    const db = new FakeFirestore()
    seedVisits(db, 3)
    db.seed('hosts/h1/funnelJourneys/old', { startedAt: { toMillis: () => START - DAY }, steps: [] })
    db.seed('hosts/h1/funnelJourneys/nostart', { steps: [{ t: 'page', k: '/a', at: START }] })
    const { journeys, capped } = await readJourneys(db, 'h1', START, START + DAY)
    expect(journeys).toHaveLength(3)
    expect(capped).toBe(false)
  })

  it('stops at the cap, newest first, across pages, and says so', async () => {
    const db = new FakeFirestore()
    seedVisits(db, 25)
    const { journeys, capped } = await readJourneys(db, 'h1', START, START + DAY, 10)
    expect(journeys).toHaveLength(10)
    expect(capped).toBe(true)
  })

  it('computes, caches per funnel version and range, and serves the cache inside its window', async () => {
    const db = new FakeFirestore()
    seedVisits(db, 4)
    const base = { firestore: db, hostId: 'h1', funnelId: 'f1', steps: STEPS, version: 7, from: '2026-10-01', to: '2026-10-01', startMs: START, endMs: START + DAY }
    const now = START + 2 * DAY
    const first = await funnelResult({ ...base, now })
    expect(first).toMatchObject({ entered: 4, completed: 2, overall: 0.5, journeysRead: 4, capped: false })
    const key = funnelResultKey('f1', 7, '2026-10-01', '2026-10-01')
    expect(db.docs.get(`hosts/h1/funnelResults/${key}`)).toBeDefined()

    seedVisits(db, 8)
    const cached = await funnelResult({ ...base, now: now + CLOSED_RESULT_TTL_MS - 1 })
    expect(cached.entered).toBe(4)
    const fresh = await funnelResult({ ...base, now: now + 1, fresh: true })
    expect(fresh.entered).toBe(8)
    const edited = await funnelResult({ ...base, version: 8, now: now + 2 })
    expect(edited.entered).toBe(8)
  })

  it('keeps a range that includes today for minutes, not a day', async () => {
    const db = new FakeFirestore()
    seedVisits(db, 2)
    const now = START + 1000
    const base = { firestore: db, hostId: 'h1', funnelId: 'f1', steps: STEPS, version: 1, from: '2026-10-01', to: '2026-10-01', startMs: START, endMs: START + DAY }
    await funnelResult({ ...base, now })
    seedVisits(db, 6)
    expect((await funnelResult({ ...base, now: now + LIVE_RESULT_TTL_MS + 1 })).entered).toBe(6)
  })
})
