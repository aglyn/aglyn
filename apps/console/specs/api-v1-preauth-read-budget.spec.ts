/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * `/api/v1` spent an uncapped Firestore read per request before any rate
 * limit applied (AGL-2414).
 *
 * `verifyApiKey` rejects junk for free — `isValidApiKeyFormat` short-circuits
 * before the store is touched. But the token prefix is published in the API
 * docs and the suffix is any 24+ `[A-Za-z0-9_-]`, so a token that merely
 * *looks* like a key costs one document read, and nothing stood in front of
 * it: the per-key limiter needs a key id, and these requests resolve to none.
 * The route is `force-dynamic`, so there is no edge cache either.
 *
 * **These assertions are a MEASUREMENT, not an assertion about a limit.**
 * `mockReads` counts real `DocumentReference.get()` calls made by the
 * REAL `verifyApiKey` against a stand-in store, so the number here is the
 * number the production path spends. Deleting the gate from `api-v1.ts` makes
 * the first test read `200` instead of `60`, which is the before/after of
 * this issue stated as a test.
 *
 * The discriminating cases are the ones about who PAYS. A budget that charged
 * every pre-auth request would be a second, IP-shaped cap in front of a
 * billed surface that documents exactly one (120/min per key), and two
 * integrations behind one NAT would throttle each other on a limit neither
 * can see. Charging only the lookups that came back EMPTY is what keeps this
 * a bound on wasted mockReads rather than a new customer-visible ceiling.
 */

/** Real `DocumentReference.get()` calls made against the apiKeys collection. */
let mockReads = 0
/** Token hash → stored key document. Only real keys live here. */
const mockStoredKeys = new Map<string, Record<string, unknown>>()

jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => {
    const firestore = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          path: `${name}/${id}`,
          get: async () => {
            // The one line this whole spec is about.
            mockReads += 1
            const data = mockStoredKeys.get(id)
            return {
              exists: data !== undefined,
              data: () => data,
              ref: { update: async () => undefined },
            }
          },
          update: async () => undefined,
          collection: () => ({ doc: () => ({ set: async () => undefined }) }),
          set: async () => undefined,
        }),
      }),
    }
    const firebaseAdmin = {
      app: () => ({ firestore: () => firestore }),
      firestore: Object.assign(() => firestore, {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      }),
    }
    return { __esModule: true, default: firebaseAdmin, firebaseAdmin }
  },
)

const mockGetOrgDoc = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockConsumeRateLimit = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL error envelope, the REAL pure limiter, and above all the REAL
  // `verifyApiKey`/`isValidApiKeyFormat` — a stubbed key verifier would move
  // the read being counted out of the measurement. Spread, not replaced, so
  // this stays an open world (a closed factory here is how these specs go
  // falsely red).
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const apiKeys = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-keys',
  )
  const {
    firebaseAdmin,
  } = jest.requireMock(
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

// Through the package boundary, not a deep relative path (@nx/enforce-module-
// boundaries). The barrel is mocked above, but the mock spreads the REAL
// `api-keys` module, so these are the production helpers.
import {
  API_KEY_TOKEN_PREFIX,
  hashApiKey,
  isValidApiKeyFormat,
} from '@aglyn/tenant-data-admin'
import {
  PREAUTH_LOOKUP_LIMIT,
  resetPreAuthLookupBudgetForTests,
} from '../utils/api-v1'
import { GET } from '../app/api/v1/[[...route]]/route'

/** A well-formed token that no key was ever minted for. */
function unknownToken(seed: number): string {
  return `${API_KEY_TOKEN_PREFIX}${String(seed).padStart(4, '0')}aaaaaaaaaaaaaaaaaaaaaaaaaaaa`
}

/** Mint a token that DOES resolve, the way a paying integration's key does. */
function realToken(orgId = 'org-1'): string {
  const token = `${API_KEY_TOKEN_PREFIX}realrealrealrealrealrealreal01`
  mockStoredKeys.set(hashApiKey(token), {
    keyId: 'key-1',
    orgId,
    scopes: ['sites:read'],
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: { toMillis: () => Date.now() },
  })
  return token
}

const call = (token: string, ip = '203.0.113.7') =>
  GET(
    new Request('https://app.aglyn.com/api/v1', {
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
    }),
    { params: Promise.resolve({ route: [] as string[] }) },
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockReads = 0
  mockStoredKeys.clear()
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
})

describe('AGL-2414 · the pre-auth Firestore read is bounded', () => {
  it('MEASUREMENT: 200 unknown-key requests from one IP spend 60 mockReads, not 200', async () => {
    const responses = []
    for (let i = 0; i < 200; i += 1) responses.push(await call(unknownToken(i)))

    // Before this change this was 200 — one read per request, unbounded, from
    // an unauthenticated caller. The bound is the budget, and nothing else.
    expect(mockReads).toBe(PREAUTH_LOOKUP_LIMIT)
    expect(mockReads).toBe(60)

    const statuses = responses.map((r) => r.status)
    expect(statuses.filter((s) => s === 401)).toHaveLength(60)
    expect(statuses.filter((s) => s === 429)).toHaveLength(140)
  })

  it('answers the refusal with Retry-After and NO per-key budget headers', async () => {
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT; i += 1) await call(unknownToken(i))
    const refused = await call(unknownToken(999))

    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await refused.json()).toMatchObject({ error: { type: 'rate_limited' } })
    // `X-RateLimit-*` describe ONE key's 120/min. This refusal happens because
    // we declined to find out which key, so a per-key budget here would be a
    // number about nobody — the same reason the 401 carries none.
    expect(refused.headers.get('X-RateLimit-Limit')).toBeNull()
    expect(refused.headers.get('X-RateLimit-Remaining')).toBeNull()
  })

  it('charges a VALID key nothing, however much traffic it sends', async () => {
    // The property that keeps this from becoming a second cap on a billed
    // surface. A healthy integration's keys resolve, so it never fills the
    // bucket and can never be refused by its own traffic.
    const token = realToken()
    for (let i = 0; i < 200; i += 1) {
      const response = await call(token)
      expect(response.status).toBe(200)
    }
    expect(mockReads).toBe(200)

    // …and the budget is untouched, so an unknown key from that same IP is
    // still answered on the merits.
    const unknown = await call(unknownToken(1))
    expect(unknown.status).toBe(401)
  })

  it('charges a MALFORMED token nothing — it never cost a read', async () => {
    // `verifyApiKey` short-circuits on the format check, so junk spends no
    // read. Charging it would make this budget a request cap rather than a
    // truthful count of mockReads.
    expect(isValidApiKeyFormat('nope')).toBe(false)
    for (let i = 0; i < 500; i += 1) {
      const response = await call('nope')
      expect(response.status).toBe(401)
    }
    expect(mockReads).toBe(0)

    const stillAnswered = await call(unknownToken(1))
    expect(stillAnswered.status).toBe(401)
    expect(mockReads).toBe(1)
  })

  it('budgets each client IP separately', async () => {
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT; i += 1) {
      await call(unknownToken(i), '203.0.113.7')
    }
    expect((await call(unknownToken(999), '203.0.113.7')).status).toBe(429)
    // A different caller is unaffected — one abusive IP must not refuse the
    // rest of the internet.
    expect((await call(unknownToken(999), '198.51.100.4')).status).toBe(401)
  })

  it('does not consume the per-key durable budget on a refused lookup', async () => {
    // The refusal happens before `verifyApiKey`, so there is no key id to
    // charge — and charging some *other* budget would be spending a Firestore
    // transaction on exactly the path this exists to make free.
    for (let i = 0; i < PREAUTH_LOOKUP_LIMIT + 5; i += 1) await call(unknownToken(i))
    expect(mockConsumeRateLimit).not.toHaveBeenCalled()
  })
})
