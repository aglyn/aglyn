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
 * The environment gate for the billing webhook (AGL-2040).
 *
 * On 2026-08-18 five TEST-mode dispute and refund events reached the
 * PRODUCTION webhook and ran the money-reversal dispatch against production
 * Firestore. Nothing moved only because the collections those handlers join
 * against are still empty pre-launch — and that protection expires on
 * September 1.
 *
 * It was not a misconfiguration. The test-mode destination
 * (`we_1Tujsr…`, `livemode: false`) points at the production URL on purpose so
 * test-mode tenant checkouts verify (AGL-547), and the route accepts EITHER
 * signing secret by design. The route simply never asked which environment an
 * event came from: `livemode` had zero occurrences anywhere on the webhook
 * path.
 *
 * ## Why the deployment's mode cannot come from the secret that verified
 *
 * The obvious implementation — "it verified against STRIPE_WEBHOOK_SECRET_TEST,
 * so it's a test event" — is the same mistake one layer down. Both webhook
 * secrets are configured in PRODUCTION (that is what AGL-547 shipped), so
 * which one happened to match is a property of the delivery, not of this
 * deployment. The same reasoning rules out `STRIPE_SECRET_KEY_TEST`, which is
 * likewise set in `.env.production.local`.
 *
 * The deployment's own mode is the mode of the key it SPENDS MONEY with:
 * `STRIPE_SECRET_KEY`. `sk_live_` is a live deployment; anything else is not.
 * That is configuration, and it is independent of the request.
 */

/** Explicit ops override, for the case where key-prefix inference is wrong. */
const LIVEMODE_OVERRIDE = 'STRIPE_LIVEMODE'

/**
 * Whether THIS deployment is the live one.
 *
 * Derived from `STRIPE_SECRET_KEY`'s prefix, with an explicit
 * `STRIPE_LIVEMODE=true|false` override that wins when set. Note the
 * asymmetry, which is deliberate: only `sk_live_` yields `true`. An unset or
 * unrecognised key is NOT a live deployment, because a deployment with no
 * Stripe secret key cannot be charging anyone.
 */
export function deploymentLivemode(
  env: Partial<Record<string, string>> = process.env,
): boolean {
  const override = env[LIVEMODE_OVERRIDE]
  if (override === 'true') return true
  if (override === 'false') return false
  return String(env['STRIPE_SECRET_KEY'] ?? '').startsWith('sk_live_')
}

/**
 * Whether a parsed Stripe event claims to be a LIVE event.
 *
 * Strict `=== true`, so an event that omits `livemode` reads as test-mode and
 * a live deployment refuses it. That is the case worth being deliberate
 * about: a hand-assembled replay — the shape AGL-2040 warns about, where
 * someone copies a real payment-intent id into a fixture to make a rehearsal
 * realistic — is exactly what would omit the field. Failing closed here means
 * there is no separate "malformed event" branch that could be got wrong.
 */
export function eventLivemode(event: unknown): boolean {
  return (event as { livemode?: unknown } | null)?.livemode === true
}

/**
 * Where the idempotency claim is written, per environment.
 *
 * Segregated (AGL-2040 §6) so `stripeEvents` stays a pure record of LIVE
 * traffic: any future check that SCANS the collection rather than joining by
 * id would otherwise read test-mode rehearsals as production deliveries.
 *
 * This segregation is bookkeeping, NOT the safety control — see
 * `livemodeDecision`.
 */
export const LIVE_EVENT_COLLECTION = 'stripeEvents'
export const TEST_EVENT_COLLECTION = 'stripeEventsTest'

/**
 * Discriminated on a STRING, not on a boolean `accept: true | false`.
 *
 * `strictNullChecks` is off repo-wide, which widens boolean literal types and
 * makes `if (!decision.accept)` fail to narrow — caught by `tsc` here as
 * "Property 'reason' does not exist on type LivemodeDecision". A string
 * discriminant narrows regardless of that setting, and the call site reads as
 * the decision it is rather than as a flag.
 */
export type LivemodeDecision =
  | { readonly outcome: 'accept'; readonly claimCollection: string }
  | { readonly outcome: 'refuse'; readonly reason: 'livemode-mismatch' }

/**
 * The gate itself: an event is processed only when its `livemode` EQUALS the
 * deployment's own mode.
 *
 * Symmetric on purpose — both directions are hazards, and only one of them is
 * the one that bit us:
 *
 * - test event on a LIVE deployment is AGL-2040: a rehearsal running the
 *   money-reversal handlers against production Firestore.
 * - live event on a TEST deployment is the mirror: a laptop or preview build
 *   holding the live webhook secret acting on real money, and writing real
 *   outcomes into a test data set.
 *
 * A refusal must be a **200** (`{ignored: 'livemode-mismatch'}`), never a 4xx.
 * The decision is permanent — an event's `livemode` never changes — so a 4xx
 * would buy days of Stripe retries that all end here, then a dead destination.
 *
 * ## Why this, and not the claim-collection segregation the issue sketched
 *
 * AGL-2040 §5 offered "claim test events in `stripeEventsTest` and dispatch
 * them against a test-scoped data path". The second half is the entire safety
 * property and it is not buildable here: it means threading a data root
 * through the whole plugin billing-webhook contract and every helper it
 * reaches (`marketplacePurchases`, `findOrderForDispute`, `platformRevenue`,
 * `recordContactRefund`, `flagOrderRestock`, `purchase-entitlement`), where
 * every missed call site is a silent hole with EXACTLY the shape of this bug.
 * Segregating only the claim would be false safety — `stripeEvents` would
 * look clean while the money-reversal handlers went on running against
 * production data.
 *
 * The rehearsal capability AGL-1951 subscribed those three events for is not
 * lost, because it never required test events to run in PRODUCTION: pointing
 * the test-mode destination at a test-mode deployment exercises all three
 * handlers end to end on real code against test data. Rehearsals still work;
 * production data is never touched by them.
 */
export function livemodeDecision(input: {
  deploymentLivemode: boolean
  eventLivemode: boolean
}): LivemodeDecision {
  if (input.deploymentLivemode !== input.eventLivemode) {
    return { outcome: 'refuse', reason: 'livemode-mismatch' }
  }
  return {
    outcome: 'accept',
    claimCollection: input.eventLivemode
      ? LIVE_EVENT_COLLECTION
      : TEST_EVENT_COLLECTION,
  }
}
