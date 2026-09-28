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
 * Holds & reviews (AGL-3368): who may read a workspace's risk notices and
 * ask for a review — and that asking is ALL an owner can do. The route has
 * no path to a release: it hands a note to `requestRiskReview` (whose append
 * is proved in `risk-notice.spec.ts`) and never writes the store itself.
 */

const mockDecoded: Record<string, unknown> = {}
let mockRole: string | null = 'owner'
const mockRequests: Array<Record<string, unknown>> = []
const mockFirestoreTouched = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
      firestore: () => {
        mockFirestoreTouched()
        return {}
      },
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  resolveOrgMembership: async () => (mockRole ? { member: { role: mockRole } } : null),
  listOwnerRiskNotices: async () => [{ noticeId: 'a'.repeat(40), title: 'An email is on hold for review' }],
  requestRiskReview: async (input: Record<string, unknown>) => {
    mockRequests.push(input)
    return { ok: true, reference: 'HS-1', requestedAtMs: 1 }
  },
}))

const route = require('../app/api/orgs/risk-notices/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

const get = () =>
  route.GET(
    new Request('https://app.example.com/api/orgs/risk-notices?orgId=org-1', {
      headers: { authorization: 'Bearer token' },
    }),
  )
const post = (body: Record<string, unknown>) =>
  route.POST(
    new Request('https://app.example.com/api/orgs/risk-notices', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

beforeEach(() => {
  mockRole = 'owner'
  mockRequests.length = 0
  mockFirestoreTouched.mockClear()
  Object.assign(mockDecoded, { uid: 'owner-1', email: 'avery@example.com', email_verified: true, staff: false })
})

describe('/api/orgs/risk-notices', () => {
  it('lists the notices for the workspace’s owners and admins', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    expect((await response.json()).notices).toHaveLength(1)
    mockRole = 'admin'
    expect((await get()).status).toBe(200)
  })

  it('refuses an editor and a stranger', async () => {
    mockRole = 'editor'
    expect((await get()).status).toBe(403)
    mockRole = null
    expect((await get()).status).toBe(403)
  })

  it('lets staff read, but never ask on the workspace’s behalf', async () => {
    mockRole = null
    mockDecoded['staff'] = true
    expect((await get()).status).toBe(200)
    expect((await post({ noticeId: 'a'.repeat(40), note: 'A note from staff.' })).status).toBe(403)
    expect(mockRequests).toEqual([])
  })

  it('files the owner’s note as a review request — and does nothing else', async () => {
    const response = await post({
      noticeId: 'a'.repeat(40),
      note: 'This is our own resale shop.',
      // Whatever else a client sends, there is no release to ask for.
      status: 'dismissed',
      decision: 'release',
    })
    expect(response.status).toBe(200)
    expect(mockRequests).toEqual([
      {
        orgId: 'org-1',
        noticeId: 'a'.repeat(40),
        uid: 'owner-1',
        email: 'avery@example.com',
        note: 'This is our own resale shop.',
      },
    ])
    // The route itself writes nothing: the append is the seam's, and only that.
    expect(mockFirestoreTouched).not.toHaveBeenCalled()
  })

  it('refuses a malformed notice id', async () => {
    expect((await post({ noticeId: '../x', note: 'Please look again.' })).status).toBe(400)
  })
})

// A module, so its doubles do not collide with other specs in the type program.
export {}
