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
  FieldValue: jest.requireActual('../testing/fake-firestore').FAKE_FIELD_VALUE,
}))

import { FakeFirestore } from '../testing/fake-firestore'
import { resetFunnelHostStateForTests } from './funnel-host-state'
import {
  eraseFunnelPerson,
  identifyJourneyFromEvent,
  readPersonJourneys,
  recordEmailEngagementSteps,
} from './journey-people'

const VISIT = 'abcdefghijklmnopqrstuv'
const NOW = Date.parse('2026-10-06T12:00:00Z')
const FUNNEL = {
  name: 'Quote',
  steps: [
    { type: 'form', key: 'quote' },
    { type: 'booking', key: '' },
  ],
}

function store(options: { recording?: boolean; watched?: boolean } = {}) {
  const db = new FakeFirestore()
    .seed('hosts/h1', { funnelRecording: options.recording ?? true, orgId: 'o1' })
    .seed(`hosts/h1/funnelJourneys/${VISIT}`, {
      steps: [{ t: 'page', k: '/', at: NOW - 60_000 }],
      lastAt: NOW - 60_000,
    })
  db.seed('hosts/h1/funnels/f1', {
    ...FUNNEL,
    ...(options.watched ? { dropOffWatches: [{ step: 1, afterHours: 24 }] } : {}),
  })
  return db
}

const submitted = { actor: { email: 'Ada@Example.com' }, journeyId: VISIT }

beforeEach(() => resetFunnelHostStateForTests())

describe('a form submission identifies the visit it ended', () => {
  it('ties the visit to the lowercased address, and queues a drop-off check when a funnel watches', async () => {
    const db = store({ watched: true })
    expect(await identifyJourneyFromEvent(db, 'h1', 'formSubmission', submitted, NOW)).toBe(true)
    expect(db.docs.get(`hosts/h1/funnelJourneys/${VISIT}`)).toMatchObject({
      personEmail: 'ada@example.com',
      identifiedAt: NOW,
      dropOffCheckAt: NOW + 60_000,
    })
  })

  it('queues nothing on a site whose funnels watch no drop-off', async () => {
    const db = store()
    await identifyJourneyFromEvent(db, 'h1', 'formSubmission', submitted, NOW)
    expect(db.docs.get(`hosts/h1/funnelJourneys/${VISIT}`)).not.toHaveProperty('dropOffCheckAt')
  })

  it.each([
    ['an event that is not the person’s own action', 'dealWon', submitted],
    ['no address', 'formSubmission', { journeyId: VISIT }],
    ['a visit id the recorder never mints', 'formSubmission', { ...submitted, journeyId: 'short' }],
    ['a visit the site does not have', 'formSubmission', { ...submitted, journeyId: 'zzzzzzzzzzzzzzzzzzzzzz' }],
  ])('identifies nothing for %s', async (_case, event, context) => {
    const db = store()
    expect(await identifyJourneyFromEvent(db, 'h1', event, context as never, NOW)).toBe(false)
    expect(db.docs.get(`hosts/h1/funnelJourneys/${VISIT}`)).not.toHaveProperty('personEmail')
  })

  it('identifies nothing on a site that records no visits, or a stale visit, or one naming someone else', async () => {
    expect(await identifyJourneyFromEvent(store({ recording: false }), 'h1', 'formSubmission', submitted, NOW)).toBe(false)
    expect(await identifyJourneyFromEvent(store(), 'h1', 'formSubmission', submitted, NOW + 7 * 60 * 60 * 1000)).toBe(false)
    const db = store()
    db.docs.set(`hosts/h1/funnelJourneys/${VISIT}`, { lastAt: NOW, personEmail: 'grace@example.com' })
    expect(await identifyJourneyFromEvent(db, 'h1', 'formSubmission', submitted, NOW)).toBe(false)
  })
})

describe('an email the site sent', () => {
  it('becomes an email step on the person’s latest visit, the first open and click only', async () => {
    const db = store()
      .seed('hosts/h1/funnelJourneys/older', { personEmail: 'ada@example.com', lastAt: NOW - 5_000, steps: [] })
      .seed('hosts/h1/funnelJourneys/newer', { personEmail: 'ada@example.com', lastAt: NOW - 1_000, steps: [] })
    const written = await recordEmailEngagementSteps(
      db,
      'h1',
      [
        { to: 'ada@example.com', type: 'opened', at: NOW - 500, firstOfType: true },
        { to: 'ada@example.com', type: 'opened', at: NOW - 400, firstOfType: false },
        { to: 'ada@example.com', type: 'delivered', at: NOW - 600, firstOfType: true },
        { to: 'nobody@example.com', type: 'clicked', at: NOW - 300, firstOfType: true },
      ],
      NOW,
    )
    expect(written).toBe(1)
    expect(db.docs.get('hosts/h1/funnelJourneys/newer')?.steps).toEqual([{ t: 'email', k: 'opened', at: NOW - 500 }])
    expect(db.docs.get('hosts/h1/funnelJourneys/older')?.steps).toEqual([])
  })

  it('records nothing on a site that records no visits', async () => {
    const db = store({ recording: false }).seed('hosts/h1/funnelJourneys/v', { personEmail: 'ada@example.com', steps: [] })
    expect(
      await recordEmailEngagementSteps(db, 'h1', [{ to: 'ada@example.com', type: 'clicked', at: NOW, firstOfType: true }], NOW),
    ).toBe(0)
  })
})

describe('a person’s visits', () => {
  it('are read together, oldest first, with the marks they carry', async () => {
    const db = store()
      .seed('hosts/h1/funnelJourneys/b', { personEmail: 'ada@example.com', lastAt: 2, steps: [], left: { f1_1_24: 1 } })
      .seed('hosts/h1/funnelJourneys/a', { personEmail: 'ada@example.com', lastAt: 1, steps: [] })
    const read = await readPersonJourneys(db, 'h1', 'ada@example.com')
    expect(read.map((one) => one.id)).toEqual(['a', 'b'])
    expect(read[1].fired).toEqual(['f1_1_24'])
  })

  it('are erased with the person on every site of the workspace; a dry run counts', async () => {
    const db = store()
      .seed('hosts/h2', { orgId: 'o1' })
      .seed('hosts/h3', { orgId: 'other' })
      .seed('hosts/h1/funnelJourneys/a', { personEmail: 'ada@example.com' })
      .seed('hosts/h2/funnelJourneys/b', { personEmail: 'ada@example.com' })
      .seed('hosts/h3/funnelJourneys/c', { personEmail: 'ada@example.com' })
    expect(await eraseFunnelPerson(db, { orgId: 'o1', email: 'ADA@example.com', dryRun: true })).toEqual({ journeys: 2 })
    expect(db.docs.has('hosts/h1/funnelJourneys/a')).toBe(true)
    expect(await eraseFunnelPerson(db, { orgId: 'o1', email: 'ada@example.com', dryRun: false })).toEqual({ journeys: 2 })
    expect(db.docs.has('hosts/h1/funnelJourneys/a')).toBe(false)
    expect(db.docs.has('hosts/h2/funnelJourneys/b')).toBe(false)
    expect(db.docs.has('hosts/h3/funnelJourneys/c')).toBe(true)
    expect(db.docs.has(`hosts/h1/funnelJourneys/${VISIT}`)).toBe(true)
  })
})
