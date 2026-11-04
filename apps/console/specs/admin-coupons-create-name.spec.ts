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
 * The coupon name on staff create.
 *
 * Stripe refuses a coupon name over 40 characters. The route used to pass up
 * to 200 through, so a long name reached Stripe and came back to staff as a
 * 502. Pinned here: a name over the limit is a 400 that never asks Stripe, and
 * a name at the limit is sent as typed.
 *
 * NO LIVE STRIPE WRITE HAPPENS HERE: `fetch` is replaced wholesale, as in
 * `admin-coupons-promotion-code-toggle.spec.ts`.
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
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    query: {},
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
  }),
}))

const { POST } = require('../app/api/admin/coupons/route')
const { COUPON_NAME_MAX } = require('../utils/coupon-list-query')

/** Every Stripe call the handler made, in order. */
let stripeCalls: Array<{ path: string; body: string | null }>

beforeEach(() => {
  jest.clearAllMocks()
  stripeCalls = []
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    stripeCalls.push({ path, body: init.body ?? null })
    const sent = new URLSearchParams(String(init.body ?? ''))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'cpn_1',
        name: sent.get('name'),
        percent_off: Number(sent.get('percent_off')),
        duration: sent.get('duration'),
        valid: true,
      }),
    }
  })
})

const create = (name: string) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/coupons', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, percentOff: 10, duration: 'once' }),
    }),
  )

describe('POST /api/admin/coupons — coupon name length', () => {
  it('is Stripe’s 40', () => {
    expect(COUPON_NAME_MAX).toBe(40)
  })

  it('answers 400 for a name over the limit and never asks Stripe', async () => {
    const response = await create('x'.repeat(COUPON_NAME_MAX + 1))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: `Keep the name to ${COUPON_NAME_MAX} characters (it has ${COUPON_NAME_MAX + 1})`,
    })
    expect(stripeCalls).toEqual([])
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('sends a name at the limit to Stripe as typed', async () => {
    const name = 'n'.repeat(COUPON_NAME_MAX)
    const response = await create(`  ${name}  `)

    expect(response.status).toBe(200)
    expect(stripeCalls).toHaveLength(1)
    expect(stripeCalls[0].path).toBe('coupons')
    expect(new URLSearchParams(String(stripeCalls[0].body)).get('name')).toBe(name)
  })
})
