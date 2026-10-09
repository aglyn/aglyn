/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
 * helpers are unavailable.
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

// No imports (everything arrives through jest.mock factories), so without an
// export TypeScript treats this as a GLOBAL SCRIPT (TS2451, AGL-1841).
export {}

/**
 * THE STAFF USERS LIST NAMES AN SSO ACCOUNT (AGL-3721).
 *
 * owner@aglyn.com signs in through `saml.aglyn-workspace`, and his tenant Auth
 * record holds no `displayName` and no `photoURL` — GCIP keeps the SAML
 * attributes on the token. His account menu showed his name and photo (it
 * reads `users/{uid}`), while /admin/users drew a grey "Z": the route
 * serialized the Auth record alone. The route now resolves every row through
 * the account-identity resolver, which falls back to the profile document.
 */

const mockRows: any[] = []
const mockProfiles: Record<string, Record<string, unknown>> = {}
let mockResolveCalls: string[][] = []
const mockDecodedToken: Record<string, unknown> = {}

const pooled = (over: Record<string, unknown>) => ({
  record: {
    uid: 'uid',
    email: null,
    displayName: undefined,
    photoURL: undefined,
    disabled: false,
    customClaims: {},
    metadata: { creationTime: null, lastSignInTime: null },
    providerData: [] as any[],
    ...over,
  },
  tenantId: null as string | null,
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ auth: () => ({ verifyIdToken: async () => mockDecodedToken }) }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify' }, { status: 403 }),
  findUserByEmailAcrossPools: async (email: string) =>
    mockRows.find((row) => row.record.email === email) ?? null,
  findUserByUidAcrossPools: async (uid: string) =>
    mockRows.find((row) => row.record.uid === uid) ?? null,
  listUsersAcrossPools: async () => ({
    users: mockRows,
    nextPageToken: null,
    tenantsIncluded: true,
    tenantTruncated: [],
  }),
  scanUsersAcrossPools: async () => ({ users: mockRows, truncated: false, tenantTruncated: [] }),
  collapseCrossPoolUidRows: (rows: any[]) => rows,
  // The real precedence, over an in-memory `users/{uid}`: what is under test
  // is that the ROUTE hands its rows to the resolver and serializes its answer.
  resolveUserRecordIdentities: async (rows: any[]) => {
    mockResolveCalls.push(rows.map((row) => row.record.uid))
    const { resolveAccountIdentity } = jest.requireActual(
      '@aglyn/shared-util-tools/account-identity',
    )
    return new Map(
      rows.map((row) => [
        row.record.uid,
        resolveAccountIdentity({
          auth: row.record,
          profile: mockProfiles[row.record.uid] ?? null,
          email: row.record.email,
        }),
      ]),
    )
  },
}))

const route = require('../app/api/admin/users/route') as {
  GET: (request: Request) => Promise<Response>
}

const call = async (params: Record<string, string> = {}) => {
  const url = new URL('https://app.aglyn.com/api/admin/users')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await route.GET(
    new Request(url.toString(), { headers: { authorization: 'Bearer staff-token' } }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

const row = (payload: any, uid: string) => payload.users.find((one: any) => one.uid === uid)

beforeEach(() => {
  mockResolveCalls = []
  mockRows.length = 0
  for (const key of Object.keys(mockProfiles)) delete mockProfiles[key]
  mockRows.push(
    {
      ...pooled({
        uid: 'SSOfixtureUid000000000000001',
        email: 'owner@aglyn.com',
        providerData: [{ providerId: 'saml.aglyn-workspace', displayName: null, photoURL: null }],
        metadata: { creationTime: 'Mon, 03 Aug 2026 10:00:00 GMT', lastSignInTime: null },
      }),
      tenantId: 'aglyn-org-y5v14',
    },
    pooled({
      uid: 'uid-google',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      providerData: [{ providerId: 'google.com', photoURL: 'https://g.example/ada.png' }],
      metadata: { creationTime: 'Tue, 14 Jul 2026 10:00:00 GMT', lastSignInTime: null },
    }),
  )
  mockProfiles['SSOfixtureUid000000000000001'] = {
    firstName: 'Zach',
    lastName: 'Gover',
    photoUrl: 'https://cdn.example/zach.png',
  }
  Object.assign(mockDecodedToken, {
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
  })
})

describe('staff users list identity (AGL-3721)', () => {
  it("shows an SSO account's name and photo from its profile, not a blank", async () => {
    const payload = await call()
    expect(row(payload, 'SSOfixtureUid000000000000001')).toMatchObject({
      displayName: 'Zach Gover',
      photoUrl: 'https://cdn.example/zach.png',
    })
    // A Google account keeps what its Auth record and provider say.
    expect(row(payload, 'uid-google')).toMatchObject({
      displayName: 'Ada Lovelace',
      photoUrl: 'https://g.example/ada.png',
    })
  })

  it('resolves only the page it returns on an unfiltered read', async () => {
    await call()
    expect(mockResolveCalls).toHaveLength(1)
    expect(mockResolveCalls[0]?.sort()).toEqual(['SSOfixtureUid000000000000001', 'uid-google'])
  })

  it('finds an SSO account by the name only its profile holds', async () => {
    const payload = await call({ search: 'gover' })
    expect(payload.users.map((one: any) => one.uid)).toEqual(['SSOfixtureUid000000000000001'])
  })

  it('resolves the exact-email lookup too', async () => {
    const payload = await call({ email: 'owner@aglyn.com' })
    expect(payload.users[0]).toMatchObject({ displayName: 'Zach Gover' })
  })
})

describe('the SSO sign-in fills the Auth record (AGL-3721)', () => {
  it('is wired into the session mint for saml./oidc. sign-ins, absent-only', () => {
    const { readFileSync } = jest.requireActual('node:fs')
    const { join } = jest.requireActual('node:path')
    const source = readFileSync(
      join(__dirname, '../app/api/auth/session/route.ts'),
      'utf8',
    ) as string
    expect(source).toMatch(/syncAuthIdentityFromIdp\(\{/)
    expect(source).toMatch(/provider\.startsWith\('saml\.'\) \|\| provider\.startsWith\('oidc\.'\)/)
  })
})
