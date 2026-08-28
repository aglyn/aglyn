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
 * A REHEARSAL IS NOT REVENUE.
 *
 * A smoke-test checkout writes a real order document. Stripe never moved money
 * for it, but every surface summing paid orders counted it — found in
 * production as a single $18.00 `cs_test_…` order standing as the whole
 * platform's storefront revenue.
 *
 * The two signals and their ORDER OF TRUST are what this file pins. Getting
 * that order wrong is the interesting failure: reading the id first would let
 * a test-shaped id override a recorded `livemode: true` and erase a real sale,
 * and defaulting an unidentifiable order to "test" would erase every POS cash
 * sale in the system. The direction that erases revenue is the one a merchant
 * cannot detect, so both are asserted explicitly.
 */

import { orderIsTestMode } from './commerce-orders'
import { stripeIdIsTestMode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'

describe('orderIsTestMode', () => {
  it('reads a recorded livemode:false as a rehearsal', () => {
    expect(orderIsTestMode({ livemode: false })).toBe(true)
  })

  it('CONTROL: a recorded livemode:true is a real sale', () => {
    expect(orderIsTestMode({ livemode: true })).toBe(false)
  })

  it('lets the RECORDED fact beat a test-shaped id', () => {
    // The order of trust. A session id is Stripe's convention; `livemode` is
    // what the webhook was told. If the id won, one oddly-shaped id would
    // erase a real sale.
    expect(
      orderIsTestMode({ livemode: true, checkoutSessionId: 'cs_test_abc' }),
    ).toBe(false)
  })

  it('falls back to the session id when nothing recorded the fact', () => {
    // Every order written before this shipped, including the one in
    // production.
    expect(orderIsTestMode({ checkoutSessionId: 'cs_test_a1Ynzr4hGd8o' })).toBe(
      true,
    )
  })

  it('CONTROL: a live session id is a real sale', () => {
    expect(orderIsTestMode({ checkoutSessionId: 'cs_live_a1Ynzr4hGd8o' })).toBe(
      false,
    )
  })

  it('treats an order with NEITHER signal as real money', () => {
    // A POS cash sale, a folio charge, a draft order paid offline. Answering
    // "test" here would erase genuine revenue, and a merchant under-reporting
    // their own sales has no way to notice.
    expect(orderIsTestMode({})).toBe(false)
    expect(orderIsTestMode({ checkoutSessionId: '' })).toBe(false)
  })
})

describe('stripeIdIsTestMode', () => {
  it('matches the mode segment, not the letters anywhere', () => {
    expect(stripeIdIsTestMode('cs_test_abc')).toBe(true)
    expect(stripeIdIsTestMode('pi_test_abc')).toBe(true)
    // A live id whose random tail happens to contain the word. A substring
    // check would read this as a rehearsal and delete a real sale from every
    // revenue total.
    expect(stripeIdIsTestMode('cs_live_aTESTbtestc')).toBe(false)
    expect(stripeIdIsTestMode('cs_live_contest123')).toBe(false)
  })

  it('answers false for anything unreadable', () => {
    expect(stripeIdIsTestMode(undefined)).toBe(false)
    expect(stripeIdIsTestMode('')).toBe(false)
    expect(stripeIdIsTestMode(42)).toBe(false)
  })
})
