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
 * The automatic security hold, placed (AGL-3450).
 *
 * The page screen records `securityHolds/{orgId}`; the console places it
 * through the staff lockdown cores. What matters:
 *
 *  - three locks, `security` and never `abuse`, the site's as a takedown;
 *  - every lock writes an `adminAudit` row naming the system actor, with a
 *    note that names the screen, the version, the signal and the abuse row;
 *  - the owners get the standard lock notice, staff get one urgent alert;
 *  - idempotent: a placed hold is never placed again;
 *  - never the house, a staff-owned workspace or a staff account, and never a
 *    `createdBy` that is not a member of the workspace.
 *
 * The org and host cores are the same stand-ins the lockdown route specs use;
 * the user core is real, over a recorded auth pool.
 */

let mockStore: Record<string, Record<string, any>> = {}
let mockAuditRows: Array<Record<string, any>> = []
const mockNotices: Array<Record<string, any>> = []
const mockAlerts: Array<{ type: string; options: Record<string, any> }> = []
const mockAuthCalls: string[] = []
const mockOrgLocks: Array<Record<string, any>> = []
const mockHostLocks: Array<Record<string, any>> = []
const mockMail: Array<Record<string, any>> = []
const mockStaffUids = new Set<string>()

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

const mockDoc = (path: string): any => ({
  path,
  get: async () => mockSnapshot(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = options?.merge ? { ...(mockStore[path] ?? {}), ...data } : { ...data }
  },
  delete: async () => {
    delete mockStore[path]
  },
  collection: (name: string) => mockCollection(`${path}/${name}`),
})

const mockCollection = (path: string): any => ({
  doc: (id: string) => mockDoc(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (path === 'adminAudit') mockAuditRows.push(data)
    return { id: `row-${mockAuditRows.length}` }
  },
  where: (field: string, op: string, value: unknown) => ({
    limit: () => ({
      get: async () => ({
        docs: Object.keys(mockStore)
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              key.split('/').length === path.split('/').length + 1 &&
              (op === 'in'
                ? (value as unknown[]).includes(mockStore[key][field])
                : mockStore[key][field] === value),
          )
          .map(mockSnapshot),
      }),
    }),
  }),
})

const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
    work({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, any>, options?: { merge?: boolean }) => {
        mockStore[ref.path] = options?.merge ? { ...(mockStore[ref.path] ?? {}), ...data } : { ...data }
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  authForPool: (tenantId: string | null | undefined) => ({
    updateUser: async (uid: string, change: Record<string, unknown>) => {
      mockAuthCalls.push(`${tenantId ?? 'PROJECT'}:updateUser:${uid}:${JSON.stringify(change)}`)
    },
    revokeRefreshTokens: async (uid: string) => {
      mockAuthCalls.push(`${tenantId ?? 'PROJECT'}:revokeRefreshTokens:${uid}`)
    },
  }),
  invalidateTokenRevocationCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
  findUserByUidAcrossPools: async (uid: string) =>
    uid === 'ghost'
      ? null
      : {
          tenantId: null,
          record: {
            uid,
            email: `${uid}@example.com`,
            customClaims: mockStaffUids.has(uid) ? { staff: true } : {},
          },
        },
  notifyRiskEvent: async () => ({ owners: { recipients: 1, emailed: 1, emailFailed: 0, emailSkipped: null }, error: null }),
  raiseOperatorAlert: async (type: string, options: Record<string, any>) => {
    mockAlerts.push({ type, options })
    return { outcome: 'delivered', type }
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/account-lock-mail', () => ({
  __esModule: true,
  applyAccountLockToMail: async (input: Record<string, any>) => {
    mockMail.push({ uid: input['uid'], ban: input['ban'] })
    return { addresses: 1, incomplete: false, banRows: 0, houseSites: 1, houseRows: 1, failed: 0 }
  },
}))

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: Record<string, any>) => {
    mockOrgLocks.push(options)
    mockStore[`orgs/${options['orgId']}`] = { ...mockStore[`orgs/${options['orgId']}`], suspendedAt: 1 }
    return { orgId: options['orgId'], action: 'lock', membersUpdated: 1, tokensRevoked: 1, downloadTokensRotated: [] }
  },
  applyHostLockdown: async (options: Record<string, any>) => {
    mockHostLocks.push(options)
    mockStore[`hosts/${options['hostId']}`] = { ...mockStore[`hosts/${options['hostId']}`], suspendedAt: 1 }
    return { hostId: options['hostId'], action: 'lock', revalidated: { ok: true }, downloadTokensRotated: [] }
  },
}))

jest.mock('../utils/server/lockdown-owner-notice', () => ({
  __esModule: true,
  lockdownNoticeReference: (scope: string, targetId: string) => `LK-${scope}-${targetId}`,
  sendLockdownOwnerNotice: async (input: Record<string, any>) => {
    mockNotices.push(input)
    return { attempted: true, confirmed: true, scope: input['scope'], targetId: input['targetId'] }
  },
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-org-lockdown', () => ({
  __esModule: true,
  runOrgLockdownParticipants: async () => [],
}))

import { applyPendingSecurityHolds } from '../utils/server/page-security-hold'

const HOLD = {
  orgId: 'org-new',
  hostId: 'host-new',
  screenId: 'screen-1',
  versionId: 'v1',
  reviewId: 'review-1',
  reference: 'HS-REVIEW1',
  signals: [{ code: 'credential-field', field: 'password', label: 'Password' }],
  ageDays: 2,
  pageLabel: 'the page "Secure Document Access Portal"',
  pageUrl: 'https://review.aglyn.app/reviewfile',
  siteName: 'Review',
  evidence: 'Asks for a password in its own field.',
  state: 'pending',
  requestedAtMs: 1,
  claimedAtMs: null,
  settledAtMs: null,
  outcome: null,
}

beforeEach(() => {
  mockAuditRows = []
  mockNotices.length = 0
  mockAlerts.length = 0
  mockAuthCalls.length = 0
  mockOrgLocks.length = 0
  mockHostLocks.length = 0
  mockMail.length = 0
  mockStaffUids.clear()
  delete process.env['PLATFORM_MARKETING_HOST_ID']
  mockStore = {
    'securityHolds/org-new': { ...HOLD },
    'orgs/org-new': { name: 'Review', ownerUid: 'owner-1', hosts: { 'host-new': true } },
    'orgs/org-new/members/owner-1': { role: 'owner' },
    'orgs/org-new/members/editor-2': { role: 'editor' },
    'hosts/host-new': { name: 'Review' },
    'hosts/host-new/screens/screen-1': { createdBy: 'owner-1' },
    'hosts/host-new/screens/screen-1/versions/v1': { createdBy: 'editor-2' },
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('an automatic security hold', () => {
  it('locks the workspace, the site (as a takedown) and the publishing account as security, never abuse', async () => {
    const sweep = await applyPendingSecurityHolds(mockFirestore)
    expect(sweep).toMatchObject({ pending: 1, applied: 1, skipped: 0, failed: 0 })

    expect(mockOrgLocks).toEqual([
      expect.objectContaining({ orgId: 'org-new', action: 'lock', lock: { reason: 'security', mode: 'full' }, revokeMemberTokens: true }),
    ])
    expect(mockHostLocks).toEqual([
      expect.objectContaining({
        hostId: 'host-new',
        action: 'lock',
        lock: { reason: 'security', mode: 'full', enforcement: 'takedown' },
      }),
    ])
    // The version's author, a member of the workspace, is the publisher.
    expect(mockStore['lockdowns/user--editor-2']).toMatchObject({
      scope: 'user',
      reason: 'security',
      actorUid: 'system:page-screen',
    })
    expect(mockAuthCalls).toEqual([
      'PROJECT:updateUser:editor-2:{"disabled":true}',
      'PROJECT:revokeRefreshTokens:editor-2',
    ])
    for (const lock of [...mockOrgLocks, ...mockHostLocks]) {
      expect(lock['lock'].reason).not.toBe('abuse')
    }
    // Not a ban: the account's addresses leave the house lists only.
    expect(mockMail).toEqual([{ uid: 'editor-2', ban: false }])
    expect(mockStore['securityHolds/org-new']).toMatchObject({ state: 'applied' })
  })

  it('writes an adminAudit row for every lock, naming the system actor, the screen, the version, the signal and the abuse row', async () => {
    await applyPendingSecurityHolds(mockFirestore)
    expect(mockAuditRows.map((row) => `${row['scope']}:${row['target']}`)).toEqual([
      'org:orgs/org-new',
      'host:hosts/host-new',
      'user:users/editor-2',
    ])
    for (const row of mockAuditRows) {
      expect(row).toMatchObject({
        actorUid: 'system:page-screen',
        actorEmail: null,
        action: 'lockdown.lock',
        before: { locked: false },
        after: { locked: true, reason: 'security', automated: true, reviewId: 'review-1' },
      })
      expect(row['note']).toContain('screen screen-1')
      expect(row['note']).toContain('version v1')
      expect(row['note']).toContain('credential-field')
      expect(row['note']).toContain('review-1')
      expect(row['note']).toContain('HS-REVIEW1')
    }
    expect(mockAuditRows[1]['after']).toMatchObject({ enforcement: 'takedown' })
  })

  it('tells the owners through the standard lock notice and staff through one urgent alert', async () => {
    await applyPendingSecurityHolds(mockFirestore)
    expect(mockNotices.map((notice) => [notice['scope'], notice['emailOwners']])).toEqual([
      ['org', true],
      // The workspace notice already says the sites are down.
      ['host', false],
      ['user', true],
    ])
    expect(mockAlerts).toHaveLength(1)
    expect(mockAlerts[0]).toMatchObject({
      type: 'security.pageSecurityHold',
      options: {
        dedupeKey: 'org-new',
        context: {
          orgName: 'Review',
          reviewId: 'review-1',
          reference: 'HS-REVIEW1',
          signal: 'Asks for a password in its own field.',
        },
      },
    })
    expect(mockAlerts[0].options['context']['locks']).toContain('the site (host-new, takedown)')
    expect(mockStore['abuseReports/review-1']).toMatchObject({
      securityHold: { orgId: 'org-new', hostId: 'host-new', uid: 'editor-2' },
    })
  })

  it('is placed once: a second sweep, or a second held page, locks, mails and alerts nothing more', async () => {
    await applyPendingSecurityHolds(mockFirestore)
    const audits = mockAuditRows.length
    const again = await applyPendingSecurityHolds(mockFirestore)
    expect(again).toMatchObject({ pending: 0, applied: 0 })
    expect(mockAuditRows).toHaveLength(audits)
    expect(mockAlerts).toHaveLength(1)
    expect(mockOrgLocks).toHaveLength(1)
  })

  it('leaves a target already locked exactly as it was set', async () => {
    mockStore['orgs/org-new'] = { ...mockStore['orgs/org-new'], suspendedAt: 5, suspendedReasonCode: 'abuse' }
    mockStore['lockdowns/user--editor-2'] = { scope: 'user', reason: 'abuse' }
    const sweep = await applyPendingSecurityHolds(mockFirestore)
    expect(mockOrgLocks).toEqual([])
    expect(mockStore['lockdowns/user--editor-2']).toEqual({ scope: 'user', reason: 'abuse' })
    expect(sweep.holds[0].locks.map((step) => `${step.scope}:${step.outcome}`)).toEqual([
      'org:already-locked',
      'host:locked',
      'user:already-locked',
    ])
  })

  it('never holds the house workspace', async () => {
    process.env['PLATFORM_MARKETING_HOST_ID'] = 'host-new'
    const sweep = await applyPendingSecurityHolds(mockFirestore)
    expect(sweep).toMatchObject({ applied: 0, skipped: 1 })
    expect(mockOrgLocks).toEqual([])
    expect(mockAuditRows).toEqual([])
    expect(mockStore['securityHolds/org-new']).toMatchObject({ state: 'skipped' })
  })

  it('never holds a workspace a staff account owns, and never locks a staff account', async () => {
    mockStaffUids.add('owner-1')
    const sweep = await applyPendingSecurityHolds(mockFirestore)
    expect(sweep).toMatchObject({ applied: 0, skipped: 1 })
    expect(mockOrgLocks).toEqual([])

    mockStaffUids.clear()
    mockStaffUids.add('editor-2')
    mockStore['securityHolds/org-new'] = { ...HOLD }
    await applyPendingSecurityHolds(mockFirestore)
    expect(mockStore['lockdowns/user--editor-2']).toBeUndefined()
    expect(mockAuthCalls).toEqual([])
  })

  it('never locks a createdBy that is not a member of the workspace — it falls back to the owner', async () => {
    mockStore['hosts/host-new/screens/screen-1/versions/v1'] = { createdBy: 'stranger' }
    mockStore['hosts/host-new/screens/screen-1'] = { createdBy: 'stranger' }
    await applyPendingSecurityHolds(mockFirestore)
    expect(mockStore['lockdowns/user--stranger']).toBeUndefined()
    expect(mockStore['lockdowns/user--owner-1']).toMatchObject({ reason: 'security' })
  })

  it('leaves a hold another run is placing to that run', async () => {
    mockStore['securityHolds/org-new'] = { ...HOLD, state: 'applying', claimedAtMs: Date.now() }
    const sweep = await applyPendingSecurityHolds(mockFirestore)
    expect(sweep).toMatchObject({ pending: 1, applied: 0 })
    expect(mockOrgLocks).toEqual([])
  })
})
