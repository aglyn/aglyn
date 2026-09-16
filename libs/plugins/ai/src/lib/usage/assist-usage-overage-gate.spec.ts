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
 * THE OVERAGE GUARDS AT THE RESERVATION (AGL-3011).
 *
 * `ai-overage-guards.spec.ts` proves the arithmetic. This proves the WIRING:
 * that a reservation reads the workspace's standing, answers
 * `refusedBy: 'cap'` with the right `capReason`, moves no counter doing it,
 * and — the case the whole design rests on — refuses at the unpaid limit
 * with no charge having run.
 *
 * It also proves the shipped-off state: with `AI_OVERAGE_INVOICED_FROM`
 * unset, a workspace $2,000 into overage is admitted exactly as it is today.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

import { AI_OVERAGE_INVOICED_FROM_ENV } from '../billing/ai-overage-cutover'
import { reserveAssistMessage } from './assist-usage'

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

/** Pro: a band of 2,750 credits, sold past at $3.00 per 1,000. */
const PRO = { plan: 'pro', subscription: { status: 'active' } }

/**
 * A month's measured provider spend that prices to `usd` of retail overage
 * on Pro. The band is 2,750 credits and a credit is $0.001 of spend.
 */
function spendPricingTo(usd: number): number {
  return (2_750 + (usd / 3) * 1_000) * 0.001
}

const ORIGINAL = process.env[AI_OVERAGE_INVOICED_FROM_ENV]

beforeEach(() => {
  docs = new Map()
  process.env[AI_OVERAGE_INVOICED_FROM_ENV] = MONTH
  docs.set(STANDING, { paymentMethodType: 'card' })
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
  else process.env[AI_OVERAGE_INVOICED_FROM_ENV] = ORIGINAL
})

function reserve(org: unknown = PRO) {
  return reserveAssistMessage(makeFirestore(), 'org-1', true, NOW, org as never)
}

describe('the guards refuse through the reservation', () => {
  it('admits a workspace inside its ceiling with a card', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(10), messages: 4 })
    const reservation = await reserve()
    expect(reservation.allowed).toBe(true)
    expect(reservation.capReason ?? null).toBeNull()
    expect(docs.get(USAGE)?.['messages']).toBe(5)
  })

  it('refuses with no card, as `cap` and `no-card`', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(10), messages: 4 })
    docs.set(STANDING, { paymentMethodType: 'us_bank_account' })
    const reservation = await reserve()
    expect(reservation.allowed).toBe(false)
    expect(reservation.refusedBy).toBe('cap')
    expect(reservation.capReason).toBe('no-card')
  })

  it('refuses while accrual is paused', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(10), messages: 4 })
    docs.set(STANDING, {
      paymentMethodType: 'card',
      pause: { reason: 'charge_failed', invoiceId: 'in_1' },
    })
    const reservation = await reserve()
    expect(reservation.refusedBy).toBe('cap')
    expect(reservation.capReason).toBe('paused')
  })

  it('refuses at the month’s ceiling and names the figure', async () => {
    docs.set(USAGE, {
      month: MONTH,
      // $50 of overage paid off in full, so only the CEILING can refuse.
      estCostUsd: spendPricingTo(50),
      overagePaidUsd: 50,
      messages: 4,
    })
    const reservation = await reserve()
    expect(reservation.refusedBy).toBe('cap')
    expect(reservation.capReason).toBe('limit')
    expect(reservation.overageLimitUsd).toBe(50)
  })

  it('lets a workspace with payment history run to its raised ceiling', async () => {
    docs.set(USAGE, {
      month: MONTH,
      estCostUsd: spendPricingTo(60),
      overagePaidUsd: 60,
      messages: 4,
    })
    docs.set(STANDING, {
      paymentMethodType: 'card',
      firstPaidMonth: '2026-07',
      qualifyingMonths: ['2026-08'],
    })
    const reservation = await reserve()
    expect(reservation.allowed).toBe(true)
  })

  it('never moves a counter on a refusal', async () => {
    // The point of a ceiling is that the workspace above it spends nothing
    // more — including the message this request would have counted.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(60), messages: 7 })
    const before = { ...(docs.get(USAGE) as Record<string, unknown>) }
    const reservation = await reserve()
    expect(reservation.allowed).toBe(false)
    expect(docs.get(USAGE)?.['messages']).toBe(before['messages'])
    expect(docs.get(USAGE)?.['estCostUsd']).toBe(before['estCostUsd'])
  })

  it('leaves the workspace’s OWN ceiling naming itself', async () => {
    // AGL-2898's refusal keeps its sentence and its reason; the guards here
    // are Aglyn's and must not take the credit for the customer's control.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(10), messages: 4 })
    const reservation = await reserve({
      ...PRO,
      assistOverage: { capUsd: 5 },
    })
    expect(reservation.refusedBy).toBe('cap')
    expect(reservation.capReason).toBe('customer')
  })
})

describe('the bound holds when no charge has run', () => {
  it('refuses at the unpaid limit with nothing ever paid', async () => {
    // No `overagePaidUsd` at all — the state of a workspace whose charges
    // were never made: a killed background task, a Stripe outage, a bug.
    // The top rung of the ladder, so the ceiling is not what refuses.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(50), messages: 4 })
    docs.set(STANDING, {
      paymentMethodType: 'card',
      firstPaidMonth: '2026-06',
      qualifyingMonths: ['2026-07', '2026-08'],
    })
    const reservation = await reserve()
    expect(reservation.refusedBy).toBe('cap')
    expect(reservation.capReason).toBe('settling')
    expect(reservation.overageUnpaidUsd).toBeCloseTo(50, 2)
    expect(docs.get(USAGE)?.['messages']).toBe(4)
  })

  it('admits the same workspace once the charges settle', async () => {
    docs.set(USAGE, {
      month: MONTH,
      estCostUsd: spendPricingTo(50),
      overagePaidUsd: 50,
      messages: 4,
    })
    docs.set(STANDING, {
      paymentMethodType: 'card',
      firstPaidMonth: '2026-06',
      qualifyingMonths: ['2026-07', '2026-08'],
    })
    const reservation = await reserve()
    expect(reservation.allowed).toBe(true)
  })
})

describe('with the cutover unset, nothing changes for anybody', () => {
  it('admits a workspace far past the unpaid limit', async () => {
    // How this ships. Overage accrues, the monthly meter bills it, and the
    // guards refuse nobody — because before the cutover there is no invoice
    // for a refused workspace to pay.
    delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(2_000), messages: 4 })
    docs.set(STANDING, { paymentMethodType: null })
    const reservation = await reserve()
    expect(reservation.allowed).toBe(true)
    expect(reservation.capReason ?? null).toBeNull()
  })

  it('keeps refusing on the workspace’s own ceiling, which predates all this', async () => {
    delete process.env[AI_OVERAGE_INVOICED_FROM_ENV]
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(10), messages: 4 })
    const reservation = await reserve({ ...PRO, assistOverage: { capUsd: 5 } })
    expect(reservation.refusedBy).toBe('cap')
    expect(reservation.capReason).toBe('customer')
  })
})

describe('a plan that sells nothing past its band never reaches the guards', () => {
  it('leaves Free refusing at its wall', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: 10, messages: 4 })
    docs.set(STANDING, { paymentMethodType: null })
    const reservation = await reserve({ plan: 'free' })
    // The band is the wall on Free (AGL-2925), and a workspace with no
    // overage to guard must never hear an overage sentence.
    expect(reservation.capReason ?? null).toBeNull()
    expect(['band', 'budget', 'messages', null]).toContain(reservation.refusedBy)
  })
})
