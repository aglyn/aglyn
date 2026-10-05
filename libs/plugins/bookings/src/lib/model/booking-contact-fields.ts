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
 * WHAT A SERVICE ASKS THE BOOKER FOR, BEYOND A NAME AND AN EMAIL (AGL-3493).
 *
 * An on-site service — an estimate at the job, a visit to the house — is
 * no use to the business without a number to call and the place to go. So
 * a service may ask for a phone and for an address, each off, optional or
 * required, and every half reads the answer through this one module: the
 * widget to render and check the fields, the booking route to check them
 * again (a public door never trusts the page that called it), and the
 * console, the notification and the CRM to show what was given.
 *
 * Client-safe: no I/O, and the only import is core's phone normalizer.
 */

import { normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'

/** How a service asks for one field. Absent, or anything else, is `off`. */
export type BookingFieldAsk = 'off' | 'optional' | 'required'

export const BOOKING_FIELD_ASKS: readonly BookingFieldAsk[] = [
  'off',
  'optional',
  'required',
]

/** The setting as stored, read so that only the two real answers ask. */
export function bookingFieldAsk(value: unknown): BookingFieldAsk {
  return value === 'optional' || value === 'required' ? value : 'off'
}

/** The longest phone the booking keeps, as typed. */
export const BOOKING_PHONE_MAX = 40
/** The longest address the booking keeps. */
export const BOOKING_ADDRESS_MAX = 300

/** What a service asks for, as the widget and the route both read it. */
export interface BookingContactAsks {
  phone: BookingFieldAsk
  address: BookingFieldAsk
}

/** The two settings off a stored service (or its public listing). */
export function bookingContactAsks(
  service: { askPhone?: unknown; askAddress?: unknown } | null | undefined,
): BookingContactAsks {
  return {
    phone: bookingFieldAsk(service?.askPhone),
    address: bookingFieldAsk(service?.askAddress),
  }
}

/** What the booker gave, as the booking stores it. */
export interface BookingContactFields {
  phone?: string
  address?: string
}

/**
 * A phone as typed, or `null` when it cannot be one.
 *
 * E.164 when core's normalizer is confident — a US or Canadian number, or
 * one written with its `+` — and the number as typed otherwise, so a visitor
 * abroad who writes theirs the local way is not refused a booking over a
 * format. Seven to fifteen digits is the whole test: the shortest real
 * subscriber number to the longest E.164 allows.
 */
export function readBookingPhone(raw: unknown): string | null {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.length > BOOKING_PHONE_MAX) return null
  if (/[^\d\s()+\-./]/.test(text.replace(/\b(?:ext|x)\.?\s*\d+$/i, ''))) {
    return null
  }
  const digits = text.replace(/\D/g, '').length
  if (digits < 7 || digits > 20) return null
  return normalizePhone(text) ?? text
}

/**
 * An address as typed: trimmed, each line's runs of space collapsed, empty
 * lines dropped, and cut to {@link BOOKING_ADDRESS_MAX}. `null` when nothing
 * is left.
 *
 * Free text, deliberately not the postal shape a contact's address is
 * (`AglynPostalAddress`). A booking's address is where the job is, which is
 * often not where the person lives, and a visitor booking an estimate types
 * "12 Oak St, Austin" into one box; five boxes would cost bookings for a
 * structure nothing here computes with.
 */
export function readBookingAddress(raw: unknown): string | null {
  const text = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, BOOKING_ADDRESS_MAX)
    .trim()
  return text || null
}

/**
 * The phone and address a booking request carried, held to what the
 * service asks for: a field the service does not ask for is dropped
 * whatever was sent, an optional one is kept when it reads, and a required
 * one that is missing or unreadable refuses the request with the sentence
 * the visitor sees.
 */
export function readBookingContactFields(
  asks: BookingContactAsks,
  input: { phone?: unknown; address?: unknown },
): { ok: true; fields: BookingContactFields } | { ok: false; error: string } {
  const fields: BookingContactFields = {}
  if (asks.phone !== 'off') {
    const given = String(input.phone ?? '').trim()
    const phone = readBookingPhone(given)
    if (phone) fields.phone = phone
    else if (given) return { ok: false, error: 'Enter a valid phone number' }
    else if (asks.phone === 'required') {
      return { ok: false, error: 'Enter your phone number' }
    }
  }
  if (asks.address !== 'off') {
    const address = readBookingAddress(input.address)
    if (address) fields.address = address
    else if (asks.address === 'required') {
      return { ok: false, error: 'Enter the address' }
    }
  }
  return { ok: true, fields }
}

/**
 * The given fields as lines a person reads — `Phone: …`, `Address: …` —
 * for the managers' notification, the CRM meeting and the console row.
 * Read off a stored booking, so only what is there and a string is shown.
 */
export function bookingContactLines(booking: {
  phone?: unknown
  address?: unknown
}): string[] {
  const lines: string[] = []
  const phone = typeof booking.phone === 'string' ? booking.phone.trim() : ''
  const address =
    typeof booking.address === 'string'
      ? booking.address.replace(/\s*\n\s*/g, ', ').trim()
      : ''
  if (phone) lines.push(`Phone: ${phone}`)
  if (address) lines.push(`Address: ${address}`)
  return lines
}
