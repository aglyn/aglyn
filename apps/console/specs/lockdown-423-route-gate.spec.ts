/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * The AGL-1506 wiring at the ROUTE level, on one representative route
 * (domains/detach), layered exactly like `session-lockdown-gate.spec.ts`
 * sits on the mint: the verdict helper has its own unit proof in
 * libs/tenant/data/admin, and `lockdown-423-coverage.spec.ts` discovers
 * that every route carries the idiom — what neither can see is whether the
 * idiom actually GATES a handler. This file pins that:
 *
 *  - a locked caller gets the refusal AND the mutation never runs — a 423
 *    that arrives after the write would be notice-shaped data loss;
 *  - the verdict is fed the claims off the VERIFIED token and the org/host
 *    docs the route already read — never anything a client sent;
 *  - a null verdict changes nothing: the route proceeds to its mutation.
 */

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockGetOrgForHost = jest.fn()
const mockHostSet = jest.fn(async () => undefined)
// Lazy so the hoisted mock factory never touches a const in its TDZ.
const mockHostSnapshot = jest.fn()

const ORG_DOC = { plan: 'pro', suspendedAt: 1755043200000 }
const HOST_DATA = {
  memberRoles: { 'u-member': 'admin' },
  cname: 'shop.example.com',
  subdomain: 'shop',
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: async () => mockHostSnapshot() }),
        }),
      }),
    }),
    firestore: { FieldValue: { delete: () => 'FIELD_DELETE' } },
  },
  getOrgForHost: (...args: unknown[]) => mockGetOrgForHost(...args),
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  TENANT_APEX: 'aglyn.app',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST } from '../app/api/domains/detach/route'

// The 423 the lib helper would build — its exact shape is unit-tested in
// libs/tenant/data/admin; the route's obligation is only to return it.
const LOCKED_RESPONSE = () =>
  Response.json(
    { error: 'locked', scope: 'org', reason: 'billing' },
    { status: 423 },
  )

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/domains/detach', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1' }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  // No Vercel env in tests: the route's platform-API calls are skipped and
  // the Firestore write is the observable mutation.
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_TENANT_PROJECT_ID
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-member',
    email_verified: true,
    staff: false,
  })
  mockGetOrgForHost.mockResolvedValue({ orgId: 'org-1', org: ORG_DOC })
  mockHostSnapshot.mockReturnValue({
    exists: true,
    get: (field: string) => (HOST_DATA as Record<string, unknown>)[field],
    data: () => HOST_DATA,
    ref: { set: mockHostSet },
  })
})

describe('AGL-1506 · the 423 idiom gates a wired route (domains/detach)', () => {
  it('refuses a locked caller with the distinct 423 BEFORE the mutation', async () => {
    mockLockdownRefusal.mockResolvedValue(LOCKED_RESPONSE())
    const response = await post()
    expect(response.status).toBe(423)
    expect(await response.json()).toMatchObject({
      error: 'locked',
      scope: 'org',
      reason: 'billing',
    })
    // The gate, not just the status: the host doc was never written.
    expect(mockHostSet).not.toHaveBeenCalled()
  })

  it('feeds the verdict the VERIFIED claims and the docs in hand', async () => {
    mockLockdownRefusal.mockResolvedValue(null)
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-member',
      email_verified: true,
      staff: true,
    })
    await post()
    expect(mockLockdownRefusal).toHaveBeenCalledWith({
      // Off the verified token — a header or body could never say this.
      staff: true,
      uid: 'u-member',
      // The docs the route already read, so the org/host scopes are free.
      org: ORG_DOC,
      host: HOST_DATA,
    })
  })

  it('a null verdict changes nothing — the mutation proceeds', async () => {
    mockLockdownRefusal.mockResolvedValue(null)
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ detached: true })
    expect(mockHostSet).toHaveBeenCalledTimes(1)
  })
})
