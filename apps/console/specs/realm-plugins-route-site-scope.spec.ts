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
 * `/api/orgs/realm-plugins?hostId=` answers for one of the org's own sites
 * (AGL-3391).
 *
 * The Besigner asks for a site's install list — the workspace's pins plus the
 * site's own — because that is the list the site's published pages load. The
 * member check is on the org, so the host has to be proved to be the org's:
 * without that, any member of any workspace could read another site's pins by
 * naming it.
 */

let mockHostOrg: string | null
let mockInstallsAsked: Array<Record<string, unknown>>

jest.mock('@aglyn/tenant-data-admin', () => ({
  emailUnverifiedResponse: () => new Response(null, { status: 403 }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
    }),
  },
  getOrgDoc: async () => ({}),
  getRealmPluginInstalls: async (options: Record<string, unknown>) => {
    mockInstallsAsked.push(options)
    return [{ listingId: 'listing-calc' }]
  },
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  resolveOrgIdForHost: async () => mockHostOrg,
  resolveOrgMembership: async () => ({ role: 'member' }),
}))
jest.mock('../app/api/_lib/invalid-id-token-response', () => ({
  invalidIdTokenResponse: () => null,
}))

import { GET } from '../app/api/orgs/realm-plugins/route'

const ask = (query: string) =>
  GET(
    new Request(`https://console.example/api/orgs/realm-plugins?${query}`, {
      headers: { authorization: 'Bearer id-token' },
    }),
  )

beforeEach(() => {
  mockHostOrg = 'org-1'
  mockInstallsAsked = []
})

describe('the realm install list for one site (AGL-3391)', () => {
  it("answers with the site's list for a site the org owns", async () => {
    const response = await ask('orgId=org-1&hostId=host-1')

    expect(response.status).toBe(200)
    expect(mockInstallsAsked).toEqual([{ orgId: 'org-1', hostId: 'host-1' }])
  })

  it("refuses another workspace's site as though it did not exist", async () => {
    mockHostOrg = 'org-2'

    const response = await ask('orgId=org-1&hostId=host-9')

    expect(response.status).toBe(404)
    expect(mockInstallsAsked).toEqual([])
  })

  it("keeps answering with the workspace's list when no site is named", async () => {
    const response = await ask('orgId=org-1')

    expect(response.status).toBe(200)
    expect(mockInstallsAsked).toEqual([{ orgId: 'org-1' }])
  })
})
