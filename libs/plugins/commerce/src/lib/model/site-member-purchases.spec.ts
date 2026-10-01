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
  computeLifetimePurchaseCents,
  orderChargedCents,
} from './site-member-purchases'

describe('a site user’s lifetime purchases (AGL-546)', () => {
  it('reads the v1 total, else the legacy flat amount', () => {
    expect(orderChargedCents({ totals: { totalCents: 6200 }, amountCents: 1 })).toBe(6200)
    expect(orderChargedCents({ amountCents: 4100 })).toBe(4100)
    expect(orderChargedCents({})).toBe(0)
  })

  it('sums what was charged, net of refunds, skipping orders that never charged', () => {
    expect(
      computeLifetimePurchaseCents([
        { status: 'paid', totals: { totalCents: 6200 } },
        { status: 'refunded', totals: { totalCents: 3000 }, refundedCents: 1000 },
        { status: 'pending', totals: { totalCents: 9900 } },
        { status: 'cancelled', amountCents: 5000 },
      ]),
    ).toBe(8200)
  })

  it('clamps an over-recorded refund at zero for its order', () => {
    expect(
      computeLifetimePurchaseCents([
        { status: 'refunded', totals: { totalCents: 1000 }, refundedCents: 5000 },
        { status: 'paid', totals: { totalCents: 2000 } },
      ]),
    ).toBe(2000)
  })

  it('nets the WHOLE reversed figure, a lost chargeback included (AGL-1810)', () => {
    // A label fix only: money reversed is money reversed whichever door it
    // left by, so the total keeps netting all of `refundedCents`.
    expect(
      computeLifetimePurchaseCents([
        {
          status: 'refunded',
          totals: { totalCents: 6200 },
          refundedCents: 6200,
          // The dispute is invisible to the netting on purpose.
          ...({ dispute: { reversedCents: 6200 } } as object),
        },
      ]),
    ).toBe(0)
  })
})
