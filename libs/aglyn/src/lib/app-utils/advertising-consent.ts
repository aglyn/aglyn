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
  advertisingGrantedByRecord,
  hasGlobalPrivacyControl,
  hostConsentRequired,
  parseStoredVisitorConsent,
  readStoredVisitorConsent,
  type StoredVisitorConsent,
  type VisitorConsentHost,
} from './visitor-consent'

/**
 * A visitor's advertising consent, carried to the SERVER (AGL-3694).
 *
 * ## Why the server needs it, and why it cannot look it up
 *
 * A Conversions API event is sent by a server, often long after the visitor
 * left: a purchase is reported when Stripe's webhook lands, not when the
 * shopper clicked Pay. Consent on a published site is recorded in the
 * visitor's own browser (`visitor-consent.ts`) — ISR-cached pages cannot vary
 * by visitor, so there is no server-side copy to consult later. The only
 * moment the server can learn what this visitor decided is a request the
 * visitor makes: the checkout they start, the form they submit.
 *
 * So those requests carry the record as it stands, and the server decides
 * again from it — with the site's own consent settings and the request's own
 * Global Privacy Control header — through the SAME predicate the browser gate
 * uses ({@link advertisingConsentGranted}). The verdict is recorded with the
 * order or the lead it was given for, and an event whose record says no, or
 * that has no record at all, is never sent: unknown is no.
 *
 * ## What it carries
 *
 * The record's own fields (status, the advertising grant, when, the country),
 * and the vendors' first-party browser ids — `_fbp`/`_fbc` (Meta), `_ttp` and
 * `ttclid` (TikTok), `_epik` (Pinterest) — which are what let a vendor match a
 * server event to the visit it came from. Nothing at all is carried for a
 * visitor whose record does not grant advertising, or whose browser sends GPC:
 * {@link advertisingConsentWire} answers `null` and the request goes without.
 */

/** The request-body field the wire travels in. */
export const ADVERTISING_CONSENT_FIELD = 'adConsent'

/** The vendor browser ids a server event may carry, by the vendor's own name for each. */
export interface AdvertisingBrowserIds {
  fbp?: string
  fbc?: string
  ttp?: string
  ttclid?: string
  epik?: string
}

export interface AdvertisingConsentWire {
  v: 1
  status: StoredVisitorConsent['status']
  advertising: boolean
  at: number
  country: string | null
  /** The id the browser sent a lead's pixel event under; see `advertising-events.ts`. */
  lead?: string
  /** The page the event happened on, origin and path only. */
  url?: string
  ids: AdvertisingBrowserIds
}

/** Cookie name → wire key, for the ids above. */
const BROWSER_ID_COOKIES: ReadonlyArray<[string, keyof AdvertisingBrowserIds]> = [
  ['_fbp', 'fbp'],
  ['_fbc', 'fbc'],
  ['_ttp', 'ttp'],
  ['ttclid', 'ttclid'],
  ['_epik', 'epik'],
]

const BROWSER_ID = /^[A-Za-z0-9._~:+/=-]{1,256}$/
const LEAD_KEY = /^[A-Za-z0-9_.:-]{1,120}$/

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  try {
    for (const part of String(document.cookie ?? '').split(';')) {
      const at = part.indexOf('=')
      if (at < 0) continue
      if (part.slice(0, at).trim() !== name) continue
      const value = decodeURIComponent(part.slice(at + 1).trim())
      return BROWSER_ID.test(value) ? value : null
    }
  } catch {
    // An unreadable jar carries no ids.
  }
  return null
}

function pageUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    // Origin and path only: a query string is where a token or an address
    // ends up, and a vendor needs neither to know which page converted.
    return `${window.location.origin}${window.location.pathname}`.slice(0, 500)
  } catch {
    return undefined
  }
}

/**
 * The wire for this visitor on this site, or `null` when there is nothing to
 * carry: no record, a record that does not grant advertising, or a browser
 * sending Global Privacy Control. Browser only.
 *
 * `options.lead` is the id a form minted for this submission, so the server
 * reports the lead under the same event id the pixel did.
 */
export function advertisingConsentWire(
  hostId: string | null | undefined,
  options: { lead?: string | null } = {},
): AdvertisingConsentWire | null {
  if (!hostId || typeof window === 'undefined') return null
  if (hasGlobalPrivacyControl()) return null
  const stored = readStoredVisitorConsent(hostId)
  if (!stored || stored.advertising !== true) return null
  const ids: AdvertisingBrowserIds = {}
  for (const [cookie, key] of BROWSER_ID_COOKIES) {
    const value = readCookie(cookie)
    if (value) ids[key] = value
  }
  const lead = String(options.lead ?? '')
  const url = pageUrl()
  return {
    v: 1,
    status: stored.status,
    advertising: true,
    at: stored.at,
    country: stored.country ?? null,
    ...(LEAD_KEY.test(lead) ? { lead } : {}),
    ...(url ? { url } : {}),
    ids,
  }
}

/** The wire as a request body field: `{ adConsent }` or nothing at all. */
export function advertisingConsentField(
  hostId: string | null | undefined,
  options: { lead?: string | null } = {},
): { adConsent?: AdvertisingConsentWire } {
  const wire = advertisingConsentWire(hostId, options)
  return wire ? { [ADVERTISING_CONSENT_FIELD]: wire } : {}
}

/**
 * A wire from a request body, validated, or `null`. Untrusted: every field is
 * re-checked, the record is re-derived through the browser's own parser (so a
 * hand-edited grant counts for exactly what its status allows), and anything
 * malformed is dropped rather than repaired.
 */
export function readAdvertisingConsentWire(raw: unknown): AdvertisingConsentWire | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  const stored = parseStoredVisitorConsent(
    JSON.stringify({
      v: body['v'],
      status: body['status'],
      advertising: body['advertising'],
      at: body['at'],
      country: body['country'],
    }),
  )
  if (!stored) return null
  const ids: AdvertisingBrowserIds = {}
  const rawIds = (body['ids'] ?? {}) as Record<string, unknown>
  for (const [, key] of BROWSER_ID_COOKIES) {
    const value = rawIds?.[key]
    if (typeof value === 'string' && BROWSER_ID.test(value)) ids[key] = value
  }
  const lead = typeof body['lead'] === 'string' && LEAD_KEY.test(body['lead']) ? body['lead'] : null
  let url: string | null = null
  if (typeof body['url'] === 'string' && body['url'].length <= 500) {
    try {
      const parsed = new URL(body['url'])
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        url = `${parsed.origin}${parsed.pathname}`
      }
    } catch {
      url = null
    }
  }
  return {
    v: 1,
    status: stored.status,
    advertising: stored.advertising === true,
    at: stored.at,
    country: stored.country ?? null,
    ...(lead ? { lead } : {}),
    ...(url ? { url } : {}),
    ids,
  }
}

/**
 * The server's verdict: may an advertising event be sent for the visitor this
 * wire came from, on this site? The browser gate's own conditions, asked of
 * the record the visitor carried:
 *
 * - the site runs our consent tool and has something to ask about
 *   ({@link hostConsentRequired}) — a site on its own CMP has no answer of
 *   ours, and no answer is no;
 * - the site asks about advertising and the record grants it
 *   ({@link advertisingGrantedByRecord}), which carries every regional rule
 *   and every refusal the browser applies;
 * - the request did not carry Global Privacy Control (`Sec-GPC: 1`), which
 *   outranks any record.
 */
export function advertisingConsentGranted(
  host: VisitorConsentHost | null | undefined,
  wire: AdvertisingConsentWire | null | undefined,
  request: { gpc: boolean },
): boolean {
  if (!wire || request.gpc) return false
  if (!hostConsentRequired(host)) return false
  return advertisingGrantedByRecord(host, {
    v: 1,
    at: wire.at,
    status: wire.status,
    analytics: false,
    advertising: wire.advertising === true,
    country: wire.country,
  })
}

/** Whether a request's headers carry Global Privacy Control. */
export function requestSendsGlobalPrivacyControl(
  get: (name: string) => string | null | undefined,
): boolean {
  return String(get('sec-gpc') ?? '').trim() === '1'
}
