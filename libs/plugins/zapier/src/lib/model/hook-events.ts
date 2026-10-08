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
 * The events a REST hook can take (AGL-3643), and what each needs.
 *
 * A hook is a standing read: it sends the site's records out as they
 * happen, so it is held to exactly what reading them over the REST API
 * asks — the key's scope for the record, and the plan feature the record's
 * endpoint needs. Asked when the hook is made AND at every delivery, so a
 * revoked key or a lapsed plan stops it.
 *
 * Where each comes from: commerce and bookings raise theirs on core's
 * domain-event outbox and this plugin subscribes by name; a contact and a
 * form submission are host events, which this plugin relays onto the same
 * outbox (`zapier.relay`).
 */

export type ZapierHookEvent =
  | 'order.paid'
  | 'order.fulfilled'
  | 'order.delivered'
  | 'order.refunded'
  | 'order.cancelled'
  | 'booking.created'
  | 'booking.rescheduled'
  | 'booking.canceled'
  | 'contact.created'
  | 'form.submitted'

export interface ZapierHookEventSpec {
  event: ZapierHookEvent
  /** "Order paid", for the console card. */
  label: string
  /** The API scope that reads what the event carries. */
  scope: 'orders:read' | 'bookings:read' | 'contacts:read' | 'forms:read'
  /** The plan feature the record's endpoint needs, or null for none. */
  feature: 'commerce' | 'bookings' | 'crm' | null
  /** The host event relayed into it, for the two that are host events. */
  hostEvent?: 'contactCreated' | 'formSubmission'
}

export const ZAPIER_HOOK_EVENTS: readonly ZapierHookEventSpec[] = [
  { event: 'order.paid', label: 'Order paid', scope: 'orders:read', feature: 'commerce' },
  { event: 'order.fulfilled', label: 'Order shipped', scope: 'orders:read', feature: 'commerce' },
  { event: 'order.delivered', label: 'Order delivered', scope: 'orders:read', feature: 'commerce' },
  { event: 'order.refunded', label: 'Order refunded', scope: 'orders:read', feature: 'commerce' },
  { event: 'order.cancelled', label: 'Order canceled', scope: 'orders:read', feature: 'commerce' },
  { event: 'booking.created', label: 'Booking confirmed', scope: 'bookings:read', feature: 'bookings' },
  { event: 'booking.rescheduled', label: 'Booking rescheduled', scope: 'bookings:read', feature: 'bookings' },
  { event: 'booking.canceled', label: 'Booking canceled', scope: 'bookings:read', feature: 'bookings' },
  { event: 'contact.created', label: 'New contact', scope: 'contacts:read', feature: 'crm', hostEvent: 'contactCreated' },
  { event: 'form.submitted', label: 'Form submitted', scope: 'forms:read', feature: null, hostEvent: 'formSubmission' },
]

const BY_NAME = new Map(ZAPIER_HOOK_EVENTS.map((spec) => [spec.event, spec]))

/** The events commerce and bookings raise on the outbox, which this plugin subscribes to. */
export const ZAPIER_DOMAIN_EVENTS: readonly ZapierHookEvent[] = ZAPIER_HOOK_EVENTS.filter(
  (spec) => !spec.hostEvent,
).map((spec) => spec.event)

export function zapierHookEventSpec(event: string): ZapierHookEventSpec | null {
  return BY_NAME.get(event as ZapierHookEvent) ?? null
}

/** The hook event a host event is relayed as, or null when no hook takes it. */
export function zapierEventForHostEvent(hostEvent: string): ZapierHookEvent | null {
  return ZAPIER_HOOK_EVENTS.find((spec) => spec.hostEvent === hostEvent)?.event ?? null
}

/**
 * The events a subscribe asked for — `events: [...]` or one `event` —
 * de-duplicated in catalog order. `unknown` lists every name the catalog
 * does not hold, which the endpoint refuses rather than drops: a Zap that
 * silently subscribed to less than it asked for would never fire.
 */
export function readZapierHookEvents(body: { events?: unknown; event?: unknown }): {
  events: ZapierHookEvent[]
  unknown: string[]
} {
  const raw = Array.isArray(body.events) ? body.events : body.event !== undefined ? [body.event] : []
  const names = raw.map((value) => String(value ?? '').trim()).filter(Boolean)
  const unknown = names.filter((name) => !BY_NAME.has(name as ZapierHookEvent))
  const wanted = new Set(names)
  return { events: ZAPIER_HOOK_EVENTS.filter((spec) => wanted.has(spec.event)).map((spec) => spec.event), unknown }
}

/** A hook as the console card and the REST API show it: never its URL. */
export interface ZapierHookView {
  id: string
  object: 'hook'
  siteId: string
  events: ZapierHookEvent[]
  /** The host the hook posts to, `hooks.zapier.com`. */
  target: string
  /** The name of the API key that subscribed it: the Zapier connection. */
  keyName: string | null
  created: string
  lastDeliveryAt: string | null
  lastDeliveryStatus: 'delivered' | 'failed' | null
}
