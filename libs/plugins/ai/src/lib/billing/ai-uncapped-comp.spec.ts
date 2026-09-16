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
 * AN UNCAPPED STAFF COMP AT THE AI METER (AGL-3049).
 *
 * An uncapped comp lifts every band — the shape an internal workspace needs —
 * and the AI band is the one where "lifted" is easiest to get wrong. The band
 * resolves `UNLIMITED`, `resolveAssistCreditBudget` reads that as no band at
 * all, and "no band" is also what a workspace that was never sold one looks
 * like, which the reservation bounds with a $40 repo default. Left there, the
 * workspace staff uncapped would be walled at $40 a month, lower than the
 * Enterprise band it had before.
 *
 * So these cases drive the REAL reservation and the REAL charge entry points,
 * with the invoice cutover on, a Stripe customer and a card on file, and pin:
 *
 *  1. it is never refused at a band, nor by the backstop default standing in
 *     for one, and each request is still counted;
 *  2. an operator's explicit ceiling still binds it, as it binds everyone;
 *  3. it is never metered as billable: no claim, no invoice call;
 *  4. a live subscription ignores it: the paying plan's band and rate apply;
 *  5. what staff are shown about it crosses JSON as booleans and nulls.
 *
 * Every case has a control that differs in the one field under test.
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

import { resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { reserveAssistMessage } from '../usage/assist-usage'
import {
  composeStaffOrgAiOverage,
  composeStaffOrgAiPool,
} from '../usage/staff-org-ai'
import {
  AI_OVERAGE_PRODUCT_ENV,
  closeOutAiOverage,
  maybeChargeAiOverage,
} from './ai-overage-charge'
import { AI_OVERAGE_INVOICED_FROM_ENV } from './ai-overage-cutover'
import { claimAiOverageCharge } from './ai-overage-ledger'

let docs = new Map<string, Record<string, unknown>>()

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !('__inc' in (value as object))
  )
}

function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') base[key] = Number(base[key] ?? 0) + inc
    else if (isPlainMap(value)) {
      base[key] = applyData(merge && isPlainMap(base[key]) ? base[key] : undefined, value, true)
    } else base[key] = value
  }
  return base
}

function snapshotOf(path: string) {
  return {
    exists: docs.has(path),
    data: () => docs.get(path),
    get: (field: string) => (docs.get(path) ?? {})[field],
  }
}

/** A merge-and-increment double: enough of Firestore for the meter and the ledger. */
function makeFirestore(): FirebaseFirestore.Firestore {
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      docs.set(path, applyData(docs.get(path), data, Boolean(options?.merge)))
    },
  })
  const makeCollection = (path: string) => ({
    doc: (id: string) => makeDoc(`${path}/${id}`),
  })
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async <T,>(
      fn: (tx: {
        get: (ref: { path: string }) => Promise<unknown>
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => void
      }) => Promise<T>,
    ): Promise<T> => {
      const queued: Array<() => void> = []
      const result = await fn({
        get: async (ref) => snapshotOf(ref.path),
        set: (ref, data, options) => {
          queued.push(() => {
            docs.set(ref.path, applyData(docs.get(ref.path), data, Boolean(options?.merge)))
          })
        },
      })
      for (const write of queued) write()
      return result
    },
  } as unknown as FirebaseFirestore.Firestore
}

const NOW = new Date('2026-10-16T12:00:00.000Z')
const MONTH = '2026-10'
const USAGE = `orgs/org-1/assistUsage/${MONTH}`
const STANDING = 'orgs/org-1/aiBilling/standing'

/**
 * $500 of spend this month: past Enterprise's 116,000-credit band ($116),
 * past the $40 backstop default, and past Agency's band too.
 */
const SPEND_USD = 500

/** The grant as the override route writes it. */
const grant = (plan: string, uncapped: boolean) => ({
  plan,
  uncapped,
  reason: 'other',
  note: 'Internal workspace',
  grantedBy: 'staff-1',
})

/** aglyn-org's shape once comped: Enterprise stored before comps, no subscription. */
const UNCAPPED = {
  plan: 'enterprise',
  enterprise: true,
  entitlements: { planComp: grant('enterprise', true) },
}
/** The control: the same grant, capped. */
const CAPPED = {
  plan: 'enterprise',
  enterprise: true,
  entitlements: { planComp: grant('enterprise', false) },
}
/**
 * A paying Pro workspace holding a DORMANT uncapped comp: the subscription
 * decides, so Pro's band is sold past at Pro's rate.
 */
const PAYING_WITH_DORMANT_COMP = {
  plan: 'pro',
  billingStatus: 'active',
  entitlements: { planComp: grant('agency', true) },
}

const ENV_KEYS = [
  AI_OVERAGE_INVOICED_FROM_ENV,
  AI_OVERAGE_PRODUCT_ENV,
  'ASSIST_ORG_MONTHLY_COGS_LIMIT_USD',
  'ASSIST_ENTITLED_MONTHLY_LIMIT',
] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

beforeEach(() => {
  docs = new Map()
  docs.set(STANDING, { paymentMethodType: 'card' })
  docs.set(USAGE, { month: MONTH, messages: 3, estCostUsd: SPEND_USD })
  process.env[AI_OVERAGE_INVOICED_FROM_ENV] = MONTH
  process.env[AI_OVERAGE_PRODUCT_ENV] = 'prod_ai_overage_test'
  // Nothing configured: the repo default is what would stand in for a band.
  delete process.env['ASSIST_ORG_MONTHLY_COGS_LIMIT_USD']
  delete process.env['ASSIST_ENTITLED_MONTHLY_LIMIT']
  mockChargeOrgUsageInvoice.mockReset().mockResolvedValue({
    ok: true,
    invoiceId: 'in_1',
    amountPaidCents: 2500,
    error: null,
  })
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
})

describe('an uncapped comp is never refused at a band (AGL-3049)', () => {
  it('admits a request far past its plan’s band and the backstop default, and counts it', async () => {
    const reservation = await reserveAssistMessage(makeFirestore(), 'org-1', true, NOW, UNCAPPED as never)
    expect(reservation).toMatchObject({
      allowed: true,
      refusedBy: null,
      costUsd: SPEND_USD,
      costLimitUsd: null,
      budgetUsd: null,
    })
    expect(docs.get(USAGE)?.['messages']).toBe(4)
    // The band it reads as — unlimited, not a zero somebody could refuse at.
    expect(resolveOrgEntitlements(UNCAPPED as never).assistCreditsPerMonth).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('the control: the same grant, capped, is refused at its band and moves no counter', async () => {
    const reservation = await reserveAssistMessage(makeFirestore(), 'org-1', true, NOW, CAPPED as never)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
    expect(docs.get(USAGE)?.['messages']).toBe(3)
  })

  it('an operator’s explicit ceiling still binds it, as it binds every workspace', async () => {
    process.env['ASSIST_ORG_MONTHLY_COGS_LIMIT_USD'] = '200'
    const reservation = await reserveAssistMessage(makeFirestore(), 'org-1', true, NOW, UNCAPPED as never)
    expect(reservation).toMatchObject({
      allowed: false,
      refusedBy: 'budget',
      costLimitUsd: 200,
    })
    expect(docs.get(USAGE)?.['messages']).toBe(3)
  })

  it('and the runaway message guard is not a band: it still applies', async () => {
    process.env['ASSIST_ENTITLED_MONTHLY_LIMIT'] = '3'
    const reservation = await reserveAssistMessage(makeFirestore(), 'org-1', true, NOW, UNCAPPED as never)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'messages' })
  })
})

describe('an uncapped comp never reaches Stripe (AGL-3049)', () => {
  it('claims nothing, on either kind of charge, and moves no counter', async () => {
    for (const kind of ['threshold', 'closeout'] as const) {
      const claim = await claimAiOverageCharge(makeFirestore(), {
        orgId: 'org-1',
        org: UNCAPPED as never,
        month: MONTH,
        kind,
      })
      expect(claim).toEqual({ claimed: null, refused: 'not-sold' })
    }
    expect(docs.get(USAGE)).toEqual({ month: MONTH, messages: 3, estCostUsd: SPEND_USD })
    expect([...docs.keys()].some((path) => path.includes('aiOverageCharges'))).toBe(false)
  })

  it('never calls the invoice function, with a Stripe customer and a card on file', async () => {
    const request = {
      orgId: 'org-1',
      org: UNCAPPED as never,
      month: MONTH,
      stripeCustomerId: 'cus_internal',
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
})

describe('a live subscription ignores an uncapped comp (AGL-3049)', () => {
  it('reserves exactly as the same paying workspace with no comp at all', async () => {
    const seeded = new Map([...docs].map(([path, data]) => [path, { ...data }]))
    const withComp = await reserveAssistMessage(
      makeFirestore(),
      'org-1',
      true,
      NOW,
      PAYING_WITH_DORMANT_COMP as never,
    )
    docs = seeded
    const paying = {
      plan: PAYING_WITH_DORMANT_COMP.plan,
      billingStatus: PAYING_WITH_DORMANT_COMP.billingStatus,
    }
    const withoutComp = await reserveAssistMessage(
      makeFirestore(),
      'org-1',
      true,
      NOW,
      paying as never,
    )
    expect(withComp).toEqual(withoutComp)
    // Pro's own band is what was measured: finite, not lifted away.
    expect(withComp.budgetUsd).toBe(2.75)
  })

  it('charges past the paying plan’s band — the comp lifts and withholds nothing while dormant', async () => {
    const outcome = await maybeChargeAiOverage(makeFirestore(), {
      orgId: 'org-1',
      org: PAYING_WITH_DORMANT_COMP as never,
      month: MONTH,
      stripeCustomerId: 'cus_paying',
    })
    expect(outcome.charged).toBe(true)
    expect(mockChargeOrgUsageInvoice).toHaveBeenCalledTimes(1)
  })

  it('and its own hard cap refuses at the paying plan’s band', async () => {
    const reservation = await reserveAssistMessage(makeFirestore(), 'org-1', true, NOW, {
      ...PAYING_WITH_DORMANT_COMP,
      assistOverage: { hardCap: true },
    } as never)
    expect(reservation).toMatchObject({ allowed: false, refusedBy: 'band' })
  })
})

describe('what staff read about an uncapped comp (AGL-3049)', () => {
  it('the staff AI card’s pool and overage cross JSON as themselves — no band is null, and the flag says why', () => {
    const now = new Date(NOW)
    const wire = JSON.parse(
      JSON.stringify({
        pool: composeStaffOrgAiPool(UNCAPPED as never, docs.get(USAGE), now),
        overage: composeStaffOrgAiOverage(UNCAPPED as never, SPEND_USD),
      }),
    )
    expect(wire.pool).toMatchObject({
      totalCredits: null,
      remainingCredits: null,
      uncapped: true,
      usedCredits: 500_000,
    })
    expect(wire.overage).toMatchObject({
      overageCredits: 0,
      accruedUsd: 0,
      rateUsdPer1k: null,
      sellsOverage: false,
      bandRefuses: false,
    })
    // The control: the capped grant carries Enterprise's band and no flag.
    const capped = composeStaffOrgAiPool(CAPPED as never, docs.get(USAGE), now)
    expect(capped).toMatchObject({ totalCredits: 116_000, uncapped: false })
  })

})
