/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * THE ORGANIZATION'S EFFECTIVE ENTITLEMENTS FOR THE STAFF APPS (AGL-3667).
 *
 * The staff page works the table out in the browser; `/api/admin/org-entitlements`
 * sends the same rows: every numeric limit as it resolves now, beside the plan
 * default, with the override flagged and what the organization holds against
 * the platform's own limits. Staff only.
 */

const mockVerifyIdToken = jest.fn()
const mockOrg = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: async () => mockOrg() }) }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  listOrgMembers: async () => [
    { role: 'owner' },
    { role: 'editor', allHosts: true },
    { role: 'editor', allHosts: false, hostAccess: { h1: 'editor' } },
  ],
}))
jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => undefined,
}))
jest.mock('../utils/server/capacity-in-use', () => ({
  __esModule: true,
  countOrgSites: async () => 2,
  countOrgCapacity: async () => 7,
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: { authorization: request.headers.get('authorization') ?? undefined },
    }
  },
}))

import { GET } from '../app/api/admin/org-entitlements/route'

const get = (opts: { token?: string; orgId?: string } = {}) =>
  GET(
    new Request(`https://app.example.test/api/admin/org-entitlements?orgId=${opts.orgId ?? 'org-1'}`, {
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    }),
  )

beforeEach(() => {
  mockVerifyIdToken.mockReset()
  mockOrg.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
  mockOrg.mockReturnValue({ exists: true, data: () => ({ plan: 'pro', entitlements: { hostLimit: 12 } }) })
})

describe('/api/admin/org-entitlements', () => {
  it('needs a token, and staff', async () => {
    expect((await get()).status).toBe(401)
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    expect((await get({ token: 't' })).status).toBe(403)
  })

  it('says when there is no such organization', async () => {
    mockOrg.mockReturnValue({ exists: false })
    expect((await get({ token: 't' })).status).toBe(404)
  })

  it('answers each limit as it resolves, beside the plan default, flagging an override', async () => {
    const body = await (await get({ token: 't' })).json()
    const hostLimit = body.rows.find((row: { key: string }) => row.key === 'hostLimit')
    expect(hostLimit).toMatchObject({ effective: '12', overridden: true, used: '2' })
    expect(hostLimit.planDefault).not.toBe('12')
    expect(body.rows.every((row: { key: string }) => row.key !== 'features')).toBe(true)
    const untouched = body.rows.find((row: { overridden: boolean }) => !row.overridden)
    expect(untouched.effective).toBe(untouched.planDefault)
  })

  it('counts manager seats the way the gates do: org-wide members only', async () => {
    const body = await (await get({ token: 't' })).json()
    const seats = body.rows.find((row: { key: string }) => row.key === 'managersPerOrg')
    expect(seats?.used).toBe('2')
  })
})
