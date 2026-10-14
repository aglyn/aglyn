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

import {
  advertisingConsentGranted,
  readAdvertisingConsentWire,
} from '@aglyn/aglyn/app-utils/advertising-consent'
import { advertisingEventId } from '@aglyn/aglyn/app-utils/advertising-events'
import { stripeIdIsTestMode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'
import {
  resolveAdvertisingTagId,
  type VisitorConsentHost,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import type {
  AdvertisingLeadRequest,
  AdvertisingOrderConsentRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-advertising-conversions'
import { CONSENT_TTL_MS, EVENT_TTL_MS } from '../constants'
import { AD_PROVIDERS, type AdProviderId } from '../model/connections'
import {
  hashUserData,
  normalizeEmail,
  sha256Hex,
  type ConversionEvent,
  type ConversionItem,
} from '../providers/event'
import {
  consentDocId,
  eventDocId,
  type AdConversionStore,
  type StoredConnection,
  type StoredEvent,
} from './store'

/**
 * THE CONSENT GATE AND THE QUEUE (AGL-3694). Holds no token and calls no
 * vendor: it decides whether a conversion may be reported at all, hashes what
 * it keeps, and owes the event to each of the site's active connections; the
 * console job delivers.
 *
 * ## Consent, which decides everything here
 *
 * - A CHECKOUT carries the visitor's advertising consent
 *   (`app-utils/advertising-consent.ts`). It is judged by the browser gate's
 *   own predicate against the site's consent settings and the request's GPC
 *   header, and recorded under the order's id ONLY when it grants.
 * - An ORDER is reported only when that record exists. No record — a visitor
 *   who said no, never answered, sent GPC, checked out on a site with no
 *   connection, or an order from the register — is unknown consent, and
 *   unknown is never sent.
 * - A LEAD carries its consent with it and is judged the same way, then and
 *   there.
 *
 * ## Idempotency
 *
 * The event id is derived (`advertisingEventId`): a purchase's from its order
 * id, a lead's from the id its form minted. The owed event's document id is
 * the connection and that id, created with `create` — so the outbox
 * redelivering `order.paid` owes nothing twice, and the vendors, which
 * de-duplicate by the same id against the browser tag, see one conversion.
 *
 * ## Test orders are never live
 *
 * An order paid in Stripe's test mode is owed only to a connection that can
 * mark it as a test (a test event code for Meta and TikTok; Pinterest's test
 * flag) and always carries that mark. With no way to mark it, it is not sent.
 */

export interface IntakeDeps {
  store: Pick<
    AdConversionStore,
    'listConnectionsForHost' | 'putConsent' | 'getConsent' | 'removeConsent' | 'enqueueEvent'
  >
  /** The site's host document, for its consent settings and tag ids; `null` when missing. */
  host(hostId: string): Promise<VisitorConsentHost | null>
  /** Whether the plugin is on for the site: off stops every event. */
  enabled(hostId: string): Promise<boolean>
  now(): number
}

const ORDER_KEY = /^[A-Za-z0-9_]{1,255}$/

/** A site's connections that take events now. */
async function activeConnections(deps: IntakeDeps, hostId: string) {
  const all = await deps.store.listConnectionsForHost(hostId)
  const active = all.filter(({ connection }) => connection.status === 'active' && connection.hostId === hostId)
  // Asked only when there is something to send, so a site that connected
  // nothing costs one query and no more.
  if (!active.length || !(await deps.enabled(hostId))) return []
  return active
}

/**
 * What one connection can send an event to, or `null` when it cannot: a
 * pixel-addressed vendor (Meta, TikTok) needs the site's tag id, Pinterest its
 * ad account.
 */
function targetOf(
  provider: AdProviderId,
  connection: StoredConnection,
  host: VisitorConsentHost | null,
): { pixelId: string | null } | null {
  if (AD_PROVIDERS[provider].needsTagId) {
    const pixelId = resolveAdvertisingTagId(host, provider)
    return pixelId ? { pixelId } : null
  }
  return connection.adAccountId ? { pixelId: null } : null
}

/** How an event is marked for a connection: live, a test code, Pinterest's flag — or `undefined` when it cannot be sent. */
export function testMarkerFor(
  provider: AdProviderId,
  connection: Pick<StoredConnection, 'testEventCode'>,
  test: boolean,
): string | true | null | undefined {
  if (!test) return null
  if (provider === 'pinterest') return true
  return connection.testEventCode || undefined
}

function owed(
  connectionId: string,
  connection: StoredConnection,
  event: ConversionEvent,
  pixelId: string | null,
  test: string | true | null,
  emailHash: string | null,
  nowMs: number,
): StoredEvent {
  return {
    orgId: connection.orgId,
    connectionId,
    hostId: connection.hostId,
    provider: connection.provider,
    status: 'pending',
    test,
    pixelId,
    attempts: 0,
    nextAttemptAtMs: nowMs,
    createdAtMs: nowMs,
    lastError: null,
    emailHash,
    event,
    expiresAt: new Date(nowMs + EVENT_TTL_MS),
  }
}

/** Owes one event to every active connection that can take it. Answers how many newly owed. */
async function owe(
  deps: IntakeDeps,
  connections: Array<{ id: string; connection: StoredConnection }>,
  host: VisitorConsentHost | null,
  event: ConversionEvent,
  test: boolean,
  emailHash: string | null,
): Promise<number> {
  let count = 0
  const nowMs = deps.now()
  for (const { id, connection } of connections) {
    const target = targetOf(connection.provider, connection, host)
    if (!target) continue
    const marker = testMarkerFor(connection.provider, connection, test)
    if (marker === undefined) continue
    const created = await deps.store.enqueueEvent(
      eventDocId(id, event.id),
      owed(id, connection, event, target.pixelId, marker, emailHash, nowMs),
    )
    if (created) count += 1
  }
  return count
}

/**
 * Records a checkout's consent for the order it may become. Writes nothing
 * unless the site has an active connection AND the consent grants.
 */
export async function recordOrderConsent(
  deps: IntakeDeps,
  request: AdvertisingOrderConsentRequest,
): Promise<boolean> {
  const wire = readAdvertisingConsentWire(request.wire)
  if (!wire || request.gpc || !ORDER_KEY.test(request.orderKey)) return false
  const connections = await activeConnections(deps, request.hostId)
  if (!connections.length) return false
  const host = await deps.host(request.hostId)
  if (!advertisingConsentGranted(host, wire, { gpc: request.gpc })) return false
  const nowMs = deps.now()
  await deps.store.putConsent(consentDocId(request.hostId, request.orderKey), {
    orgId: connections[0].connection.orgId,
    hostId: request.hostId,
    orderKey: request.orderKey,
    status: wire.status,
    consentAtMs: wire.at,
    country: wire.country,
    url: wire.url ?? null,
    ids: wire.ids,
    userAgent: request.userAgent,
    ip: request.ip,
    createdAtMs: nowMs,
    expiresAt: new Date(nowMs + CONSENT_TTL_MS),
  })
  return true
}

/** Reports a submitted lead, judged on the consent it carried. Answers how many connections it was owed to. */
export async function reportLead(deps: IntakeDeps, request: AdvertisingLeadRequest): Promise<number> {
  const wire = readAdvertisingConsentWire(request.wire)
  if (!wire || request.gpc) return 0
  // The browser's pixel sent this lead under this id; without it the two
  // could not be paired, so nothing is sent rather than counted twice.
  const id = advertisingEventId('lead', wire.lead)
  if (!id) return 0
  const connections = await activeConnections(deps, request.hostId)
  if (!connections.length) return 0
  const host = await deps.host(request.hostId)
  if (!advertisingConsentGranted(host, wire, { gpc: request.gpc })) return 0
  const email = normalizeEmail(request.person.email)
  const event: ConversionEvent = {
    id,
    name: 'lead',
    occurredAtMs: deps.now(),
    url: wire.url ?? null,
    currency: null,
    valueCents: null,
    orderId: null,
    items: [],
    user: hashUserData(request.person),
    browser: { ip: request.ip, userAgent: request.userAgent, ...wire.ids },
  }
  return owe(deps, connections, host, event, false, email ? sha256Hex(email) : null)
}

const cents = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : 0
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

function orderItems(lines: unknown): ConversionItem[] {
  if (!Array.isArray(lines)) return []
  return lines.slice(0, 100).flatMap((line: any) => {
    const quantity = Math.max(0, Math.floor(Number(line?.quantity ?? 0)))
    const id = text(line?.productId) ?? text(line?.sku)
    if (!quantity || !id) return []
    return [{ id, name: text(line?.name), quantity, unitCents: cents(line?.unitAmountCents) }]
  })
}

/**
 * `order.paid`, from commerce through core's domain-event outbox: a Purchase,
 * owed only where the checkout recorded a consent that granted. Reads only the
 * payload's public order view, never commerce's code.
 */
export async function intakeOrderPaid(
  deps: IntakeDeps,
  envelope: PluginDomainEventEnvelope<unknown>,
): Promise<number> {
  if (envelope.event !== 'order.paid' || !envelope.hostId) return 0
  const order = ((envelope.payload ?? {}) as Record<string, any>)['order'] as Record<string, any> | undefined
  const orderId = text(order?.['id'])
  if (!order || !orderId || !ORDER_KEY.test(orderId)) return 0
  const id = advertisingEventId('purchase', orderId)
  if (!id) return 0
  const connections = await activeConnections(deps, envelope.hostId)
  if (!connections.length) return 0
  const consentId = consentDocId(envelope.hostId, orderId)
  const consent = await deps.store.getConsent(consentId)
  // Unknown consent is no consent: nothing was recorded for this order.
  if (!consent || consent.hostId !== envelope.hostId) return 0
  const host = await deps.host(envelope.hostId)
  const totals = (order['totals'] ?? {}) as Record<string, unknown>
  const address = (order['shippingAddress'] ?? {}) as Record<string, unknown>
  // The browser tag's `purchase` value excludes tax (`purchase-analytics.ts`),
  // so the server's does too: one conversion, one figure.
  const total = totals['totalCents'] === null || totals['totalCents'] === undefined ? null : cents(totals['totalCents'])
  const valueCents = total === null ? cents(totals['itemsCents']) : Math.max(0, total - cents(totals['taxCents']))
  const email = normalizeEmail(order['customerEmail'])
  const event: ConversionEvent = {
    id,
    name: 'purchase',
    occurredAtMs: envelope.occurredAtMs || deps.now(),
    url: consent.url ?? null,
    currency: (text(order['currency']) ?? 'usd').toUpperCase(),
    valueCents,
    orderId,
    items: orderItems(order['lineItems']),
    user: hashUserData({
      email: order['customerEmail'],
      name: text(order['customerName']) ?? text(address['name']),
      city: address['city'],
      state: address['state'],
      postalCode: address['postalCode'],
      country: address['country'],
    }),
    browser: { ip: consent.ip ?? null, userAgent: consent.userAgent ?? null, ...(consent.ids ?? {}) },
  }
  // A Stripe test-mode checkout says so in its id (`cs_test_…`).
  const test = stripeIdIsTestMode(orderId) || order['livemode'] === false
  const count = await owe(deps, connections, host, event, test, email ? sha256Hex(email) : null)
  // The consent has served its order; the owed events carry what they need.
  await deps.store.removeConsent(consentId)
  return count
}
