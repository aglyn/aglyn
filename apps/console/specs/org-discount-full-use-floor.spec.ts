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
 * APPLYING A COUPON TO AN ORG IS HELD TO THE FULL-USE FLOOR (AGL-3473).
 *
 * `/api/admin/org-discount` is where staff commit a discount to one org's live
 * subscription. Its guardrail rated the discount against what the org had
 * USED, so a deal was approved on the strength of a quiet month. The floor is
 * what the org would cost using every band it resolves to: a discount may
 * spend the margin a price carries above that, never the cost — and
 * `confirmBelowFloor`, the override for the measured guardrail, does not
 * reach it.
 *
 * The org here is priced so that it covers exactly cost + 30% at full use:
 * 20% off spends part of the margin and is applied; 25% off crosses 1.0× and
 * is refused. Real arithmetic throughout — only Firebase, the audit write and
 * Stripe are doubles.
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

describe('POST /api/admin/org-discount — the full-use floor (AGL-3473)', () => {
  it('applies a ~20% coupon on a price with headroom — it spends margin, not cost', async () => {
    coupon = { id: 'cpn_1', percent_off: 20 }
    const response = await apply()
    expect(response.status).toBe(200)
    expect(subscriptionWrites).toEqual(['coupon=cpn_1'])
    expect(mockOrgWrites[0]).toMatchObject({ discount: { percentOff: 20 } })
  })

  it('refuses a coupon that crosses 1.0× full-use cost, with the floor and the figures', async () => {
    coupon = { id: 'cpn_1', percent_off: 25 }
    const response = await apply()
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.code).toBe('full_use_floor')
    expect(payload.error).toContain('full-use cost')
    expect(payload.error).toContain(`$${PRO_FULL_USE_USD.toFixed(2)}`)
    expect(payload.fullUse.ok).toBe(false)
    expect(payload.fullUse.coverage).toBeLessThan(1)
    expect(subscriptionWrites).toEqual([])
    expect(mockOrgWrites).toEqual([])
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('is not lifted by the measured guardrail’s override', async () => {
    coupon = { id: 'cpn_1', percent_off: 25 }
    const response = await apply({ confirmBelowFloor: true })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('full_use_floor')
    expect(subscriptionWrites).toEqual([])
  })

  it('refuses an org with no subscription price on record rather than rating it free', async () => {
    mockBilling = { stripeCustomerId: 'cus_1' }
    coupon = { id: 'cpn_1', percent_off: 5 }
    const response = await apply()
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.code).toBe('full_use_floor')
    expect(payload.error).toMatch(/no subscription price on record/)
  })
})
