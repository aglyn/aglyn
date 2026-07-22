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

import type {
  PluginApiHandler,
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { memberCookieName, mintMemberSession } from './membership'
import { gateHandler } from './gate'
import { memberFeedHandler } from './member-feed'
import { membershipAccountHandler } from './membership-account'
import { membershipContentHandler } from './membership-content'
import { membershipWishlistHandler } from './membership-wishlist'
import { streamHandler } from './stream'
import { subscriptionPortalHandler } from './subscription-portal'

// One configurable member behind chainable stubs, following
// membership-login.spec.ts. Collections other than siteMembers resolve
// from mockDocsByCollection so each endpoint's post-auth reads can be
// staged per test.
const mockMemberFields: Record<string, unknown> = {}
let mockMemberExists = true
const mockDocsByCollection: Record<
  string,
  Array<{ id: string; fields: Record<string, unknown> }>
> = {}
const mockMemberSetCalls: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const makeSnapshot = (doc: {
    id: string
    fields: Record<string, unknown>
  }) => ({
    id: doc.id,
    exists: true,
    get: (field: string) => doc.fields[field],
    data: () => doc.fields,
  })
  const makeCollection = (name: string) => {
    const collection = {
      where: () => collection,
      limit: () => collection,
      get: async () => ({
        docs: (mockDocsByCollection[name] ?? []).map(makeSnapshot),
      }),
      doc: (id: string) => ({
        get: async () =>
          name === 'siteMembers'
            ? {
                id,
                exists: mockMemberExists,
                get: (field: string) => mockMemberFields[field],
              }
            : makeSnapshot(
                (mockDocsByCollection[name] ?? []).find(
                  (doc) => doc.id === id,
                ) ?? { id, fields: {} },
              ),
        set: async (data: Record<string, unknown>) => {
          mockMemberSetCalls.push(data)
        },
      }),
    }
    return collection
  }
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => ({ exists: true, get: () => undefined }),
              collection: makeCollection,
            }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'server-time' } },
    },
    // Entitled org so the AGL-481 plan gate never masks the suspension
    // path under test.
    getOrgForHost: async () => ({
      org: { entitlements: { features: { contentGating: true } } },
    }),
  }
})
// Members-only content resolves through tenant-runtime; the suspension
// gate fires before either is reached, and the active path just needs a
// publishable screen.
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: async () => ({ screen: { id: 'screen-1' } }),
}))
jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: async () => [{ id: 'node-1' }],
}))

const HOST_ID = 'host-1'
const MEMBER_ID = 'member-1'
const PRODUCT_ID = 'prod-1'

function makeRequest(init: {
  method: string
  body?: Record<string, unknown>
  query?: Record<string, string>
  signedIn?: boolean
}): PluginApiRequest {
  return {
    method: init.method,
    query: init.query ?? {},
    body: init.body,
    headers: {},
    cookies:
      init.signedIn === false
        ? {}
        : {
            [memberCookieName(HOST_ID)]: mintMemberSession(HOST_ID, MEMBER_ID),
          },
    socket: {},
  }
}

function makeResponse() {
  const result = { status: 0, body: undefined as any, headers: {} as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader(name, value) {
      result.headers[name] = value
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  }
  return { res, result }
}

const fetchMock = jest.fn(
  async () =>
    ({
      ok: true,
      json: async () => ({ url: 'https://portal.example/session' }),
    }) as unknown as Response,
)

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.STRIPE_SECRET_KEY = 'sk_test_suspension_spec'
  // Stream tokens sign with the dedicated fail-closed secret (AGL-689), not
  // the Stripe key — without this the mint throws instead of returning a URL.
  process.env.TOKEN_SIGNING_SECRET = 'test-token-signing-secret'
})

beforeEach(() => {
  jest.clearAllMocks()
  mockMemberExists = true
  mockMemberFields['email'] = 'user@example.com'
  mockMemberFields['wishlist'] = ['p1']
  delete mockMemberFields['suspended']
  mockDocsByCollection['orders'] = []
  mockDocsByCollection['memberPosts'] = []
  // A live subscription so gate/stream resolve `entitled` for the active
  // member — proving the suspension gate, not the entitlement, is what
  // rejects the suspended one.
  mockDocsByCollection['subscriptions'] = [
    {
      id: 'sub-1',
      fields: {
        status: 'active',
        productId: PRODUCT_ID,
        customerEmail: 'user@example.com',
        stripeCustomerId: 'cus_1',
      },
    },
  ]
  mockMemberSetCalls.length = 0
})

/** Every endpoint that authenticates via the member session cookie. */
const COOKIE_ENDPOINTS: Array<{
  name: string
  handler: PluginApiHandler
  request: () => PluginApiRequest
  expectActiveOk: (result: { status: number; body: any }) => void
}> = [
  {
    name: 'membership/account',
    handler: membershipAccountHandler,
    request: () => makeRequest({ method: 'GET', query: { hostId: HOST_ID } }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(result.body?.member?.email).toBe('user@example.com')
    },
  },
  {
    name: 'membership/content',
    handler: membershipContentHandler,
    request: () =>
      makeRequest({
        method: 'POST',
        body: { hostId: HOST_ID, screenId: 'screen-1' },
      }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(result.body?.nodes).toEqual([{ id: 'node-1' }])
    },
  },
  {
    name: 'membership/wishlist (GET)',
    handler: membershipWishlistHandler,
    request: () => makeRequest({ method: 'GET', query: { hostId: HOST_ID } }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(result.body?.productIds).toEqual(['p1'])
    },
  },
  {
    name: 'membership/wishlist (POST add)',
    handler: membershipWishlistHandler,
    request: () =>
      makeRequest({
        method: 'POST',
        body: { hostId: HOST_ID, action: 'add', productId: 'p2' },
      }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(result.body?.productIds).toEqual(['p1', 'p2'])
    },
  },
  {
    name: 'commerce/member-feed',
    handler: memberFeedHandler,
    request: () => makeRequest({ method: 'GET', query: { hostId: HOST_ID } }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(result.body?.posts).toEqual([])
    },
  },
  {
    name: 'commerce/stream (POST mint)',
    handler: streamHandler,
    request: () =>
      makeRequest({
        method: 'POST',
        body: { hostId: HOST_ID, productId: PRODUCT_ID },
      }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(String(result.body?.url)).toContain('/api/commerce/stream?')
    },
  },
  {
    name: 'commerce/subscription-portal',
    handler: subscriptionPortalHandler,
    request: () => makeRequest({ method: 'POST', body: { hostId: HOST_ID } }),
    expectActiveOk: (result) => {
      expect(result.status).toBe(200)
      expect(result.body?.url).toBe('https://portal.example/session')
    },
  },
]

describe('member suspension enforcement (AGL-550)', () => {
  describe.each(COOKIE_ENDPOINTS)('$name', (endpoint) => {
    it('rejects a suspended member with 403 and clears the cookie', async () => {
      mockMemberFields['suspended'] = true
      const { res, result } = makeResponse()
      await endpoint.handler(endpoint.request(), res)
      expect(result.status).toBe(403)
      expect(String(result.body?.error)).toMatch(/suspended/i)
      // The stale HMAC session is dropped so the signed-in shell unwinds.
      expect(String(result.headers['Set-Cookie'])).toContain(
        `${memberCookieName(HOST_ID)}=;`,
      )
      expect(String(result.headers['Set-Cookie'])).toContain('Max-Age=0')
      // Nothing was written on the way out.
      expect(mockMemberSetCalls).toHaveLength(0)
    })

    it('leaves an active member unaffected', async () => {
      const { res, result } = makeResponse()
      await endpoint.handler(endpoint.request(), res)
      endpoint.expectActiveOk(result)
    })

    it('still 401s without a session cookie', async () => {
      const request = endpoint.request()
      request.cookies = {}
      const { res, result } = makeResponse()
      await endpoint.handler(request, res)
      expect(result.status).toBe(401)
    })
  })

  describe('commerce/gate (soft probe)', () => {
    it('reads a suspended member as signed-out and clears the cookie', async () => {
      mockMemberFields['suspended'] = true
      const { res, result } = makeResponse()
      await gateHandler(
        makeRequest({
          method: 'GET',
          query: { hostId: HOST_ID, productId: PRODUCT_ID },
        }),
        res,
      )
      // The probe's contract is 200 either way — but a suspended member
      // must never read as entitled or signed in.
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ entitled: false, signedIn: false })
      expect(String(result.headers['Set-Cookie'])).toContain('Max-Age=0')
    })

    it('still resolves entitlement for an active member', async () => {
      const { res, result } = makeResponse()
      await gateHandler(
        makeRequest({
          method: 'GET',
          query: { hostId: HOST_ID, productId: PRODUCT_ID },
        }),
        res,
      )
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ entitled: true, signedIn: true })
      expect(result.headers['Set-Cookie']).toBeUndefined()
    })
  })

  it('treats a deleted member doc as signed-out (401), not a crash', async () => {
    mockMemberExists = false
    const { res, result } = makeResponse()
    await membershipAccountHandler(
      makeRequest({ method: 'GET', query: { hostId: HOST_ID } }),
      res,
    )
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ error: 'Not signed in' })
  })
})
