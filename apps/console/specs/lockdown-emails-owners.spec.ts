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
 * Every lock emails the people it locked (AGL-3368).
 *
 *  - Every org, host, domain, user and one-workspace feature lock, and every
 *    lift, sends the owners' notice through `notifyRiskEvent`, with the lock's
 *    own customer-facing message.
 *  - "Email the owners" is on unless staff untick it, and unticking it is a
 *    recorded, verified line — never silence. A notice that did not go is an
 *    UNCONFIRMED line, never a quiet success.
 *  - "Resend owner notice" announces locks that already stand: ONE email per
 *    person listing everything locked for them, idempotent per (lock, person)
 *    unless staff ask to send again.
 *
 * Firestore is an in-memory map, the org lock helper moves the carrier doc,
 * and the notice seam is a double that records what it was asked to send —
 * nothing is emailed.
 */

let mockStore: Record<string, Record<string, unknown>> = {}
const mockDecodedToken: Record<string, unknown> = {}
const mockNotices: Array<Record<string, any>> = []
let mockNoticeFails = false

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

const mockSnapshot = (path: string) => {
  const data = mockStore[path] ? { ...mockStore[path] } : undefined
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const mockFirestore = {
  collection: (collection: string) => ({
    add: async () => ({ id: 'audit' }),
    doc: (id: string) => ({
      get: async () => mockSnapshot(`${collection}/${id}`),
      set: async (data: Record<string, unknown>) => {
        mockStore[`${collection}/${id}`] = data
      },
      delete: async () => {
        delete mockStore[`${collection}/${id}`]
      },
    }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => ({
          docs: Object.keys(mockStore)
            .filter(
              (path) =>
                path.startsWith(`${collection}/`) &&
                path.split('/').length === 2 &&
                mockStore[path][field] === value,
            )
            .map(mockSnapshot),
        }),
      }),
    }),
    limit: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  invalidateTokenRevocationCache: () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  authForPool: () => ({
    updateUser: async () => undefined,
    revokeRefreshTokens: async () => undefined,
  }),
  findUserByUidAcrossPools: async (uid: string) => ({
    tenantId: null,
    record: { uid, email: `${uid}@example.com`, customClaims: {} },
  }),
  // The owner of `org-fraud` is the same person as the locked account.
  listOrgMembers: async (orgId: string) =>
    orgId === 'org-fraud'
      ? [
          { $id: 'user-fraud', role: 'owner', email: 'user-fraud@example.com' },
          { $id: 'admin-2', role: 'admin', email: 'avery@example.com' },
          { $id: 'editor-3', role: 'editor', email: 'sam@example.org' },
        ]
      : [],
  invalidateDomainLockdownCache: () => undefined,
  invalidateFeatureLockdownCache: () => undefined,
  invalidatePlatformLockdownCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
  readSignupsCreationTriggerStatus: async () => ({ status: 'unknown', reason: 'not probed in tests' }),
  notifyRiskEvent: async (input: Record<string, any>) => {
    mockNotices.push(input)
    const recipients = input['recipients']?.length ?? 2
    const skipped = input['emailOwners'] === false
    return {
      noticeId: `notice-${mockNotices.length}`,
      duplicate: false,
      error: mockNoticeFails ? 'provider down' : null,
      owners: {
        recipients,
        inApp: recipients,
        emailed: skipped || mockNoticeFails ? 0 : recipients,
        emailFailed: mockNoticeFails ? recipients : 0,
        emailSkipped: skipped ? 'Staff chose not to email the owners for this event.' : null,
        digested: false,
      },
      staff: { alerted: false, digested: false },
    }
  },
}))

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: { orgId: string; action: string }) => {
    const path = `orgs/${options.orgId}`
    const doc = { ...(mockStore[path] ?? {}) }
    if (options.action === 'lock') doc['suspendedAt'] = 1_790_000_000_000
    else delete doc['suspendedAt']
    mockStore[path] = doc
    return { orgId: options.orgId, action: options.action, membersUpdated: 1, tokensRevoked: 2, downloadTokensRotated: [] }
  },
  applyHostLockdown: async () => ({ revalidated: { ok: true }, downloadTokensRotated: [] }),
}))

const route = require('../app/api/admin/lockdown/route') as {
  POST: (request: Request) => Promise<Response>
}

async function post(body: Record<string, unknown>) {
  const response = await route.POST(
    new Request('https://app.aglyn.com/api/admin/lockdown', {
      method: 'POST',
      headers: { authorization: 'Bearer staff-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as any }
}

beforeEach(() => {
  mockNotices.length = 0
  mockNoticeFails = false
  mockStore = {
    'orgs/org-fraud': { slug: 'fraud-co', name: 'Fraud Co', ownerUid: 'user-fraud' },
  }
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@example.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  delete process.env.STRIPE_SECRET_KEY
})

describe('a lock emails the people it locked', () => {
  it('sends the workspace notice with the lock’s own message, on by default', async () => {
    const { status, body } = await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-fraud',
      reason: 'security',
      message: 'Your workspace is locked while we review recent activity.',
    })
    expect(status).toBe(200)
    expect(mockNotices).toEqual([
      expect.objectContaining({
        kind: 'workspace-locked',
        orgId: 'org-fraud',
        emailOwners: true,
        lock: expect.objectContaining({
          message: 'Your workspace is locked while we review recent activity.',
          affected: expect.stringContaining('everyone was signed out'),
        }),
      }),
    ])
    // Reported as its own verified step beside the lock.
    expect(body.ownerNotice).toMatchObject({ kind: 'workspace-locked', confirmed: true, emailed: 2 })
  })

  it('uses the per-reason notice the lock serves when staff wrote no message', async () => {
    await post({ action: 'lock', scope: 'org', targetId: 'org-fraud', reason: 'security' })
    expect(mockNotices[0]['lock']['message']).toMatch(/security concern/)
  })

  it('records an unticked box as a verified "not sent", never as silence', async () => {
    const { body } = await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-fraud',
      reason: 'manual',
      emailOwners: false,
    })
    expect(mockNotices[0]).toMatchObject({ emailOwners: false })
    expect(body.ownerNotice).toMatchObject({
      confirmed: true,
      emailed: 0,
      skipped: expect.stringMatching(/chose not to email/),
    })
  })

  it('reports a notice that did not go as UNCONFIRMED', async () => {
    mockNoticeFails = true
    const { status, body } = await post({ action: 'lock', scope: 'org', targetId: 'org-fraud', reason: 'security' })
    // The lock itself stands.
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    expect(body.ownerNotice).toMatchObject({ confirmed: false, error: 'provider down' })
  })

  it('sends the "restored" notice on the lift', async () => {
    await post({ action: 'lock', scope: 'org', targetId: 'org-fraud', reason: 'security' })
    mockNotices.length = 0
    await post({ action: 'unlock', scope: 'org', targetId: 'org-fraud' })
    expect(mockNotices).toEqual([expect.objectContaining({ kind: 'workspace-unlocked', orgId: 'org-fraud' })])
  })

  it('writes to a locked account’s own person, and to the workspaces locked with it', async () => {
    const { body } = await post({
      action: 'lock',
      scope: 'user',
      targetId: 'user-fraud',
      reason: 'security',
      lockOwnedWorkspaces: true,
    })
    expect(mockNotices.map((notice) => notice['kind']).sort()).toEqual(['account-locked', 'workspace-locked'])
    expect(mockNotices.find((notice) => notice['kind'] === 'account-locked')).toMatchObject({
      userUid: 'user-fraud',
    })
    expect(body.ownerNotice).toMatchObject({ kind: 'account-locked' })
  })

  it('emails nobody for a platform-wide lock, which names no workspace', async () => {
    const { body } = await post({
      action: 'lock',
      scope: 'platform',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    expect(mockNotices).toEqual([])
    expect(body.ownerNotice).toBeUndefined()
  })
})

describe('resend owner notice', () => {
  beforeEach(() => {
    mockStore['orgs/org-fraud'] = { ...mockStore['orgs/org-fraud'], suspendedAt: 1_790_000_000_000, suspendedReasonCode: 'security' }
    mockStore['lockdowns/user--user-fraud'] = { scope: 'user', reason: 'security', atMs: 1_790_000_000_500 }
  })

  const resend = (extra: Record<string, unknown> = {}) =>
    post({
      action: 'resend-notice',
      targets: [
        { scope: 'user', targetId: 'user-fraud' },
        { scope: 'org', targetId: 'org-fraud' },
      ],
      ...extra,
    })

  it('sends each person ONE email listing everything locked for them', async () => {
    const { status, body } = await resend()
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    // The account's person is also the workspace's owner: one email, both locks.
    const person = body.recipients.find((entry: any) => entry.email === 'user-fraud@example.com')
    expect(person).toMatchObject({ outcome: 'sent' })
    expect(person.sentLockKeys).toHaveLength(2)
    const admin = body.recipients.find((entry: any) => entry.email === 'avery@example.com')
    expect(admin.sentLockKeys).toHaveLength(1)
    // An editor is not an owner or admin.
    expect(body.recipients.some((entry: any) => entry.email === 'sam@example.org')).toBe(false)
    expect(mockNotices).toHaveLength(2)
    const toPerson = mockNotices.find((notice) => notice['recipients'][0].email === 'user-fraud@example.com')
    expect(toPerson).toMatchObject({ kind: 'account-locked' })
    expect(toPerson?.['item']['label']).toBe('your account and your workspace')
  })

  it('is idempotent per lock and person, unless staff send again', async () => {
    await resend()
    mockNotices.length = 0
    const second = await resend()
    expect(mockNotices).toEqual([])
    expect(second.body.recipients.every((entry: any) => entry.outcome === 'already-sent')).toBe(true)
    expect(second.body.recipients[0].alreadySentAtMs).toEqual(expect.any(Number))
    expect(second.body.confirmed).toBe(true)

    const again = await resend({ sendAgain: true })
    expect(mockNotices).toHaveLength(2)
    expect(again.body.recipients.every((entry: any) => entry.outcome === 'sent')).toBe(true)
  })

  it('announces a relock afresh: a new lock is a new key', async () => {
    await resend()
    mockNotices.length = 0
    mockStore['lockdowns/user--user-fraud'] = { scope: 'user', reason: 'security', atMs: 1_790_000_999_999 }
    await resend()
    expect(mockNotices).toHaveLength(1)
    expect(mockNotices[0]['recipients'][0].email).toBe('user-fraud@example.com')
  })

  it('reports a target that is not locked, and sends it nothing', async () => {
    delete mockStore['lockdowns/user--user-fraud']
    const { body } = await post({ action: 'resend-notice', targets: [{ scope: 'user', targetId: 'user-fraud' }] })
    expect(body.targets[0]).toMatchObject({ locked: false, error: expect.stringMatching(/Not locked/) })
    expect(body.confirmed).toBe(false)
    expect(mockNotices).toEqual([])
  })

  it('is for the super role only', async () => {
    mockDecodedToken['staffRole'] = 'support'
    const { status } = await resend()
    expect(status).toBe(403)
    mockDecodedToken['staffRole'] = 'super'
  })
})

// A module, so its doubles do not collide with other specs in the type program.
export {}
