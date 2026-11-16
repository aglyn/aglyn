/**
 * @jest-environment node
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
 * A connector's access token goes through the SAME `/api/v1` door an API key
 * does (AGL-4225).
 *
 * The real `authenticateApiV1`, the real `verifyConnectorAccessToken` and the
 * real pre-auth budget, against a stand-in store: what is asserted is that
 * the gates a key passes — the per-credential rate limit, the lockdown
 * verdict, the plan, the usage meter — are the gates a connection passes,
 * keyed on the connection and named after the app, and that a token that
 * resolves to nothing is charged to the caller's address exactly as an
 * unknown key is.
 */

import { createHash } from 'node:crypto'

let mockReads = 0
let mockReadFails = false
const mockStore = new Map<string, Record<string, unknown>>()
const mockUsageWrites: string[] = []

jest.mock('../../../libs/tenant/data/admin/src/lib/server/firebase-admin', () => {
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        get: async () => {
          mockReads += 1
          if (mockReadFails) throw new Error('UNAVAILABLE: firestore')
          const data = mockStore.get(`${name}/${id}`)
          return { exists: data !== undefined, data: () => data }
        },
        update: async () => undefined,
        collection: (sub: string) => ({
          doc: (subId: string) => ({
            set: async () => void mockUsageWrites.push(`${name}/${id}/${sub}/${subId}`),
          }),
        }),
        set: async () => undefined,
      }),
    }),
    runTransaction: async (body: (tx: unknown) => Promise<unknown>) =>
      body({ get: async () => ({ exists: false }), update: () => undefined }),
  }
  const firebaseAdmin = {
    app: () => ({ firestore: () => firestore }),
    firestore: Object.assign(() => firestore, {
      FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'NOW' },
    }),
  }
  return { __esModule: true, default: firebaseAdmin, firebaseAdmin }
})

const mockResolveOrgMembership = jest.fn()
const mockMemberHasOrgPermission = jest.fn()
jest.mock('../../../libs/tenant/data/admin/src/lib/server/organizations', () => ({
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => mockMemberHasOrgPermission(...args),
}))
jest.mock('../../../libs/tenant/data/admin/src/lib/server/lockdown', () => ({
  getLockdownVerdict: jest.fn(),
}))

const mockGetOrgDoc = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockConsumeRateLimit = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/api-http')
  const apiKeys = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/api-keys')
  const { firebaseAdmin } = jest.requireMock(
    '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  )
  return {
    __esModule: true,
    ...apiHttp,
    ...apiKeys,
    firebaseAdmin,
    consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
    getOrgDoc: (...args: unknown[]) => mockGetOrgDoc(...args),
    lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

import { PREAUTH_LOOKUP_LIMIT, resetPreAuthLookupBudgetForTests } from '../utils/api-v1'
import { GET } from '../app/api/v1/[[...route]]/route'

const GRANT = 'grant_AAAAAAAAAAAAAAAA'
const stamp = (ms: number) => ({ toMillis: () => ms })
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const token = (seed: string) => `aglyn_at_${seed.padEnd(43, 'x').slice(0, 43)}`

function storeConnection(raw: string, overrides: Record<string, unknown> = {}) {
  mockStore.set(`oauthAccessTokens/${hash(raw)}`, {
    grantId: GRANT,
    orgId: 'org-1',
    uid: 'user-1',
    clientId: 'aglyn_client_x',
    scopes: ['sites:read', 'contacts:read'],
    expiresAt: stamp(Date.now() + 60_000),
  })
  mockStore.set(`oauthGrants/${GRANT}`, {
    grantId: GRANT,
    orgId: 'org-1',
    uid: 'user-1',
    clientName: 'Claude',
    scopes: ['sites:read', 'contacts:read'],
    revokedAt: null,
    lastUsedAt: stamp(Date.now()),
    expiresAt: stamp(Date.now() + 86_400_000),
    ...overrides,
  })
}

const call = (credential: string, path: string[] = ['me'], ip = '203.0.113.9') =>
  GET(
    new Request(`https://app.aglyn.com/api/v1/${path.join('/')}`, {
      headers: { authorization: `Bearer ${credential}`, 'x-forwarded-for': ip },
    }),
    { params: Promise.resolve({ route: path }) },
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockReads = 0
  mockReadFails = false
  mockStore.clear()
  mockUsageWrites.length = 0
  resetPreAuthLookupBudgetForTests()
  mockConsumeRateLimit.mockResolvedValue({
    allowed: true,
    limit: 120,
    remaining: 119,
    resetMs: Date.now() + 60_000,
    degraded: false,
    contended: false,
  })
  mockGetOrgDoc.mockResolvedValue({ plan: 'business' })
  mockLockdownRefusal.mockResolvedValue(null)
  mockResolveOrgMembership.mockResolvedValue({ orgId: 'org-1', member: { role: 'admin' } })
  mockMemberHasOrgPermission.mockResolvedValue(true)
})

describe('a connector token through the /api/v1 door (AGL-4225)', () => {
  it('resolves to the workspace, named after the app, with the scopes it was granted', async () => {
    const credential = token('live')
    storeConnection(credential)
    const response = await call(credential)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      org: 'org-1',
      name: 'Claude',
      scopes: ['contacts:read', 'sites:read'],
    })
  })

  it('is rate limited, lock-checked and metered as ITS connection, through the one pipeline', async () => {
    const credential = token('pipeline')
    storeConnection(credential)
    await call(credential)
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(`apiv1:${GRANT}`)
    // The person's own lock applies to their app.
    expect(mockLockdownRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1', org: { plan: 'business' } }),
    )
    expect(mockUsageWrites).toEqual([expect.stringMatching(/^orgs\/org-1\/apiUsage\//)])
  })

  it('gets the plan refusal a key gets', async () => {
    const credential = token('plan')
    storeConnection(credential)
    mockGetOrgDoc.mockResolvedValue({ plan: 'free' })
    const response = await call(credential)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { type: 'plan_required' } })
  })

  it('stops the moment the person is no longer a manager of the workspace', async () => {
    const credential = token('removed')
    storeConnection(credential)
    mockMemberHasOrgPermission.mockResolvedValue(false)
    expect((await call(credential)).status).toBe(401)
    mockResolveOrgMembership.mockResolvedValue(null)
    expect((await call(credential)).status).toBe(401)
  })

  it('stops once the connection is disconnected', async () => {
    const credential = token('ended')
    storeConnection(credential, { revokedAt: stamp(Date.now()) })
    expect((await call(credential)).status).toBe(401)
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })

  it('charges an unknown well-formed token to the caller’s address, like an unknown key', async () => {
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT; i += 1) {
      expect((await call(token(`unknown${i}`))).status).toBe(401)
    }
    expect(mockReads).toBe(PREAUTH_LOOKUP_LIMIT)
    expect((await call(token('one-more'))).status).toBe(429)
  })

  it('charges a malformed token nothing', async () => {
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT + 10; i += 1) {
      expect((await call('aglyn_at_short')).status).toBe(401)
    }
    expect(mockReads).toBe(0)
  })

  it('answers a failed read with 503 and Retry-After — not a 401, not charged, nothing revoked', async () => {
    const credential = token('blip')
    storeConnection(credential)
    mockReadFails = true
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT + 5; i += 1) {
      const response = await call(credential)
      expect(response.status).toBe(503)
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(await response.json()).toMatchObject({ error: { type: 'service_unavailable' } })
    }
    // Not charged: once reads work again the address is still served.
    mockReadFails = false
    expect((await call(credential)).status).toBe(200)
    expect(mockStore.get(`oauthGrants/${GRANT}`)?.revokedAt).toBeNull()
  })

  it('refuses a dead token again for free, so one client retrying it cannot drain a shared address', async () => {
    const dead = token('dead')
    expect((await call(dead)).status).toBe(401)
    const readsAfterFirst = mockReads
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT * 2; i += 1) expect((await call(dead)).status).toBe(401)
    expect(mockReads).toBe(readsAfterFirst)
    // The address's budget is untouched by the retries: a live token is served.
    const live = token('alive')
    storeConnection(live)
    expect((await call(live)).status).toBe(200)
  })

  it('never refuses a credential that already resolved here, however the address’s budget stands', async () => {
    const live = token('known-good')
    storeConnection(live)
    expect((await call(live)).status).toBe(200)
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT; i += 1) await call(token(`junk${i}`))
    expect((await call(token('one-more-junk'))).status).toBe(429)
    expect((await call(live)).status).toBe(200)
  })
})
