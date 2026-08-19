/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor and every case fails for the wrong reason.
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
 * A site collaborator cannot list the workspace's API keys (AGL-2350).
 *
 * `GET /api/orgs/api-keys` returned the key list from ABOVE the manager check,
 * on a comment that read *"any member may view the (metadata) list"*. That was
 * written before AGL-1026 established what a site collaborator is: a real
 * `orgs/{orgId}/members/{uid}` document — that is what lets them into the
 * console at all — whose reach is a named list of sites rather than the
 * workspace.
 *
 * So a contractor invited to one microsite could enumerate every API key the
 * org holds: names, prefixes, scopes, created and last-used timestamps. No
 * secret is exposed — `toPublicApiKey` never returns one — but that list is a
 * map of the workspace's integrations, and `teams-and-roles/overview.md` tells
 * that person the organization pages "aren't part of their console at all".
 *
 * ## Org-wide, not manager
 *
 * Listing is not managing. An ordinary editor or viewer with `allHosts` keeps
 * the access they had; only the scoped population loses it. Choosing the
 * manager role here would have been a bigger change than the defect.
 */

import { isOrgWideMember } from '@aglyn/aglyn'

const mockVerifyIdToken = jest.fn()
const mockListApiKeys = jest.fn(async () => [
  { id: 'key-1', name: 'Zapier', prefix: 'aglyn_sk_live_abc' },
])
const mockMembers = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: () => true,
  // The REAL predicate: this is the whole subject of the test, and a
  // hand-written stand-in would be testing the stand-in.
  isOrgWideMember: (member: unknown) => mockIsOrgWideMember(member as never),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => ({ data: () => ({ plan: 'business' }) }) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  listApiKeys: (...a: unknown[]) => mockListApiKeys(...(a as [])),
  lockdownRefusal: async () => null,
  logOrgActivity: async () => undefined,
  mintApiKey: async () => ({}),
  normalizeScopes: (s: unknown) => s,
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const member = mockMembers.get(`${orgId}:${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  },
  revokeApiKey: async () => undefined,
}))

import { isOrgWideMember as mockIsOrgWideMember } from '@aglyn/aglyn'

import { GET } from '../app/api/orgs/api-keys/route'

const ORG = 'org-1'

function get(uid: string) {
  mockVerifyIdToken.mockResolvedValue({ uid, email_verified: true })
  return new Request(`https://console.test/api/orgs/api-keys?orgId=${ORG}`, {
    method: 'GET',
    headers: { authorization: 'Bearer token' },
  })
}

beforeEach(() => {
  mockMembers.clear()
  mockListApiKeys.mockClear()
})

describe('GET /api/orgs/api-keys is org-wide only', () => {
  it('PREMISE: the two members really do differ on org-wide reach', () => {
    // Without this the test below could pass because `isOrgWideMember` says
    // no to everyone, which would also break the org-wide case silently.
    expect(isOrgWideMember({ role: 'editor', allHosts: true } as never)).toBe(true)
    expect(
      isOrgWideMember({
        role: 'editor',
        allHosts: false,
        hostAccess: { 'host-9': 'editor' },
      } as never),
    ).toBe(false)
  })

  it('REGRESSION — a site collaborator is refused, and reads nothing', async () => {
    mockMembers.set(`${ORG}:contractor`, {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-9': 'editor' },
    })

    const response = await GET(get('contractor'))

    expect(response.status).toBe(403)
    // The refusal must happen BEFORE the read, or the list still leaves the
    // database on its way to being discarded.
    expect(mockListApiKeys).not.toHaveBeenCalled()
  })

  it('an org-wide editor still lists them — listing is not managing', async () => {
    mockMembers.set(`${ORG}:staffer`, { role: 'editor', allHosts: true })

    const response = await GET(get('staffer'))

    expect(response.status).toBe(200)
    expect((await response.json()).keys).toHaveLength(1)
  })

  it('a non-member is refused before any of this', async () => {
    const response = await GET(get('stranger'))
    expect(response.status).toBe(403)
    expect(mockListApiKeys).not.toHaveBeenCalled()
  })
})
