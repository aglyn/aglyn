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
 * The public REST API's per-key quota is enforced globally (AGL-1679).
 *
 * `apps/docs/api/rate-limits.md` publishes **120 requests per minute per API
 * key** — a billed product surface, and the number an integrator plans and
 * load-tests against. It was enforced by an in-process `Map`, which on Vercel
 * means once per warm instance: the counter resets on every cold start and
 * each concurrent instance keeps its own, so the real ceiling was
 * `120 × instances` and moved with OUR traffic, not the customer's.
 *
 * These assertions are about where the verdict comes from, which is the only
 * thing that changed. Budget already spent in the durable store must refuse
 * this instance's very first request (nothing in local memory knows about it),
 * and a cold start must not hand the key a fresh 120. Both pass trivially
 * under the old code for the opposite reason — it would answer `200` — so
 * each one is a real discriminator rather than a restatement of the limit.
 *
 * The fail-soft case is asserted too, because it is a deliberate product
 * decision and not an accident: every request on this path now touches
 * Firestore, and hard-failing on a blip would take every customer integration
 * down at once. It degrades to the per-instance cap instead.
 */

const mockVerifyApiKey = jest.fn()
const mockGetOrgDoc = jest.fn()
const mockLockdownRefusal = jest.fn()

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
    const firebaseAdmin = { app: () => ({ firestore: () => firestore }) }
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

import { GET } from '../app/api/v1/[[...route]]/route'

type RouteGet = typeof GET

const request = () =>
  new Request('https://app.aglyn.com/api/v1', {
    headers: { authorization: 'Bearer k' },
  })

const call = (get: RouteGet = GET) =>
  get(request(), { params: Promise.resolve({ route: [] as string[] }) })

/** The single (key, window) counter document, whatever its hashed id is. */
function counterDoc(): Record<string, unknown> {
  const entry = [...mockRateLimitDocs.entries()].find(
    ([path]) => !path.includes('/degraded_'),
  )
  if (!entry) throw new Error('no durable counter was written')
  return entry[1]
}

/** Each test gets its own key, so windows never bleed between them. */
let keySeq = 0

beforeEach(() => {
  jest.clearAllMocks()
  mockRateLimitDocs.clear()
  mockStoreFails = false
  keySeq += 1
  mockVerifyApiKey.mockResolvedValue({
    orgId: 'org-1',
    keyId: `key-${keySeq}`,
    scopes: ['read'],
  })
  mockGetOrgDoc.mockResolvedValue({ plan: 'business' })
  mockLockdownRefusal.mockResolvedValue(null)
})

describe('AGL-1679 · the /api/v1 per-key quota is durable', () => {
  it('counts into the durable store rather than instance memory', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    // If the counter lived in a `Map` this collection would be empty and the
    // helper would throw.
    expect(counterDoc()['count']).toBe(1)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
  })

  it('refuses on budget spent by OTHER instances', async () => {
    // One call to create this key's window, then spend the rest of the
    // published 120 elsewhere — the fleet, not this process.
    await call()
    counterDoc()['count'] = 120

    const response = await call()
    // The in-process limiter would answer 200 here: it has seen one request.
    expect(response.status).toBe(429)
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await response.json()).toMatchObject({
      error: { type: 'rate_limited' },
    })
  })

  it('does not hand the key a fresh 120 on a cold start', async () => {
    await call()
    counterDoc()['count'] = 120

    // A brand-new instance: fresh module registry, so every in-process `Map`
    // in the graph is empty. The durable store is not.
    jest.resetModules()
    const { GET: coldGet } = require('../app/api/v1/[[...route]]/route')

    const response = await call(coldGet)
    expect(response.status).toBe(429)
  })

  it('fails SOFT when the durable store is unreachable', async () => {
    mockStoreFails = true
    const response = await call()

    // Not a 500 and not a 429: one Firestore blip must not become a
    // simultaneous outage of every customer integration. The per-instance
    // fallback answers, and its budget starts empty — so a degraded window
    // can only ever allow MORE than the published limit, never fewer.
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119')
  })
})
