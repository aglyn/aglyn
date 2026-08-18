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
 * The staff self-check must diagnose the caller WITHOUT becoming an
 * enumeration surface (AGL-1993). Two properties, both tested:
 *
 *  - it answers only about the caller's own verified address;
 *  - it never tells a stranger anything about anyone else's staff grant.
 */

const mockTokens = new Map<string, any>()
const mockProjectUsers = new Map<string, any>()
const mockTenantUsers = new Map<string, Map<string, any>>()

const mockUserRecord = (uid: string, email: string, claims?: any) => ({
  uid,
  email,
  customClaims: claims,
})

const mockPoolApi = (users: Map<string, any>) => ({
  getUserByEmail: jest.fn(async (email: string) => {
    const found = [...users.values()].find((u) => u.email === email)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    return found
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: jest.fn(async (token: string) => {
          const decoded = mockTokens.get(token)
          if (!decoded) throw new Error('invalid token')
          return decoded
        }),
      }),
    }),
  },
  listAuthTenantIds: jest.fn(async () => [...mockTenantUsers.keys()]),
  authForPool: (tenantId: string | null) =>
    mockPoolApi(tenantId ? (mockTenantUsers.get(tenantId) ?? new Map()) : mockProjectUsers),
}))

import { GET } from '../app/api/auth/staff-self-check/route'

const AGLYN_TENANT = 'aglyn-org-y5v14'

const call = (token?: string) =>
  GET(
    new Request('https://app.aglyn.com/api/auth/staff-self-check', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

beforeEach(() => {
  mockTokens.clear()
  mockProjectUsers.clear()
  mockTenantUsers.clear()
})

describe('authentication', () => {
  it('401s with no Bearer token', async () => {
    expect((await call()).status).toBe(401)
  })

  it('401s on an unverifiable token', async () => {
    expect((await call('garbage')).status).toBe(401)
  })
})

describe('it diagnoses the caller, and only the caller', () => {
  it('tells an SSO staff member their claim is present and names the pool', async () => {
    mockTokens.set('t', {
      uid: 'sso-uid',
      email: 'zach@aglyn.com',
      staff: true,
      staffRole: 'super',
      firebase: { tenant: AGLYN_TENANT },
    })
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        ['sso-uid', mockUserRecord('sso-uid', 'zach@aglyn.com', {
          staff: true,
          staffRole: 'super',
        })],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.staff).toBe(true)
    expect(body.staffRole).toBe('super')
    expect(body.tenantId).toBe(AGLYN_TENANT)
    expect(body.hint).toBeNull()
    // The record they are signed in as must be marked `current`. Without this
    // assertion the flag is unguarded, and a self-check that recognised
    // nobody's own record would still pass every other case here.
    expect(body.identities).toEqual([
      { tenantId: AGLYN_TENANT, staff: true, staffRole: 'super', current: true },
    ])
  })

  it('tells a user whose OWN address holds staff in another pool which one', async () => {
    // The shape that cost two investigations: signed in as the wrong one of
    // your own identities.
    mockTokens.set('t', {
      uid: 'proj-uid',
      email: 'someone@example.com',
      firebase: {},
    })
    mockProjectUsers.set(
      'proj-uid',
      mockUserRecord('proj-uid', 'someone@example.com', {}),
    )
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        ['sso-uid', mockUserRecord('sso-uid', 'someone@example.com', { staff: true })],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.staff).toBe(false)
    expect(body.hint).toContain('single sign-on')
    expect(body.identities).toHaveLength(2)
  })

  it('gives a plain non-staff answer with NO hint when no identity holds staff', async () => {
    // The stranger case. They learn they are not staff — which the 404
    // already told them — and nothing else.
    mockTokens.set('t', {
      uid: 'nobody',
      email: 'stranger@example.com',
      firebase: {},
    })
    mockProjectUsers.set('nobody', mockUserRecord('nobody', 'stranger@example.com', {}))
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        ['zach', mockUserRecord('zach', 'zach@aglyn.com', { staff: true, staffRole: 'super' })],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.staff).toBe(false)
    expect(body.hint).toBeNull()
    // The critical negative: somebody ELSE's staff grant is not disclosed.
    expect(body.identities).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('zach@aglyn.com')
  })

  it('does not leak another address even when the caller asks about theirs', async () => {
    mockTokens.set('t', { uid: 'u', email: 'a@example.com', firebase: {} })
    mockProjectUsers.set('u', mockUserRecord('u', 'a@example.com', {}))
    mockProjectUsers.set('other', mockUserRecord('other', 'b@example.com', { staff: true }))
    const body = await (await call('t')).json()
    expect(JSON.stringify(body)).not.toContain('b@example.com')
    expect(body.hint).toBeNull()
  })

  it('a missing staffRole on a staff token reads as support, not super', async () => {
    // Mirrors AGL-495: the routes fail closed to the least-privileged role,
    // and a self-check that guessed `super` would contradict them.
    mockTokens.set('t', { uid: 'u', email: 'a@example.com', staff: true, firebase: {} })
    mockProjectUsers.set('u', mockUserRecord('u', 'a@example.com', { staff: true }))
    const body = await (await call('t')).json()
    expect(body.staffRole).toBe('support')
  })
})
