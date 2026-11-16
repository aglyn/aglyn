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
 * The WORKSPACE's per-minute limit on the customer API (AGL-4226).
 *
 * The per-key 120/min was the only bound, and creating a key is free, so a
 * workspace holding N keys could make N × 120 requests a minute — no ceiling
 * at all on what one subscription could cost. This holds every key of a
 * workspace to one durable budget sized by plan, beside the per-key one, and
 * keeps the headers truthful about which of the two refused.
 *
 * The harness is `api-v1-durable-rate-limit.spec.ts`'s: the real limiter,
 * the real envelope and the real headers over an in-memory durable store.
 */

import { createHash } from 'node:crypto'

const mockVerifyApiKey = jest.fn()
const mockGetOrgDoc = jest.fn()
const mockLockdownRefusal = jest.fn()
/** Every write the usage meter made. */
const mockMeterWrites: unknown[] = []
/** What `apiUsage/{month}.count` reads as. */
const mockMonthCount = 0

/** The durable store, standing in for Firestore. Survives a "cold start". */
const mockRateLimitDocs = new Map<string, Record<string, unknown>>()
/** Flip to simulate Firestore being unreachable. */
let mockStoreFails = false

jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => {
    const firestore = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          path: `${name}/${id}`,
          collection: () => ({ doc: () => ({ set: async () => undefined }) }),
          // AGL-2416: the counter is an atomic increment plus a read-back, not
          // a read-modify-write transaction. The sentinel's real `operand` is
          // applied rather than assuming +1, so a mutation to `increment(0)`
          // changes what this store holds instead of being absorbed.
          set: async (value: Record<string, unknown>) => {
            if (mockStoreFails) throw new Error('firestore unavailable')
            const path = `${name}/${id}`
            const prior = mockRateLimitDocs.get(path) ?? {}
            const next: Record<string, unknown> = { ...prior }
            for (const [field, raw] of Object.entries(value)) {
              const operand = (raw as { operand?: unknown })?.operand
              next[field] =
                typeof operand === 'number'
                  ? (Number(prior[field]) || 0) + operand
                  : raw
            }
            mockRateLimitDocs.set(path, next)
          },
          get: async () => {
            if (mockStoreFails) throw new Error('firestore unavailable')
            const path = `${name}/${id}`
            return {
              exists: mockRateLimitDocs.has(path),
              get: (field: string) => mockRateLimitDocs.get(path)?.[field],
            }
          },
        }),
      }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        if (mockStoreFails) throw new Error('firestore unavailable')
        const tx = {
          get: async (ref: { path: string }) => ({
            exists: mockRateLimitDocs.has(ref.path),
            get: (field: string) => mockRateLimitDocs.get(ref.path)?.[field],
          }),
          set: (ref: { path: string }, value: Record<string, unknown>) => {
            mockRateLimitDocs.set(ref.path, {
              ...(mockRateLimitDocs.get(ref.path) ?? {}),
              ...value,
            })
          },
        }
        return fn(tx)
      },
    }
    const firebaseAdmin = {
      app: () => ({ firestore: () => firestore }),
      // Without this namespace the counter's `FieldValue.increment` lookup
      // throws, the limiter degrades to its per-instance fallback, and every
      // durability assertion in this file passes for the wrong reason.
      firestore: Object.assign(() => firestore, {
        FieldValue: { increment: (n: number) => ({ operand: n }) },
      }),
    }
    return { __esModule: true, default: firebaseAdmin, firebaseAdmin }
  },
)

jest.mock('@aglyn/tenant-data-admin', () => {
  // The real error envelope, the real header builder, the real durable
  // limiter — this spec is about what reaches the wire.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const { consumeRateLimit } = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/rate-limit-store',
  )
  return {
    __esModule: true,
    ...apiHttp,
    consumeRateLimit,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              collection: () => ({
                doc: () => ({
                  set: async (value: unknown) => {
                    mockMeterWrites.push(value)
                  },
                  // The month's count, read by a plan whose band is measured.
                  get: async () => ({ get: () => mockMonthCount }),
                }),
              }),
            }),
          }),
        }),
      }),
      firestore: {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      },
    },
    getOrgDoc: (...args: unknown[]) => mockGetOrgDoc(...args),
    verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
    lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}))

import { GET } from '../app/api/v1/[[...route]]/route'

const PINNED_NOW = Date.UTC(2026, 10, 16, 12, 30, 0)
const WINDOW_START = Math.floor(PINNED_NOW / 60_000) * 60_000

const call = () =>
  GET(new Request('https://app.aglyn.com/api/v1', { headers: { authorization: 'Bearer k' } }), {
    params: Promise.resolve({ route: [] as string[] }),
  })

/** The durable counter for a limiter key in the pinned window, by its hashed id. */
function bucket(key: string): Record<string, unknown> | undefined {
  const id = `${createHash('sha256').update(key).digest('hex').slice(0, 32)}_${WINDOW_START}`
  const entry = [...mockRateLimitDocs.entries()].find(([path]) => path.endsWith(`/${id}`))
  return entry?.[1]
}

let clock: jest.SpyInstance<number, []> | undefined
let keySeq = 0

/** A request from a key this workspace has not used yet. */
function freshKey(orgId = 'org-1') {
  keySeq += 1
  mockVerifyApiKey.mockResolvedValueOnce({ orgId, keyId: `key-${keySeq}`, scopes: ['read'] })
}

beforeEach(() => {
  jest.clearAllMocks()
  clock = jest.spyOn(Date, 'now').mockReturnValue(PINNED_NOW)
  mockRateLimitDocs.clear()
  mockStoreFails = false
  mockGetOrgDoc.mockResolvedValue({ plan: 'pro', billingStatus: 'active' })
  mockLockdownRefusal.mockResolvedValue(null)
})

afterEach(() => {
  clock?.mockRestore()
  clock = undefined
})

describe('AGL-4226 · one per-minute budget for the whole workspace', () => {
  it('counts every key of the workspace into ONE durable bucket', async () => {
    freshKey()
    expect((await call()).status).toBe(200)
    freshKey()
    expect((await call()).status).toBe(200)
    // Two keys, two key buckets — and one workspace bucket holding both.
    expect(bucket('apiv1-org:org-1')?.['count']).toBe(2)
  })

  it('refuses a FRESH key once the workspace is spent, and says the workspace refused', async () => {
    freshKey()
    await call()
    bucket('apiv1-org:org-1')!['count'] = 600

    // A brand-new key has its whole 120 left; minting it buys nothing.
    freshKey()
    const response = await call()
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(response.headers.get('X-RateLimit-Scope')).toBe('workspace')
    // The RateLimit-* headers describe the budget that refused, not the key's.
    expect(response.headers.get('RateLimit-Limit')).toBe('600')
    expect(response.headers.get('RateLimit-Remaining')).toBe('0')
    expect(response.headers.get('X-Workspace-RateLimit-Limit')).toBe('600')
    expect(await response.json()).toMatchObject({
      error: { type: 'rate_limited', code: 'workspace_rate_limit' },
    })
  })

  it('a refused request is not metered', async () => {
    freshKey()
    await call()
    bucket('apiv1-org:org-1')!['count'] = 600
    const meteredBefore = mockMeterWrites.length
    freshKey()
    expect((await call()).status).toBe(429)
    expect(mockMeterWrites.length).toBe(meteredBefore)
  })

  it('sizes the budget by plan: Starter-sized 120 is one key, Pro 600', async () => {
    mockGetOrgDoc.mockResolvedValue({ plan: 'pro', billingStatus: 'active' })
    freshKey()
    const pro = await call()
    expect(pro.headers.get('X-Workspace-RateLimit-Limit')).toBe('600')
    expect(pro.headers.get('X-Workspace-RateLimit-Remaining')).toBe('599')
  })

  it('a contracted figure on the workspace decides it', async () => {
    mockGetOrgDoc.mockResolvedValue({
      plan: 'pro',
      billingStatus: 'active',
      entitlements: { apiRequestsPerMinutePerOrg: 2 },
    })
    freshKey()
    expect((await call()).status).toBe(200)
    freshKey()
    expect((await call()).status).toBe(200)
    freshKey()
    const third = await call()
    expect(third.status).toBe(429)
    expect(third.headers.get('X-RateLimit-Scope')).toBe('workspace')
  })

  it('Custom with no agreed figure spends no workspace transaction and reports none', async () => {
    mockGetOrgDoc.mockResolvedValue({ plan: 'enterprise', billingStatus: 'active' })
    freshKey()
    const response = await call()
    expect(response.status).toBe(200)
    expect(bucket('apiv1-org:org-1')).toBeUndefined()
    expect(response.headers.get('X-Workspace-RateLimit-Limit')).toBeNull()
    // The per-key 120 still applies to Custom.
    expect(response.headers.get('RateLimit-Limit')).toBe('120')
  })

  it('a success reports the key budget in RateLimit-* and names it', async () => {
    freshKey()
    const response = await call()
    expect(response.headers.get('X-RateLimit-Scope')).toBe('key')
    expect(response.headers.get('RateLimit-Limit')).toBe('120')
    expect(response.headers.get('RateLimit-Remaining')).toBe('119')
  })

  it('a KEY refusal says the key refused', async () => {
    freshKey()
    await call()
    const keyBucket = [...mockRateLimitDocs.entries()].find(([path]) =>
      path.endsWith(
        `/${createHash('sha256').update(`apiv1:key-${keySeq}`).digest('hex').slice(0, 32)}_${WINDOW_START}`,
      ),
    )![1]
    keyBucket['count'] = 120
    mockVerifyApiKey.mockResolvedValueOnce({ orgId: 'org-1', keyId: `key-${keySeq}`, scopes: ['read'] })
    const response = await call()
    expect(response.status).toBe(429)
    expect(response.headers.get('X-RateLimit-Scope')).toBe('key')
    expect(await response.json()).toMatchObject({
      error: { type: 'rate_limited', code: 'key_rate_limit' },
    })
    // The workspace was never charged for the key's refusal.
    expect(bucket('apiv1-org:org-1')?.['count']).toBe(1)
  })
})
