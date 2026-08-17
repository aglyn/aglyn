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
 * `splitReversalCents` (AGL-1810) is a deliberate DUPLICATE of the commerce
 * model's `splitOrderReversal` — `scope:app` must not import `aglyn:addons`
 * (AGL-417/419), and that ban covers this spec too, so the agreement is
 * pinned by mirroring `commerce-dispute.spec.ts`'s cases rather than by
 * importing the model to compare. If the model's clamp semantics ever move,
 * these cases are the ones to move with them.
 */

import {
  computeLifetimePurchaseCents,
  splitReversalCents,
} from './site-member-purchases'

describe('splitReversalCents (AGL-1810)', () => {
  it('reads an ordinary refund as all the merchant’s', () => {
    expect(splitReversalCents({ refundedCents: 6200 })).toEqual({
      refundedCents: 6200,
      chargedBackCents: 0,
    })
  })

  it('reads a lost chargeback as all the bank’s', () => {
    expect(
      splitReversalCents({
        refundedCents: 6200,
        dispute: { reversedCents: 6200 },
      }),
    ).toEqual({ refundedCents: 0, chargedBackCents: 6200 })
  })

  it('splits a partial refund followed by a capped chargeback', () => {
    // $17 refunded by the merchant, then the dispute lost and capped by
    // AGL-1787 to the remaining $45; `refundedCents` holds the $62 total.
    expect(
      splitReversalCents({
        refundedCents: 6200,
        dispute: { reversedCents: 4500 },
      }),
    ).toEqual({ refundedCents: 1700, chargedBackCents: 4500 })
  })

  it('clamps a reversal larger than the recorded total to a zero refund share', () => {
    // The two fields disagreeing yields no NEGATIVE refund line — the
    // model's clamp, mirrored.
    expect(
      splitReversalCents({
        refundedCents: 4500,
        dispute: { reversedCents: 6200 },
      }),
    ).toEqual({ refundedCents: 0, chargedBackCents: 4500 })
  })

  it('reads an untouched order, and junk figures, as no reversal at all', () => {
    expect(splitReversalCents({})).toEqual({
      refundedCents: 0,
      chargedBackCents: 0,
    })
    expect(
      splitReversalCents({
        refundedCents: Number.NaN,
        dispute: { reversedCents: -100 },
      }),
    ).toEqual({ refundedCents: 0, chargedBackCents: 0 })
  })

  it('leaves the lifetime netting reading the WHOLE reversed figure', () => {
    // AGL-1810 is a label fix: money reversed is money reversed whichever
    // door it left by, so the total keeps netting all of `refundedCents`.
    expect(
      computeLifetimePurchaseCents([
        {
          status: 'refunded',
          totals: { totalCents: 6200 },
          refundedCents: 6200,
          // The dispute is invisible to the netting on purpose.
          ...( { dispute: { reversedCents: 6200 } } as object),
        },
      ]),
    ).toBe(0)
  })
})
