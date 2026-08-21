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
        // AGL-2471: the payout question is only reached once the linkage's
        // Stripe world is established. Recorded here so this case still
        // asserts what it was written to assert.
        accountLivemode: true,
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
        accountLivemode: true,
      }),
    ).toBe('ready')
  })

  it('reports unknown — not blocked — when the field was never written', () => {
    // Every profile connected before AGL-1547 is this shape. Reading the
    // absent field as `false` would tell them their payouts are broken.
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        accountLivemode: true,
      }),
    ).toBe('unknown')
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        payoutsEnabled: null,
        accountLivemode: true,
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

  // AGL-2471 -----------------------------------------------------------------

  it('will not speak about payouts for a linkage whose mode was never recorded', () => {
    // The production shape. `stripeChargesEnabled: true` on a TEST-mode
    // account made this card say "Payouts are enabled" about a storefront no
    // money door would charge against — the panel and the checkout have to
    // agree, and the panel was the more confident of the two.
    expect(
      payoutReadiness({ state: 'loaded', chargesEnabled: true }),
    ).toBe('unverified')
    // It outranks the payout question: an unverified linkage cannot take a
    // payment at all, so "payouts are enabled" is the wrong thing to argue
    // about.
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toBe('unverified')
  })

  it('reads the recorded mode three-valued, like every other flag here', () => {
    for (const value of ['true', 1, null, {}]) {
      expect(
        payoutReadiness({
          state: 'loaded',
          chargesEnabled: true,
          payoutsEnabled: true,
          accountLivemode: value,
        }),
      ).toBe('unverified')
    }
    // A recorded TEST mode is still RECORDED — the panel is not the place
    // that compares it against the platform's key, so it says what it knows
    // and lets the server gate make the comparison.
    expect(
      payoutReadiness({
        state: 'loaded',
        chargesEnabled: true,
        payoutsEnabled: true,
        accountLivemode: false,
      }),
    ).toBe('ready')
  })
})
