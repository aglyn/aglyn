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

describe('site member lifetime purchases (AGL-546)', () => {
  it('sums v1 totals and legacy amountCents alike', () => {
    expect(
      computeLifetimePurchaseCents([
        { status: 'paid', totals: { totalCents: 2500 } },
        { status: 'fulfilled', amountCents: 1000 },
      ]),
    ).toBe(3500)
  })

  it('prefers the v1 totals block when both shapes are present', () => {
    expect(
      orderChargedCents({ totals: { totalCents: 4200 }, amountCents: 999 }),
    ).toBe(4200)
  })

  it('subtracts refunds, including partial refunds', () => {
    expect(
      computeLifetimePurchaseCents([
        { status: 'refunded', amountCents: 2000, refundedCents: 2000 },
        { status: 'delivered', totals: { totalCents: 3000 }, refundedCents: 500 },
      ]),
    ).toBe(2500)
  })

  it('skips orders that never charged (pending/cancelled)', () => {
    expect(
      computeLifetimePurchaseCents([
        { status: 'pending', amountCents: 9900 },
        { status: 'cancelled', totals: { totalCents: 1500 } },
        { status: 'paid', amountCents: 700 },
      ]),
    ).toBe(700)
  })

  it('never goes negative per order on over-recorded refunds', () => {
    expect(
      computeLifetimePurchaseCents([
        { status: 'refunded', amountCents: 1000, refundedCents: 1500 },
        { status: 'paid', amountCents: 800 },
      ]),
    ).toBe(800)
  })

  it('handles empty and malformed inputs', () => {
    expect(computeLifetimePurchaseCents([])).toBe(0)
    expect(
      computeLifetimePurchaseCents([
        { status: 'paid' },
        { status: 'paid', amountCents: Number.NaN },
      ]),
    ).toBe(0)
  })
})
