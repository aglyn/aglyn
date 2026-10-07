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
  FieldValue: {
    arrayUnion: (...elements: unknown[]) => ({ arrayUnion: elements }),
    serverTimestamp: () => 'SERVER_TIME',
  },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => null }) },
}))

import { pluginSiteBeaconFor } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import { registerFunnelsServerDeclarations } from '../declarations.server'
import { FakeFirestore } from '../testing/fake-firestore'
import { countJourneyBeacon, journeyExpiresAt, resetJourneyRecordingCache } from './journey-beacon'

const VISIT = 'abcdefghijklmnopqrstuv'
const NOW = Date.parse('2026-10-06T12:00:00Z')

function store(recording = true) {
  return new FakeFirestore().seed('hosts/h1', { funnelRecording: recording })
}

beforeEach(() => resetJourneyRecordingCache())

describe('the journey beacon (AGL-3605)', () => {
  it('is the funnels plugin’s, by the journey field', () => {
    registerFunnelsServerDeclarations()
    expect(pluginSiteBeaconFor({ journey: VISIT })?.pluginId).toBe('funnels')
    expect(pluginSiteBeaconFor({ path: '/' })).toBeNull()
  })

  it('writes the first step with where the visit came from, the server time and the expiry', async () => {
    const db = store()
    const counted = await countJourneyBeacon(
      {
        hostId: 'h1',
        body: {
          journey: VISIT,
          stepType: 'page',
          stepKey: '/pricing',
          journeyStart: true,
          utmSource: 'news',
          referrerHost: 'x'.repeat(300),
          utmMedium: 42,
          at: 1,
        },
      },
      db,
      NOW,
    )
    expect(counted).toBe(true)
    const write = db.writes.find((one) => one.path === `hosts/h1/funnelJourneys/${VISIT}`)
    expect(write?.options).toEqual({ merge: true })
    expect(write?.data).toMatchObject({
      steps: { arrayUnion: [{ t: 'page', k: '/pricing', at: NOW }] },
      lastAt: NOW,
      expiresAt: journeyExpiresAt(NOW),
      source: { utmSource: 'news', referrerHost: 'x'.repeat(100) },
    })
    expect(write?.data?.['startedAt'].toMillis()).toBe(NOW)
    expect(write?.data?.['source']).not.toHaveProperty('utmMedium')
  })

  it('never overwrites the start or source on a later step, and still stamps the expiry', async () => {
    const db = store()
    await countJourneyBeacon({ hostId: 'h1', body: { journey: VISIT, stepType: 'form', stepKey: 'f1', utmSource: 'late' } }, db, NOW)
    const data = db.writes[0].data as Record<string, unknown>
    expect(data).not.toHaveProperty('startedAt')
    expect(data).not.toHaveProperty('source')
    expect(data['expiresAt']).toEqual(journeyExpiresAt(NOW))
  })

  it.each([
    ['a malformed visit id', { journey: 'short', stepType: 'page', stepKey: '/' }],
    ['an unknown step type', { journey: VISIT, stepType: 'hover', stepKey: '/' }],
    ['a page step with no path', { journey: VISIT, stepType: 'page', stepKey: 'pricing' }],
    ['an event step with no name', { journey: VISIT, stepType: 'event' }],
  ])('refuses %s without writing', async (_name, body) => {
    const db = store()
    expect(await countJourneyBeacon({ hostId: 'h1', body }, db, NOW)).toBe(false)
    expect(db.writes).toEqual([])
  })

  it('refuses a site that records no journeys, and reads that answer once per window', async () => {
    const db = store(false)
    const get = jest.spyOn(db, 'collection')
    const body = { journey: VISIT, stepType: 'page', stepKey: '/' }
    expect(await countJourneyBeacon({ hostId: 'h1', body }, db, NOW)).toBe(false)
    expect(await countJourneyBeacon({ hostId: 'h1', body }, db, NOW + 1000)).toBe(false)
    expect(get).toHaveBeenCalledTimes(1)
    expect(db.writes).toEqual([])
  })

  it('cuts a long key', async () => {
    const db = store()
    await countJourneyBeacon({ hostId: 'h1', body: { journey: VISIT, stepType: 'event', stepKey: 'e'.repeat(500) } }, db, NOW)
    const element = (db.writes[0].data?.['steps'] as { arrayUnion: Array<{ k: string }> }).arrayUnion[0]
    expect(element.k).toHaveLength(200)
  })
})
