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
 * The payment-fraud hold's decisions and state (AGL-3767): which charge asks
 * for a hold, what card cycling is, the two guards, and the claim that makes
 * a hold once-only. The charges are the shapes the 2026-10-13 card tester
 * left: four US cards on one $56 invoice within two minutes.
 */

import {
  cardCyclingPattern,
  chargeEvidence,
  chargeFraudTrigger,
  claimPaymentFraudHold,
  hasPaidOtherInvoice,
  isPaymentFraudHeld,
  PAYMENT_FRAUD_HOLD,
  paymentFraudHoldGuard,
  recordWorkspaceChargeFailure,
  settlePaymentFraudHold,
} from './payment-fraud-hold'

let store: Record<string, Record<string, any>> = {}

const snapshot = (path: string) => {
  const data = store[path] ? { ...store[path] } : undefined
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

const doc = (path: string): any => ({
  path,
  get: async () => snapshot(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    store[path] = options?.merge ? { ...(store[path] ?? {}), ...data } : { ...data }
  },
})

const firestore: any = {
  collection: (name: string) => ({
    doc: (id: string) => doc(`${name}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => ({
          docs: Object.keys(store)
            .filter((key) => key.startsWith(`${name}/`) && store[key][field] === value)
            .map(snapshot),
        }),
      }),
    }),
  }),
  runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
    work({
      get: async (ref: { path: string }) => snapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, any>, options?: { merge?: boolean }) => {
        store[ref.path] = options?.merge ? { ...(store[ref.path] ?? {}), ...data } : { ...data }
      },
    }),
}

/** A Stripe Charge as `charge.failed` delivers it. */
function charge(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    amount: 5600,
    currency: 'usd',
    customer: 'cus_vinted',
    payment_intent: 'pi_1',
    outcome: { type: 'issuer_declined', risk_level: 'normal', reason: null },
    fraud_details: {},
    failure_code: 'card_declined',
    payment_method_details: {
      card: { fingerprint: `fp_${id}`, country: 'US', brand: 'visa', last4: '4242', checks: { address_postal_code_check: 'fail' } },
    },
    ...overrides,
  }
}

beforeEach(() => {
  store = {}
})

describe('which failed charge asks for a hold', () => {
  it('a Radar block at highest risk, and a Stripe fraud report, each do on their own', () => {
    const blocked = chargeEvidence(
      charge('ch_3UQBbYDYHP4psn7h2nvPTfSZ', { outcome: { type: 'blocked', risk_level: 'highest', reason: 'highest_risk_level' } }),
      1,
    )
    expect(chargeFraudTrigger(blocked)).toBe('radar-blocked')
    const reported = chargeEvidence(
      charge('ch_3UQBbYDYHP4psn7h25lPwOTp', {
        outcome: { type: 'blocked', risk_level: 'highest' },
        fraud_details: { stripe_report: 'fraudulent' },
      }),
      1,
    )
    expect(chargeFraudTrigger(reported)).toBe('stripe-reported-fraud')
  })

  it('an ordinary decline, an elevated-risk block or a rule block does not', () => {
    expect(chargeFraudTrigger(chargeEvidence(charge('ch_a'), 1))).toBeNull()
    expect(
      chargeFraudTrigger(chargeEvidence(charge('ch_b', { outcome: { type: 'blocked', risk_level: 'elevated' } }), 1)),
    ).toBeNull()
    expect(
      chargeFraudTrigger(chargeEvidence(charge('ch_c', { outcome: { type: 'blocked', risk_level: 'normal', reason: 'rule' } }), 1)),
    ).toBeNull()
  })

  it('keeps the card evidence staff need: fingerprint, country, risk, checks', () => {
    const evidence = chargeEvidence(
      charge('ch_x', { outcome: { type: 'blocked', risk_level: 'highest', risk_score: 92 }, invoice: { id: 'in_1' } }),
      7,
    )
    expect(evidence).toMatchObject({
      chargeId: 'ch_x',
      paymentIntentId: 'pi_1',
      invoiceId: 'in_1',
      fingerprint: 'fp_ch_x',
      cardCountry: 'US',
      riskLevel: 'highest',
      riskScore: 92,
      postalCheck: 'fail',
      amountCents: 5600,
      atMs: 7,
    })
  })
})

describe('card cycling', () => {
  const at = (id: string, fingerprint: string | null, atMs: number) => ({
    ...chargeEvidence(charge(id), atMs),
    fingerprint,
  })

  it('is three different cards inside 30 minutes, counted by fingerprint', () => {
    const now = 60 * 60_000
    expect(cardCyclingPattern([at('a', 'fp1', now), at('b', 'fp2', now), at('c', 'fp2', now)], now).matched).toBe(false)
    expect(cardCyclingPattern([at('a', 'fp1', now), at('b', 'fp2', now), at('c', 'fp3', now)], now)).toEqual({
      matched: true,
      fingerprints: ['fp1', 'fp2', 'fp3'],
    })
  })

  it('never counts a card older than the window, or a charge with no fingerprint', () => {
    const now = 60 * 60_000
    const old = now - PAYMENT_FRAUD_HOLD.cyclingWindowMs - 1
    expect(cardCyclingPattern([at('a', 'fp1', old), at('b', 'fp2', now), at('c', 'fp3', now)], now).matched).toBe(false)
    expect(cardCyclingPattern([at('a', null, now), at('b', 'fp2', now), at('c', 'fp3', now)], now).matched).toBe(false)
  })

  it('is recorded once per charge, and a redelivery adds nothing', async () => {
    const now = 1_000_000
    const first = await recordWorkspaceChargeFailure(firestore, 'org-v', chargeEvidence(charge('ch_1'), now), now)
    expect(first).toMatchObject({ added: true, state: 'watching' })
    const again = await recordWorkspaceChargeFailure(firestore, 'org-v', chargeEvidence(charge('ch_1'), now + 1), now + 1)
    expect(again.added).toBe(false)
    expect(store['paymentFraudHolds/org-v']['failures']).toHaveLength(1)
    await recordWorkspaceChargeFailure(firestore, 'org-v', chargeEvidence(charge('ch_2'), now + 2), now + 2)
    const third = await recordWorkspaceChargeFailure(firestore, 'org-v', chargeEvidence(charge('ch_3'), now + 3), now + 3)
    expect(third.cycling).toEqual({ matched: true, fingerprints: ['fp_ch_1', 'fp_ch_2', 'fp_ch_3'] })
    expect(third.recent.map((entry) => entry.chargeId)).toEqual(['ch_1', 'ch_2', 'ch_3'])
  })
})

describe('the guards', () => {
  it('locks only a workspace under 14 days old that never paid', () => {
    expect(paymentFraudHoldGuard({ ageDays: 0, hasPaidInvoice: false })).toEqual({ lock: true, reason: null })
    expect(paymentFraudHoldGuard({ ageDays: 13.9, hasPaidInvoice: false }).lock).toBe(true)
    expect(paymentFraudHoldGuard({ ageDays: 14, hasPaidInvoice: false }).lock).toBe(false)
    expect(paymentFraudHoldGuard({ ageDays: 1, hasPaidInvoice: true }).lock).toBe(false)
    // An unreadable creation date is an existing customer, as everywhere else.
    expect(paymentFraudHoldGuard({ ageDays: null, hasPaidInvoice: false }).lock).toBe(false)
  })

  it('a paid invoice counts unless it was paid with the flagged charge itself', async () => {
    store['platformRevenue/in_flagged'] = { orgId: 'org-v', grossCents: 5600, chargeId: 'ch_efw', paymentIntentId: 'pi_efw' }
    store['platformRevenue/in_zero'] = { orgId: 'org-v', grossCents: 0, chargeId: 'ch_zero' }
    const flagged = { chargeIds: ['ch_efw'], paymentIntentIds: ['pi_efw'] }
    expect(await hasPaidOtherInvoice(firestore, 'org-v', flagged)).toBe(false)
    store['platformRevenue/in_earlier'] = { orgId: 'org-v', grossCents: 2900, chargeId: 'ch_earlier' }
    expect(await hasPaidOtherInvoice(firestore, 'org-v', flagged)).toBe(true)
  })
})

describe('the claim', () => {
  it('is taken once; a held workspace is never claimed again', async () => {
    expect(await claimPaymentFraudHold(firestore, 'org-v', 'radar-blocked', 1)).toEqual({ claimed: true, reason: null })
    expect(await claimPaymentFraudHold(firestore, 'org-v', 'radar-blocked', 2)).toMatchObject({ claimed: false, reason: 'placing' })
    await settlePaymentFraudHold(firestore, 'org-v', 'held', { reviewId: 'r1' }, 3)
    expect(await isPaymentFraudHeld(firestore, 'org-v')).toBe(true)
    expect(await claimPaymentFraudHold(firestore, 'org-v', 'card-cycling', 10 * 24 * 60 * 60_000)).toMatchObject({
      claimed: false,
      reason: 'held',
    })
  })

  it('an alert-only decision raises no second alert inside its window, and may after it', async () => {
    await claimPaymentFraudHold(firestore, 'org-v', 'radar-blocked', 1)
    await settlePaymentFraudHold(firestore, 'org-v', 'alerted', {}, 1)
    expect(await claimPaymentFraudHold(firestore, 'org-v', 'card-cycling', 2)).toMatchObject({ claimed: false, reason: 'alerted' })
    expect(
      await claimPaymentFraudHold(firestore, 'org-v', 'card-cycling', 2 + PAYMENT_FRAUD_HOLD.alertWindowMs),
    ).toMatchObject({ claimed: true })
    expect(await isPaymentFraudHeld(firestore, 'org-v')).toBe(false)
  })

  it('a claim whose run died is taken over after its lease', async () => {
    await claimPaymentFraudHold(firestore, 'org-v', 'radar-blocked', 1)
    expect(
      await claimPaymentFraudHold(firestore, 'org-v', 'radar-blocked', 1 + PAYMENT_FRAUD_HOLD.claimLeaseMs),
    ).toMatchObject({ claimed: true })
  })
})
