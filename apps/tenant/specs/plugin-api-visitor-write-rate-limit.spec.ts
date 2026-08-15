/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * The tenant plugin API dispatcher bounds visitor-facing writes (AGL-1770).
 *
 * `apps/tenant/app/api/[...pluginApi]/route.ts` is the single chokepoint every
 * plugin's visitor endpoints pass through — cart, checkout, reserve, reviews,
 * newsletter, membership registration, bookings — and it applied no rate limit
 * of any kind. The gates it had each refuse something narrower: per-site
 * enablement is skipped by an unresolvable `hostId`, the release gate only
 * checks that the plugin is on, and `visitorWriteRefusal` refuses only a
 * paused or suspended site. AGL-1769 closed the *shape* of the unauthenticated
 * cart write and was explicit that it did not bound the *quantity*.
 *
 * **The assertion surface is `runLegacyHandler`, not the status code.** A 429
 * on its own would not prove the plugin handler stopped running — and "the
 * handler never runs" is the entire claim, because the handler is what mints
 * the document in the merchant's Firestore. Every case asserts the handler
 * call count.
 *
 * The real limiter is used here, driven against a fake Firestore, so "the
 * limiter engages" means a counter genuinely crossed a cap rather than a stub
 * saying it did.
 */

/** Requests that reached the plugin handler. */
let mockHandlerCalls: number
/** Dispatcher path the fake route registry is asked for. */
let mockPath: string

/**
 * A counting Firestore stand-in — the same shape `rate-limit-store.spec.ts`
 * uses. Module-scoped so every request in a test shares one durable counter,
 * which is the property that makes the limiter global in production.
 */
const rateLimitDocs = new Map<string, Record<string, unknown>>()
const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}` }),
  }),
  runTransaction: async (fn: (tx: unknown) => Promise<number>) => {
    const tx = {
      get: async (ref: { path: string }) => ({
        exists: rateLimitDocs.has(ref.path),
        get: (field: string) => rateLimitDocs.get(ref.path)?.[field],
      }),
      set: (ref: { path: string }, value: Record<string, unknown>) => {
        rateLimitDocs.set(ref.path, {
          ...(rateLimitDocs.get(ref.path) ?? {}),
          ...value,
        })
      },
    }
    return fn(tx)
  },
}

jest.mock('./../../../libs/tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  // The REAL limiter and the REAL policy, so this suite pins behaviour rather
  // than a stub. Only the surrounding gates are stubbed to "allow", which is
  // what puts every request on the path the limiter guards.
  const real = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/visitor-write-rate-limit',
  )
  return {
    __esModule: true,
    filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [...ids]),
    getHostDisabledPlugins: jest.fn(async () => []),
    getOrgForHost: jest.fn(async () => ({
      orgId: 'org-1',
      org: { enabledPlugins: ['commerce', 'marketing'] },
    })),
    visitorWriteRefusal: jest.fn(async () => null),
    visitorWriteRateLimitRefusal: real.visitorWriteRateLimitRefusal,
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/lockdown'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  ),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plugin-api-rate-limit',
  ),
  pluginIdForRegisteredApiPath: jest.fn(() => 'commerce'),
  resolvePluginApiRoute: jest.fn(() => ({ path: mockPath })),
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ ok: true }, { status: 200 })
  }),
}))

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'commerce'),
  },
}))

import { GET, POST } from '../app/api/[...pluginApi]/route'
import { VISITOR_WRITE_RATE_LIMIT } from '@aglyn/aglyn/server'

const params = Promise.resolve({ pluginApi: ['commerce', 'cart'] })

/** The exact AGL-1769 request: no cookie, no credentials, no valid product. */
function cartPost(ip: string, body: Record<string, unknown> = { hostId: 'host-1', action: 'clear' }) {
  return new Request('https://shop.aglyn.app/api/commerce/cart', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockHandlerCalls = 0
  mockPath = 'commerce/cart'
  rateLimitDocs.clear()
})

describe('tenant plugin API dispatcher — visitor-write rate limit', () => {
  it('stops the unauthenticated cart POST from reaching Firestore in a loop', async () => {
    const statuses: number[] = []
    for (let i = 0; i < VISITOR_WRITE_RATE_LIMIT + 3; i += 1) {
      statuses.push((await POST(cartPost('9.9.9.9'), { params })).status)
    }

    // Before this change every one of these 123 requests reached the handler
    // and minted a document. The handler now runs exactly the budget.
    expect(mockHandlerCalls).toBe(VISITOR_WRITE_RATE_LIMIT)
    expect(statuses.filter((s) => s === 429)).toHaveLength(3)
    expect(statuses[VISITOR_WRITE_RATE_LIMIT - 1]).toBe(200)
    expect(statuses[VISITOR_WRITE_RATE_LIMIT]).toBe(429)

    // The DURABLE counter did the refusing, not the in-process fallback.
    // Without this the suite would pass just as happily if the Firestore mock
    // never took: `consumeRateLimit` fails soft, so a broken fake would send
    // every call to the in-memory limiter and produce the same 120/429 shape
    // — and every `rateLimitDocs.size === 0` assertion below would then be
    // vacuous. One key, one window, one bucket document.
    expect(rateLimitDocs.size).toBe(1)
    expect([...rateLimitDocs.values()][0].count).toBe(
      VISITOR_WRITE_RATE_LIMIT + 3,
    )
  })

  it('answers a refused request with Retry-After', async () => {
    for (let i = 0; i < VISITOR_WRITE_RATE_LIMIT; i += 1) {
      await POST(cartPost('9.9.9.9'), { params })
    }
    const refused = await POST(cartPost('9.9.9.9'), { params })

    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('leaves a real shopper on the same site unaffected', async () => {
    for (let i = 0; i < VISITOR_WRITE_RATE_LIMIT + 5; i += 1) {
      await POST(cartPost('9.9.9.9'), { params })
    }
    mockHandlerCalls = 0

    const shopper = await POST(cartPost('1.1.1.1'), { params })

    // The property a site-wide ceiling would have cost: the merchant keeps
    // selling while one source is being refused.
    expect(shopper.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })

  it('counts a write that names no site, so the limiter cannot be switched off', async () => {
    // No `hostId` anywhere: not in the query, not in the body. This is the
    // request shape that skips the per-site enablement gate entirely.
    const noHost = () =>
      new Request('https://shop.aglyn.app/api/commerce/cart', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '4.4.4.4' },
        body: JSON.stringify({ action: 'clear' }),
      })

    for (let i = 0; i < VISITOR_WRITE_RATE_LIMIT; i += 1) {
      await POST(noHost(), { params })
    }
    mockHandlerCalls = 0

    const refused = await POST(noHost(), { params })
    expect(refused.status).toBe(429)
    expect(mockHandlerCalls).toBe(0)
  })

  it('does not limit reads', async () => {
    for (let i = 0; i < VISITOR_WRITE_RATE_LIMIT + 10; i += 1) {
      const response = await GET(
        new Request('https://shop.aglyn.app/api/commerce/cart?hostId=host-1', {
          headers: { 'x-forwarded-for': '9.9.9.9' },
        }),
        { params },
      )
      expect(response.status).toBe(200)
    }
    expect(mockHandlerCalls).toBe(VISITOR_WRITE_RATE_LIMIT + 10)
    // No transaction was spent: a durable limiter in front of a GET would be
    // the only Firestore work in the request.
    expect(rateLimitDocs.size).toBe(0)
  })

  it('does not limit the Resend webhook', async () => {
    mockPath = 'email/events'
    const webhookParams = Promise.resolve({ pluginApi: ['email', 'events'] })

    for (let i = 0; i < VISITOR_WRITE_RATE_LIMIT + 10; i += 1) {
      const response = await POST(
        new Request('https://shop.aglyn.app/api/email/events', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '3.3.3.3',
          },
          body: JSON.stringify({ type: 'email.opened' }),
        }),
        { params: webhookParams },
      )
      expect(response.status).toBe(200)
    }

    // One 50k-recipient campaign delivers far more than this from a handful
    // of Resend IPs; a shopper-sized cap would silently drop email analytics.
    expect(mockHandlerCalls).toBe(VISITOR_WRITE_RATE_LIMIT + 10)
    expect(rateLimitDocs.size).toBe(0)
  })

  it('spends no transaction on a path that does not resolve to a handler', async () => {
    const { resolvePluginApiRoute } = jest.requireMock('@aglyn/aglyn/server')
    resolvePluginApiRoute.mockReturnValueOnce(undefined)

    const response = await POST(cartPost('9.9.9.9'), { params })

    // Limiting before route resolution would turn a free 404 into a Firestore
    // transaction — a cheaper amplification than the one being closed.
    expect(response.status).toBe(404)
    expect(rateLimitDocs.size).toBe(0)
  })
})
