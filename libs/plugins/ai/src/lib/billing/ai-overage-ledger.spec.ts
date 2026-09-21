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

import { USAGE_INVOICE_MIN_CHARGE_CENTS } from '@aglyn/tenant-data-admin/server/usage-invoice'
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
      paidUsd: 30,
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
    // An invoice under the minimum is worse than unpayable: Stripe finalizes
    // it as PAID having collected nothing (AGL-3023). Carried, not sent.
    expect(tiny.refused).toBe('below-threshold')
    expect(AI_OVERAGE_MIN_CHARGE_USD).toBe(0.5)
  })

  it('holds its floor at exactly the figure the invoice module enforces', () => {
    /*
     * Two floors, one number, and they must not drift (AGL-3023).
     *
     * `chargeOrgUsageInvoice` refuses anything under Stripe's minimum, so a
     * close-out floor BELOW it would claim dollars the charge path then
     * refuses — the month would read as billed and nothing would be sent.
     * A floor above it is merely conservative and allowed; below it is a
     * silent revenue hole, which is what this pins.
     */
    expect(AI_OVERAGE_MIN_CHARGE_USD * 100).toBeGreaterThanOrEqual(
      USAGE_INVOICE_MIN_CHARGE_CENTS,
    )
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
        paidUsd: 30,
      })
    }
    expect(readAiOverageMonthLedger(docs.get(USAGE)).paidUsd).toBe(30)
  })

  it('credits what STRIPE collected, never what we claimed (AGL-3023)', async () => {
    /*
     * The fail-open this closes. `overagePaidUsd` is the figure the gate
     * subtracts to decide whether a workspace may keep spending — so a
     * settlement that credited the CLAIM would clear a balance nobody paid,
     * and the unpaid bound would be satisfied by our own bookkeeping rather
     * than by money.
     *
     * This is not hypothetical: AGL-3023's invoices finalized at $0 and read
     * `paid`. Crediting the claim there would have handed every workspace an
     * unbounded month.
     */
    const { firestore, claim } = await claimOne()
    await settleAiOverageCharge(firestore, 'org-1', {
      chargeId: claim.chargeId,
      month: MONTH,
      invoiceId: 'in_zero',
      status: 'paid',
      paidUsd: 0,
    })
    expect(readAiOverageMonthLedger(docs.get(USAGE)).paidUsd).toBe(0)
    // The claim still stands against the month: the dollars were billed on
    // an invoice that exists, and re-billing them would charge twice.
    expect(readAiOverageMonthLedger(docs.get(USAGE)).invoicedUsd).toBe(30)
  })

  it('credits a part payment by its part, not by the whole', async () => {
    const { firestore, claim } = await claimOne()
    await settleAiOverageCharge(firestore, 'org-1', {
      chargeId: claim.chargeId,
      month: MONTH,
      invoiceId: 'in_1',
      status: 'paid',
      paidUsd: 12.5,
    })
    expect(readAiOverageMonthLedger(docs.get(USAGE)).paidUsd).toBe(12.5)
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
      paidUsd: 30,
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

describe('Starter WITH the AI add-on is charged at the rate its card quotes (AGL-3014)', () => {
  /**
   * Starter used to list no band and no rate, and the add-on brought both —
   * which is the split AGL-3014 was made of. Since AGL-3203 the plan's own
   * row carries 750 credits and $3.00 per 1,000, and the add-on only widens
   * the band to 4,750. From the cutover month this claim is the invoice for
   * that overage, so it has to price the month exactly as the overage card,
   * the ceiling, the 100% alert and the gate do — with the add-on and
   * without it.
   */
  const STARTER_WITH_AI = {
    plan: 'starter',
    subscription: { status: 'active' },
    seatAddons: { aiAddon: 1 },
  }
  /** Starter's 750 plus the add-on's 4,000 — one pool, one meter. */
  const ADDON_BAND = 4_750

  beforeAll(() => {
    // The band arrives with the plugin's declaration of the add-on, which a
    // running app registers by a call at boot.
    const { registerAiDeclarations } = require('../declarations') as typeof import('../declarations')
    registerAiDeclarations()
  })

  it('claims the overage past the add-on band at $3.00 per 1,000', async () => {
    // 14,750 credits drawn: 10,000 past the 4,750 band, $30.00. FORCED RED
    // by deciding `not-sold` off the plan table: the claim was refused and
    // nothing was invoiced.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(30, 3, ADDON_BAND) })
    const result = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: STARTER_WITH_AI as never,
      month: MONTH,
      kind: 'threshold',
    })
    expect(result.refused).toBeNull()
    expect(result.claimed).toMatchObject({ amountUsd: 30, credits: 10_000, rateUsdPer1k: 3 })
    expect(readAiOverageMonthLedger(docs.get(USAGE)).invoicedUsd).toBe(30)
  })

  it('THE CONTROL: without the add-on the same month is claimed at the same rate, from the plan’s own band', async () => {
    // The AGL-3014 bug was the two halves disagreeing about Starter. They
    // cannot now: the rate is one figure on the plan's row (AGL-3203), so
    // the same 14,750 credits are claimed either way — only the band the
    // overage is measured from moves. Bare Starter bands at 750, so all but
    // 750 of the month is overage: 14,000 credits, $42.00.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(30, 3, ADDON_BAND) })
    const result = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: { plan: 'starter', subscription: { status: 'active' } } as never,
      month: MONTH,
      kind: 'threshold',
    })
    expect(result.refused).toBeNull()
    expect(result.claimed).toMatchObject({ amountUsd: 42, credits: 14_000, rateUsdPer1k: 3 })
    expect(readAiOverageMonthLedger(docs.get(USAGE)).invoicedUsd).toBe(42)
  })

  it('THE COUNTER-CASE: a plan that quotes no rate claims nothing from the same month', async () => {
    // What still refuses `not-sold`: a plan with no rate at all. Free bands
    // and then walls (AGL-2925), so the identical spend is never a charge —
    // which is what keeps the claim above from reading as unconditional.
    docs.set(USAGE, { month: MONTH, estCostUsd: spendPricingTo(30, 3, ADDON_BAND) })
    const result = await claimAiOverageCharge(makeFirestore(), {
      orgId: 'org-1',
      org: { plan: 'free', subscription: { status: 'active' } } as never,
      month: MONTH,
      kind: 'threshold',
    })
    expect(result).toEqual({ claimed: null, refused: 'not-sold' })
    expect(readAiOverageMonthLedger(docs.get(USAGE)).invoicedUsd).toBe(0)
  })
})
