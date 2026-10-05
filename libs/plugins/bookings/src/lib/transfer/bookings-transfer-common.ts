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

import type { MatchKeySpec } from '@aglyn/aglyn/data-transfer'

/**
 * WHAT BOTH HALVES OF THE `bookings` TRANSFER RESOURCE SHARE, in a module
 * with no server dependency: the key, the match keys the declarations
 * register synchronously, and the list's filters.
 *
 * The Bookings page and the export's `readPage` must name a filter the same
 * way: the page builds the value it hands the export dialog, and the server
 * half parses it back into one Firestore query.
 *
 * One filter at a time, each a query an index serves:
 *
 * - `{ upcoming: true, asOfMs? }` — the page's default list: every booking
 *   that has not ended by `asOfMs` (the moment the page drew the list; now
 *   when absent), canceled ones included, as the list shows them.
 * - `{ email }` — one booker's bookings, past and upcoming, the list a
 *   contact's record links to.
 * - `{ serviceId }` — one service's bookings.
 *
 * Anything else is refused rather than read as "everything": a file that
 * says it holds a filtered list and holds the whole site would be worse than
 * no file.
 */

/** The resource key `plugins.config.json` declares under `transferResources`. */
export const BOOKINGS_TRANSFER_RESOURCE = 'bookings'

/** The one key a row is named by: its Aglyn ID. Nothing is ever matched to import. */
export const BOOKINGS_TRANSFER_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'id', normalizer: 'aglynId' },
]

/** One of the bookings list's filters, in the export's terms. */
export type BookingsTransferFilter =
  | { kind: 'upcoming'; asOfMs: number | null }
  | { kind: 'email'; email: string }
  | { kind: 'service'; serviceId: string }

/** Why a filter could not be read, in a sentence the person reads. */
export class BookingsTransferFilterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BookingsTransferFilterError'
  }
}

/** The value the page hands the export dialog for its default list. */
export function upcomingBookingsFilterValue(
  asOfMs: number,
): Record<string, unknown> {
  return { upcoming: true, asOfMs }
}

/** The value the page hands the export dialog when narrowed to one booker. */
export function bookerBookingsFilterValue(
  email: string,
): Record<string, unknown> {
  return { email }
}

/**
 * The filter `value` names, or `null` for none (an empty object). Throws
 * {@link BookingsTransferFilterError} for anything else: an unknown key, two
 * filters at once, or a value of the wrong shape.
 */
export function parseBookingsTransferFilter(
  value: Readonly<Record<string, unknown>> | null | undefined,
): BookingsTransferFilter | null {
  if (!value) return null
  const keys = Object.keys(value).filter((key) => value[key] !== undefined)
  if (!keys.length) return null
  const unknown = keys.filter(
    (key) => !['upcoming', 'asOfMs', 'email', 'serviceId'].includes(key),
  )
  if (unknown.length) {
    throw new BookingsTransferFilterError(
      `Bookings can be filtered by upcoming, email or service, not by ${unknown.join(', ')}.`,
    )
  }
  const named = ['upcoming', 'email', 'serviceId'].filter((key) =>
    keys.includes(key),
  )
  if (named.length > 1) {
    throw new BookingsTransferFilterError(
      'Bookings are exported with one filter at a time.',
    )
  }
  if (keys.includes('asOfMs') && !keys.includes('upcoming')) {
    throw new BookingsTransferFilterError(
      'A start time only narrows the upcoming bookings.',
    )
  }
  if (keys.includes('upcoming')) {
    if (value['upcoming'] !== true) {
      throw new BookingsTransferFilterError(
        'The upcoming filter is on or absent.',
      )
    }
    const asOf = value['asOfMs']
    if (asOf === undefined || asOf === null)
      return { kind: 'upcoming', asOfMs: null }
    if (typeof asOf !== 'number' || !Number.isFinite(asOf)) {
      throw new BookingsTransferFilterError(
        'The upcoming filter’s start time is not a time.',
      )
    }
    return { kind: 'upcoming', asOfMs: Math.floor(asOf) }
  }
  if (keys.includes('email')) {
    // Stored lowercased and trimmed by the booking route, so that is the
    // form an equality has to ask in.
    const email = String(value['email'] ?? '')
      .trim()
      .toLowerCase()
    if (!email || !email.includes('@')) {
      throw new BookingsTransferFilterError(
        'The email filter needs an email address.',
      )
    }
    return { kind: 'email', email }
  }
  const serviceId = String(value['serviceId'] ?? '').trim()
  if (!serviceId || serviceId.includes('/')) {
    throw new BookingsTransferFilterError('The service filter needs a service.')
  }
  return { kind: 'service', serviceId }
}
