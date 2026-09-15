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
 * `/api/ai/admin/orgs-spend` (AGL-2984) backs the staff Organizations list's
 * AI spend column. Pinned: the staff gate — 401, 403 and 200 on the rungs
 * `/api/ai/admin/org` climbs, and 400 for an ask no read should serve — then
 * ONE read for the page, and the answer's one distinction: an org with no
 * month document is `null`, never `0`, and a failed read is `null` for every
 * org rather than a failed list.
 */

const mockVerifyIdToken = jest.fn()
let mockDocsByPath: Record<string, Record<string, unknown> | undefined> = {}
let mockGetAllPaths: string[][] = []
let mockGetAllFails = false

function mockMakeDoc(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => ({
      doc: (id: string) => mockMakeDoc(`${path}/${name}/${id}`),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => mockMakeDoc(`${name}/${id}`),
        }),
        getAll: async (...refs: Array<{ path: string }>) => {
          mockGetAllPaths.push(refs.map((ref) => ref.path))
          if (mockGetAllFails) throw new Error('DEADLINE_EXCEEDED')
          return refs.map((ref) => {
            const data = mockDocsByPath[ref.path]
            return {
              id: ref.path.split('/').pop(),
              exists: data !== undefined,
              data: () => data,
              get: (field: string) => data?.[field],
            }
          })
        },
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
}))

jest.mock('../usage/assist-usage', () => ({
  __esModule: true,
  assistUsageMonth: () => '2026-09',
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

import { staffOrgsAiSpendQuery } from '../usage/staff-orgs-ai-spend'
import { GET } from './ai-admin-orgs-spend'

const ORG_IDS = ['org-1', 'org-2', 'org-3']

const get = (
  opts: { token?: string; query?: string; method?: string } = {},
) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/ai/admin/orgs-spend?${
        opts.query ?? staffOrgsAiSpendQuery(ORG_IDS)
      }`,
      {
        method: opts.method ?? 'GET',
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      },
    ),
  )

const asStaff = (claims: Record<string, unknown> = {}) =>
  mockVerifyIdToken.mockResolvedValueOnce({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
    ...claims,
  })

describe('/api/ai/admin/orgs-spend (AGL-2984)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllPaths = []
    mockGetAllFails = false
    mockDocsByPath = {
      'orgs/org-1/assistUsage/2026-09': { month: '2026-09', estCostUsd: 2.5 },
      // A month document that measured nothing is a measured zero.
      'orgs/org-2/assistUsage/2026-09': { month: '2026-09', estCostUsd: 0 },
      // Last month's spend says nothing about this month.
      'orgs/org-3/assistUsage/2026-08': { month: '2026-08', estCostUsd: 40 },
    }
  })

  it('refuses anything but GET', async () => {
    expect((await get({ token: 'tok', method: 'POST' })).status).toBe(405)
  })

  it('401s an unauthenticated caller, and reads nothing', async () => {
    expect((await get()).status).toBe(401)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(mockGetAllPaths).toEqual([])
  })

  it('401s a token that does not verify, rather than failing with a 500', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error('Firebase ID token has expired.'), {
        code: 'auth/id-token-expired',
      }),
    )
    expect((await get({ token: 'expired' })).status).toBe(401)
    expect(mockGetAllPaths).toEqual([])
  })

  it('403s an unverified email', async () => {
    asStaff({ email_verified: false })
    expect((await get({ token: 'tok' })).status).toBe(403)
    expect(mockGetAllPaths).toEqual([])
  })

  it('403s a verified NON-staff token — the claim is the gate', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: 'user-1',
      email_verified: true,
    })
    expect((await get({ token: 'tok' })).status).toBe(403)
    expect(mockGetAllPaths).toEqual([])
  })

  it('400s an ask no read should serve, before verifying anything', async () => {
    const tooMany = staffOrgsAiSpendQuery(
      Array.from({ length: 101 }, (_, index) => `org-${index}`),
    )
    for (const query of ['', 'orgIds=', tooMany, 'orgIds=a%2Fb']) {
      expect((await get({ token: 'tok', query })).status).toBe(400)
    }
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(mockGetAllPaths).toEqual([])
  })

  it('answers each org’s spend this month from ONE read, and null — never 0 — where there is no month document', async () => {
    asStaff()
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      month: '2026-09',
      spendUsd: { 'org-1': 2.5, 'org-2': 0, 'org-3': null },
    })
    expect(mockGetAllPaths).toEqual([
      [
        'orgs/org-1/assistUsage/2026-09',
        'orgs/org-2/assistUsage/2026-09',
        'orgs/org-3/assistUsage/2026-09',
      ],
    ])
  })

  it('answers null for every org when the read fails, rather than failing the list', async () => {
    asStaff()
    mockGetAllFails = true
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(200)
    expect((await response.json()).spendUsd).toEqual({
      'org-1': null,
      'org-2': null,
      'org-3': null,
    })
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})
