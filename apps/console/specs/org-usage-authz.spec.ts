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
 * AGL-939 surfaces /api/admin/org-usage on the org detail page, so its
 * authorization contract gets pinned: no token → 401, a verified NON-staff
 * token → 403, and a staff token → the monthly rollups. The 403 is the
 * load-bearing case — the detail page hands this endpoint to a browser
 * session, and the staff claim on the decoded token is the only gate.
 */

const mockVerifyIdToken = jest.fn()
const mockUsageGet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              orderBy: () => ({
                limit: () => ({ get: () => mockUsageGet() }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import { GET } from '../app/api/admin/org-usage/route'

const get = (opts: { token?: string; orgId?: string } = {}) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/admin/org-usage?orgId=${opts.orgId ?? 'org-1'}`,
      {
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      },
    ),
  )

describe('/api/admin/org-usage authorization (AGL-939)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('401s an unauthenticated caller', async () => {
    const response = await get()
    expect(response.status).toBe(401)
  })

  it('403s a verified NON-staff token — the claim is the gate', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'user-1',
      email_verified: true,
      // no `staff` claim
    })
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(403)
    expect(mockUsageGet).not.toHaveBeenCalled()
  })

  it('serves the monthly rollups to a staff token', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    mockUsageGet.mockResolvedValueOnce({
      docs: [
        {
          id: '2026-08',
          get: (key: string) =>
            ({
              month: '2026-08',
              storageGb: 1.5,
              pageViews: 100,
              formSubmissions: 3,
              costUsd: 2.5,
            })[key],
        },
      ],
    })
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.months).toEqual([
      {
        month: '2026-08',
        storageGb: 1.5,
        pageViews: 100,
        formSubmissions: 3,
        costUsd: 2.5,
        deltas: null,
      },
    ])
  })
})
