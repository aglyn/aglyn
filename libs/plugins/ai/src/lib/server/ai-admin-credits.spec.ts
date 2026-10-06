/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * `/api/ai/admin/credits` (AGL-3595): staff give AI credits back. Pinned:
 * the gate (staff claim, then the billing or super role), the reason, the
 * bound (never more than the month used), the key (a repeat returns
 * nothing), and the one audit row per act, committed in the same
 * transaction as the give-back.
 */

let mockDocs = new Map<string, Record<string, unknown>>()
const mockVerifyIdToken = jest.fn()
const mockAuditRows: Array<Record<string, unknown>> = []
let mockAutoId = 0

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  !('__inc' in (value as object))

function mockApply(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') base[key] = Number(base[key] ?? 0) + inc
    else if (isPlainMap(value)) {
      base[key] = mockApply(isPlainMap(base[key]) ? base[key] : undefined, value, true)
    } else base[key] = value
  }
  return base
}

const mockSnapshot = (path: string) => ({
  exists: mockDocs.has(path),
  data: () => mockDocs.get(path),
  get: (field: string) => (mockDocs.get(path) ?? {})[field],
})

const mockFirestore: any = (() => {
  const doc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
  })
  const collection = (prefix: string): any => ({
    doc: (id?: string) => doc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
  })
  return {
    collection,
    runTransaction: async <T,>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const queued: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => mockSnapshot(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          queued.push(() =>
            mockDocs.set(ref.path, mockApply(mockDocs.get(ref.path), data, Boolean(options?.merge))),
          )
        },
      }
      const result = await fn(tx)
      for (const write of queued) write()
      return result
    },
  }
})()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
}))

// The audit row goes through the writer the rest of the console uses, inside
// the give-back's own transaction: captured here, and queued on that
// transaction so a give-back that commits nothing commits no row either.
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  setAdminAudit: (
    writer: { set: (ref: unknown, data: Record<string, unknown>) => void },
    firestore: any,
    entry: Record<string, unknown>,
  ) => {
    const ref = firestore.collection('adminAudit').doc()
    writer.set(ref, entry)
    mockAuditRows.push(entry)
    return ref
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/staff-alert-email', () => ({
  __esModule: true,
  sendStaffAlertEmail: async () => ({ sent: true }),
}))

jest.mock('../usage/assist-usage', () => ({
  __esModule: true,
  assistUsageMonth: () => '2026-10',
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ORG_BILLING_SUBCOLLECTION: 'billing',
  ORG_BILLING_DOC_ID: 'stripe',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: request.method === 'POST' ? await request.json() : undefined,
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from './ai-admin-credits'

const ORG = 'IuH0x_G1kT'
const ORG_MONTH = `orgs/${ORG}/assistUsage/2026-10`
const ACCOUNT_MONTH = 'users/owner-1/aiUsage/2026-10'

const post = (body: Record<string, unknown>, token: string | null = 'tok') =>
  POST(
    new Request('https://app.aglyn.com/api/ai/admin/credits', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )

const as = (claims: Record<string, unknown>) =>
  mockVerifyIdToken.mockResolvedValueOnce({ uid: 'staff-1', email_verified: true, ...claims })

const GIVE = {
  orgId: ORG,
  action: 'give',
  meter: 'both',
  credits: 227,
  reason: 'Our planner refused the plan after spending',
  jobId: 'job-9',
  idempotencyKey: 'c0ffee00-1111-4222-8333-444455556666',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuditRows.length = 0
  mockDocs = new Map<string, Record<string, unknown>>([
    [`orgs/${ORG}`, { plan: 'free', ownerUid: 'owner-1', name: 'Incident workspace' }],
    [ORG_MONTH, { estCostUsd: 0.227, messages: 3 }],
    [ACCOUNT_MONTH, { estCostUsd: 0.227, requests: 3 }],
  ])
})

describe('the gate', () => {
  it('401s with no credential', async () => {
    expect((await post(GIVE, null)).status).toBe(401)
  })

  it('403s a verified NON-staff token and writes nothing', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'user-1', email_verified: true })
    expect((await post(GIVE)).status).toBe(403)
    expect(mockDocs.get(ORG_MONTH)).toEqual({ estCostUsd: 0.227, messages: 3 })
    expect(mockAuditRows).toEqual([])
  })

  it('403s a `support` staff member, and a staff token with no role (fails closed)', async () => {
    as({ staff: true, staffRole: 'support' })
    const response = await post(GIVE)
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('role')
    as({ staff: true })
    expect((await post(GIVE)).status).toBe(403)
    expect(mockAuditRows).toEqual([])
  })

  it('admits the billing role, as it does for a quota override', async () => {
    as({ staff: true, staffRole: 'billing' })
    expect((await post(GIVE)).status).toBe(200)
  })
})

describe('what it refuses', () => {
  it('a give-back with no reason', async () => {
    as({ staff: true, staffRole: 'super' })
    const response = await post({ ...GIVE, reason: '   ' })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('reason_required')
    expect(mockAuditRows).toEqual([])
  })

  it('more than the month used — on either meter — and writes nothing', async () => {
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.1 })
    as({ staff: true, staffRole: 'super' })
    const response = await post({ ...GIVE, credits: 150 })
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('over_return')
    expect(body.error).toContain('227 on the workspace')
    expect(body.error).toContain('100 on the account')
    expect(mockDocs.get(ORG_MONTH)).toEqual({ estCostUsd: 0.227, messages: 3 })
    expect(mockAuditRows).toEqual([])
  })

  it('a fractional or missing amount, and a missing key', async () => {
    as({ staff: true, staffRole: 'super' })
    expect((await post({ ...GIVE, credits: 2.5 })).status).toBe(400)
    as({ staff: true, staffRole: 'super' })
    expect((await post({ ...GIVE, idempotencyKey: undefined })).status).toBe(400)
  })

  it('the owner’s allowance on a PAID workspace, which has none', async () => {
    mockDocs.set(`orgs/${ORG}`, {
      plan: 'pro',
      billingStatus: 'active',
      ownerUid: 'owner-1',
    })
    as({ staff: true, staffRole: 'super' })
    const response = await post(GIVE)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('no_account_allowance')
  })
})

describe('giving back', () => {
  it('returns to both meters and writes ONE audit row naming everything', async () => {
    as({ staff: true, staffRole: 'super' })
    const response = await post(GIVE)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ month: '2026-10', duplicate: false })
    expect(mockDocs.get(ORG_MONTH)).toMatchObject({ estCostUsd: 0.227, returnedUsd: 0.227 })
    expect(mockDocs.get(ACCOUNT_MONTH)).toMatchObject({ estCostUsd: 0.227, returnedUsd: 0.227 })

    expect(mockAuditRows).toHaveLength(1)
    const [row] = mockAuditRows
    expect(row).toMatchObject({
      actorUid: 'staff-1',
      action: 'ai.credits.giveBack',
      target: ORG_MONTH,
      subjectUid: 'owner-1',
      after: {
        orgId: ORG,
        accountUid: 'owner-1',
        month: '2026-10',
        jobId: 'job-9',
        idempotencyKey: GIVE.idempotencyKey,
        meters: [
          { meter: 'workspace', path: ORG_MONTH, credits: 227, usedBefore: 227 },
          { meter: 'account', path: ACCOUNT_MONTH, credits: 227, usedBefore: 227 },
        ],
      },
    })
    expect(String(row?.['note'])).toContain('Our planner refused the plan after spending')
    // Committed with the give-back, not beside it.
    expect([...mockDocs.keys()].filter((path) => path.startsWith('adminAudit/'))).toHaveLength(1)
  })

  it('is idempotent: the same key twice returns once and audits once', async () => {
    as({ staff: true, staffRole: 'super' })
    await post({ ...GIVE, credits: 100 })
    as({ staff: true, staffRole: 'super' })
    const again = await post({ ...GIVE, credits: 100 })
    expect(again.status).toBe(200)
    expect((await again.json()).duplicate).toBe(true)
    expect(mockDocs.get(ORG_MONTH)?.['returnedUsd']).toBe(0.1)
    expect(mockAuditRows).toHaveLength(1)
  })

  it('reset returns everything each meter used, audited as a reset', async () => {
    mockDocs.set(ACCOUNT_MONTH, { estCostUsd: 0.29 })
    as({ staff: true, staffRole: 'super' })
    const response = await post({ ...GIVE, action: 'reset', credits: undefined })
    expect(response.status).toBe(200)
    expect(
      (await response.json()).lines.map((line: { credits: number }) => line.credits),
    ).toEqual([227, 290])
    expect(mockAuditRows[0]).toMatchObject({ action: 'ai.credits.reset' })
  })

  it('from the staff user page, gives back to the account’s allowance alone', async () => {
    as({ staff: true, staffRole: 'super' })
    const response = await post({
      uid: 'owner-1',
      action: 'give',
      meter: 'account',
      credits: 27,
      reason: 'Compensation',
      idempotencyKey: 'user-page-key-0001',
    })
    expect(response.status).toBe(200)
    expect(mockDocs.get(ACCOUNT_MONTH)).toMatchObject({ returnedUsd: 0.027 })
    expect(mockDocs.get(ORG_MONTH)).not.toHaveProperty('returnedUsd')
    expect(mockAuditRows[0]).toMatchObject({ target: ACCOUNT_MONTH, subjectUid: 'owner-1' })
  })
})
