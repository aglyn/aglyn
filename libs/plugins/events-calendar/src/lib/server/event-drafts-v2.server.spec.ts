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
 * The AI event writer's calendar v2 half (AGL-4252): a repeating event and
 * one of the site's categories, kept only where the workspace has v2.
 */

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

import { readEventDraftContent } from '../model/event-draft-content'
import { createEventDraftWriter } from './event-drafts.server'

const NOW = new Date('2026-10-12T15:00:00.000Z')
const store = new Map<string, Record<string, unknown>>()

function snapshotOf(path: string) {
  const data = store.get(path)
  return { id: path.split('/').pop() as string, exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}
function collectionRef(path: string): Record<string, unknown> {
  return {
    path,
    doc: (id: string) => ({ path: `${path}/${id}`, collection: (name: string) => collectionRef(`${path}/${id}/${name}`), get: async () => snapshotOf(`${path}/${id}`) }),
    limit: () => ({
      get: async () => ({
        docs: [...store.keys()].filter((key) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1).map(snapshotOf),
      }),
    }),
  }
}
const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: unknown) => Promise<unknown>) =>
    body({
      get: async (target: { path: string }) => snapshotOf(target.path),
      create: (ref: { path: string }, data: Record<string, unknown>) => store.set(ref.path, data),
    }),
} as unknown as FirebaseFirestore.Firestore

let v2 = true
const writer = createEventDraftWriter({ firestore: () => firestore, stockPhotos: () => null, calendarV2: async () => v2 })

const CONTENT = {
  title: 'Thursday night training',
  startsAt: '2026-11-05T18:00',
  endsAt: '2026-11-05T21:00',
  timezone: 'America/Chicago',
  description: 'Lights on the main track, all levels welcome.',
  repeat: 'weekly',
  repeatDays: 'Thursday',
  repeatUntil: '2027-03-25',
  category: 'mx training',
}

const request = () => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: { plan: 'pro', entitlements: { features: { eventCalendar: true } } },
  now: NOW,
  id: 'job-1-i0',
  name: CONTENT.title,
  content: CONTENT,
})

beforeEach(() => {
  v2 = true
  store.clear()
  store.set('hosts/host-1', { memberRoles: { 'uid-1': 'editor' } })
  store.set('hosts/host-1/eventCategories/mx', { name: 'MX Training', color: '#1E88E5', order: 0 })
})

describe('the event content’s repeat', () => {
  it('reads a weekly repeat in the zone the times are in', () => {
    const read = readEventDraftContent(CONTENT)
    expect(read.ok && read.value).toMatchObject({
      recurrence: { freq: 'weekly', weekdays: [4], untilDayKey: '2027-03-25' },
      timeZone: 'America/Chicago',
    })
    expect(read.ok && read.categoryName).toBe('mx training')
  })

  it('refuses a repeat it cannot keep', () => {
    expect(readEventDraftContent({ ...CONTENT, repeat: 'yearly' })).toEqual({
      ok: false,
      problems: ['The repeat is daily, weekly or monthly'],
    })
    expect(readEventDraftContent({ ...CONTENT, repeatDays: 'Funday' })).toEqual({
      ok: false,
      problems: ['"funday" is not a day of the week'],
    })
  })
})

describe('the writer, calendar v2', () => {
  it('keeps the repeat and finds the category by name where v2 is on', async () => {
    const written = await writer.write(request())
    expect(written.ok).toBe(true)
    expect(store.get('hosts/host-1/events/job-1-i0')).toMatchObject({
      recurrence: { freq: 'weekly', weekdays: [4], untilDayKey: '2027-03-25' },
      timeZone: 'America/Chicago',
      categoryIds: ['mx'],
    })
    expect(store.get('hosts/host-1/events/job-1-i0')?.['seriesEndsAtMs']).toBeGreaterThan(Date.UTC(2027, 2, 25))
  })

  it('writes a one-off where v2 is off', async () => {
    v2 = false
    await writer.write(request())
    const stored = store.get('hosts/host-1/events/job-1-i0') ?? {}
    expect(stored['recurrence']).toBeUndefined()
    expect(stored['categoryIds']).toBeUndefined()
  })
})
