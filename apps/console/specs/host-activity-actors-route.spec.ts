/**
 * @jest-environment node
 *
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
 * `/api/hosts/activity-actors` (AGL-3369): the site feeds' uid → address
 * lookup, gated as the log is and bounded to the uids the log names.
 */

const mockVerifyIdToken = jest.fn()
const mockGetUsers = jest.fn()
let mockHost: { exists: boolean; memberRoles?: Record<string, string> } = {
  exists: true,
}
/** The uids that appear as `actorId` in this site's activity log. */
let mockLoggedActors = new Set<string>()
const mockActivityAsked: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        getUsers: (...args: unknown[]) => mockGetUsers(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockHost.exists,
              get: (field: string) =>
                field === 'memberRoles' ? mockHost.memberRoles : undefined,
            }),
            collection: () => ({
              where: (_field: string, _op: string, uid: string) => ({
                select: () => ({
                  limit: () => ({
                    get: async () => {
                      mockActivityAsked.push(uid)
                      return { empty: !mockLoggedActors.has(uid) }
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))

import { GET } from '../app/api/hosts/activity-actors/route'

const get = (params: Record<string, string>, token = 'token') => {
  const url = new URL('https://console.test/api/hosts/activity-actors')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return GET(
    new Request(url.toString(), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockActivityAsked.length = 0
  mockHost = { exists: true, memberRoles: { viewer: 'viewer' } }
  mockLoggedActors = new Set(['uid-7'])
  mockVerifyIdToken.mockResolvedValue({ uid: 'viewer', email_verified: true })
  mockGetUsers.mockImplementation(async (ids: Array<{ uid: string }>) => ({
    users: ids.map(({ uid }) => ({ uid, email: `${uid}@example.test` })),
    notFound: [],
  }))
})

describe('the site feed resolves who acted (AGL-3369)', () => {
  it('answers a member of the site with the address each logged uid holds now', async () => {
    const response = await get({ hostId: 'host-1', uids: 'uid-7' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      actors: { 'uid-7': 'uid-7@example.test' },
    })
  })

  it('resolves ONLY uids this site’s log names — not a directory', async () => {
    // `uid-9` never acted on this site: a member must not be able to turn
    // an arbitrary uid into an address.
    const response = await get({ hostId: 'host-1', uids: 'uid-7,uid-9' })
    expect(mockActivityAsked.sort()).toEqual(['uid-7', 'uid-9'])
    expect(mockGetUsers).toHaveBeenCalledWith([{ uid: 'uid-7' }])
    expect((await response.json()).actors).toEqual({ 'uid-7': 'uid-7@example.test' })
  })

  it('refuses someone who is not a member of the site', async () => {
    mockHost = { exists: true, memberRoles: { someoneElse: 'admin' } }
    const response = await get({ hostId: 'host-1', uids: 'uid-7' })
    expect(response.status).toBe(403)
    expect(mockGetUsers).not.toHaveBeenCalled()
  })

  it('lets staff through without a membership', async () => {
    mockHost = { exists: true, memberRoles: {} }
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    expect((await get({ hostId: 'host-1', uids: 'uid-7' })).status).toBe(200)
  })

  it('refuses an absent token, a missing site and an oversized ask', async () => {
    expect((await get({ hostId: 'host-1', uids: 'uid-7' }, '')).status).toBe(401)
    expect((await get({ uids: 'uid-7' })).status).toBe(400)
    const many = Array.from({ length: 51 }, (_, i) => `uid-${i}`).join(',')
    expect((await get({ hostId: 'host-1', uids: many })).status).toBe(400)
    mockHost = { exists: false }
    expect((await get({ hostId: 'gone', uids: 'uid-7' })).status).toBe(404)
  })

  it('never looks up the key or platform ids', async () => {
    await get({ hostId: 'host-1', uids: 'api,system:stripe-webhook' })
    expect(mockActivityAsked).toEqual([])
    expect(mockGetUsers).not.toHaveBeenCalled()
  })
})
