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
 * The WRITE side of read-only mode (AGL-1511): /api/admin/lockdown driven
 * in-process, asserting what the staff button actually persists.
 *
 * Four things this pins, each of which is a way the mode could ship looking
 * correct and behaving as a full lockdown:
 *
 *  1. `mode: 'read-only'` reaches the carrier — and a FULL lock still writes
 *     no `mode` key at all, so every document written before this field
 *     existed stays byte-identical and no migration is implied.
 *  2. A read-only ORG lock NEVER revokes member sessions. Revocation is a
 *     full lockdown's effect; delivering "you can keep reading" by signing
 *     everyone out would be the feature failing at its one job.
 *  3. `user` and `feature` scope REFUSE read-only rather than silently
 *     downgrading it — an operator who asked for the gentle lock and got the
 *     hard one is the exact accident this refusal exists to prevent.
 *  4. The audit row carries the mode on both sides, never null: "staff froze
 *     writes" and "staff took the workspace down" are different actions.
 */

import { PLATFORM_LOCKDOWN_DOC_ID } from '@aglyn/aglyn/server'

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, unknown>[] = []
let mockOrgCalls: Record<string, unknown>[] = []
const mockDecodedToken: Record<string, unknown> = {}

const mockServerTimestamp = Symbol('serverTimestamp')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => mockServerTimestamp },
}))

const mockDocHandle = (path: string) => ({
  get: async () => {
    const data = mockStore[path] ? { ...mockStore[path] } : undefined
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (data: Record<string, unknown>) => {
    mockStore[path] = data
  },
  delete: async () => {
    delete mockStore[path]
  },
})

const mockFirestore = {
  collection: (collection: string) => ({
    add: async (data: Record<string, unknown>) => {
      if (collection !== 'adminAudit') {
        throw new Error(`unexpected add: ${collection}`)
      }
      mockAuditRows.push(data)
      return { id: `audit-${mockAuditRows.length}` }
    },
    doc: (id: string) => mockDocHandle(`${collection}/${id}`),
    limit: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  authForPool: () => ({
    updateUser: async () => undefined,
    revokeRefreshTokens: async () => undefined,
  }),
  findUserByUidAcrossPools: async (uid: string) => ({
    tenantId: null,
    record: { uid, customClaims: {} },
  }),
  getLockdownVerdict: async () => null,
  featureLockdownRefusal: async () => null,
  lockdownJsonResponse: () => Response.json({}, { status: 423 }),
  invalidateFeatureLockdownCache: () => undefined,
  invalidatePlatformLockdownCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
}))

/**
 * The org/host appliers, standing in for the real four-effect helpers but
 * RECORDING their options — `mode` and `revokeMemberTokens` are the two
 * arguments this spec is about, and a mock that swallowed them would let the
 * route drop either without a failure.
 */
jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: Record<string, unknown>) => {
    mockOrgCalls.push(options)
    const path = `orgs/${options['orgId']}`
    const doc = { ...(mockStore[path] ?? {}) }
    if (options['action'] === 'lock') {
      doc['suspendedAt'] = Date.now()
      const lock = options['lock'] as { mode?: string } | undefined
      if (lock?.mode === 'read-only') doc['suspendedMode'] = 'read-only'
      else delete doc['suspendedMode']
    } else {
      delete doc['suspendedAt']
      delete doc['suspendedMode']
    }
    mockStore[path] = doc
    return {
      orgId: options['orgId'],
      action: options['action'],
      membersUpdated: 1,
      tokensRevoked: options['revokeMemberTokens'] ? 1 : 0,
      revokeTruncated: false,
      revalidated: [],
    }
  },
  applyHostLockdown: async (options: Record<string, unknown>) => {
    mockOrgCalls.push(options)
    const path = `hosts/${options['hostId']}`
    const doc = { ...(mockStore[path] ?? {}) }
    if (options['action'] === 'lock') {
      doc['suspendedAt'] = Date.now()
      const lock = options['lock'] as { mode?: string } | undefined
      if (lock?.mode === 'read-only') doc['suspendedMode'] = 'read-only'
    } else {
      delete doc['suspendedAt']
      delete doc['suspendedMode']
    }
    mockStore[path] = doc
    return { hostId: options['hostId'], action: options['action'], revalidated: { ok: true, reason: 'ok' } }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/lockdown/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

async function post(body: Record<string, unknown>): Promise<Response> {
  return route.POST(
    new Request('https://app.aglyn.com/api/admin/lockdown', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

const onlyRow = () => {
  expect(mockAuditRows).toHaveLength(1)
  return mockAuditRows[0]
}

beforeEach(() => {
  mockStore = {}
  mockAuditRows = []
  mockOrgCalls = []
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-1511 · arming a read-only lock', () => {
  it('writes mode on the platform doc for read-only, and NOTHING for full', async () => {
    const readOnly = await post({
      action: 'lock',
      scope: 'platform',
      mode: 'read-only',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    expect(readOnly.status).toBe(200)
    const doc = mockStore[`lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`]
    expect(doc['mode']).toBe('read-only')
    // The read-back the route answers with reports it too (AGL-1571), so an
    // operator is told which lock actually landed rather than assuming.
    expect((await readOnly.json()).verified.mode).toBe('read-only')

    mockStore = {}
    await post({
      action: 'lock',
      scope: 'platform',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    // No key at all — identical to every lock written before AGL-1511.
    expect(
      'mode' in mockStore[`lockdowns/${PLATFORM_LOCKDOWN_DOC_ID}`],
    ).toBe(false)
  })

  it('NEVER revokes member sessions for a read-only org lock', async () => {
    mockStore['orgs/org-1'] = { name: 'Acme' }
    // `security` is the reason that DOES revoke on a full lock — so this
    // asserts the mode overrides it, not that the reason happened to be mild.
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-1',
      mode: 'read-only',
      reason: 'security',
    })
    expect(mockOrgCalls[0]['revokeMemberTokens']).toBe(false)
    expect((mockOrgCalls[0]['lock'] as { mode?: string }).mode).toBe('read-only')

    mockOrgCalls = []
    mockAuditRows = []
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-1',
      reason: 'security',
    })
    expect(mockOrgCalls[0]['revokeMemberTokens']).toBe(true)
  })

  it('carries the mode to the host applier too', async () => {
    mockStore['hosts/host-1'] = { subdomain: 'acme' }
    await post({
      action: 'lock',
      scope: 'host',
      targetId: 'host-1',
      mode: 'read-only',
      reason: 'maintenance',
    })
    expect((mockOrgCalls[0]['lock'] as { mode?: string }).mode).toBe('read-only')
    expect(mockStore['hosts/host-1']['suspendedMode']).toBe('read-only')
  })

  it('refuses read-only where it would be a lie, naming the alternative', async () => {
    for (const scope of ['user', 'feature']) {
      const response = await post({
        action: 'lock',
        scope,
        targetId: scope === 'feature' ? 'checkout' : 'user-1',
        mode: 'read-only',
        reason: 'security',
      })
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('all-or-nothing')
      // Refused BEFORE anything was written or audited.
      expect(mockAuditRows).toHaveLength(0)
      expect(mockStore).toEqual({})
    }
  })

  it('rejects an unrecognised mode rather than defaulting it away', async () => {
    const response = await post({
      action: 'lock',
      scope: 'platform',
      mode: 'kind-of',
      reason: 'maintenance',
      confirm: 'LOCK PLATFORM',
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('mode must be one of')
  })

  it('records the mode on BOTH sides of the audit row, never null', async () => {
    mockStore['orgs/org-1'] = { name: 'Acme' }
    await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-1',
      mode: 'read-only',
      reason: 'maintenance',
    })
    const locked = onlyRow()
    expect((locked['before'] as Record<string, unknown>)['mode']).toBe('full')
    expect((locked['after'] as Record<string, unknown>)['mode']).toBe('read-only')

    mockAuditRows = []
    await post({ action: 'unlock', scope: 'org', targetId: 'org-1' })
    // The lift's `before` is what says the operator released a WRITE FREEZE
    // rather than a takedown — the question the trail gets asked later.
    expect((onlyRow()['before'] as Record<string, unknown>)['mode']).toBe(
      'read-only',
    )
  })
})
