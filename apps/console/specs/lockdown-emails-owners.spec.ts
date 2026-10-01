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
/** Notices and mail-list writes, in the order the route made them. */
const mockOrder: string[] = []
const mockMailLists: Array<Record<string, any>> = []

// What the lock writes onto the suppression lists (AGL-3420), recorded.
jest.mock('@aglyn/tenant-data-admin/server/account-lock-mail', () => ({
  __esModule: true,
  applyAccountLockToMail: async (input: Record<string, any>) => {
    mockOrder.push(`apply:${input['ban'] ? 'ban' : 'lock'}`)
    mockMailLists.push({ fn: 'apply', uid: input['uid'], ban: input['ban'] })
    return { addresses: 1, incomplete: false, banRows: input['ban'] ? 1 : 0, houseSites: 1, houseRows: 1, failed: 0 }
  },
  liftAccountLockFromMail: async (input: Record<string, any>) => {
    mockOrder.push('lift')
    mockMailLists.push({ fn: 'lift', uid: input['uid'] })
    return { addresses: 1, incomplete: false, banRows: 1, houseSites: 1, houseRows: 1, failed: 0 }
  },
}))

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
    mockOrder.push(`notice:${input['kind']}`)
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
  mockOrder.length = 0
  mockMailLists.length = 0
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

  /*
   * A feature pause is a staff decision that holds until it is lifted, so
   * the member-facing "please try again shortly" is not what its owners are
   * told; nor is the pause written as "Media uploads is paused" (AGL-3432).
   */
  it('tells the owners what a feature pause stops, and that it holds until it is lifted', async () => {
    await post({ action: 'lock', scope: 'feature', targetId: 'checkout', orgId: 'org-fraud', reason: 'manual' })
    expect(mockNotices).toEqual([
      expect.objectContaining({
        kind: 'feature-locked',
        orgId: 'org-fraud',
        // The customer's name for the lever, never the checklist label
        // "Checkout (new subscriptions)" (AGL-3442).
        item: expect.objectContaining({ label: 'new purchases' }),
        lock: expect.objectContaining({
          message: 'Checkout is temporarily unavailable.',
          affected: 'The pause holds until our team lifts it.',
        }),
      }),
    ])
    expect(mockNotices[0]['lock']['message']).not.toMatch(/try again/i)
  })

  /*
   * The staff org page's AI pause is two levers and one staff action, so it
   * is one request and one email (AGL-3442): each lever is still written
   * and audited on its own.
   */
  it('sends ONE notice for a pause of several levers, naming each by its customer name', async () => {
    const { status, body } = await post({
      action: 'lock',
      scope: 'feature',
      targetIds: ['ai-assist', 'ai-generate'],
      orgId: 'org-fraud',
      reason: 'billing',
    })
    expect(status).toBe(200)
    expect(Object.keys(mockStore).filter((path) => path.startsWith('lockdowns/')).sort()).toEqual([
      'lockdowns/feature--ai-assist--org--org-fraud',
      'lockdowns/feature--ai-generate--org--org-fraud',
    ])
    expect(body).toMatchObject({ confirmed: true, features: ['ai-assist', 'ai-generate'] })
    expect(body.verifiedTargets.map((state: any) => [state.targetId, state.locked])).toEqual([
      ['ai-assist', true],
      ['ai-generate', true],
    ])
    expect(mockNotices).toEqual([
      expect.objectContaining({
        kind: 'feature-locked',
        orgId: 'org-fraud',
        item: expect.objectContaining({ label: 'AI assist and AI generation' }),
        lock: expect.objectContaining({
          message: 'AI assist is temporarily unavailable. AI generation is temporarily unavailable.',
          affected: 'The pause holds until our team lifts it.',
        }),
      }),
    ])
    expect(body.ownerNotice).toMatchObject({ kind: 'feature-locked', confirmed: true })

    // The lift is one request and one "back on" email too.
    mockNotices.length = 0
    const lifted = await post({
      action: 'unlock',
      scope: 'feature',
      targetIds: ['ai-assist', 'ai-generate'],
      orgId: 'org-fraud',
    })
    expect(lifted.body.confirmed).toBe(true)
    expect(Object.keys(mockStore).filter((path) => path.startsWith('lockdowns/'))).toEqual([])
    expect(mockNotices).toEqual([
      expect.objectContaining({
        kind: 'feature-unlocked',
        item: expect.objectContaining({ label: 'AI assist and AI generation' }),
        lock: expect.objectContaining({ affected: 'Everything the pause stopped works again.' }),
      }),
    ])
  })

  it('says a feature pause with an end ends on its own, rather than that it holds until lifted', async () => {
    const untilMs = Date.now() + 3_600_000
    await post({ action: 'lock', scope: 'feature', targetId: 'uploads', orgId: 'org-fraud', reason: 'manual', untilMs })
    expect(mockNotices[0]['lock']['affected']).toBe(
      `The pause ends on its own at ${new Date(untilMs).toUTCString()}, or sooner if our team lifts it.`,
    )
  })

  it('refuses a pause naming any lever nothing declared, and writes none of them', async () => {
    const { status } = await post({
      action: 'lock',
      scope: 'feature',
      targetIds: ['ai-assist', 'everything'],
      orgId: 'org-fraud',
      reason: 'billing',
    })
    expect(status).toBe(400)
    expect(Object.keys(mockStore).filter((path) => path.startsWith('lockdowns/'))).toEqual([])
    expect(mockNotices).toEqual([])
  })

  it('keeps a feature pause’s own message when staff wrote one', async () => {
    await post({
      action: 'lock',
      scope: 'feature',
      targetId: 'uploads',
      orgId: 'org-fraud',
      reason: 'manual',
      message: 'Uploads are off while we look at your storage use.',
    })
    expect(mockNotices[0]['lock']['message']).toBe('Uploads are off while we look at your storage use.')
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

  it('bans on an abuse lock — onto the lists only after every notice has gone (AGL-3420)', async () => {
    const { body } = await post({
      action: 'lock',
      scope: 'user',
      targetId: 'user-fraud',
      reason: 'abuse',
      lockOwnedWorkspaces: true,
    })
    expect(mockOrder[mockOrder.length - 1]).toBe('apply:ban')
    expect(mockOrder.filter((step) => step.startsWith('notice:')).sort()).toEqual([
      'notice:account-locked',
      'notice:workspace-locked',
    ])
    expect(body.mailLists).toMatchObject({ outcome: 'banned', banRows: 1 })
  })

  it('suppresses a non-ban lock on the house sites only, and lifts it before the "restored" notice', async () => {
    await post({ action: 'lock', scope: 'user', targetId: 'user-fraud', reason: 'billing' })
    expect(mockMailLists).toEqual([{ fn: 'apply', uid: 'user-fraud', ban: false }])
    mockOrder.length = 0
    const { body } = await post({ action: 'unlock', scope: 'user', targetId: 'user-fraud' })
    expect(mockOrder).toEqual(['lift', 'notice:account-unlocked'])
    expect(body.mailLists).toMatchObject({ outcome: 'lifted' })
  })

  it('quotes one reference an appeal can name, on the notice and on every resend (AGL-3420)', async () => {
    const { body } = await post({ action: 'lock', scope: 'user', targetId: 'user-fraud', reason: 'abuse' })
    const reference = mockNotices.find((notice) => notice['kind'] === 'account-locked')?.['reference']
    expect(reference).toMatch(/^LK-[0-9A-F]{10}$/)
    expect(body.ownerNotice).toMatchObject({ reference })
    mockNotices.length = 0
    await post({ action: 'resend-notice', targets: [{ scope: 'user', targetId: 'user-fraud' }] })
    expect(mockNotices.map((notice) => notice['reference'])).toContain(reference)
  })

  it('lifts the ban when a ban is re-placed under a milder reason', async () => {
    await post({ action: 'lock', scope: 'user', targetId: 'user-fraud', reason: 'abuse' })
    mockMailLists.length = 0
    await post({ action: 'lock', scope: 'user', targetId: 'user-fraud', reason: 'security' })
    expect(mockMailLists).toEqual([
      { fn: 'lift', uid: 'user-fraud' },
      { fn: 'apply', uid: 'user-fraud', ban: false },
    ])
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
    // Each lock by name (AGL-3432): the workspace is not "your workspace".
    expect(toPerson?.['item']['label']).toBe('your account and the workspace "Fraud Co"')
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

describe('what a lock or lift says it did (AGL-3432)', () => {
  const { lockdownAffectedText } = require('../utils/server/lockdown-owner-notice') as {
    lockdownAffectedText: (input: Record<string, unknown>) => string
  }

  it('never says everything is back as it was, and names a canceled subscription only as a condition', () => {
    const lifted = lockdownAffectedText({ action: 'unlock', scope: 'org' })
    expect(lifted).not.toMatch(/back as it was/)
    expect(lifted).toContain('if the lock canceled your subscription, it stays canceled')
  })

  it('never tells a lifted site to sign in again: a site lock signs nobody out', () => {
    const lifted = lockdownAffectedText({ action: 'unlock', scope: 'host' })
    expect(lifted).toBe('The site works as normal again, and it can be changed.')
    expect(lifted).not.toMatch(/sign in/)
  })

  it('reports the sign-out a lock actually made, not one it did not', () => {
    expect(lockdownAffectedText({ action: 'lock', scope: 'org', effects: { sessionsRevoked: false } })).not.toMatch(
      /signed out/,
    )
    expect(lockdownAffectedText({ action: 'lock', scope: 'org', effects: { sessionsRevoked: true } })).toMatch(
      /everyone was signed out/,
    )
  })
})
