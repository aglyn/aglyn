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

import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin'

/**
 * The storefront Payment Element (AGL-1944), the half of native payments
 * AGL-1132 said mattered more: a shopper on a merchant's own domain pays
 * without being bounced to `checkout.stripe.com` and back.
 *
 * ## Why a Checkout Session and not a bare PaymentIntent
 *
 * AGL-1132 recommended "PaymentIntent + `<PaymentElement/>`" for this surface,
 * and AGL-1944 asked for that to be a conscious re-decision rather than an
 * inherited one. It is: the Payment Element ships, the bare PaymentIntent does
 * not, and the difference is worth stating because it is the whole safety
 * argument.
 *
 * A PaymentIntent-backed flow would have to own totals, tax, shipping and the
 * platform fee itself — which means a SECOND place that computes what a shopper
 * owes. Two paths that price a cart independently is how a storefront starts
 * under-collecting tax without anyone noticing: nothing fails, the number is
 * just quietly wrong on one of them. It also emits `payment_intent.succeeded`
 * rather than `checkout.session.completed`, so every fulfilment branch in
 * `billing-webhook.ts` — orders, inventory, coupons, gift cards, licence keys,
 * subscriptions — would need a parallel implementation reading a different
 * object shape.
 *
 * `ui_mode: 'custom'` is the Payment Element backed by a Checkout Session. The
 * shopper sees `<PaymentElement/>` inside the merchant's own layout — no Stripe
 * chrome, which is the thing AGL-1944 objected to about embedded Checkout — and
 * the server keeps the session builder it already has. So:
 *
 *   - tax, shipping, inventory, coupons, the Connect destination and the fee
 *     ladder are the SAME code, not a parallel implementation. Parity is by
 *     construction rather than by test;
 *   - `checkout.session.completed` still fires, so `billing-webhook.ts` needs
 *     no change at all and stays the only thing that fulfils an order.
 *
 * ## The API version, and why it is pinned per-request
 *
 * Measured against live Stripe in test mode: `ui_mode: 'custom'` is refused at
 * the platform account's default API version with
 *
 *     Invalid Stripe API version: 2020-08-27. In order to use `ui_mode:
 *     custom`, you must upgrade to Stripe API version 2025-03-31.basil.
 *
 * Upgrading the ACCOUNT default would re-version every Stripe call in this
 * repo at once — a change whose blast radius nobody could review in one pass.
 * A `Stripe-Version` header pins one request instead, and the pin is contained
 * in a way worth being explicit about: webhook deliveries are versioned per
 * ENDPOINT, not per request, so the events `billing-webhook.ts` parses keep
 * arriving in exactly the shape it already reads. The only thing read off the
 * pinned response is `client_secret` and `id`, neither of which the version
 * affects.
 *
 * Same probe, same params (line items, a manual tax line,
 * `shipping_address_collection`, a `fixed_amount` shipping option, Connect
 * `transfer_data[destination]` and `application_fee_amount`), hosted vs custom:
 * `amount_total` **6212 in both**. That is the tax-and-shipping parity claim,
 * measured rather than assumed.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not fulfil anything, and it hands the browser nothing it could use to
 * claim an order was paid. The client gets a `clientSecret` — which is an
 * instruction to Stripe, not an assertion about money — and the same
 * `session_id` the redirect flow already put in the return URL. Fulfilment
 * remains `checkout.session.completed` in `billing-webhook.ts`, exactly as with
 * the redirect. An in-page flow makes trusting the browser tempting; the
 * browser is the one participant that can lie about having paid.
 */

/**
 * The API version `ui_mode: 'custom'` needs, pinned on the session-create
 * request only. Stated once so the header and the doc comment cannot drift.
 */
export const NATIVE_CHECKOUT_STRIPE_VERSION = '2025-03-31.basil'

/** The flag both halves of native checkout share (AGL-1132, AGL-1944). */
export const NATIVE_CHECKOUT_FLAG = 'release_native_checkout' as const

export interface NativeCheckoutMode {
  /** True only when the flag is on for this org AND a publishable key exists. */
  native: boolean
  /** Empty unless `native` — the client needs it to boot Stripe.js. */
  publishableKey: string
}

/**
 * Two conditions, not one — the same pairing the console's route settled on.
 *
 * A `ui_mode` session returns a `client_secret` and NO `url`, so a browser that
 * cannot mount Stripe.js has nothing to navigate to. If the flag alone decided
 * this, flipping it in an environment without
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` would replace a working redirect with a
 * dead Buy button on every storefront at once. Requiring the key here means the
 * worst case of a premature flag flip is the redirect we already ship.
 *
 * That is not hypothetical for the storefront. Measured on 2026-08-18 through
 * the Vercel REST API (`vercel env ls` cannot see team-shared vars):
 * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` exists as a project-level var on
 * `aglyn-console` and is set NOWHERE on `aglyn-tenant`, which is the project
 * that serves storefronts. So today this resolves to `native: false` in
 * production however the flag is set, and the shopper keeps the redirect.
 *
 * The org — never the host — is the rollout bucket, per AGL-1656: a hostId and
 * an orgId hash to different buckets, so bucketing on the host could land a
 * merchant's storefront and their console on opposite sides of the same
 * percentage.
 */
export async function resolveNativeCheckoutMode(
  orgId: string | null | undefined,
): Promise<NativeCheckoutMode> {
  const publishableKey = String(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  ).trim()
  if (!publishableKey) return { native: false, publishableKey: '' }
  // A flag lookup that throws must not take a sale down with it, and the catch
  // is a `try` rather than `.catch()` deliberately: Remote Config being
  // unreachable rejects, but the resolver being absent entirely — an
  // environment where the module never loaded — throws SYNCHRONOUSLY, before
  // there is a promise to attach a handler to. Only the block form covers both.
  // Either way the answer is the same and it is the safe one: the redirect.
  let on = false
  try {
    on = await isServerReleaseFlagOnForOrg(NATIVE_CHECKOUT_FLAG, orgId ?? null)
  } catch {
    return { native: false, publishableKey: '' }
  }
  return on ? { native: true, publishableKey } : { native: false, publishableKey: '' }
}

/**
 * Rewrite a built session param set for the Payment Element, in place.
 *
 * DELETES `success_url` and `cancel_url` rather than leaving them alongside
 * `return_url`: Stripe rejects the pair outright on a `ui_mode` session, and a
 * 400 here would surface to the shopper as "Checkout failed" on a store that
 * was working an hour ago. Everything else in the param set — line items, the
 * tax line, `automatic_tax`, shipping options, the Connect destination, the
 * application fee, every `metadata[…]` key the webhook reads — is left exactly
 * as the caller built it. That is the point: this function must be incapable of
 * changing what the shopper is charged.
 *
 * `returnUrl` is the caller's OWN `success_url` string, `{CHECKOUT_SESSION_ID}`
 * placeholder and all. Stripe substitutes it on a `ui_mode: 'custom'` return
 * exactly as it does on a hosted redirect (measured), so the storefront's
 * post-purchase reporting — which reads `session_id` off the query to name the
 * order it just completed (AGL-1641) — keeps working unchanged.
 */
export function applyNativeCheckoutParams(
  params: URLSearchParams,
  returnUrl: string,
): void {
  params.delete('success_url')
  params.delete('cancel_url')
  params.set('ui_mode', 'custom')
  params.set('return_url', returnUrl)
}

/**
 * The `Stripe-Version` pin, as headers to spread into the session-create fetch.
 * Empty for the hosted path so its request is byte-identical to today's.
 */
export function nativeCheckoutStripeHeaders(
  mode: NativeCheckoutMode,
): Record<string, string> {
  return mode.native
    ? { 'Stripe-Version': NATIVE_CHECKOUT_STRIPE_VERSION }
    : {}
}

export interface NativeCheckoutPayload {
  /** Stripe's own instruction to the browser. Not a claim that money moved. */
  clientSecret: string
  publishableKey: string
  /** The order document id, and the `session_id` the return URL carries. */
  sessionId: string
}

export interface HostedCheckoutPayload {
  url: string
}

/**
 * Read the created session into the payload the storefront gets back.
 *
 * Returns `null` when the session is unusable, which BOTH callers already treat
 * as "nothing was sold" — release the idempotency claim and answer 502. The
 * null case is the whole reason this is a function rather than a ternary: the
 * hosted path's liveness check was `!session.url`, and a `ui_mode` session
 * never has one. Left unchanged, switching a store to native mode would have
 * made every successful session look like a Stripe failure — a 502 to the
 * shopper, a released claim, and a real Checkout Session left open on the
 * account. So the check has to move with the mode, and it does.
 */
export function readCheckoutSessionPayload(
  session: { url?: string; id?: string; client_secret?: string },
  mode: NativeCheckoutMode,
): NativeCheckoutPayload | HostedCheckoutPayload | null {
  if (!mode.native) return session?.url ? { url: session.url } : null
  if (!session?.client_secret || !session?.id) return null
  return {
    clientSecret: String(session.client_secret),
    publishableKey: mode.publishableKey,
    sessionId: String(session.id),
  }
}
