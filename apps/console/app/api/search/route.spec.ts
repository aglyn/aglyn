/**
 * @jest-environment node
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
 * `GET /api/search` (AGL-3943): the door in front of the one box. Signed in
 * by the token, the uid is the token's, a request is counted per account,
 * and a locked workspace is not searched. What is found is the engine's
 * spec (`_lib/one-box-search.spec.ts`).
 */

const mockVerify = jest.fn()
const mockRun = jest.fn()
const mockLockdown = jest.fn()
let mockAllowed = true

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: Object.assign(
    {
      app: () => ({
        auth: () => ({ verifyIdToken: (token: string) => mockVerify(token) }),
        firestore: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
      }),
    },
    { firestore: { FieldPath: { documentId: () => '__name__' } } },
  ),
  checkRateLimit: () => ({ allowed: mockAllowed, limit: 60, remaining: 0, resetMs: Date.now() + 1000 }),
  rateLimitHeaders: () => ({ 'RateLimit-Limit': '60' }),
  lockdownRefusal: (options: unknown) => mockLockdown(options),
  resolveMemberOrgPermissions: async () => ({}),
}))
jest.mock('@aglyn/tenant-data-admin/server/list-query', () => ({ applyListQuery: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  filterEnabledPluginsByReleaseFlags: async (ids: string[]) => ids,
}))
jest.mock('../../../constants/plugins.declarations.server.generated', () => ({
  registerPluginServerDeclarations: async () => undefined,
}))
jest.mock('../_lib/one-box-search', () => ({
  runOneBoxSearch: (input: unknown) => mockRun(input),
}))

import { GET } from './route'

const call = (query: string, token = 'tok') =>
  GET(
    new Request(`https://app.example/api/search?${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockAllowed = true
  mockVerify.mockResolvedValue({ uid: 'ana' })
  mockLockdown.mockResolvedValue(null)
  mockRun.mockResolvedValue({ status: 200, body: { query: 'acme', groups: [] } })
})

describe('GET /api/search', () => {
  it('CONTROL: searches as the token’s account, with the request’s scope and paging', async () => {
    const response = await call('q=acme&orgId=org-a&hostId=site-a&limit=10&group=orders&cursor=5&uid=bo')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'ana',
        text: 'acme',
        orgId: 'org-a',
        hostId: 'site-a',
        limit: 10,
        group: 'orders',
        cursor: 5,
      }),
    )
  })

  it('refuses a caller with no token', async () => {
    expect((await call('q=acme', '')).status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('refuses a query too short to search, and a site with no workspace', async () => {
    expect((await call('q=a')).status).toBe(400)
    expect((await call('q=acme&hostId=site-a')).status).toBe(400)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('answers 429 past the account’s budget', async () => {
    mockAllowed = false
    const response = await call('q=acme')
    expect(response.status).toBe(429)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('answers a locked workspace with its lockdown refusal', async () => {
    mockLockdown.mockResolvedValue(Response.json({ error: 'locked' }, { status: 423 }))
    const response = await call('q=acme&orgId=org-a')
    expect(response.status).toBe(423)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('passes the engine’s refusal through', async () => {
    mockRun.mockResolvedValue({ status: 403, error: 'You are not a member of this workspace' })
    const response = await call('q=acme&orgId=org-b')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'You are not a member of this workspace' })
  })
})
