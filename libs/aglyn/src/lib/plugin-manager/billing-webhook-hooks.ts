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
 * Billing-webhook extension point (AGL-418): plugins register handlers for
 * the platform Stripe webhook from their `/server` entries — the console's
 * webhook route verifies the signature, syncs the org's plan/subscription
 * (the only core-billing concern), then fans the event out here. Handlers
 * self-select on `type` + `object.metadata.type` exactly as the old inline
 * sections did (commerce orders/carts/drafts/reservations/subscriptions,
 * booking payments, marketplace purchases). Errors PROPAGATE: a throwing
 * handler fails the webhook with a 500 so Stripe redelivers — identical to
 * the pre-extraction behavior, and every section is idempotent by doc key.
 */

export interface BillingWebhookEvent {
  /** Stripe event type, e.g. 'checkout.session.completed'. */
  type: string
  /** `event.data.object` — the session/subscription/invoice payload. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  object: any
  /** The full parsed Stripe event, for handlers that need ids/metadata. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any
  /** The webhook request's Host header — for absolute callback URLs. */
  requestHost?: string
}

/**
 * What a handler may tell the route about the event it just saw (AGL-2429).
 *
 * Handlers have always returned `void`, which made "a plugin handled this"
 * and "every plugin ignored this" the same observation from the route's side.
 * On most events that is harmless — the route does not care who consumed a
 * `checkout.session.completed`. On a CHARGEBACK it is the whole question: an
 * event nobody claimed is money that moved with nothing recording it, and it
 * is indistinguishable from the ordinary case where a plugin quietly did its
 * job. See the `charge.dispute.*` section of the console's webhook route.
 *
 * `claimed` is deliberately opt-in and deliberately narrow. A handler sets it
 * when it RECOGNISED the event as its own — found the order, the purchase,
 * the booking — not when it merely ran. Returning nothing keeps the old
 * meaning, so every handler that does not care is unaffected.
 */
export interface BillingWebhookHandlerResult {
  /** True when this handler recognised the event as belonging to it. */
  claimed?: boolean
}

export type BillingWebhookHandler = (
  event: BillingWebhookEvent,
) =>
  | Promise<void | BillingWebhookHandlerResult>
  | void
  | BillingWebhookHandlerResult

/** What `runBillingWebhookHandlers` reports back about a whole dispatch. */
export interface BillingWebhookDispatchResult {
  /** True when ANY handler claimed the event. */
  claimed: boolean
}

const handlers: BillingWebhookHandler[] = []

/**
 * Registers a webhook handler. The plugin loader guarantees each plugin's
 * register fn runs once per process, so no dedupe is needed here.
 */
export function registerBillingWebhookHandler(
  handler: BillingWebhookHandler,
): void {
  handlers.push(handler)
}

/**
 * Runs every registered handler sequentially; the first throw propagates.
 *
 * EVERY handler runs even after one has claimed the event: two plugins may
 * legitimately care about the same event, and short-circuiting on the first
 * claim would turn a reporting signal into a dispatch rule and silently drop
 * side effects. The claim is a fold over all of them, never a break.
 */
export async function runBillingWebhookHandlers(
  event: BillingWebhookEvent,
): Promise<BillingWebhookDispatchResult> {
  let claimed = false
  for (const handler of handlers) {
    // Narrowed through the union rather than read off it: the handler's
    // return type includes `void` — the shape every handler that does not
    // care still returns — and a property read on `void` is a type error even
    // with `strictNullChecks` off.
    const result = (await handler(event)) as
      | BillingWebhookHandlerResult
      | undefined
    if (result?.claimed === true) claimed = true
  }
  return { claimed }
}
