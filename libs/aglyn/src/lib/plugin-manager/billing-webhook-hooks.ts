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

export type BillingWebhookHandler = (
  event: BillingWebhookEvent,
) => Promise<void> | void

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

/** Runs every registered handler sequentially; the first throw propagates. */
export async function runBillingWebhookHandlers(
  event: BillingWebhookEvent,
): Promise<void> {
  for (const handler of handlers) {
    await handler(event)
  }
}
