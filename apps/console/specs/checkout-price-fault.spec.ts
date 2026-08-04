/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * A price id that is SET but dead reads as "Stripe checkout failed" (AGL-1137).
 *
 * That is the shape you get when `STRIPE_SECRET_KEY` is moved from test to live
 * and the `STRIPE_PRICE_*` ids are not — measured on this repo's own config:
 * 44 of 64 ids 404 against the live key while the products all exist. The
 * absent-env guard upstream does not catch it, because the variable is present;
 * it is the VALUE that is wrong.
 *
 * The fixture below is a REAL Stripe response, captured by POSTing one of those
 * dead ids to `/v1/checkout/sessions` on 2026-08-04. Nothing was created — the
 * request fails validation before a session exists. Using the real shape
 * matters: the whole mapping keys on `code` and `param`, and a guessed
 * envelope would let this pass while doing nothing in production.
 */

import { configuredPriceFault } from '../utils/stripe-price-fault'

/** Captured verbatim from live Stripe. */
const REAL_DEAD_PRICE_ERROR = {
  code: 'resource_missing',
  param: 'line_items[0][price]',
  type: 'invalid_request_error',
  message:
    "No such price: 'price_1TuRlNDYHP4psn7hoiocMOU3'; a similar object exists in test mode, but a live mode key was used to make this request.",
}

describe('configuredPriceFault (AGL-1137)', () => {
  it('names the exact env var for a dead monthly plan price', () => {
    const message = configuredPriceFault(REAL_DEAD_PRICE_ERROR, 'pro', 'month')
    expect(message).toContain('STRIPE_PRICE_PRO')
    expect(message).not.toContain('STRIPE_PRICE_PRO_YEARLY')
    // Stripe's own words are carried through — they say which mode the object
    // is in, which is the single most useful fact for fixing it.
    expect(message).toContain('a similar object exists in test mode')
  })

  it('names the _YEARLY variant when the annual toggle was used', () => {
    const message = configuredPriceFault(REAL_DEAD_PRICE_ERROR, 'pro', 'year')
    expect(message).toContain('STRIPE_PRICE_PRO_YEARLY')
  })

  it('distinguishes the metered line item from the plan line item', () => {
    // line_items[1] is the shared metered price. Reporting it as the PLAN's
    // env var would send someone to rewrite a value that is already correct.
    const message = configuredPriceFault(
      { ...REAL_DEAD_PRICE_ERROR, param: 'line_items[1][price]' },
      'pro',
      'month',
    )
    expect(message).toContain('STRIPE_PRICE_METERED')
    expect(message).not.toContain('STRIPE_PRICE_PRO')
  })

  it('stays out of the way of every other Stripe failure', () => {
    // The control that keeps this honest: if it matched broadly, a genuine
    // outage would be relabelled as a config fault and nobody would look at
    // Stripe. Each of these must fall through to the existing 502.
    expect(configuredPriceFault(undefined, 'pro', 'month')).toBeNull()
    expect(
      configuredPriceFault({ code: 'card_declined' }, 'pro', 'month'),
    ).toBeNull()
    expect(
      configuredPriceFault({ code: 'rate_limit' }, 'pro', 'month'),
    ).toBeNull()
    // resource_missing on something that is NOT a price — a customer, say —
    // is a real error and not this bug.
    expect(
      configuredPriceFault(
        { code: 'resource_missing', param: 'customer' },
        'pro',
        'month',
      ),
    ).toBeNull()
  })
})
