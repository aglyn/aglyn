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
 * AGL-118 — every activity entry carries `createdAt`, or it is invisible to
 * the feed it was written for.
 *
 * Both readers order by `createdAt`, and a Firestore `orderBy` DROPS documents
 * that lack the field — silently, with no error at either end. So a writer
 * that forgets it does not produce a badly-sorted row; it produces a row
 * nobody will ever see, in a collection whose entire purpose is being read
 * later. That is the same failure class as the bug this issue opened on: an
 * act that happened, recorded nowhere a reader looks.
 *
 * Every entry in the collection carried the field when this was written, so
 * the property held by luck. These writers are new, and this is what keeps it
 * from being luck.
 */

interface Doc {
  [key: string]: unknown
}

const store = new Map<string, Doc>()
let mockAutoId = 0

const mockMakeDoc = (path: string): any => ({
  path,
  id: path.split('/').pop(),
  collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  get: async () => ({
    exists: store.has(path),
    data: () => store.get(path),
    get: (field: string) => store.get(path)?.[field],
  }),
})

const mockMakeCollection = (prefix: string): any => ({
  doc: (id: string) => mockMakeDoc(`${prefix}/${id}`),
  add: async (data: Doc) => {
    const path = `${prefix}/auto-${(mockAutoId += 1)}`
    store.set(path, data)
    return mockMakeDoc(path)
  },
})

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockMakeCollection(name),
      }),
    }),
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    // A SENTINEL, not a Date. Asserting on it is what distinguishes "the
    // server stamped this" from "a caller's clock did", which matters on a
    // log whose ordering is the only thing making it readable.
    serverTimestamp: () => '__server_timestamp__',
    delete: () => '__delete__',
  },
}))
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteMemberHostProjections: async () => undefined,
  syncHostProjectionForMembers: async () => undefined,
  syncMemberHostProjections: async () => undefined,
}))
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async () => null,
}))
jest.mock('./update-existing', () => ({
  __esModule: true,
  updateExisting: async () => undefined,
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: async () => undefined,
}))

const { logHostActivity, logOrgActivity } =
  require('./organizations') as typeof import('./organizations')

const rows = () => [...store.values()]

beforeEach(() => {
  store.clear()
  mockAutoId = 0
})

describe('an activity entry is orderable, or it does not exist (AGL-118)', () => {
  it('THE CONTROL — a host entry lands with the fields a reader needs', async () => {
    // First: every assertion below would also pass against a writer that
    // wrote nothing at all.
    await logHostActivity(
      'host-1',
      { uid: 'uid-1', email: 'person@example.test' },
      'Created screen',
      { type: 'screen', id: 'screen-1', name: 'Home' },
    )
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({
      actorId: 'uid-1',
      actorEmail: 'person@example.test',
      action: 'Created screen',
      target: { type: 'screen', id: 'screen-1', name: 'Home' },
    })
  })

  it('a key’s entry carries the key’s name, and a person’s carries none (AGL-2632)', async () => {
    // A key has no address, and an entry with no address and no name reads
    // as "Someone" in every feed — an audit trail with a hole in it.
    await logHostActivity(
      'host-1',
      { uid: 'api', email: null, apiKeyName: 'Zapier' },
      'Converted lead',
      { type: 'lead', id: 'lead-1', name: 'Ann Lee' },
    )
    await logHostActivity(
      'host-1',
      { uid: 'uid-1', email: 'person@example.test' },
      'Converted lead',
      { type: 'lead', id: 'lead-2' },
    )
    const [byKey, byPerson] = rows()
    expect(byKey).toMatchObject({ actorId: 'api', actorEmail: null, apiKeyName: 'Zapier' })
    expect(byPerson).not.toHaveProperty('apiKeyName')
  })

  it('a host entry carries createdAt, server-stamped', async () => {
    await logHostActivity('host-1', { uid: 'uid-1' }, 'Created the site', {
      type: 'host',
      id: 'host-1',
    })
    const row = rows()[0]
    // Present at all — the `orderBy` hazard.
    expect(Object.keys(row)).toContain('createdAt')
    expect(row['createdAt']).toBeDefined()
    // And from the server. A client Timestamp does not survive the JSON hop
    // into a route, and a server whose own clock writes the field cannot be
    // reordered by a caller.
    expect(row['createdAt']).toBe('__server_timestamp__')
  })

  it('an org entry carries createdAt, server-stamped', async () => {
    // The org log is the same collection name under a different parent and is
    // read by the same collection-group query, so it has the same hazard.
    await logOrgActivity(
      'org-1',
      { uid: 'uid-1', email: 'person@example.test' },
      'Created the workspace',
      { type: 'org', id: 'org-1', name: 'Acme' },
    )
    const row = rows()[0]
    expect(Object.keys(row)).toContain('createdAt')
    expect(row['createdAt']).toBe('__server_timestamp__')
  })

  it('an entry with no email still carries createdAt', async () => {
    // The optional fields are the ones a writer trims; `createdAt` must not
    // be trimmed with them. `actorEmail` going null is correct and expected —
    // a Stripe-initiated event has no person — and it must not take the
    // ordering key with it.
    await logHostActivity('host-1', { uid: 'uid-1' }, 'Attached a custom domain', {
      type: 'host',
      id: 'host-1',
    })
    expect(rows()[0]).toMatchObject({
      actorEmail: null,
      createdAt: '__server_timestamp__',
    })
  })

  it('a target keeps only the keys it was given, and never loses createdAt', async () => {
    // `target` is built by spreading optional keys, which is the shape most
    // likely to acquire a bug that eats a sibling field.
    await logHostActivity('host-1', { uid: 'uid-1' }, 'Created shared layout', {
      type: 'layout',
    })
    const row = rows()[0]
    expect(row['target']).toEqual({ type: 'layout' })
    expect(row['createdAt']).toBe('__server_timestamp__')
  })
})
