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
 * The environment gate's decision, driven directly (AGL-2040).
 *
 * The assembly spec `specs/billing-webhook-livemode.spec.ts` proves the gate
 * is WIRED and correctly positioned. This file pins the decision itself,
 * including the two inference rules that are easy to get subtly wrong and
 * whose failure mode is silent: what counts as a live deployment, and what
 * counts as a live event.
 */

export {}

import {
  deploymentLivemode,
  eventLivemode,
  livemodeDecision,
  LIVE_EVENT_COLLECTION,
  TEST_EVENT_COLLECTION,
} from './stripe-livemode'

describe('deploymentLivemode reads the key the deployment SPENDS with', () => {
  it('is live only for sk_live_', () => {
    expect(deploymentLivemode({ STRIPE_SECRET_KEY: 'sk_live_abc' })).toBe(true)
    expect(deploymentLivemode({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toBe(false)
  })

  it('is NOT live when unconfigured — a deployment with no key charges nobody', () => {
    expect(deploymentLivemode({})).toBe(false)
    expect(deploymentLivemode({ STRIPE_SECRET_KEY: '' })).toBe(false)
    expect(deploymentLivemode({ STRIPE_SECRET_KEY: 'rk_live_abc' })).toBe(false)
  })

  it('IGNORES the test-mode credentials, which production also carries', () => {
    // The whole reason this function exists. AGL-547 put
    // STRIPE_WEBHOOK_SECRET_TEST in production so test-mode tenant checkouts
    // verify, and STRIPE_SECRET_KEY_TEST sits beside it in
    // .env.production.local. Inferring "test deployment" from either would
    // make PRODUCTION classify itself as test mode, and the gate would then
    // pass exactly the events it exists to refuse.
    expect(
      deploymentLivemode({
        STRIPE_SECRET_KEY: 'sk_live_abc',
        STRIPE_SECRET_KEY_TEST: 'sk_test_abc',
        STRIPE_WEBHOOK_SECRET_TEST: 'whsec_test_abc',
      }),
    ).toBe(true)
  })

  it('honours an explicit STRIPE_LIVEMODE override in both directions', () => {
    expect(
      deploymentLivemode({
        STRIPE_LIVEMODE: 'false',
        STRIPE_SECRET_KEY: 'sk_live_abc',
      }),
    ).toBe(false)
    expect(
      deploymentLivemode({
        STRIPE_LIVEMODE: 'true',
        STRIPE_SECRET_KEY: 'sk_test_abc',
      }),
    ).toBe(true)
    // Anything other than the two exact strings falls through to the key,
    // so a typo cannot silently disable the gate.
    expect(
      deploymentLivemode({
        STRIPE_LIVEMODE: 'yes',
        STRIPE_SECRET_KEY: 'sk_live_abc',
      }),
    ).toBe(true)
  })
})

describe('eventLivemode is strict, so an absent field fails CLOSED', () => {
  it('is live only for a literal boolean true', () => {
    expect(eventLivemode({ livemode: true })).toBe(true)
    expect(eventLivemode({ livemode: false })).toBe(false)
  })

  it('reads a missing or non-boolean livemode as test mode', () => {
    // A hand-assembled replay around a copied payment-intent id — the shape
    // AGL-2040 §5 warns about — is precisely what omits the field. Reading it
    // as test mode means a live deployment refuses it.
    expect(eventLivemode({})).toBe(false)
    expect(eventLivemode(null)).toBe(false)
    expect(eventLivemode(undefined)).toBe(false)
    // Truthy but not true: a string 'true' must not buy its way in.
    expect(eventLivemode({ livemode: 'true' })).toBe(false)
    expect(eventLivemode({ livemode: 1 })).toBe(false)
  })
})

describe('livemodeDecision accepts only a matching pair', () => {
  it('refuses a test event on a live deployment — the AGL-2040 delivery', () => {
    expect(
      livemodeDecision({ deploymentLivemode: true, eventLivemode: false }),
    ).toEqual({ outcome: 'refuse', reason: 'livemode-mismatch' })
  })

  it('refuses a live event on a test deployment — the mirror hazard', () => {
    expect(
      livemodeDecision({ deploymentLivemode: false, eventLivemode: true }),
    ).toEqual({ outcome: 'refuse', reason: 'livemode-mismatch' })
  })

  it('accepts a matching pair, and segregates the claim by environment', () => {
    expect(
      livemodeDecision({ deploymentLivemode: true, eventLivemode: true }),
    ).toEqual({ outcome: 'accept', claimCollection: LIVE_EVENT_COLLECTION })
    expect(
      livemodeDecision({ deploymentLivemode: false, eventLivemode: false }),
    ).toEqual({ outcome: 'accept', claimCollection: TEST_EVENT_COLLECTION })
  })

  it('keeps the two claim collections distinct', () => {
    // A single-collection regression would make the segregation vacuous
    // while every other assertion above still passed.
    expect(LIVE_EVENT_COLLECTION).not.toBe(TEST_EVENT_COLLECTION)
  })
})
