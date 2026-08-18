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

import { payoutReadiness } from './payout-readiness'

/**
 * AGL-1997. The bug was one flag answering two questions: the card read
 * `stripeChargesEnabled` and rendered "Payouts are enabled" from it. The
 * assertion that matters is that charges-yes/payouts-no is its OWN outcome —
 * and the positive controls beside it are that a genuinely ready seller still
 * reads ready, and an unread field still does not accuse anyone.
 */
describe('payoutReadiness (AGL-1997)', () => {
  it('does NOT claim payouts from charges alone', () => {
    // The exact defect: this input rendered "Payouts are enabled" before.
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        payoutsEnabled: false,
      }),
    ).toBe('blocked')
  })

  // Positive control. A seller who really is ready must still read ready, or
  // the fix is just "never say enabled", which helps nobody.
  it('still reports ready when Stripe says both', () => {
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toBe('ready')
  })

  it('reports unknown — not blocked — when the field was never written', () => {
    // Every profile connected before AGL-1547 is this shape. Reading the
    // absent field as `false` would tell them their payouts are broken.
    expect(payoutReadiness({ state: 'loaded', chargesEnabled: true })).toBe(
      'unknown',
    )
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        payoutsEnabled: null,
      }),
    ).toBe('unknown')
  })

  it('reports disconnected before any account can take charges', () => {
    expect(payoutReadiness({ state: 'loaded' })).toBe('disconnected')
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: false,
        // Nonsense combination, but it must not read as success.
        payoutsEnabled: true,
      }),
    ).toBe('disconnected')
  })

  it('passes pending and error through untouched', () => {
    // A failed or unfinished read says NOTHING about payouts — the panel's
    // existing AGL-1380 rule, preserved.
    expect(payoutReadiness({ state: 'pending', chargesEnabled: true })).toBe(
      'pending',
    )
    expect(
      payoutReadiness({
        state: 'error',
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toBe('error')
  })
})
