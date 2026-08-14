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
 * The staff verdict probe (AGL-1573): staff describe a caller, the server
 * answers what that caller would be told.
 *
 * The properties pinned here are the ones that decide whether the answer is
 * trustworthy during an incident — every one of them, wrong, produces a
 * REASSURING falsehood rather than an obvious failure:
 *
 *  - the verdict is evaluated for the SUBJECT, never the caller. The caller
 *    is staff by definition (the route is staff-gated), and staff bypass
 *    every scope — leaking the caller's claim in would make the probe answer
 *    "not locked" for every customer on the platform;
 *  - a subject who IS staff is reported as bypassing, not as unlocked;
 *  - the refusal body is the real `lockdownJsonResponse`, so the panel can
 *    never drift into a second, prettier rendering of the 423;
 *  - a scope the caller did not name, or named wrongly, is absent from
 *    `evaluated` rather than silently counted as clear;
 *  - reading is open to every staff role: during an incident the person
 *    asking "what is this customer seeing" is usually support, not the
 *    super-role operator who armed the lock.
 */

const mockVerifyIdToken = jest.fn()
const mockGetLockdownVerdict = jest.fn()
const mockFeatureLockdownRefusal = jest.fn()
const mockFindUser = jest.fn()
const mockDocGet = jest.fn()

const ORG_DOC = { plan: 'pro', suspendedAt: 1755043200000 }
const HOST_DOC = { subdomain: 'shop' }
const VERDICT = {
  scope: 'org',
  reason: 'billing',
  message: 'Payment failed.',
  atMs: 1755043200000,
  untilMs: 1755046800000,
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
          doc: (id: string) => ({ get: async () => mockDocGet(name, id) }),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
  authForPool: () => ({}),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  featureLockdownRefusal: (...args: unknown[]) =>
    mockFeatureLockdownRefusal(...args),
  findUserByUidAcrossPools: (...args: unknown[]) => mockFindUser(...args),
  getLockdownVerdict: (...args: unknown[]) => mockGetLockdownVerdict(...args),
  invalidateFeatureLockdownCache: () => undefined,
  invalidatePlatformLockdownCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
  isImpersonationSession: () => false,
  // The REAL body builder is what the panel must show; this stands in for
  // it with the same call contract so the assertion below is about wiring.
  lockdownJsonResponse: (state: { scope: string; reason: string }) =>
    Response.json(
      { error: 'locked', scope: state.scope, reason: state.reason },
      { status: 423 },
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  LOCKDOWNS_COLLECTION: 'lockdowns',
  LOCKDOWN_FEATURE_KEYS: ['signups', 'uploads'],
  LOCKDOWN_MESSAGE_MAX: 400,
  PLATFORM_LOCKDOWN_DOC_ID: 'platform',
  featureLockdownDocId: (key: string) => `feature--${key}`,
  isLockdownFeatureKey: (value: unknown) =>
    value === 'signups' || value === 'uploads',
  isLockdownReasonCode: (value: unknown) => value === 'billing',
  userLockdownDocId: (uid: string) => `user--${uid}`,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body: {},
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: jest.fn(),
  applyHostLockdown: jest.fn(),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'NOW' },
}))

import { GET } from '../app/api/admin/lockdown/route'

const probe = (search: string) =>
  GET(
    new Request(`https://app.aglyn.com/api/admin/lockdown?${search}`, {
      headers: { authorization: 'Bearer tok' },
    }),
  )

const snapshot = (exists: boolean, data: object) => ({
  exists,
  data: () => (exists ? data : undefined),
  get: (field: string) => (data as Record<string, unknown>)[field],
})

beforeEach(() => {
  jest.clearAllMocks()
  // The CALLER: staff, as everyone who reaches this route must be — and
  // only the SUPPORT role, to prove reading needs no super.
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'support',
  })
  mockDocGet.mockImplementation((collection: string, id: string) => {
    if (collection === 'orgs') {
      return snapshot(id === 'org-1', ORG_DOC)
    }
    if (collection === 'hosts') return snapshot(id === 'host-1', HOST_DOC)
    return snapshot(false, {})
  })
  // The SUBJECT: an ordinary customer account.
  mockFindUser.mockResolvedValue({ record: { customClaims: {} }, tenantId: null })
  mockGetLockdownVerdict.mockResolvedValue(VERDICT)
  mockFeatureLockdownRefusal.mockResolvedValue(null)
})

describe('AGL-1573 · the staff verdict probe', () => {
  it('evaluates the SUBJECT, never the staff caller who asked', async () => {
    const response = await probe('verdict=1&uid=u-1&orgId=org-1&hostId=host-1')
    expect(response.status).toBe(200)
    expect(mockGetLockdownVerdict).toHaveBeenCalledWith({
      // The caller's `staff: true` must NOT arrive here — it would bypass
      // every scope and answer "not locked" about every customer alive.
      staff: false,
      uid: 'u-1',
      org: ORG_DOC,
      host: HOST_DOC,
    })
  })

  it('answers with the real refusal body, not a re-description of it', async () => {
    const payload = await (await probe('verdict=1&orgId=org-1')).json()
    expect(payload.locked).toBe(true)
    expect(payload.verdict).toEqual(VERDICT)
    expect(payload.refusal).toEqual({
      status: 423,
      body: { error: 'locked', scope: 'org', reason: 'billing' },
    })
    // Labelled as derived, so no one can read it as a wire observation.
    expect(payload.kind).toBe('computed-verdict')
    expect(payload.note).toMatch(/COMPUTED, not observed/)
  })

  it('reports a staff SUBJECT as bypassing rather than as unlocked', async () => {
    mockFindUser.mockResolvedValue({
      record: { customClaims: { staff: true } },
      tenantId: null,
    })
    mockGetLockdownVerdict.mockResolvedValue(null)
    const payload = await (await probe('verdict=1&uid=staff-2&orgId=org-1')).json()
    expect(payload.staffBypass).toBe(true)
    expect(payload.subject.staff).toBe(true)
    expect(payload.locked).toBe(false)
    // And the claim was passed truthfully, so the null verdict is honest.
    expect(mockGetLockdownVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ staff: true }),
    )
  })

  it('never counts a scope it was not given as evaluated', async () => {
    const named = await (await probe('verdict=1&orgId=org-1')).json()
    expect(named.evaluated).toEqual(['platform', 'org'])

    // A typo'd id must not read as a cleared workspace: the scope is absent
    // from `evaluated` and the org doc is never handed to the verdict.
    const typo = await (await probe('verdict=1&orgId=org-nope')).json()
    expect(typo.evaluated).toEqual(['platform'])
    expect(typo.subject.orgExists).toBe(false)
    expect(mockGetLockdownVerdict).toHaveBeenLastCalledWith(
      expect.objectContaining({ org: undefined }),
    )
  })

  it('reports the capabilities refused for that same subject', async () => {
    mockFeatureLockdownRefusal.mockImplementation(
      async ({ feature }: { feature: string }) =>
        feature === 'uploads'
          ? Response.json(
              { error: 'locked', scope: 'feature', feature },
              { status: 423 },
            )
          : null,
    )
    const payload = await (await probe('verdict=1&uid=u-1')).json()
    expect(payload.features).toEqual([
      { feature: 'signups', locked: false, body: null },
      {
        feature: 'uploads',
        locked: true,
        body: { error: 'locked', scope: 'feature', feature: 'uploads' },
      },
    ])
    // The subject's claim again — a staff bypass on the feature stage is
    // the subject's to have, not the operator's.
    expect(mockFeatureLockdownRefusal).toHaveBeenCalledWith({
      feature: 'uploads',
      staff: false,
    })
  })

  it('refuses an empty subject instead of answering about nobody', async () => {
    const response = await probe('verdict=1')
    expect(response.status).toBe(400)
    expect(mockGetLockdownVerdict).not.toHaveBeenCalled()
  })

  it('needs staff, but not the super role, to read', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'nobody',
      email_verified: true,
      staff: false,
    })
    const response = await probe('verdict=1&orgId=org-1')
    expect(response.status).toBe(403)
    expect(mockGetLockdownVerdict).not.toHaveBeenCalled()
  })
})
