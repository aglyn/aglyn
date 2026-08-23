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
 * The order-fulfilment capability (AGL-2461) — how a HOST APP records a
 * shipment without importing the plugin that owns order semantics.
 *
 * ## Why this registry exists at all
 *
 * `eslint.config.mjs`'s `scope:app` → `notDependOnLibsWithTags:['aglyn:addons']`
 * rule means `apps/console` may not import `@aglyn/plugins-commerce`, so the
 * customer REST API could not reach `ORDER_TRANSITIONS`, `canTransitionOrder`,
 * `liftLegacyOrder` or `appendOrderEvent` — and therefore could not record a
 * shipment at all. The rule is not a preference: the app must stay runnable
 * with any plugin absent, which is the whole plugin platform (AGL-417/419).
 *
 * The tempting escape is a second copy of the transition table inside `/v1`.
 * That is the wrong one, and much worse than the projection drift `orderView`
 * already tolerates: two transition tables drifting means **the API writes an
 * order status the console forbids** — `paid → delivered` skipping fulfilment,
 * or a write onto a `refunded` order — which is precisely the class of bug
 * AGL-1818/AGL-1819 were opened to close.
 *
 * So the edge runs the way every other app↔plugin edge on this platform runs:
 * the plugin registers an implementation into a core registry from its
 * `/server` entry, and the app looks it up. Same shape as
 * `registerBillingWebhookHandler`, `registerSitePageResolver` and
 * `registerPluginJob`. Nothing is imported statically in either direction, the
 * app compiles and boots with commerce absent, and there is exactly ONE
 * implementation of the transition rule — the plugin's.
 *
 * ## THE REGISTRY CARRIES NO AUTHORIZATION. READ THIS BEFORE CALLING.
 *
 * `recordShipment` is a PRE-AUTHORIZED domain operation. It answers "may this
 * order move to this status" (the transition rule, re-asked inside the write)
 * and nothing whatsoever about "may this caller touch this order". It does not
 * know who is asking — deliberately, because its two callers authenticate
 * completely differently: the console's `commerce/fulfill-order` route
 * verifies a Firebase ID token and reads `memberRoles[uid]`, while a `/v1`
 * API key is an ORG credential with no uid at all.
 *
 * Every caller MUST therefore have already established, in its own terms:
 *
 * 1. **who the caller is** (session, or key), and
 * 2. **that the caller's org owns `hostId`** — the org-scoping check, without
 *    which this becomes a cross-tenant write primitive addressable by any
 *    authenticated caller who can guess a host id, and
 * 3. **that the plugin owning this service is switched on for that site**
 *    (`isHostPluginEnabled`) — the registry is process-global and populated by
 *    `ensureAll`, so a registered service says nothing about one org's
 *    configuration.
 *
 * A single implementation is held, not a list: this is a capability with an
 * owner, not a fan-out hook. Two plugins claiming order fulfilment is a
 * misconfiguration, and last-registration-wins would resolve it silently, so
 * {@link registerOrderFulfilmentService} refuses the second registration
 * loudly instead.
 */

/**
 * The two fulfilment-side transitions, and ONLY those.
 *
 * `cancelled` releases stock under its own transaction and `refunded` moves
 * money under another, so neither belongs to a capability whose contract is
 * "a forward status flip plus a timeline entry, no stock moved, no money
 * moved". Widening this union is how a caller gets a door around the
 * specifics those routes exist to enforce — the type is the door being shut.
 */
export type OrderFulfilmentTarget = 'fulfilled' | 'delivered'

export interface RecordShipmentRequest {
  /** Site that owns the order. The CALLER has already proven ownership. */
  hostId: string
  orderId: string
  to: OrderFulfilmentTarget
  /** Free text, e.g. `'UPS'`. Implementations bound the length. */
  carrier?: string
  trackingNumber?: string
}

/**
 * What happened, as a domain fact rather than an HTTP status — each caller
 * maps it into its own error vocabulary (the console route into its JSON
 * shape, `/v1` into the published error envelope), because those two
 * vocabularies are contracts with different audiences and neither may leak
 * into the other.
 *
 * `already` is a SUCCESS and is distinct from `recorded` on purpose: a retried
 * request finds the order in the target status and returns without writing, so
 * a lost response can never append a second copy of the same shipment. A
 * caller that folded the two together would still be correct about the state
 * and would lose the only signal that says "this was your retry".
 */
export type RecordShipmentOutcome =
  | { outcome: 'recorded' }
  | { outcome: 'already' }
  | { outcome: 'no_such_order' }
  /** The transition rule refused. `from` is the status that refused it. */
  | { outcome: 'blocked'; from: string }

export interface OrderFulfilmentService {
  /**
   * The plugin that owns this capability. Callers gate on THIS — never on a
   * hard-coded `'commerce'` — which is what keeps the app free of any name
   * from the addon layer.
   */
  pluginId: string
  recordShipment(request: RecordShipmentRequest): Promise<RecordShipmentOutcome>
}

let service: OrderFulfilmentService | null = null

/**
 * Registers the platform's order-fulfilment implementation, from a plugin's
 * `/server` entry. Idempotent for the SAME plugin (the loader guarantees one
 * activation per plugin+surface, but a re-registration must not be an error in
 * a process that loads a surface twice); a DIFFERENT plugin claiming the
 * capability throws, because silently overwriting it would hand order writes
 * to whichever module happened to load last.
 */
export function registerOrderFulfilmentService(
  next: OrderFulfilmentService,
): void {
  if (service && service.pluginId !== next.pluginId) {
    throw new Error(
      `Order fulfilment is already provided by "${service.pluginId}"; ` +
        `"${next.pluginId}" cannot also claim it`,
    )
  }
  service = next
}

/**
 * The registered service, or `null` when no loaded plugin provides one — a
 * deployment with commerce switched off, or a self-host build without it.
 * `null` is an ordinary answer, never an error: callers turn it into "this
 * endpoint does not exist here", which is the truth.
 */
export function getOrderFulfilmentService(): OrderFulfilmentService | null {
  return service
}

/** Test seam: forget the registration. */
export function resetOrderFulfilmentServiceForTests(): void {
  service = null
}
