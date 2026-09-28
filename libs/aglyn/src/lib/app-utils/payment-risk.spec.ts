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

import {
  addPaymentRiskSignal,
  describePaymentRisk,
  paymentRiskEventFrom,
  settlePaymentRiskDispute,
} from './payment-risk'

describe('payment risk on a merchant record (AGL-3360)', () => {
  it('reads the three Stripe signals and nothing else', () => {
    expect(
      paymentRiskEventFrom('radar.early_fraud_warning.created', {
        id: 'issfr_1',
        charge: 'ch_1',
        payment_intent: { id: 'pi_1' },
        fraud_type: 'made_with_stolen_card',
        created: 100,
      }),
    ).toEqual({
      signal: {
        kind: 'early-fraud-warning',
        stripeObjectId: 'issfr_1',
        detail: 'made_with_stolen_card',
        atMs: 100_000,
      },
      paymentIntentId: 'pi_1',
      chargeId: 'ch_1',
    })
    expect(paymentRiskEventFrom('review.opened', { id: 'prv_1' }, 5)?.signal).toEqual({
      kind: 'radar-review',
      stripeObjectId: 'prv_1',
      atMs: 5,
    })
    expect(paymentRiskEventFrom('charge.dispute.created', { id: 'du_1' })?.signal.kind).toBe(
      'dispute',
    )
    expect(paymentRiskEventFrom('charge.refunded', { id: 'ch_1' })).toBeNull()
    expect(paymentRiskEventFrom('review.opened', {})).toBeNull()
  })

  it('adds a signal once, and answers null for a redelivery', () => {
    const signal = { kind: 'dispute' as const, stripeObjectId: 'du_1', atMs: 1 }
    const once = addPaymentRiskSignal(undefined, signal)
    expect(once).toEqual({ signals: [signal], latestKind: 'dispute', latestAtMs: 1 })
    expect(addPaymentRiskSignal(once, signal)).toBeNull()
  })

  it('records a dispute outcome on its own signal', () => {
    const risk = addPaymentRiskSignal(undefined, {
      kind: 'dispute',
      stripeObjectId: 'du_1',
      atMs: 1,
    })
    const settled = settlePaymentRiskDispute(risk, 'du_1', 'won')
    expect(settled?.signals[0].outcome).toBe('won')
    expect(settlePaymentRiskDispute(settled, 'du_1', 'won')).toBeNull()
    expect(settlePaymentRiskDispute(risk, 'du_other', 'lost')).toBeNull()
  })

  it('always tells the merchant nothing was refunded', () => {
    const risk = addPaymentRiskSignal(undefined, {
      kind: 'early-fraud-warning',
      stripeObjectId: 'issfr_1',
      detail: 'unauthorized_use_of_card',
      atMs: 1,
    })
    const described = describePaymentRisk(risk)
    expect(described?.label).toBe('Fraud warning')
    expect(described?.detail).toContain('unauthorized use of card')
    expect(described?.detail).toContain('has not refunded or canceled')
    expect(describePaymentRisk(undefined)).toBeNull()
  })
})
