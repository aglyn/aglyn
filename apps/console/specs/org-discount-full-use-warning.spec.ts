/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * APPLYING A COUPON TO AN ORG ANSWERS WITH ITS FULL-USE VERDICT (AGL-3473).
 *
 * `/api/admin/org-discount` is where staff commit a discount to one org's live
 * subscription. Its guardrail rates the discount against what the org has
 * USED; beside it, the route now judges the discount against what the org
 * would cost using every band it resolves to, on the charges the coupon
 * reaches, and returns that verdict for the console to warn with. It refuses
 * nothing for it — a discount that spends cost to close a deal is staff's
 * call — and the measured guardrail behaves exactly as it did.
 *
 * The org here is priced so that it covers exactly cost + 30% at full use:
 * 20% off spends part of the margin; 25% off crosses 1.0× and is applied
 * with a warning. Real arithmetic throughout — only Firebase, the audit
 * write and Stripe are doubles.
 */

export {}

import { fullUseMonthlyCogsUsd } from '@aglyn/aglyn/app-utils/full-use-cost'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn()
let mockOrgDoc: Record<string, unknown> = {}
let mockBilling: Record<string, unknown> = {}
let mockOrgWrites: Array<Record<string, unknown>> = []

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
            set: async (data: Record<string, unknown>) => {
              mockOrgWrites.push(data)
            },
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
  readOrgBilling: async () => mockBilling,
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAuditAdd(...args),
}))

// No usage rollup: the measured guardrail rates against the flat per-site
// estimate, which a 20% or 25% discount on this price clears comfortably —
// so the verdicts below are the full-use floor's alone.
jest.mock('../app/api/_lib/org-cogs', () => ({
  __esModule: true,
  latestMeasuredCogsUsd: async () => null,
}))

const { POST } = require('../app/api/admin/org-discount/route')

/** What Pro's bands cost at 100%, read off the production function. */
const PRO_FULL_USE_USD = fullUseMonthlyCogsUsd(PLAN_ENTITLEMENTS.pro)
/**
 * A negotiated monthly price that nets, after Stripe, exactly cost + 30% —
 * the headroom every tier is sized to carry.
 */
const PRICE_WITH_HEADROOM_USD =
  Math.ceil(((1.3 * PRO_FULL_USE_USD + 0.3) / (1 - 0.029)) * 100) / 100

/** The coupon the Stripe double answers `GET /v1/coupons/{id}` with. */
let coupon: Record<string, unknown> = {}
let subscriptionWrites: string[] = []

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  mockOrgWrites = []
  subscriptionWrites = []
  mockOrgDoc = { plan: 'pro', displayName: 'Acme' }
  mockBilling = {
    stripeCustomerId: 'cus_1',
    subscription: {
      status: 'active',
      interval: 'month',
      customMonthlyUsd: PRICE_WITH_HEADROOM_USD,
    },
  }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    if (path.startsWith('coupons/')) {
      return { ok: true, status: 200, json: async () => coupon }
    }
    if (path.startsWith('subscriptions?')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'sub_1', status: 'active' }] }),
      }
    }
    subscriptionWrites.push(String(init.body ?? ''))
    return { ok: true, status: 200, json: async () => ({ id: 'sub_1' }) }
  })
})

const apply = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/org-discount', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', action: 'apply', couponId: 'cpn_1', ...extra }),
    }),
  ) as Promise<Response>

describe('POST /api/admin/org-discount — the full-use verdict (AGL-3473)', () => {
  it('applies a ~20% coupon on a price with headroom, and says it covers cost', async () => {
    coupon = { id: 'cpn_1', percent_off: 20, duration: 'forever' }
    const response = await apply()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.fullUse).toMatchObject({ ok: true, warning: null })
    expect(subscriptionWrites).toEqual(['coupon=cpn_1'])
    expect(mockOrgWrites[0]).toMatchObject({ discount: { percentOff: 20 } })
  })

  it('applies a coupon that crosses 1.0× full-use cost, and warns with the figures', async () => {
    coupon = { id: 'cpn_1', percent_off: 25, duration: 'forever' }
    const response = await apply()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.fullUse.ok).toBe(false)
    expect(payload.fullUse.coverage).toBeLessThan(1)
    expect(payload.fullUse.warning).toMatch(/^under full-use cost on every monthly charge/)
    expect(payload.fullUse.warning).toContain(`$${PRO_FULL_USE_USD.toFixed(2)} of full-use cost`)
    expect(subscriptionWrites).toEqual(['coupon=cpn_1'])
    expect(mockAuditAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'org.discount.apply',
        after: expect.objectContaining({ fullUseOk: false }),
      }),
    )
  })

  it('judges a first-month coupon on the first month, with the year beside it', async () => {
    coupon = { id: 'cpn_1', percent_off: 25, duration: 'once' }
    const payload = await (await apply()).json()
    expect(payload.fullUse.ok).toBe(false)
    expect(payload.fullUse.warning).toMatch(/^under full-use cost on the first month's charge/)
    expect(payload.fullUse.warning).toContain('It touches 1 of the first 12 months')
    // Eleven months at a price netting cost + 30% carry the one under it.
    expect(payload.fullUse.firstYearCoverage).toBeGreaterThan(1)
  })

  it('holds a 75% coupon to the override when the subscription is on the billing doc', async () => {
    // Where every org migrated since AGL-1028 keeps it. The org doc carries no
    // subscription, so a guardrail reading it alone priced the org at $0 and
    // waved the coupon through.
    expect(mockOrgDoc['subscription']).toBeUndefined()
    coupon = { id: 'cpn_1', percent_off: 75, duration: 'once' }
    const refused = await apply()
    expect(refused.status).toBe(400)
    const payload = await refused.json()
    expect(payload.requiresConfirmation).toBe(true)
    expect(payload.rating).toMatchObject({ rating: 'block', reason: 'depth' })
    // The warning travels with the refusal, so the override is taken knowing it.
    expect(payload.fullUse.ok).toBe(false)
    expect(subscriptionWrites).toEqual([])

    const overridden = await apply({ confirmBelowFloor: true })
    expect(overridden.status).toBe(200)
    expect(subscriptionWrites).toEqual(['coupon=cpn_1'])
  })

  it('says when the org has no subscription price to judge against — and applies all the same', async () => {
    mockBilling = { stripeCustomerId: 'cus_1' }
    coupon = { id: 'cpn_1', percent_off: 5, duration: 'once' }
    const response = await apply()
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.fullUse.ok).toBe(false)
    expect(payload.fullUse.warning).toMatch(/no subscription price is on record/)
  })
})
