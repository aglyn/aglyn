/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor (feedback_jest_environment_pragma_shadowed_by_license).
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
 * THE FREE-WORKSPACE CEILING, and who may move it (AGL-2265).
 *
 * Zach's decision was "3 but provide a control in the staff console", and the
 * second half is what this route is. It carries the same posture as release
 * flags and the send-rate ramp: any staff may READ the number — support fields
 * "why can't I create another workspace" and has to be able to answer it — and
 * only `super` may set it, with an `adminAudit` row carrying a before, an
 * after and a typed reason.
 *
 * The audit row is asserted rather than assumed because this value decides who
 * can sign up at all. When somebody asks in two weeks why signups stopped on
 * the 3rd, the answer has to exist.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
const mockConfigSet = jest.fn(async (..._args: unknown[]) => undefined)
const mockInvalidate = jest.fn((..._args: unknown[]) => undefined)
const mockCount = jest.fn(async (..._args: unknown[]) => ({
  held: 3,
  orgIds: ['org-a', 'org-b', 'org-c'],
}))
let storedConfig = {
  limit: 3,
  enabled: true,
  note: '',
  updatedAtMs: null as number | null,
  updatedByEmail: null as string | null,
  ready: true,
}
const mockReadConfig = jest.fn(async (..._args: unknown[]) => storedConfig)

jest.mock('@aglyn/tenant-data-admin', () => {
  const actual = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/free-workspace-cap',
  )
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        }),
        firestore: () => ({
          collection: (name: string) => ({
            doc: () => ({ set: (...args: unknown[]) => mockConfigSet(...args) }),
            add: (row: unknown) => mockAuditAdd(name, row),
          }),
        }),
      }),
    },
    RATE_LIMIT_COLLECTION: 'rateLimits',
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
    // Referenced through arrows, not by value: the `jest.mock` factory is
    // HOISTED above these `const` declarations, so naming one directly is a
    // temporal-dead-zone ReferenceError that fails the whole suite to
    // TRANSFORM — which reads a great deal like a suite that ran.
    countFreeWorkspacesForOwner: (...args: unknown[]) => mockCount(...args),
    readFreeWorkspaceCapConfig: (...args: unknown[]) => mockReadConfig(...args),
    invalidateFreeWorkspaceCapConfigCache: (...args: unknown[]) =>
      mockInvalidate(...args),
    // The real ones — pure values and a pure shape function, and the shape
    // function is what guarantees the stored document carries no `expiresAt`.
    FREE_WORKSPACE_CAP_CONFIG_DOC: actual.FREE_WORKSPACE_CAP_CONFIG_DOC,
    FREE_WORKSPACE_CAP_MIN: actual.FREE_WORKSPACE_CAP_MIN,
    FREE_WORKSPACE_CAP_MAX: actual.FREE_WORKSPACE_CAP_MAX,
    FREE_WORKSPACE_CAP_NOTE_MAX: actual.FREE_WORKSPACE_CAP_NOTE_MAX,
    freeWorkspaceCapConfigWrite: actual.freeWorkspaceCapConfigWrite,
    normalizeFreeWorkspaceCapConfig: actual.normalizeFreeWorkspaceCapConfig,
  }
})

import { GET, PUT } from '../app/api/admin/free-workspace-cap/route'

function request(method: string, body?: unknown, url?: string) {
  return new Request(
    url ?? 'https://app.aglyn.com/api/admin/free-workspace-cap',
    {
      method,
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
}

function asStaff(role: string) {
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: role,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  storedConfig = {
    limit: 3,
    enabled: true,
    note: '',
    updatedAtMs: null,
    updatedByEmail: null,
    ready: true,
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('GET', () => {
  it('refuses a non-staff session', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u1',
      email_verified: true,
    })
    expect((await GET(request('GET'))).status).toBe(403)
  })

  it('refuses an unauthenticated request', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/admin/free-workspace-cap'),
    )
    expect(response.status).toBe(401)
  })

  it('is READABLE by every staff role — support has to answer the ticket', async () => {
    for (const role of ['support', 'billing', 'super']) {
      asStaff(role)
      const response = await GET(request('GET'))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.config.limit).toBe(3)
      expect(body.role).toBe(role)
      expect(body.bounds).toEqual({ min: 1, max: 500 })
    }
  })

  // The question support actually arrives with is not "what is the limit" but
  // "why was THIS person refused".
  it('answers one account’s current count when asked for a uid', async () => {
    asStaff('support')
    const response = await GET(
      request(
        'GET',
        undefined,
        'https://app.aglyn.com/api/admin/free-workspace-cap?uid=uid-9',
      ),
    )
    const body = await response.json()
    expect(mockCount).toHaveBeenCalledWith({ uid: 'uid-9' })
    expect(body.holder).toEqual({
      uid: 'uid-9',
      held: 3,
      orgIds: ['org-a', 'org-b', 'org-c'],
    })
  })

  it('does not go looking when no uid was asked for', async () => {
    asStaff('support')
    const body = await (await GET(request('GET'))).json()
    expect(mockCount).not.toHaveBeenCalled()
    expect(body.holder).toBeUndefined()
  })

  it('carries `ready` through, so the card can say it is a stand-in', async () => {
    storedConfig = { ...storedConfig, ready: false }
    asStaff('support')
    const body = await (await GET(request('GET'))).json()
    expect(body.config.ready).toBe(false)
    // …and it is still the built-in default, never zero and never absent.
    expect(body.config.limit).toBe(3)
  })
})

describe('PUT', () => {
  it('refuses support and billing — setting it is SUPER only', async () => {
    for (const role of ['support', 'billing']) {
      asStaff(role)
      const response = await PUT(request('PUT', { limit: 10 }))
      expect(response.status).toBe(403)
    }
    expect(mockConfigSet).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('stores the number a super staff member typed', async () => {
    asStaff('super')
    const response = await PUT(
      request('PUT', { limit: 8, enabled: true, note: 'agency beta' }),
    )
    expect(response.status).toBe(200)
    const [written] = mockConfigSet.mock.calls[0] as [Record<string, unknown>]
    expect(written).toMatchObject({
      limit: 8,
      enabled: true,
      note: 'agency beta',
      updatedByEmail: 'staff@aglyn.com',
    })
    // The TTL policy on `rateLimits` would DELETE the ceiling if this field
    // ever appeared, and the platform would silently revert to the default.
    expect(Object.keys(written)).not.toContain('expiresAt')
  })

  it('invalidates the cache, so the change takes effect without a deploy', async () => {
    asStaff('super')
    await PUT(request('PUT', { limit: 8 }))
    expect(mockInvalidate).toHaveBeenCalled()
  })

  it('audits the change with a before, an after and the reason', async () => {
    asStaff('super')
    await PUT(request('PUT', { limit: 8, note: 'agency beta' }))
    const [collection, row] = mockAuditAdd.mock.calls[0] as [string, any]
    expect(collection).toBe('adminAudit')
    expect(row).toMatchObject({
      actorUid: 'staff-1',
      action: 'freeWorkspaceCap.update',
      before: { limit: 3, enabled: true },
      after: { limit: 8, enabled: true },
      note: 'agency beta',
    })
  })

  it('REFUSES an out-of-bounds number rather than clamping it', async () => {
    asStaff('super')
    for (const limit of [0, -1, 501]) {
      const response = await PUT(request('PUT', { limit }))
      expect(response.status).toBe(400)
    }
    // Silently storing a different number than the operator typed is how a
    // limit gets believed and is not real.
    expect(mockConfigSet).not.toHaveBeenCalled()
  })

  it('refuses a non-numeric limit', async () => {
    asStaff('super')
    expect((await PUT(request('PUT', { limit: 'lots' }))).status).toBe(400)
  })

  it('can switch the ceiling off entirely', async () => {
    asStaff('super')
    await PUT(request('PUT', { limit: 3, enabled: false }))
    expect(mockConfigSet.mock.calls[0][0]).toMatchObject({ enabled: false })
  })
})
