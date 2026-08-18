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
 * The erase action behind the new staff button (AGL-1977).
 *
 * `POST /api/admin/users/manage {action:'erase'}` has been the only way to
 * reach `eraseUser` since AGL-1140, and it had no spec of its own — the
 * function was covered, the endpoint that fronts it was not. Now that a button
 * points at it, the gates it enforces are what stands between a support-role
 * staffer and an irreversible deletion, so they are asserted here rather than
 * read off the file.
 *
 * The audit row is the load-bearing one. It is the only durable record that an
 * account existed and was deleted on purpose: the uid it names no longer
 * resolves to anything, so if the row is missing there is nothing anywhere
 * saying who ordered the deletion or why.
 */

const mockVerifyIdToken = jest.fn()
const mockEraseUser = jest.fn()
const mockAuditAdd = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => {
  const serverTimestamp = () => 'SERVER_TIMESTAMP'
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          revokeRefreshTokens: async () => undefined,
          tenantManager: () => ({ authForTenant: () => ({}) }),
        }),
        firestore: () => ({
          collection: (name: string) => ({
            // Returns a real promise: the handler chains `.catch()` onto the
            // audit write, and a double that returned undefined would fail
            // for a reason that has nothing to do with what is being tested.
            add: async (row: unknown) => mockAuditAdd(name, row),
            doc: () => ({ set: async () => undefined }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp } },
    },
    eraseUser: (...args: unknown[]) => mockEraseUser(...args),
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
    authForPool: () => ({}),
    findUserByUidAcrossPools: async () => null,
    consumePasswordResetSend: async () => ({ allowed: true }),
    passwordResetThrottleMessage: () => '',
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
  }),
}))

jest.mock('../app/api/_lib/password-admin', () => ({
  __esModule: true,
  originFromHeaders: () => 'https://console.aglyn.com',
  sendAuthPasswordResetEmail: async () => true,
  sendPasswordChangedNotice: async () => true,
  validateNewPassword: () => ({ password: 'x' }),
}))

const { POST } = require('../app/api/admin/users/manage/route')

function manage(body: Record<string, unknown>) {
  return new Request('https://console.aglyn.com/api/admin/users/manage', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** The audit rows the handler wrote, whatever collection it aimed them at. */
const auditRows = () =>
  mockAuditAdd.mock.calls
    .filter(([collection]) => collection === 'adminAudit')
    .map(([, row]) => row as Record<string, any>)

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-super',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  mockEraseUser.mockResolvedValue({
    ok: true,
    deleted: { subcollections: ['orgs'], authRecord: true, photo: true },
  })
})

describe('POST /api/admin/users/manage — erase', () => {
  it('erases and WRITES THE AUDIT ROW with the reason', async () => {
    const response = await POST(
      manage({ action: 'erase', uid: 'victim', reason: 'DSAR-2026-14' }),
    )
    expect(response.status).toBe(200)
    expect(mockEraseUser).toHaveBeenCalledWith('victim')

    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUid: 'staff-super',
      action: 'user.erased',
      target: 'users/victim',
    })
    // The reason is the only thing that will still identify the request: the
    // uid the row names no longer resolves to an account.
    expect(rows[0].after).toMatchObject({ reason: 'DSAR-2026-14' })
  })

  it('refuses a non-staff caller', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'customer',
      email_verified: true,
    })
    const response = await POST(
      manage({ action: 'erase', uid: 'victim', reason: 'why' }),
    )
    expect(response.status).toBe(403)
    expect(mockEraseUser).not.toHaveBeenCalled()
    expect(auditRows()).toEqual([])
  })

  it('refuses a SUPPORT-role staffer — the button is gated the same way', async () => {
    // A UI gate that disagreed with this would render a button that 403s,
    // which teaches an operator the console is broken at the worst moment.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-support',
      email_verified: true,
      staff: true,
      staffRole: 'support',
    })
    const response = await POST(
      manage({ action: 'erase', uid: 'victim', reason: 'why' }),
    )
    expect(response.status).toBe(403)
    expect(mockEraseUser).not.toHaveBeenCalled()
  })

  it('fails CLOSED for a staff token carrying no role at all', async () => {
    // AGL-495: a missing `staffRole` defaults to the least-privileged
    // `support`, never to super. This is the token shape a pre-RBAC staff
    // grant leaves behind.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'legacy-staff',
      email_verified: true,
      staff: true,
    })
    const response = await POST(
      manage({ action: 'erase', uid: 'victim', reason: 'why' }),
    )
    expect(response.status).toBe(403)
    expect(mockEraseUser).not.toHaveBeenCalled()
  })

  it('refuses without a reason, and erases nothing', async () => {
    const response = await POST(manage({ action: 'erase', uid: 'victim' }))
    expect(response.status).toBe(400)
    expect(mockEraseUser).not.toHaveBeenCalled()
    expect(auditRows()).toEqual([])
  })

  it('refuses self-erasure', async () => {
    const response = await POST(
      manage({ action: 'erase', uid: 'staff-super', reason: 'why' }),
    )
    expect(response.status).toBe(400)
    expect(mockEraseUser).not.toHaveBeenCalled()
  })

  it('returns the owns-orgs BLOCKERS so the UI can name the workspaces', async () => {
    // 409 with a list, not a bare refusal: "transfer ownership" is useless
    // advice if you do not know which of eleven workspaces is the problem.
    mockEraseUser.mockResolvedValue({
      ok: false,
      skippedReason: 'owns-orgs',
      blockers: [
        {
          orgId: 'o1',
          orgName: 'Acme',
          hasLiveSubscription: true,
          otherMembers: 3,
        },
      ],
    })
    const response = await POST(
      manage({ action: 'erase', uid: 'victim', reason: 'DSAR-2026-14' }),
    )
    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.skippedReason).toBe('owns-orgs')
    expect(payload.blockers).toEqual([
      { orgId: 'o1', orgName: 'Acme', hasLiveSubscription: true, otherMembers: 3 },
    ])
    // Nothing happened, so nothing is recorded as having happened.
    expect(auditRows()).toEqual([])
  })
})

// Marks this file a MODULE. Without it every top-level `const` here is
// global, and two route specs that both name a `POST` handler collide at
// typecheck time while passing at runtime — a red the test run cannot show.
export {}
