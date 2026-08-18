/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * Who may download what (AGL-1974).
 *
 * `personal-data-export.spec.ts` proves the FILE is right — bounded, redacted,
 * free of other people's data. These two routes decide who receives it, and
 * that is the half where a mistake turns a statutory right into a disclosure:
 *
 *  - the personal export has no subject parameter at all, so it cannot be
 *    pointed at somebody else;
 *  - the workspace export resolves membership for the NAMED org and refuses
 *    anyone below owner/admin with a 404, because an org id a caller has no
 *    standing in should not even be confirmed to exist;
 *  - neither serves an impersonating staff session. Impersonation looks
 *    exactly like the customer, which is the point of it and exactly why it
 *    is refused before every other gate.
 */

const mockVerifyIdToken = jest.fn()
const mockTenantVerify = jest.fn()
const mockExportUserData = jest.fn()
const mockExportOrgData = jest.fn()
const mockResolveMembership = jest.fn()
const mockAuditAdd = jest.fn()
const mockState = { impersonating: false, locked: false }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        tenantManager: () => ({
          authForTenant: () => ({
            verifyIdToken: (...args: unknown[]) => mockTenantVerify(...args),
          }),
        }),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          add: async (row: unknown) => mockAuditAdd(name, row),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => mockState.impersonating,
  lockdownRefusal: async () =>
    mockState.locked ? Response.json({ error: 'locked' }, { status: 423 }) : null,
  getOrgDoc: async () => ({ name: 'Acme' }),
  resolveOrgMembership: (...args: unknown[]) => mockResolveMembership(...args),
  exportUserData: (...args: unknown[]) => mockExportUserData(...args),
  exportOrgData: (...args: unknown[]) => mockExportOrgData(...args),
  exportFilename: (exported: any) =>
    `aglyn-${exported.subject.type}-data-${exported.subject.id}.json`,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: {},
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    }
  },
}))

const accountExport = require('../app/api/account/export/route')
const orgExport = require('../app/api/orgs/export-data/route')

const bearer = (token = 'tok') => ({ Authorization: `Bearer ${token}` })

const freshToken = (extra: Record<string, unknown> = {}) => ({
  uid: 'caller',
  email_verified: true,
  auth_time: Math.floor(Date.now() / 1000),
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockState.impersonating = false
  mockState.locked = false
  mockVerifyIdToken.mockResolvedValue(freshToken())
  mockExportUserData.mockResolvedValue({
    subject: { type: 'user', id: 'caller' },
    data: { users: [{ path: 'users/caller', data: {} }] },
  })
  mockExportOrgData.mockResolvedValue({
    subject: { type: 'org', id: 'o1' },
    data: { orgs: [{ path: 'orgs/o1', data: {} }] },
  })
  mockResolveMembership.mockResolvedValue({ member: { role: 'owner' } })
})

describe('GET /api/account/export', () => {
  const get = (headers: Record<string, string> = bearer()) =>
    accountExport.GET(
      new Request('https://console.aglyn.com/api/account/export', { headers }),
    )

  it('serves the CALLER’s own data as a named attachment', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(mockExportUserData).toHaveBeenCalledWith('caller')
    expect(response.headers.get('Content-Disposition')).toContain(
      'aglyn-user-data-caller.json',
    )
    // The most personal payload the console produces — a shared cache holding
    // it is a disclosure.
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })

  it('records that the access request happened, with no content in the row', async () => {
    await get()
    const [[collection, row]] = mockAuditAdd.mock.calls
    expect(collection).toBe('adminAudit')
    expect(row).toMatchObject({
      actorUid: 'caller',
      action: 'account.exported.self',
      target: 'users/caller',
    })
    // Ids and counts, never the content (the AGL-1443 rule that removed the
    // erasure's own dump): the row carries WHICH sources were read and HOW
    // MANY documents, and nothing that was in them. `adminAudit` must not
    // become a second copy of the data the export produced.
    expect(Object.keys((row as any).after).sort()).toEqual([
      'documents',
      'sources',
    ])
    expect((row as any).after.documents).toBe(1)
  })

  it('refuses an IMPERSONATED staff session', async () => {
    // The session looks exactly like the customer's. Staff who genuinely need
    // this run the subject-access script, which leaves a named actor in the
    // trail instead of the customer's own uid.
    mockState.impersonating = true
    const response = await get()
    expect(response.status).toBe(403)
    expect(mockExportUserData).not.toHaveBeenCalled()
  })

  it('refuses a stale sign-in', async () => {
    mockVerifyIdToken.mockResolvedValue(
      freshToken({ auth_time: Math.floor(Date.now() / 1000) - 7200 }),
    )
    const response = await get()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: 'reauth-required',
    })
    expect(mockExportUserData).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await accountExport.GET(
      new Request('https://console.aglyn.com/api/account/export'),
    )
    expect(response.status).toBe(401)
    expect(mockExportUserData).not.toHaveBeenCalled()
  })
})

describe('GET /api/orgs/export-data', () => {
  const get = (orgId = 'o1') =>
    orgExport.GET(
      new Request(
        `https://console.aglyn.com/api/orgs/export-data?orgId=${orgId}`,
        { headers: bearer() },
      ),
    )

  it('serves an owner the workspace export', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect(mockExportOrgData).toHaveBeenCalledWith('o1')
  })

  it('resolves membership for the NAMED org, never the caller’s default', async () => {
    // `resolveOrgMembership` falls back to the caller's first workspace when
    // given no org. A route relying on that would hand somebody their own data
    // while appearing to honour a request for a different workspace.
    await get('o-other')
    expect(mockResolveMembership).toHaveBeenCalledWith('caller', 'o-other')
  })

  it('refuses a VIEWER with 404, not 403', async () => {
    // The whole workspace is in this file — members' emails, customers'
    // orders, support threads. A viewer invited to one site has no claim on
    // it, and an org id they have no standing in should not be confirmed to
    // exist.
    mockResolveMembership.mockResolvedValue({ member: { role: 'viewer' } })
    const response = await get()
    expect(response.status).toBe(404)
    expect(mockExportOrgData).not.toHaveBeenCalled()
  })

  it('refuses a non-member with 404', async () => {
    mockResolveMembership.mockResolvedValue(null)
    const response = await get()
    expect(response.status).toBe(404)
    expect(mockExportOrgData).not.toHaveBeenCalled()
  })

  it('refuses an impersonated staff session', async () => {
    mockState.impersonating = true
    const response = await get()
    expect(response.status).toBe(403)
    expect(mockExportOrgData).not.toHaveBeenCalled()
  })

  it('answers a lockdown with the distinct 423', async () => {
    mockState.locked = true
    const response = await get()
    expect(response.status).toBe(423)
    expect(mockExportOrgData).not.toHaveBeenCalled()
  })

  it('requires an orgId', async () => {
    const response = await orgExport.GET(
      new Request('https://console.aglyn.com/api/orgs/export-data', {
        headers: bearer(),
      }),
    )
    expect(response.status).toBe(400)
    expect(mockExportOrgData).not.toHaveBeenCalled()
  })
})

// Marks this file a MODULE. Without it every top-level `const` here is
// global, and route specs that each name a `POST`/`GET` handler collide at
// typecheck time while passing at runtime — a red the test run cannot show.
export {}
