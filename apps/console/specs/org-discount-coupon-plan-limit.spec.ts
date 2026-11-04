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
 * Staff applying a base-price coupon to an organization (AGL-4159).
 *
 * The same rule checkout holds a code to: a coupon limited to one plan's base
 * price, applied to an org on another plan, would be attached by Stripe and
 * discount nothing while `org.discount` recorded a discount the org never
 * gets. It is refused with the plan it is for; on the plan it is for it
 * applies as any coupon does.
 *
 * NO LIVE STRIPE WRITE HAPPENS HERE: `fetch` is replaced wholesale.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn()
let mockOrgDoc: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => mockOrgDoc }),
            set: async () => undefined,
          }),
        }),
      }),
    }),
    firestore: {
      FieldValue: { serverTimestamp: () => 'ts', delete: () => 'delete' },
    },
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  readOrgBilling: async () => ({
    stripeCustomerId: 'cus_1',
    subscription: { status: 'active', interval: 'month' },
  }),
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAuditAdd(...args),
}))

jest.mock('../app/api/_lib/org-cogs', () => ({
  __esModule: true,
  latestMeasuredCogsUsd: async () => null,
}))

const { POST } = require('../app/api/admin/org-discount/route')

const ORIGINAL_ENV = process.env
let coupon: Record<string, unknown> = {}
let stripePaths: string[] = []
let subscriptionWrites: string[] = []

beforeEach(() => {
  jest.clearAllMocks()
  stripePaths = []
  subscriptionWrites = []
  const clean = { ...ORIGINAL_ENV }
  for (const key of Object.keys(clean)) if (key.startsWith('STRIPE_')) delete clean[key]
  process.env = {
    ...clean,
    STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
    STRIPE_PRICE_STARTER: 'price_starter_month',
    STRIPE_PRICE_PRO: 'price_pro_month',
  } as NodeJS.ProcessEnv
  mockOrgDoc = { plan: 'pro', displayName: 'Acme' }
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    stripePaths.push(path)
    const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (path.startsWith('coupons/')) return answer(coupon)
    if (path.startsWith('prices/')) {
      const id = path.slice('prices/'.length)
      return answer({ id, product: id === 'price_starter_month' ? 'prod_starter' : 'prod_pro' })
    }
    if (path.startsWith('subscriptions?')) {
      return answer({ data: [{ id: 'sub_1', status: 'active' }] })
    }
    subscriptionWrites.push(String(init.body ?? ''))
    return answer({ id: 'sub_1' })
  })
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

const apply = () =>
  POST(
    new Request('https://console.aglyn.com/api/admin/org-discount', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'org-1',
        action: 'apply',
        couponId: 'cpn_1',
        confirmBelowFloor: true,
      }),
    }),
  ) as Promise<Response>

describe('POST /api/admin/org-discount — a coupon limited to a plan’s base price', () => {
  it('reads the coupon with `applies_to` expanded', async () => {
    coupon = { id: 'cpn_1', percent_off: 10, duration: 'forever' }
    await apply()
    expect(stripePaths[0]).toBe('coupons/cpn_1?expand[]=applies_to')
  })

  it('refuses a Starter coupon on a Pro organization, and attaches nothing', async () => {
    coupon = {
      id: 'cpn_1',
      percent_off: 100,
      duration: 'forever',
      applies_to: { products: ['prod_starter'] },
    }
    const response = await apply()
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.code).toBe('coupon_plan_mismatch')
    expect(payload.error).toBe(
      'This coupon takes its discount off the Starter base price, and this organization ' +
        'is on Pro, so it would discount nothing.',
    )
    expect(subscriptionWrites).toEqual([])
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('applies it on the plan it is for, and records the plan on the audit row', async () => {
    mockOrgDoc = { plan: 'starter', displayName: 'Acme' }
    coupon = {
      id: 'cpn_1',
      percent_off: 100,
      duration: 'repeating',
      duration_in_months: 24,
      applies_to: { products: ['prod_starter'] },
    }
    const response = await apply()
    expect(response.status).toBe(200)
    expect(subscriptionWrites).toEqual(['coupon=cpn_1'])
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'org.discount.apply',
        after: expect.objectContaining({ appliesToPlans: ['starter'] }),
      }),
    )
  })
})
