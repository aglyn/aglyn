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
 * The rate-limit budget survives the lockdown 423 (AGL-1596).
 *
 * `authenticateApiV1` computes `X-RateLimit-*` once and echoes it on every
 * response — AGL-900's fix, on the reasoning that a client reading its budget
 * off each response must not lose it on exactly the errors it retries. The
 * lockdown refusal (AGL-1506) is built by a helper shared with ~36 console
 * routes that know nothing about API keys, so it returned a fresh response
 * carrying only `Cache-Control` and `Retry-After` — dropping the budget on
 * the ONE error that hands the client a retry schedule.
 *
 * These assertions read the real `Response` objects the route returns (the
 * real refusal body from `lockdownJsonResponse`, the real limiter, the real
 * merge), not that a helper was called. The 200 case is here for the merge's
 * own risk: a header set the wrong way is dropped or DOUBLED on success.
 */

const mockVerifyApiKey = jest.fn()
const mockGetOrgDoc = jest.fn()
const mockLockdownRefusal = jest.fn()

// `lockdownJsonResponse` is pure, but its module reaches for the admin SDK at
// import time. Stub that one edge so the REAL body builder is what answers.
jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => ({
    __esModule: true,
    default: {},
  }),
)

const ORG = { plan: 'business' }
/** A locked org, exactly as `getLockdownVerdict` would resolve it. */
const VERDICT = {
  scope: 'org' as const,
  reason: 'billing' as const,
  atMs: 1_755_000_000_000,
  untilMs: 1_755_000_000_000 + 1_800_000,
}

jest.mock('@aglyn/tenant-data-admin', () => {
  // The real limiter, the real header builder, the real merge, the real
  // error envelope — this spec is about what reaches the wire.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  // …and the real 423 body builder, so the refusal under test is the one
  // customers receive rather than a second, prettier rendering of it.
  const { lockdownJsonResponse } = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/lockdown',
  )
  return {
    __esModule: true,
    ...apiHttp,
    lockdownJsonResponse,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              collection: () => ({
                doc: () => ({ set: async () => undefined }),
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

import { lockdownJsonResponse } from '@aglyn/tenant-data-admin'
import { GET } from '../app/api/v1/[[...route]]/route'

/** Every key gets its own bucket so `remaining` is deterministic. */
let keySeq = 0

const call = (key: string) =>
  GET(
    new Request('https://app.aglyn.com/api/v1', {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ route: [] as string[] }) },
  )

/** Raw header lines, so a DOUBLED header is visible rather than joined. */
const headerNames = (response: Response) =>
  [...response.headers].map(([name]) => name)

beforeEach(() => {
  jest.clearAllMocks()
  keySeq += 1
  mockVerifyApiKey.mockResolvedValue({
    orgId: 'org-1',
    keyId: `key-${keySeq}`,
    scopes: ['read'],
  })
  mockGetOrgDoc.mockResolvedValue(ORG)
  mockLockdownRefusal.mockResolvedValue(null)
})

describe('AGL-1596 · the lockdown 423 keeps the rate-limit budget', () => {
  it('ships X-RateLimit-* alongside Retry-After on the 423', async () => {
    mockLockdownRefusal.mockResolvedValue(lockdownJsonResponse(VERDICT))

    const response = await call('k')
    expect(response.status).toBe(423)

    // The budget AGL-900 promised on every response, on the one error a
    // client is most likely to poll against.
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(Number(response.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    )

    // …without costing the refusal anything it already carried.
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await response.json()).toMatchObject({
      error: 'locked',
      scope: 'org',
      reason: 'billing',
    })
  })

  it('emits each rate-limit header exactly once on the 423', async () => {
    mockLockdownRefusal.mockResolvedValue(lockdownJsonResponse(VERDICT))

    const names = headerNames(await call('k'))
    for (const name of [
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'retry-after',
      'cache-control',
    ]) {
      expect(names.filter((n) => n === name)).toEqual([name])
    }
  })

  it('leaves the 200 path carrying the same budget, undoubled', async () => {
    const response = await call('k')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy()

    const names = headerNames(response)
    for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining']) {
      expect(names.filter((n) => n === name)).toEqual([name])
    }
    // The merge must not have leaked a refusal's headers onto a success.
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('counts the refused request against the budget, as before', async () => {
    // Second call on the same key: the limiter ran either way, so a client
    // polling a locked org still watches `remaining` fall.
    mockVerifyApiKey.mockResolvedValue({
      orgId: 'org-1',
      keyId: `key-${keySeq}-shared`,
      scopes: ['read'],
    })
    await call('k')
    mockLockdownRefusal.mockResolvedValue(lockdownJsonResponse(VERDICT))
    const second = await call('k')
    expect(second.status).toBe(423)
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('118')
  })
})
