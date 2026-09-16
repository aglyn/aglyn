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

/**
 * A STAFF COMP NEVER REACHES STRIPE (AGL-3034).
 *
 * A comp puts a workspace on a paid plan with no subscription behind it. AI
 * overage is charged as it accrues since AGL-3011, straight to the Stripe
 * customer as one-off invoices — no subscription required — and a canceled
 * customer keeps their Stripe customer and their card. So a comp that priced
 * overage at its plan's rate would invoice a workspace nobody sold anything
 * to, the day staff granted it.
 *
 * The fix is structural: `resolvePlanPricing` sells nothing on a comp, so
 * `assistMonthOverage` prices its overage to zero and the claim refuses it as
 * `not-sold` before any Stripe call. These cases drive the real ledger and
 * the real charge entry points with the cutover ON, a Stripe customer and a
 * card on file — every condition under which a paying workspace IS charged —
 * and prove the invoice function is never called for the comp, while the
 * same month on a live subscription does reach it.
 */

const mockChargeOrgUsageInvoice = jest.fn()
jest.mock('@aglyn/tenant-data-admin/server/usage-invoice', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/tenant-data-admin/server/usage-invoice'),
  chargeOrgUsageInvoice: (...args: unknown[]) => mockChargeOrgUsageInvoice(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

import { isBillingSubscription } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  closeOutAiOverage,
  maybeChargeAiOverage,
  AI_OVERAGE_PRODUCT_ENV,
} from './ai-overage-charge'
import { AI_OVERAGE_INVOICED_FROM_ENV } from './ai-overage-cutover'
import { claimAiOverageCharge } from './ai-overage-ledger'
import { aiOverageCardOnFile, readAiOverageStanding } from './ai-overage-standing'

let docs = new Map<string, Record<string, unknown>>()

/** A merge-and-increment double: enough of a transaction for the ledger. */
function makeFirestore(): FirebaseFirestore.Firestore {
  const snapshotOf = (path: string) => ({
    exists: docs.has(path),
    data: () => docs.get(path),
    get: (field: string) => (docs.get(path) ?? {})[field],
  })
  const apply = (path: string, data: Record<string, unknown>) => {
    const next = { ...(docs.get(path) ?? {}) }
    for (const [key, value] of Object.entries(data)) {
      const inc = (value as { __inc?: number } | null)?.__inc
      next[key] = typeof inc === 'number' ? Number(next[key] ?? 0) + inc : value
    }
    docs.set(path, next)
  }
  const makeDoc = (path: string): any => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => makeDoc(`${path}/${name}/${id}`) }),
    get: async () => snapshotOf(path),
  })
  return {
    collection: (name: string) => ({ doc: (id: string) => makeDoc(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const queued: Array<() => void> = []
      const result = await fn({
        get: async (ref: { path: string }) => snapshotOf(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          queued.push(() => apply(ref.path, data))
        },
      })
      for (const write of queued) write()
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

const MONTH = '2026-09'
const USAGE = `orgs/org-1/assistUsage/${MONTH}`
const STANDING = 'orgs/org-1/aiBilling/standing'

/**
 * test-org once comped: canceled, Pro granted by staff, its own 5,000-credit
 * band. The Stripe customer survives cancellation, so the request carries one.
 */
const COMPED = {
  plan: 'pro',
  billingStatus: 'canceled',
  entitlements: {
    assistCreditsPerMonth: 5000,
    planComp: { plan: 'pro', reason: 'beta', note: null, grantedBy: 'staff-1' },
  },
}
/** The control: the same plan and band on a live subscription. */
const PAYING = {
  plan: 'pro',
  billingStatus: 'active',
  entitlements: { assistCreditsPerMonth: 5000 },
}

const ORIGINAL_CUTOVER = process.env[AI_OVERAGE_INVOICED_FROM_ENV]
const ORIGINAL_PRODUCT = process.env[AI_OVERAGE_PRODUCT_ENV]

beforeEach(() => {
  docs = new Map()
  // A card on file and every guard clear: nothing here refuses for any
  // reason but the one under test.
  docs.set(STANDING, { paymentMethodType: 'card' })
  // $500 of spend against a 5,000-credit band: 495,000 credits past it.
  docs.set(USAGE, { month: MONTH, estCostUsd: 500 })
  process.env[AI_OVERAGE_INVOICED_FROM_ENV] = MONTH
  process.env[AI_OVERAGE_PRODUCT_ENV] = 'prod_ai_overage_test'
  mockChargeOrgUsageInvoice.mockReset().mockResolvedValue({
    ok: true,
    invoiceId: 'in_1',
    amountPaidCents: 2500,
    error: null,
  })
})

afterAll(() => {
  if (ORIGINAL_CUTOVER === undefined) delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
  else process.env[AI_OVERAGE_INVOICED_FROM_ENV] = ORIGINAL_CUTOVER
  if (ORIGINAL_PRODUCT === undefined) delete process.env[AI_OVERAGE_PRODUCT_ENV]
  else process.env[AI_OVERAGE_PRODUCT_ENV] = ORIGINAL_PRODUCT
})

describe('a staff comp never reaches Stripe (AGL-3034)', () => {
  it('claims nothing, on either kind of charge, and moves no counter', async () => {
    for (const kind of ['threshold', 'closeout'] as const) {
      const claim = await claimAiOverageCharge(makeFirestore(), {
        orgId: 'org-1',
        org: COMPED as never,
        month: MONTH,
        kind,
      })
      expect(claim).toEqual({ claimed: null, refused: 'not-sold' })
    }
    expect(docs.get(USAGE)).toEqual({ month: MONTH, estCostUsd: 500 })
    expect([...docs.keys()].some((path) => path.includes('aiOverageCharges'))).toBe(false)
  })

  it('never calls the invoice function — threshold or close-out — with a customer and a card', async () => {
    const request = {
      orgId: 'org-1',
      org: COMPED as never,
      month: MONTH,
      stripeCustomerId: 'cus_comped',
    }
    expect(await maybeChargeAiOverage(makeFirestore(), request)).toMatchObject({
      charged: false,
      invoiceId: null,
      skipped: 'not-sold',
    })
    expect(await closeOutAiOverage(makeFirestore(), request)).toMatchObject({
      charged: false,
      invoiceId: null,
      skipped: 'not-sold',
    })
    expect(mockChargeOrgUsageInvoice).not.toHaveBeenCalled()
  })

  it('the control: the same month on a live subscription IS charged', async () => {
    // Without this, a charge path broken for everyone would pass the case
    // above.
    const outcome = await maybeChargeAiOverage(makeFirestore(), {
      orgId: 'org-1',
      org: PAYING as never,
      month: MONTH,
      stripeCustomerId: 'cus_paying',
    })
    expect(outcome.charged).toBe(true)
    expect(mockChargeOrgUsageInvoice).toHaveBeenCalledTimes(1)
    expect(mockChargeOrgUsageInvoice.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      stripeCustomerId: 'cus_paying',
    })
  })

  it('is never a paying subscription, and grants no card on file', () => {
    // The comp lives on the org document; the card question is answered
    // only by the standing document Stripe's own events write.
    expect(isBillingSubscription(COMPED as never)).toBe(false)
    expect(aiOverageCardOnFile(readAiOverageStanding(null))).toBeUndefined()
    expect(aiOverageCardOnFile(readAiOverageStanding({ paymentMethodType: null }))).toBe(false)
  })
})
