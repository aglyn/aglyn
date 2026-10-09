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
 * Conversion events for a site's OWN advertising tags (AGL-3694).
 *
 * ## What this is
 *
 * The analytics taxonomy (`analytics-events.ts`) already says what a visitor
 * did — `purchase`, `generate_lead`, `begin_checkout`, `add_to_cart`,
 * `view_item` — and delivers it to the site's Google tag. A merchant who runs
 * a Meta pixel, a TikTok pixel or a Pinterest tag wants the same moments in
 * those accounts, under each vendor's own standard event name. This module is
 * the translation and the delivery, and nothing else: it never loads a tag.
 *
 * ## Why it cannot fire before consent
 *
 * It sends only to a tag that is ALREADY IN THE DOCUMENT and carries both of
 * this module's marks: {@link ADVERTISING_TAG_ATTRIBUTE}, which only
 * `advertising-tag-mounts.tsx` writes and only where `resolveAdvertisingTags`
 * said the visitor granted advertising, and {@link ADVERTISING_EVENTS_ATTRIBUTE},
 * which the tenant writes only on a merchant's own site. No mark, no call: a
 * visitor who did not grant has no tag, and an event raised for them goes
 * nowhere, exactly as the Google path drops one when `gtag` is absent. A
 * pixel a merchant pasted into Custom HTML carries neither mark and is never
 * called — it runs on a basis that is not ours.
 *
 * Aglyn's own surfaces carry the first mark and never the second, so their
 * tags keep reporting only the page views they always have.
 *
 * ## The event id, and why both halves derive it
 *
 * A purchase or a lead can reach a vendor twice: from this browser call and
 * from the server's Conversions API (the ad-conversions plugin). Each vendor
 * de-duplicates the pair by an event id the two sides share, so the id is
 * DERIVED rather than minted wherever both sides can know the same key:
 * {@link advertisingEventId} turns a purchase's transaction id, or a lead's
 * id, into the one string both send.
 *
 * Kept free of the vendor descriptors on purpose: the console imports the
 * analytics taxonomy, which imports this, and the console may not carry the
 * module that mounts a vendor's script.
 */

/**
 * The attribute every script element the advertising gate renders carries; its
 * value is the vendor id. Declared here and re-exported by
 * `advertising-tags.ts`, so the event delivery below can find a tag without
 * importing the module that mounts one.
 */
export const ADVERTISING_TAG_ATTRIBUTE = 'data-aglyn-ad-tag'

/**
 * The second mark (AGL-3694): this tag is a SITE OWNER's, mounted on their own
 * site, and takes the site's conversion events. Aglyn's own surfaces never
 * write it.
 */
export const ADVERTISING_EVENTS_ATTRIBUTE = 'data-aglyn-ad-events'

/** The conversions a server also reports, and so share an id with it. */
export type AdvertisingEventKind = 'purchase' | 'lead'

const EVENT_KEY = /^[A-Za-z0-9_.:-]{1,120}$/

/**
 * The event id the browser tag and the server's Conversions API both send for
 * one conversion, or `null` for a key that cannot be one. `purchase` takes the
 * order's transaction id (the Stripe Checkout Session id the order is stored
 * under); `lead` takes the id the form minted for its submission.
 */
export function advertisingEventId(
  kind: AdvertisingEventKind,
  key: string | null | undefined,
): string | null {
  const value = String(key ?? '').trim()
  if (!EVENT_KEY.test(value)) return null
  return `${kind}.${value}`
}

/** A fresh id for a lead, minted where the form is submitted. */
export function mintAdvertisingLeadKey(): string {
  try {
    const id = globalThis.crypto?.randomUUID?.()
    if (id) return id
  } catch {
    // Fall through to the time-based id below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

type Params = Record<string, unknown>

interface EventItem {
  id: string
  name?: string
  price?: number
  quantity: number
}

function itemsOf(params: Params): EventItem[] {
  const items = Array.isArray(params['items']) ? params['items'] : []
  return items.flatMap((entry) => {
    const item = (entry ?? {}) as Params
    const id = String(item['item_id'] ?? '').trim()
    if (!id) return []
    const price = Number(item['price'])
    const quantity = Math.max(1, Math.floor(Number(item['quantity'] ?? 1)) || 1)
    return [
      {
        id,
        ...(typeof item['item_name'] === 'string' ? { name: item['item_name'] } : {}),
        ...(Number.isFinite(price) ? { price } : {}),
        quantity,
      },
    ]
  })
}

function money(params: Params): { value?: number; currency?: string } {
  const value = Number(params['value'])
  const currency = typeof params['currency'] === 'string' ? params['currency'].toUpperCase() : ''
  return Number.isFinite(value) && currency ? { value, currency } : {}
}

/** One vendor's call for one event: its event name and its own parameters. */
interface VendorCall {
  name: string
  params: Params
}

type Translate = (params: Params) => VendorCall | null

/**
 * Each vendor's standard event for each taxonomy event, in that vendor's own
 * parameter shape. An event a vendor has no standard name for is not sent to
 * it at all rather than invented.
 */
const TRANSLATIONS: Readonly<Record<string, Readonly<Record<string, Translate>>>> = {
  meta: {
    purchase: (params) => {
      const items = itemsOf(params)
      return {
        name: 'Purchase',
        params: {
          ...money(params),
          content_type: 'product',
          content_ids: items.map((item) => item.id),
          contents: items.map((item) => ({ id: item.id, quantity: item.quantity, item_price: item.price })),
          num_items: items.reduce((sum, item) => sum + item.quantity, 0),
        },
      }
    },
    generate_lead: () => ({ name: 'Lead', params: {} }),
    begin_checkout: (params) => {
      const items = itemsOf(params)
      return {
        name: 'InitiateCheckout',
        params: { ...money(params), content_ids: items.map((item) => item.id), num_items: items.length },
      }
    },
    add_to_cart: (params) => ({
      name: 'AddToCart',
      params: { ...money(params), content_type: 'product', content_ids: itemsOf(params).map((item) => item.id) },
    }),
    view_item: (params) => ({
      name: 'ViewContent',
      params: { content_type: 'product', content_ids: itemsOf(params).map((item) => item.id) },
    }),
  },
  tiktok: {
    purchase: (params) => ({
      name: 'CompletePayment',
      params: {
        ...money(params),
        content_type: 'product',
        contents: itemsOf(params).map((item) => ({
          content_id: item.id,
          content_name: item.name,
          quantity: item.quantity,
          price: item.price,
        })),
      },
    }),
    generate_lead: () => ({ name: 'SubmitForm', params: {} }),
    begin_checkout: (params) => ({
      name: 'InitiateCheckout',
      params: { ...money(params), contents: itemsOf(params).map((item) => ({ content_id: item.id, quantity: item.quantity })) },
    }),
    add_to_cart: (params) => ({
      name: 'AddToCart',
      params: { ...money(params), content_type: 'product', contents: itemsOf(params).map((item) => ({ content_id: item.id, quantity: item.quantity })) },
    }),
    view_item: (params) => ({
      name: 'ViewContent',
      params: { content_type: 'product', contents: itemsOf(params).map((item) => ({ content_id: item.id })) },
    }),
  },
  pinterest: {
    purchase: (params) => {
      const items = itemsOf(params)
      return {
        name: 'checkout',
        params: {
          ...money(params),
          order_id: typeof params['transaction_id'] === 'string' ? params['transaction_id'] : undefined,
          order_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
          line_items: items.map((item) => ({
            product_id: item.id,
            product_name: item.name,
            product_price: item.price,
            product_quantity: item.quantity,
          })),
        },
      }
    },
    generate_lead: () => ({ name: 'lead', params: {} }),
    add_to_cart: (params) => {
      const items = itemsOf(params)
      return {
        name: 'addtocart',
        params: {
          ...money(params),
          order_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
          line_items: items.map((item) => ({ product_id: item.id, product_quantity: item.quantity })),
        },
      }
    },
  },
}

/** The vendors that take conversion events, by `analytics.adTags` key. */
export const ADVERTISING_EVENT_VENDORS: readonly string[] = Object.keys(TRANSLATIONS)

type Send = (scope: Params, call: VendorCall, eventId: string) => void

const SENDERS: Readonly<Record<string, Send>> = {
  // `fbq('track', name, params, { eventID })` is Meta's documented
  // de-duplication call: the fourth argument pairs this hit with the
  // Conversions API event carrying the same `event_id`.
  meta: (scope, call, eventId) => {
    const fbq = scope['fbq']
    if (typeof fbq === 'function') {
      ;(fbq as (...args: unknown[]) => void)('track', call.name, call.params, { eventID: eventId })
    }
  },
  // `event_id` in the third argument is TikTok's de-duplication key against
  // the Events API.
  tiktok: (scope, call, eventId) => {
    const ttq = scope['ttq'] as { track?: unknown } | undefined
    if (ttq && typeof ttq.track === 'function') {
      ;(ttq.track as (...args: unknown[]) => void).call(ttq, call.name, call.params, { event_id: eventId })
    }
  },
  // Pinterest reads `event_id` from the event's own data.
  pinterest: (scope, call, eventId) => {
    const pintrk = scope['pintrk']
    if (typeof pintrk === 'function') {
      ;(pintrk as (...args: unknown[]) => void)('track', call.name, { ...call.params, event_id: eventId })
    }
  },
}

/** Whether this document holds a merchant's own tag for `vendorId`, mounted by the gate. */
function merchantTagResident(vendorId: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    return Boolean(
      document.querySelector(
        `script[${ADVERTISING_TAG_ATTRIBUTE}="${vendorId}"][${ADVERTISING_EVENTS_ATTRIBUTE}]`,
      ),
    )
  } catch {
    return false
  }
}

/** Whether any merchant tag that takes conversion events is in the document. */
export function merchantAdvertisingTagsResident(): boolean {
  return ADVERTISING_EVENT_VENDORS.some(merchantTagResident)
}

/** The id one browser event is sent under, for the vendors' de-duplication. */
function eventIdFor(name: string, params: Params, explicit: string | undefined): string {
  if (explicit) return explicit
  if (name === 'purchase') {
    const derived = advertisingEventId('purchase', String(params['transaction_id'] ?? ''))
    if (derived) return derived
  }
  // No server counterpart: an id of its own, so a vendor still sees one.
  return `${name}.${mintAdvertisingLeadKey()}`
}

/**
 * Sends one taxonomy event to every merchant tag in the document that takes
 * it, and answers the vendor ids it reached. Never throws and never queues:
 * with no marked tag — the visitor did not grant advertising, or the site runs
 * none — it does nothing at all.
 *
 * `options.eventId` is the shared id for a conversion the server also reports
 * (a lead); a purchase derives its own from `transaction_id`.
 */
export function sendAdvertisingEvent(
  name: string,
  params: Params,
  options: { eventId?: string | null } = {},
): string[] {
  if (typeof window === 'undefined') return []
  const reached: string[] = []
  const scope = window as unknown as Params
  let eventId: string | null = null
  for (const vendorId of ADVERTISING_EVENT_VENDORS) {
    const translate = TRANSLATIONS[vendorId]?.[name]
    if (!translate || !merchantTagResident(vendorId)) continue
    try {
      const call = translate(params)
      if (!call) continue
      eventId ??= eventIdFor(name, params, options.eventId ?? undefined)
      SENDERS[vendorId]?.(scope, call, eventId)
      reached.push(vendorId)
    } catch {
      // A vendor whose own call throws is skipped; the others still hear it.
    }
  }
  return reached
}
