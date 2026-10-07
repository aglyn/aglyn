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
  createCrmPersonRecords,
  decodeContactChangesCursor,
  encodeContactChangesCursor,
  type CrmPersonRecordsDeps,
} from './person-records'

/**
 * The CRM's walk of a site's contacts by change (AGL-3639): the query it
 * asks, the cursor it hands out, and who it leaves out.
 */

jest.mock('firebase-admin/firestore', () => {
  class Timestamp {
    constructor(
      public seconds: number,
      public nanoseconds: number,
    ) {}
    toMillis() {
      return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6)
    }
  }
  return {
    FieldPath: { documentId: () => '__name__' },
    FieldValue: { serverTimestamp: () => '<server-timestamp>' },
    Timestamp,
  }
})
jest.mock('@aglyn/tenant-data-admin', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/crm-records', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/contact-email-index', () => ({}))
jest.mock('@aglyn/tenant-data-admin/server/dynamic-list-materialize', () => ({}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Timestamp } = require('firebase-admin/firestore')

const stamp = (seconds: number, nanoseconds = 0) => new Timestamp(seconds, nanoseconds)

interface Recorded {
  path: string
  where: unknown[][]
  orderBy: unknown[][]
  startAfter: unknown[] | null
  limit: number | null
}

let recorded: Recorded[] = []
let answer: Array<{ id: string; data: Record<string, unknown> }> = []

function contactsQuery(path: string) {
  const state: Recorded = { path, where: [], orderBy: [], startAfter: null, limit: null }
  recorded.push(state)
  const query: any = {
    where: (...args: unknown[]) => (state.where.push(args), query),
    orderBy: (...args: unknown[]) => (state.orderBy.push(args), query),
    startAfter: (...args: unknown[]) => ((state.startAfter = args), query),
    limit: (count: number) => ((state.limit = count), query),
    get: async () => ({ docs: answer.map((row) => ({ id: row.id, data: () => row.data })) }),
  }
  return query
}

const firestore: any = {
  collection: (name: string) => ({
    doc: (orgId: string) => ({
      collection: (child: string) => contactsQuery(`${name}/${orgId}/${child}`),
    }),
  }),
}

const deps: CrmPersonRecordsDeps = {
  firestore: () => firestore,
  orgIdForHost: async () => 'org-1',
  groupIdForHost: async () => 'group-a',
  contactViewEmails: async () => ({ emails: [], complete: true }),
}
const records = createCrmPersonRecords(deps)

beforeEach(() => {
  recorded = []
  answer = []
})

describe('the CRM walks a site’s contacts by change (AGL-3639)', () => {
  it('asks the Contacts list’s own index, oldest change first, the id breaking ties', async () => {
    await records.changedSince!({ hostId: 'host-1', after: null, limit: 50 })
    expect(recorded).toHaveLength(1)
    const [query] = recorded
    expect(query.path).toBe('orgs/org-1/contacts')
    expect(query.where).toEqual([['visibleTo', 'array-contains-any', ['org', 'host:host-1']]])
    expect(query.orderBy).toEqual([
      ['updatedAt', 'asc'],
      ['__name__', 'asc'],
    ])
    expect(query.startAfter).toBeNull()
    expect(query.limit).toBe(50)
  })

  it('answers the site’s facet as the profile, and a cursor past the last contact read', async () => {
    answer = [
      {
        id: 'c-1',
        data: {
          email: 'Pat@Example.com',
          visibleTo: ['host:host-1'],
          updatedAt: stamp(1_700_000_000, 123_456_789),
          marketingConsentByHost: { 'host-1': true },
          facets: {
            'group-a': { name: 'Pat Lee', phone: '+15555550100', tags: ['vip', 7], ltvCents: 12_345.4, ordersCount: 3 },
            'group-b': { name: 'Someone else’s note' },
          },
        },
      },
    ]
    const page = await records.changedSince!({ hostId: 'host-1', after: null, limit: 50 })
    expect(page.people).toEqual([
      expect.objectContaining({
        kind: 'contact',
        id: 'c-1',
        email: 'pat@example.com',
        changedAtMs: 1_700_000_000_123,
        profile: { name: 'Pat Lee', phone: '+15555550100', tags: ['vip'], lifetimeValueCents: 12_345, ordersCount: 3 },
      }),
    ])
    expect(page.people[0].data['marketingConsentByHost']).toEqual({ 'host-1': true })
    expect(page.next).toBe('1700000000.123456789.c-1')
  })

  it('starts after the cursor to the nanosecond, so a contact is never answered twice', async () => {
    await records.changedSince!({ hostId: 'host-1', after: '1700000000.123456789.c-1', limit: 10 })
    const [after, id] = recorded[0].startAfter as [any, string]
    expect([after.seconds, after.nanoseconds, id]).toEqual([1_700_000_000, 123_456_789, 'c-1'])
  })

  it('steps over a contact seen only through a sharing grant, and still moves the cursor past it', async () => {
    answer = [
      {
        id: 'shared',
        data: {
          email: 'other@example.com',
          hostId: 'host-2',
          visibleTo: ['host:host-2', 'host:host-1'],
          sharing: { added: ['host:host-1'] },
          updatedAt: stamp(1_700_000_100),
        },
      },
      { id: 'no-email', data: { visibleTo: ['org'], updatedAt: stamp(1_700_000_200) } },
    ]
    const page = await records.changedSince!({ hostId: 'host-1', after: null, limit: 10 })
    expect(page.people).toEqual([])
    expect(page.next).toBe('1700000200.0.no-email')
  })

  it('answers next: null when nothing changed after the cursor', async () => {
    expect(await records.changedSince!({ hostId: 'host-1', after: '1.0.c', limit: 10 })).toEqual({ people: [], next: null })
  })

  it('reads only cursors it handed out', () => {
    expect(encodeContactChangesCursor(stamp(5, 6), 'c-1')).toBe('5.6.c-1')
    expect(encodeContactChangesCursor(null, 'c-1')).toBeNull()
    expect(decodeContactChangesCursor('5.6.c-1')).toEqual({ seconds: 5, nanoseconds: 6, id: 'c-1' })
    for (const bad of ['', 'x', '5.6.', '5.6.a/b', null]) {
      expect(decodeContactChangesCursor(bad)).toBeNull()
    }
  })
})
