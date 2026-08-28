/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 */
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
 * AGL-118 — a resource records WHO made it, and the route records THAT it was
 * made.
 *
 * Two defects with one shape. No artifact under a host carried an author field
 * of any kind, so nothing in the stored data could say who built a site; and
 * the activity log was appended only by the browser, so three template
 * surfaces created screens, layouts and components while calling no logger at
 * all and the log reported sites nobody had touched. Neither is recoverable
 * afterwards — an artifact that never recorded its creator can only be
 * attributed by guessing, which is a name written into an audit record on the
 * strength of nothing.
 *
 * The route is where both are fixed because it is the only participant that
 * has a VERIFIED uid and knows the write actually happened.
 */

const mockVerifyIdToken = jest.fn()
const mockWrite = jest.fn()
const mockLogHostActivity = jest.fn()

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
} = { memberRoles: {}, org: {} }

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

function fakeSubcollection(): any {
  const api: any = {
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    select: () => api,
    where: () => api,
    limit: () => api,
    get: async () => ({ docs: [], empty: true }),
    doc: () => ({
      create: (payload: unknown) => mockWrite(payload),
      get: async () => snapshotOf({}),
      collection: () => fakeSubcollection(),
    }),
  }
  return api
}

const fakeHostRef = {
  get: async () =>
    snapshotOf({ memberRoles: state.memberRoles, orgId: 'org-1' }),
  collection: () => fakeSubcollection(),
}

const fakeFirestore = {
  collection: (name: string) => ({
    doc: () =>
      name === 'orgs'
        ? { get: async () => snapshotOf(state.org) }
        : fakeHostRef,
  }),
  runTransaction: async (body: (transaction: any) => Promise<unknown>) =>
    body({
      get: async (ref: any) =>
        typeof ref?.get === 'function' ? ref.get() : { docs: [], empty: true },
      create: (_ref: unknown, payload: unknown) => mockWrite(payload),
      set: (_ref: unknown, payload: unknown) => mockWrite(payload),
    }),
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 0 }) },
  FieldValue: { delete: () => '__field_deleted__' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: state.org }),
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...args),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: async (options: Record<string, any>) =>
    options?.staff === true
      ? null
      : options?.org?.suspendedAt != null
        ? { scope: 'org', reason: 'manual' }
        : null,
  lockdownJsonResponse: (verdict: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table, screen kinds and host-role gate. This factory is a
  // CLOSED WORLD: a stub here would let the suite pass against a route
  // enforcing nothing, which is the failure mode the assertions exist to
  // catch.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  createResourceUid: () => 'generated-id',
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST as RESOURCES_POST } from '../app/api/hosts/resources/route'
import { POST as VERSIONS_POST } from '../app/api/hosts/versions/route'

const CALLER = 'uid-the-person-who-clicked'

const postResource = (resource: string, data: Record<string, unknown>) =>
  RESOURCES_POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', resource, data }),
    }),
  )

beforeEach(() => {
  mockWrite.mockClear()
  mockLogHostActivity.mockClear()
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: CALLER,
    email: 'person@example.test',
    email_verified: true,
  })
  state.memberRoles = { [CALLER]: 'admin' }
  state.org = { plan: 'pro' }
})

describe('a resource created through the route records its creator (AGL-118)', () => {
  it('THE CONTROL — the create succeeds and stores the verified uid', async () => {
    // Asserted first: every refusal below would also pass against a route that
    // rejected the create outright, and a resource nobody can make is not a
    // fix for a resource nobody can attribute.
    const response = await postResource('screen', { displayName: 'Home' })
    expect(response.status).toBe(200)
    expect(mockWrite).toHaveBeenCalled()
    expect(mockWrite.mock.calls[0][0]).toMatchObject({
      displayName: 'Home',
      createdBy: CALLER,
    })
  })

  it('a version records its creator too', async () => {
    const response = await VERSIONS_POST(
      new Request('https://app.aglyn.com/api/hosts/versions', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({
          hostId: 'host-1',
          kind: 'screen',
          parentId: 'generated-id',
          data: { nodes: {} },
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mockWrite.mock.calls.at(-1)?.[0]).toMatchObject({ createdBy: CALLER })
  })

  it('the caller cannot supply its own provenance', async () => {
    // `createdBy` is off the allow-list, so a client naming somebody else is
    // dropped rather than stored. Provenance the caller chooses is not
    // provenance.
    await postResource('screen', {
      displayName: 'Home',
      createdBy: 'uid-somebody-else',
    })
    expect(mockWrite.mock.calls[0][0]).toMatchObject({ createdBy: CALLER })
  })
})

describe('the route writes the audit entry itself (AGL-118)', () => {
  it('a caller that never touches a logger still produces an entry', async () => {
    // The defect, stated as a test. The three template surfaces called no
    // logger; nothing in this request does either. The entry must exist
    // anyway, or the log stays a record of who remembered to write to it.
    const response = await postResource('screen', { displayName: 'About us' })
    expect(response.status).toBe(200)
    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    const [hostId, actor, action, target] = mockLogHostActivity.mock.calls[0]
    expect(hostId).toBe('host-1')
    expect(actor).toMatchObject({ uid: CALLER })
    expect(action).toBe('Created screen')
    expect(target).toMatchObject({
      type: 'screen',
      id: 'generated-id',
      name: 'About us',
    })
  })

  it('names the resource, not the plural label the quota copy uses', async () => {
    await postResource('reusableComponent', { displayName: 'Card' })
    expect(mockLogHostActivity.mock.calls[0][2]).toBe(
      'Created reusable component',
    )
    expect(mockLogHostActivity.mock.calls[0][3]).toMatchObject({
      type: 'component',
    })
  })

  it('a REFUSED create writes no entry', async () => {
    // An audit row that outlives the write it describes is worse than a
    // missing one: it is a false record of something that never happened.
    state.org = { plan: 'pro', suspendedAt: { seconds: 1 } }
    const response = await postResource('screen', { displayName: 'Home' })
    expect(response.status).toBe(423)
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })

  it('a version create adds no second entry for the same act', async () => {
    // A template-built page writes screen, first version and route as ONE
    // act. A row here would be an invented event making the timeline look
    // busier than the work was.
    await VERSIONS_POST(
      new Request('https://app.aglyn.com/api/hosts/versions', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({
          hostId: 'host-1',
          kind: 'screen',
          parentId: 'generated-id',
          data: { nodes: {} },
        }),
      }),
    )
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })
})
