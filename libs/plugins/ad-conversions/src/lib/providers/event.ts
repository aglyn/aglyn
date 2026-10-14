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

import { createHash } from 'crypto'

/**
 * One conversion as this plugin keeps and sends it (AGL-3694), in no vendor's
 * shape: each adapter maps it to its own.
 *
 * Personal data is HASHED AT INTAKE, before anything is stored: the queue
 * holds SHA-256 digests of normalized values, never an address or a name.
 * The browser's own ids (`_fbp`, `_ttp`, `_epik`…), the request's address and
 * its user agent are kept as they are, because each vendor requires them
 * unhashed — and they are kept only on an event whose visitor granted
 * advertising, deleted once sent or when it expires.
 */

export type ConversionName = 'purchase' | 'lead'

export interface ConversionItem {
  id: string
  name: string | null
  quantity: number
  unitCents: number
}

/** Each field a SHA-256 hex digest of the normalized value; absent when unknown. */
export interface HashedUserData {
  em?: string
  /** Digits only, with the country code: Meta and Pinterest. */
  ph?: string
  /** E.164 with the `+`: TikTok. */
  phE164?: string
  fn?: string
  ln?: string
  ct?: string
  st?: string
  zp?: string
  country?: string
}

/** What the visitor's browser and request said, unhashed, as the vendors require. */
export interface ConversionBrowser {
  ip: string | null
  userAgent: string | null
  fbp?: string
  fbc?: string
  ttp?: string
  ttclid?: string
  epik?: string
}

export interface ConversionEvent {
  /** The event id the browser tag sent the same conversion under: the de-duplication key. */
  id: string
  name: ConversionName
  occurredAtMs: number
  /** The page it happened on, origin and path only. */
  url: string | null
  currency: string | null
  valueCents: number | null
  orderId: string | null
  items: ConversionItem[]
  user: HashedUserData
  browser: ConversionBrowser
}

/** SHA-256, lower-case hex: the digest all three vendors take. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

const hashed = (value: string | null): string | undefined => (value ? sha256Hex(value) : undefined)

/** An address, trimmed and lower-cased; `null` when it is not one. */
export function normalizeEmail(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}

/**
 * A phone number as digits with its country code, or `null`. A number written
 * with `+` or `00` already says its country; a bare ten-digit number is read
 * as North American (`1`) only where the country is the US or Canada or not
 * known, which is the only case this can be sure enough of to send.
 */
export function normalizePhoneDigits(raw: unknown, country?: string | null): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  let digits = text.replace(/[^0-9]/g, '')
  if (text.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? digits : null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.length === 10 && (!country || /^(us|ca)$/i.test(country))) digits = `1${digits}`
  return digits.length >= 11 && digits.length <= 15 ? digits : null
}

/** Lower-cased, trimmed, punctuation and spacing removed: names and cities. */
export function normalizeWord(raw: unknown): string | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s!-/:-@[-`{-~]+/g, '')
  return value || null
}

/** A postal code: lower-cased, no spaces or dashes; a US code to its five digits. */
export function normalizePostal(raw: unknown, country?: string | null): string | null {
  const value = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '')
  if (!value) return null
  if (/^us$/i.test(String(country ?? '')) && /^[0-9]{5}/.test(value)) return value.slice(0, 5)
  return value
}

/** A two-letter code, lower-cased; `null` otherwise. */
export function normalizeCode(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  return /^[a-z]{2}$/.test(value) ? value : null
}

export interface PersonInput {
  email?: unknown
  phone?: unknown
  name?: unknown
  firstName?: unknown
  lastName?: unknown
  city?: unknown
  state?: unknown
  postalCode?: unknown
  country?: unknown
}

/** A person's details, normalized per the vendors' matching rules and hashed. */
export function hashUserData(person: PersonInput): HashedUserData {
  const country = normalizeCode(person.country)
  let first = normalizeWord(person.firstName)
  let last = normalizeWord(person.lastName)
  if (!first && !last && typeof person.name === 'string') {
    const parts = person.name.trim().split(/\s+/).filter(Boolean)
    if (parts.length) {
      first = normalizeWord(parts[0])
      last = parts.length > 1 ? normalizeWord(parts[parts.length - 1]) : null
    }
  }
  const phone = normalizePhoneDigits(person.phone, country)
  const out: HashedUserData = {
    em: hashed(normalizeEmail(person.email)),
    ph: hashed(phone),
    phE164: hashed(phone ? `+${phone}` : null),
    fn: hashed(first),
    ln: hashed(last),
    ct: hashed(normalizeWord(person.city)),
    st: hashed(normalizeCode(person.state) ?? normalizeWord(person.state)),
    zp: hashed(normalizePostal(person.postalCode, country)),
    country: hashed(country),
  }
  for (const key of Object.keys(out) as Array<keyof HashedUserData>) {
    if (out[key] === undefined) delete out[key]
  }
  return out
}
