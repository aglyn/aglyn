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
 * THE CHARGE LEDGER (AGL-3011).
 *
 * Money is claimed here before it is asked for, so the properties worth
 * proving are about what happens when two things try at once and when one of
 * them dies half-way. The Firestore double models `increment` and merging
 * `set` exactly, and SERIALISES transactions — a double that let two
 * transactions interleave their reads would go green on the very race the
 * claim exists to close.
 */

import {
  AI_OVERAGE_MIN_CHARGE_USD,
  AI_OVERAGE_THRESHOLD_USD,
} from './ai-overage-standing'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

import {
  claimAiOverageCharge,
  aiOverageChargeId,
  floorToCent,
  readAiOverageMonthLedger,
  settleAiOverageCharge,
} from './ai-overage-ledger'

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

/** Firestore's own `increment` + deep merge, or the counters are fiction. */
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

/**
 * One transaction at a time, FIFO — the guarantee Firestore gives and the
 * one the claim's correctness rests on.
 */
let txChain: Promise<void> = Promise.resolve()
function txLock(): Promise<() => void> {
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const waitFor = txChain
  txChain = txChain.then(() => next)
  return waitFor.then(() => release)
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
      const release = await txLock()
      try {
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
      } finally {
        release()
      }
    },
  } as unknown as FirebaseFirestore.Firestore
}

const MONTH = '2026-09'
const USAGE = `orgs/org-1/assistUsage/${MONTH}`
const STANDING = 'orgs/org-1/aiBilling/standing'

/** Pro: 11,750 credits with the add-on, sold past at $3.00 per 1,000. */
const PRO = { plan: 'pro', subscription: { status: 'active' } }

/** A month's measured provider spend, in dollars, that prices to `usd`. */
function spendPricingTo(usd: number, ratePer1k = 3, bandCredits = 2_750): number {
  // Retail dollars -> credits over the band -> the provider dollars that
  // many credits cost. A credit is $0.001 of spend, band included.
  const overageCredits = (usd / ratePer1k) * 1_000
  return (bandCredits + overageCredits) * 0.001
}

beforeEach(() => {
  docs = new Map()
  txChain = Promise.resolve()
  docs.set(STANDING, { paymentMethodType: 'card' })
})

describe('claiming a charge', () => {
  it('waits for the threshold', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(24.99) })
    const below = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'threshold',
    })
    expect(below.refused).toBe('below-threshold')

    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(25) })
    const at = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'threshold',
    })
    expect(at.claimed?.amountUsd).toBe(AI_OVERAGE_THRESHOLD_USD)
  })

  it('claims once when two requests cross the threshold together', async () => {
    // THE RACE THE CLAIM EXISTS TO CLOSE. Both read a month with $30
    // unbilled; only one may take it, or the workspace is charged twice for
    // the same dollars.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(30) })
    const firestore = makeFirestore()
    const [first, second] = await Promise.all([
      claimAiOverageCharge(firestore, {
        orgId: 'org-1',
        org: PRO as never,
        month: MONTH,
        kind: 'threshold',
      }),
      claimAiOverageCharge(firestore, {
        orgId: 'org-1',
        org: PRO as never,
        month: MONTH,
        kind: 'threshold',
      }),
    ])
    const claims = [first, second].filter((result) => result.claimed)
    expect(claims).toHaveLength(1)
    expect([first, second].find((r) => r.refused)?.refused).toBe('charge-already-open')
    const ledger = readAiOverageMonthLedger(docs.get(USAGE))
    expect(ledger.invoicedUsd).toBe(30)
    expect(ledger.charges).toBe(1)
  })

  it('moves the invoiced total forward so the next claim sees only what is left', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(30) })
    const firestore = makeFirestore()
    const first = await claimAiOverageCharge(firestore, {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'threshold',
    })
    await settleAiOverageCharge(firestore, 'org-1', {
      chargeId: first.claimed!.chargeId,
      month: MONTH,
      invoiceId: 'in_1',
      status: 'paid',
    })
    // The month grows to $54 of overage: $24 unbilled, under the threshold.
    docs.set(USAGE, {
      ...(docs.get(USAGE) ?? {}),
      estCostUsd: spendPricingTo(54),
    })
    const second = await claimAiOverageCharge(firestore, {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'threshold',
    })
    expect(second.refused).toBe('below-threshold')
  })

  it('refuses without a card, while paused, and on a plan that sells nothing', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(40) })
    docs.set(STANDING, { paymentMethodType: null })
    expect(
      (
        await claimAiOverageCharge(makeFirestore(), {
          orgId: 'org-1',
          org: PRO as never,
          month: MONTH,
          kind: 'threshold',
        })
      ).refused,
    ).toBe('no-card')

    docs.set(STANDING, {
      paymentMethodType: 'card',
      pause: { reason: 'charge_failed', invoiceId: 'in_1' },
    })
    expect(
      (
        await claimAiOverageCharge(makeFirestore(), {
          orgId: 'org-1',
          org: PRO as never,
          month: MONTH,
          kind: 'threshold',
        })
      ).refused,
    ).toBe('paused')

    docs.set(STANDING, { paymentMethodType: 'card' })
    // Free sells no credits past its band, so there is nothing to bill.
    expect(
      (
        await claimAiOverageCharge(makeFirestore(), {
          orgId: 'org-1',
          org: { plan: 'free' } as never,
          month: MONTH,
          kind: 'threshold',
        })
      ).refused,
    ).toBe('not-sold')
  })

  it('bills a close-out below the threshold but never below Stripe’s minimum', async () => {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(3) })
    const small = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'closeout',
    })
    expect(small.claimed?.amountUsd).toBe(3)
    expect(small.claimed?.kind).toBe('closeout')

    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(0.3) })
    const tiny = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'closeout',
    })
    // An invoice under the minimum can never be paid; dunning would chase it
    // forever. Carried, not sent.
    expect(tiny.refused).toBe('below-threshold')
    expect(AI_OVERAGE_MIN_CHARGE_USD).toBe(0.5)
  })

  it('floors to the cent, because a rounded-up cent was never accrued', () => {
    expect(floorToCent(25.999)).toBe(25.99)
    expect(floorToCent(-3)).toBe(0)
    expect(floorToCent(Number.NaN)).toBe(0)
  })

  it('numbers charges in sequence within the month', () => {
    expect(aiOverageChargeId('2026-09', 1)).toBe('2026-09-001')
    expect(aiOverageChargeId('2026-09', 12)).toBe('2026-09-012')
  })
})

describe('settling a charge', () => {
  async function claimOne() {
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(30) })
    const firestore = makeFirestore()
    const claim = await claimAiOverageCharge(firestore, {
      orgId: 'org-1',
      org: PRO as never,
      month: MONTH,
      kind: 'threshold',
    })
    return { firestore, claim: claim.claimed! }
  }

  it('counts a payment once, however often the outcome arrives', async () => {
    // The synchronous answer and the webhook both report a paid invoice.
    // Recording the status twice is harmless; moving the money twice would
    // credit the workspace $30 it never paid and let it spend it.
    const { firestore, claim } = await claimOne()
    for (let i = 0; i < 3; i += 1) {
      await settleAiOverageCharge(firestore, 'org-1', {
        chargeId: claim.chargeId,
        month: MONTH,
        invoiceId: 'in_1',
        status: 'paid',
      })
    }
    expect(readAiOverageMonthLedger(docs.get(USAGE)).paidUsd).toBe(30)
  })

  it('keeps the claim on an invoice that exists but did not pay', async () => {
    // Stripe may still retry it, and re-billing the same dollars on a second
    // invoice would charge the customer twice for one month.
    const { firestore, claim } = await claimOne()
    await settleAiOverageCharge(firestore, 'org-1', {
      chargeId: claim.chargeId,
      month: MONTH,
      invoiceId: 'in_failed',
      status: 'failed',
    })
    const ledger = readAiOverageMonthLedger(docs.get(USAGE))
    expect(ledger.invoicedUsd).toBe(30)
    expect(ledger.paidUsd).toBe(0)
    // The slot is cleared either way, or the close-out and every later
    // charge queue behind an invoice that will not move on its own.
    expect(ledger.open).toBeNull()
  })

  it('releases a claim that never became an invoice at all', async () => {
    const { firestore, claim } = await claimOne()
    await settleAiOverageCharge(firestore, 'org-1', {
      chargeId: claim.chargeId,
      month: MONTH,
      invoiceId: null,
      status: 'failed',
    })
    const ledger = readAiOverageMonthLedger(docs.get(USAGE))
    // Back to unbilled, so a later attempt bills these dollars rather than
    // leaving them permanently claimed and never charged.
    expect(ledger.invoicedUsd).toBe(0)
    expect(ledger.charges).toBe(0)
    expect(ledger.open).toBeNull()
  })

  it('records the invoice and the status on the audit row', async () => {
    const { firestore, claim } = await claimOne()
    await settleAiOverageCharge(firestore, 'org-1', {
      chargeId: claim.chargeId,
      month: MONTH,
      invoiceId: 'in_1',
      status: 'paid',
    })
    const row = docs.get(`orgs/org-1/aiOverageCharges/${claim.chargeId}`)
    expect(row).toMatchObject({
      month: MONTH,
      kind: 'threshold',
      amountUsd: 30,
      invoiceId: 'in_1',
      status: 'paid',
    })
    // The credits and the rate the amount came from, so a staff question
    // about one charge is answerable without re-deriving a month.
    expect(Number(row?.['credits'])).toBeGreaterThan(0)
    expect(row?.['rateUsdPer1k']).toBe(3)
  })
})
