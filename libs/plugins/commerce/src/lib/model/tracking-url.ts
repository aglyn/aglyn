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
 * Carrier tracking links (AGL-3610) — THE one place a carrier name and a
 * tracking number become a URL a buyer can open.
 *
 * SHARED ON PURPOSE. The buyer's shipped email and the guest order-status page
 * (AGL-3610), the console's fulfillment rows and partial fulfillment
 * (AGL-3611), and the shipping plugin's label purchase all need the same link
 * for the same parcel. Import `trackingUrlFor` from
 * `@aglyn/plugins-commerce/model` rather than writing a second table: two
 * tables drift, and a buyer whose email and status page disagree about where
 * their parcel is has been handed two answers to one question.
 *
 * The carrier is FREE TEXT on an order (`OrderFulfillment.carrier`, typed by a
 * merchant or a supplier: "UPS", "ups ground", "Fed Ex", "USPS Priority"), so
 * `carrierIdFor` matches loosely and returns `null` for anything it does not
 * know. An unknown carrier gets NO link rather than a guess — a link to the
 * wrong carrier's tracker is worse than none, because the buyer believes it.
 *
 * A fulfillment that already carries a `trackingUrl` (the shipping plugin's
 * label purchase knows the exact one) wins over a built one:
 * `fulfillmentTrackingUrl` is the reader every surface should call.
 */

export type TrackingCarrierId =
  | 'usps'
  | 'ups'
  | 'fedex'
  | 'dhl'
  | 'canada-post'
  | 'royal-mail'
  | 'australia-post'

export interface TrackingCarrier {
  id: TrackingCarrierId
  /** How the carrier names itself, for display. */
  label: string
  /** Lower-cased, punctuation-stripped spellings a merchant types. */
  aliases: readonly string[]
  /** The public tracker, with the number URL-encoded in place. */
  url: (trackingNumber: string) => string
}

export const TRACKING_CARRIERS: readonly TrackingCarrier[] = [
  {
    id: 'usps',
    label: 'USPS',
    aliases: ['usps', 'unitedstatespostalservice', 'uspostalservice', 'postalservice'],
    url: (number) =>
      `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`,
  },
  {
    id: 'ups',
    label: 'UPS',
    aliases: ['ups', 'unitedparcelservice'],
    url: (number) => `https://www.ups.com/track?tracknum=${number}`,
  },
  {
    id: 'fedex',
    label: 'FedEx',
    aliases: ['fedex', 'federalexpress'],
    url: (number) => `https://www.fedex.com/fedextrack/?trknbr=${number}`,
  },
  {
    id: 'dhl',
    label: 'DHL',
    aliases: ['dhl', 'dhlexpress', 'dhlecommerce'],
    url: (number) =>
      `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${number}`,
  },
  {
    id: 'canada-post',
    label: 'Canada Post',
    aliases: ['canadapost', 'postescanada', 'canpost'],
    url: (number) =>
      `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${number}`,
  },
  {
    id: 'royal-mail',
    label: 'Royal Mail',
    aliases: ['royalmail', 'parcelforce'],
    url: (number) =>
      `https://www.royalmail.com/track-your-item#/tracking-results/${number}`,
  },
  {
    id: 'australia-post',
    label: 'Australia Post',
    aliases: ['australiapost', 'auspost', 'startrack'],
    url: (number) => `https://auspost.com.au/mypost/track/details/${number}`,
  },
]

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The carrier a free-text name refers to, or `null`. Matches an alias exactly
 * after squashing, then as a prefix ("UPS Ground", "USPS Priority Mail",
 * "FedEx 2Day") — never as a substring, so "Pups Express" is not UPS.
 */
export function carrierIdFor(
  carrier: string | null | undefined,
): TrackingCarrierId | null {
  const squashed = squash(String(carrier ?? ''))
  if (!squashed) return null
  for (const entry of TRACKING_CARRIERS) {
    if (entry.aliases.includes(squashed)) return entry.id
  }
  // Longest alias first, so "uspostalservice" is tried before "ups".
  const byLength = TRACKING_CARRIERS.flatMap((entry) =>
    entry.aliases.map((alias) => ({ alias, id: entry.id })),
  ).sort((a, b) => b.alias.length - a.alias.length)
  for (const { alias, id } of byLength) {
    if (squashed.startsWith(alias)) return id
  }
  return null
}

/** Display label for a carrier id, or the merchant's own text. */
export function carrierLabelFor(carrier: string | null | undefined): string {
  const id = carrierIdFor(carrier)
  return (
    TRACKING_CARRIERS.find((entry) => entry.id === id)?.label ??
    String(carrier ?? '').trim()
  )
}

/**
 * The public tracking URL for a parcel, or `null` when the carrier is unknown
 * or there is no number. Whitespace inside the number is removed (merchants
 * paste "1Z 999 AA1 01 2345 6784"); everything else is URL-encoded.
 */
export function trackingUrlFor(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  const number = String(trackingNumber ?? '').replace(/\s+/g, '')
  if (!number) return null
  const id = carrierIdFor(carrier)
  const entry = TRACKING_CARRIERS.find((candidate) => candidate.id === id)
  return entry ? entry.url(encodeURIComponent(number)) : null
}

/**
 * The link for one fulfillment: its own stored `trackingUrl` when it is an
 * `https:` URL, otherwise one built from carrier + number. Anything else in
 * the stored field (a `javascript:` URL typed into a supplier callback) is
 * ignored rather than rendered into an email or a page.
 */
export function fulfillmentTrackingUrl(fulfillment: {
  carrier?: string | null
  trackingNumber?: string | null
  trackingUrl?: string | null
}): string | null {
  const stored = String(fulfillment.trackingUrl ?? '').trim()
  if (/^https:\/\/[^\s]+$/i.test(stored)) return stored
  return trackingUrlFor(fulfillment.carrier, fulfillment.trackingNumber)
}
