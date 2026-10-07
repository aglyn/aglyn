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
import { DROP_OFF_SWEEP_BATCH, runDropOffSweep } from './drop-off-sweep'
import { resetFunnelHostStateForTests } from './funnel-host-state'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-06T12:00:00Z')

function site() {
  return new FakeFirestore()
    .seed('hosts/h1', { funnelRecording: true })
    .seed('hosts/h1/funnels/f1', {
      name: 'Quote',
      steps: [
        { type: 'form', key: 'quote', label: 'Quote form' },
        { type: 'booking', key: '', label: 'Booked' },
      ],
      dropOffWatches: [{ step: 1, afterHours: 24 }],
    })
}

function sweep(db: FakeFirestore) {
  const emit = jest.fn(async () => undefined)
  const run = runDropOffSweep({ firestore: db, emit }, { nowMs: NOW, deadlineMs: Number.MAX_SAFE_INTEGER })
  return { emit, run }
}

beforeEach(() => resetFunnelHostStateForTests())

describe('the drop-off sweep', () => {
  it('raises Left a funnel once for a person past the wait, and clears their check', async () => {
    const db = site().seed('hosts/h1/funnelJourneys/v1', {
      personEmail: 'ada@example.com',
      steps: [{ t: 'form', k: 'quote', at: NOW - 25 * HOUR }],
      lastAt: NOW - 25 * HOUR,
      dropOffCheckAt: NOW - 1,
    })
    const { emit, run } = sweep(db)
    expect(await run).toMatchObject({ looked: 1, raised: 1, cleared: 1, failed: 0 })
    expect(emit).toHaveBeenCalledWith('h1', 'funnelLeft', expect.objectContaining({
      funnelId: 'f1',
      step: 1,
      afterHours: 24,
      email: 'ada@example.com',
      stepLabel: 'Quote form',
      nextStepLabel: 'Booked',
    }))
    const held = db.docs.get('hosts/h1/funnelJourneys/v1')
    expect(held?.left).toEqual({ f1_1_24: NOW })
    expect(held).not.toHaveProperty('dropOffCheckAt')

    // Queued again by hand, it does not raise twice.
    db.docs.set('hosts/h1/funnelJourneys/v1', { ...held, dropOffCheckAt: NOW - 1 })
    const again = sweep(db)
    expect(await again.run).toMatchObject({ raised: 0 })
    expect(again.emit).not.toHaveBeenCalled()
  })

  it('judges the person on every visit of theirs: one who booked in another tab did not leave', async () => {
    const db = site()
      .seed('hosts/h1/funnelJourneys/v1', {
        personEmail: 'ada@example.com',
        steps: [{ t: 'form', k: 'quote', at: NOW - 30 * HOUR }],
        lastAt: NOW - 30 * HOUR,
        dropOffCheckAt: NOW - 1,
      })
      .seed('hosts/h1/funnelJourneys/v2', {
        personEmail: 'ada@example.com',
        steps: [{ t: 'booking', k: 'svc', at: NOW - 29 * HOUR }],
        lastAt: NOW - 29 * HOUR,
      })
    const { emit, run } = sweep(db)
    expect(await run).toMatchObject({ raised: 0, cleared: 1 })
    expect(emit).not.toHaveBeenCalled()
  })

  it('reschedules a person whose wait has not passed', async () => {
    const db = site().seed('hosts/h1/funnelJourneys/v1', {
      personEmail: 'ada@example.com',
      steps: [{ t: 'form', k: 'quote', at: NOW - HOUR }],
      lastAt: NOW - HOUR,
      dropOffCheckAt: NOW - 1,
    })
    const { emit, run } = sweep(db)
    expect(await run).toMatchObject({ raised: 0, cleared: 0 })
    expect(emit).not.toHaveBeenCalled()
    expect(db.docs.get('hosts/h1/funnelJourneys/v1')?.dropOffCheckAt).toBe(NOW + 23 * HOUR)
  })

  it('looks only at visits that are due, and clears one on a site that stopped recording', async () => {
    const db = site()
      .seed('hosts/h2', { funnelRecording: false })
      .seed('hosts/h2/funnelJourneys/v9', { personEmail: 'ada@example.com', steps: [], dropOffCheckAt: NOW - 1 })
      .seed('hosts/h1/funnelJourneys/later', { personEmail: 'b@example.com', steps: [], dropOffCheckAt: NOW + HOUR })
    const { emit, run } = sweep(db)
    expect(await run).toMatchObject({ looked: 1, cleared: 1, more: false })
    expect(emit).not.toHaveBeenCalled()
    expect(db.docs.get('hosts/h2/funnelJourneys/v9')).not.toHaveProperty('dropOffCheckAt')
    expect(db.docs.get('hosts/h1/funnelJourneys/later')?.dropOffCheckAt).toBe(NOW + HOUR)
    expect(DROP_OFF_SWEEP_BATCH).toBeGreaterThan(0)
  })

  it('puts a visit it could not judge back an hour, so it cannot hold the queue', async () => {
    const db = site().seed('hosts/h1/funnelJourneys/v1', {
      personEmail: 'ada@example.com',
      steps: [{ t: 'form', k: 'quote', at: NOW - 25 * HOUR }],
      lastAt: NOW - 25 * HOUR,
      dropOffCheckAt: NOW - 1,
    })
    const emit = jest.fn(async () => {
      throw new Error('bus down')
    })
    const report = await runDropOffSweep({ firestore: db, emit }, { nowMs: NOW, deadlineMs: Number.MAX_SAFE_INTEGER })
    expect(report).toMatchObject({ failed: 1 })
    expect(db.docs.get('hosts/h1/funnelJourneys/v1')?.dropOffCheckAt).toBe(NOW + HOUR)
  })
})
