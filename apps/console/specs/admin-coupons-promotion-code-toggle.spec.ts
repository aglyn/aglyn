/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * Staff activate/deactivate of a Stripe promotion code.
 *
 * NO LIVE STRIPE WRITE HAPPENS HERE. This repo has recorded that localhost
 * runs against the LIVE Stripe secret key, so `fetch` is replaced wholesale
 * below and the handler never reaches api.stripe.com — every assertion about
 * what Stripe was asked reads the recorded request, not a response.
 *
 * What is pinned: the endpoint and params each direction sends, the staff bar,
 * the audit row that makes a flip of a discount's redeemability attributable,
 * the id shape (it is interpolated into the Stripe path), the sign-off on
 * re-arming a deep discount, and a Stripe failure surfacing as a 502 rather
 * than a 200 that reports a write which never landed.
 */

// Keeps the file a module: these declarations share names with other route
// suites, which collide in the global scope a script-mode spec lands in.
export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          add: async (row: unknown) => mockAuditAdd(name, row),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  DISCOUNT_APPROVAL_THRESHOLD_PCT: 40,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body:
        request.method === 'GET'
          ? undefined
          : await request.json().catch(() => ({})),
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    }
  },
}))

const { POST } = require('../app/api/admin/coupons/route')

/** Every Stripe call the handler made, in order. */
let stripeCalls: Array<{ path: string; method: string; body: string | null }>
/**
 * What the promotion code READ answers with — the state Stripe holds before
 * the flip. The write is not scripted here: it echoes the flag it was asked
 * for, the way Stripe does, so a handler that sent the wrong flag cannot be
 * covered up by a canned response.
 */
let stripeReadReply: { ok?: boolean; status?: number; body: any }

const CODE_ID = 'promo_1AglynSmoke'

/** The promotion code as Stripe returns it, with its coupon expanded. */
const promotionCode = (over: Record<string, unknown> = {}) => ({
  id: CODE_ID,
  code: 'AGLYNSMOKELIVE',
  active: false,
  times_redeemed: 2,
  max_redemptions: null,
  coupon: { id: 'cpn_1', percent_off: 10 },
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  stripeCalls = []
  stripeReadReply = { body: promotionCode() }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    stripeCalls.push({
      path,
      method: init.method ?? 'GET',
      body: init.body ?? null,
    })
    if (init.method === 'POST') {
      const sent = new URLSearchParams(String(init.body ?? ''))
      return {
        ok: true,
        status: 200,
        json: async () =>
          promotionCode({ active: sent.get('active') === 'true' }),
      }
    }
    return {
      ok: stripeReadReply.ok !== false,
      status: stripeReadReply.status ?? (stripeReadReply.ok === false ? 400 : 200),
      json: async () => stripeReadReply.body,
    }
  })
})

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/coupons', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )

/** The write Stripe was asked to perform, if any. */
const writeCall = () =>
  stripeCalls.find((call) => call.method === 'POST' && call.body != null)

describe('POST /api/admin/coupons — promotion code activate/deactivate', () => {
  it('activates a code with active=true on the promotion code endpoint', async () => {
    const response = await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      code: {
        id: CODE_ID,
        code: 'AGLYNSMOKELIVE',
        active: true,
        timesRedeemed: 2,
        maxRedemptions: null,
      },
    })
    expect(writeCall()).toMatchObject({
      path: `promotion_codes/${CODE_ID}`,
      method: 'POST',
      body: 'active=true',
    })
  })

  it('deactivates a code with active=false on the same endpoint', async () => {
    stripeReadReply = {
      body: promotionCode({ active: true }),
    }

    const response = await post({
      action: 'deactivate',
      promotionCodeId: CODE_ID,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      code: { active: false },
    })
    expect(writeCall()).toMatchObject({
      path: `promotion_codes/${CODE_ID}`,
      method: 'POST',
      body: 'active=false',
    })
  })

  it('reads the code before writing, so the audit row can carry a real before', async () => {
    stripeReadReply = {
      body: promotionCode({ active: false }),
    }

    await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(stripeCalls[0]).toMatchObject({
      path: `promotion_codes/${CODE_ID}`,
      method: 'GET',
    })
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
    expect(mockAuditAdd).toHaveBeenCalledWith(
      'adminAudit',
      expect.objectContaining({
        actorUid: 'staff-1',
        action: 'coupon.promotion_code.update',
        target: `stripe/promotion_codes/${CODE_ID}`,
        before: { active: false },
        after: { active: true, code: 'AGLYNSMOKELIVE', couponId: 'cpn_1' },
      }),
    )
  })

  it('records the deactivate direction too', async () => {
    stripeReadReply = {
      body: promotionCode({ active: true }),
    }

    await post({ action: 'deactivate', promotionCodeId: CODE_ID })

    expect(mockAuditAdd).toHaveBeenCalledWith(
      'adminAudit',
      expect.objectContaining({
        before: { active: true },
        after: expect.objectContaining({ active: false }),
      }),
    )
  })

  it('refuses a non-staff caller and never touches Stripe', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user-1',
      email_verified: true,
    })

    const response = await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(response.status).toBe(403)
    expect(stripeCalls).toEqual([])
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await POST(
      new Request('https://console.aglyn.com/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', promotionCodeId: CODE_ID }),
      }),
    )

    expect(response.status).toBe(401)
    expect(stripeCalls).toEqual([])
  })

  it('rejects an id that is not a promotion code id, before any Stripe call', async () => {
    // The id lands in the Stripe request path; a traversal would address a
    // different resource entirely.
    const response = await post({
      action: 'activate',
      promotionCodeId: '../coupons/cpn_1',
    })

    expect(response.status).toBe(400)
    expect(stripeCalls).toEqual([])
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('404s an unknown promotion code without writing', async () => {
    stripeReadReply = {
      ok: false,
      status: 404,
      body: { error: { message: 'No such promotion code' } },
    }

    const response = await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(response.status).toBe(404)
    expect(writeCall()).toBeUndefined()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('surfaces a Stripe write failure as a 502, not a 200', async () => {
    let seenWrite = false
    ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      const path = String(url).replace('https://api.stripe.com/v1/', '')
      stripeCalls.push({
        path,
        method: init.method ?? 'GET',
        body: init.body ?? null,
      })
      if (init.method === 'POST') {
        seenWrite = true
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'Coupon is expired' } }),
        }
      }
      return { ok: true, status: 200, json: async () => promotionCode() }
    })

    const response = await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(seenWrite).toBe(true)
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Coupon is expired',
    })
    // Nothing changed in Stripe, so nothing may claim it did.
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('needs sign-off to re-arm a code for a discount at the approval threshold', async () => {
    stripeReadReply = {
      body: promotionCode({ coupon: { id: 'cpn_1', percent_off: 40 } }),
    }

    const response = await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      requiresConfirmation: true,
    })
    expect(writeCall()).toBeUndefined()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('activates a deep discount once the sign-off is given', async () => {
    stripeReadReply = {
      body: promotionCode({ coupon: { id: 'cpn_1', percent_off: 40 } }),
    }

    const response = await post({
      action: 'activate',
      promotionCodeId: CODE_ID,
      confirmHighDiscount: true,
    })

    expect(response.status).toBe(200)
    expect(writeCall()).toMatchObject({ body: 'active=true' })
  })

  it('does not gate the deactivate direction — it only shrinks what is redeemable', async () => {
    stripeReadReply = {
      body: promotionCode({
        active: true,
        coupon: { id: 'cpn_1', percent_off: 90 },
      }),
    }

    const response = await post({
      action: 'deactivate',
      promotionCodeId: CODE_ID,
    })

    expect(response.status).toBe(200)
    expect(writeCall()).toMatchObject({ body: 'active=false' })
  })

  it('rejects an unknown action rather than falling through to create', async () => {
    const response = await post({ action: 'destroy', promotionCodeId: CODE_ID })

    expect(response.status).toBe(400)
    expect(stripeCalls).toEqual([])
  })

  it('501s without Stripe configured', async () => {
    delete process.env.STRIPE_SECRET_KEY

    const response = await post({ action: 'activate', promotionCodeId: CODE_ID })

    expect(response.status).toBe(501)
    expect(stripeCalls).toEqual([])
  })
})
