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

import type { OrderChannel } from './commerce-orders'

/*==========================================
 * THE CHECK-IN RECORD (AGL-4043): what `/api/commerce/pos-check-in` stores
 * and answers, in a module with no runtime imports so the native register
 * reads the same shapes (`tools/scripts/native-contracts.json`). The rules
 * over them live in `commerce-check-in.ts`, which re-exports all of this.
 *=========================================*/

export const POS_CHECK_IN_ROUTE = '/api/commerce/pos-check-in'

/** The most check-ins one tap records. */
export const CHECK_IN_BATCH_MAX = 50

/** A wristband's number or color, at most this many characters. */
export const CHECK_IN_WRISTBAND_MAX = 24

/** Colors offered as quick picks for a wristband. Any word is accepted. */
export const CHECK_IN_WRISTBAND_COLORS: readonly string[] = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple',
  'Pink',
  'White',
  'Black',
]

export type CheckInStatus = 'expected' | 'checked_in'

export interface CheckInWristband {
  number: string | null
  color: string | null
}

/**
 * A rain check on one person's pass: who gave it, when, and the day it was
 * due before. `open` waits to be claimed on any later day; `date` moved it
 * to `toDayKey`.
 */
export interface CheckInRainCheck {
  kind: 'open' | 'date'
  /** The day the pass was due on before this rain check. */
  fromDayKey: string
  /** The day it was moved to; null while open. */
  toDayKey: string | null
  /** The day an open rain check was used, once it is checked in. */
  claimedDayKey: string | null
  byUid: string
  byName: string | null
  atMs: number
}

/** `hosts/{hostId}/checkIns/{id}`: one person due on one day. Server-written only. */
export interface HostCheckIn {
  source: 'order' | 'reservation'
  orderId: string | null
  /** The order's number as the console shows it (`#1042`), or null for a stay. */
  orderLabel: string | null
  /** Where the order was sold, or `reservation`. */
  channel: OrderChannel | 'reservation'
  reservationId: string | null
  lineIndex: number | null
  /** This person's place among the line's or stay's check-ins, from 0. */
  unitIndex: number
  /** How many check-ins the line or stay makes that day. */
  unitCount: number
  productId: string | null
  variantId: string | null
  itemName: string
  variantLabel: string | null
  /** The day, `YYYY-MM-DD` in the site's time zone. */
  dayKey: string
  /** Who the check-in is for, as one key: the address, else the contact, else the name, else the order. */
  customerKey: string
  customerName: string | null
  customerEmail: string | null
  customerEmailLower: string | null
  customerPhone: string | null
  /** The contact the register attached to the sale, when it was one. */
  contactId: string | null
  /** The name's, the address's, the phone's and the order number's search prefixes. */
  searchTokens: string[]
  status: CheckInStatus
  checkedInAtMs: number | null
  checkedInBy: string | null
  checkedInByName: string | null
  wristband: CheckInWristband | null
  /** The attempt that checked this person in, so a retried tap is not "already checked in". */
  checkInAttempt: string | null
  /** The last undo, kept so a reversed check-in still says who reversed it. */
  undoneAtMs: number | null
  undoneBy: string | null
  /**
   * A rain check on this pass, or null. Absent on a check-in written before
   * rain checks existed, which reads as null.
   */
  rainCheck?: CheckInRainCheck | null
  /**
   * True while an open rain check waits to be used: what a later day's
   * search and customer lookup ask (`rainCheckOpen == true`, `dayKey <` the
   * day). Absent reads as false.
   */
  rainCheckOpen?: boolean
  /** The last rain check taken back: when and by whom. */
  rainCheckUndoneAtMs?: number | null
  rainCheckUndoneBy?: string | null
  createdAtMs: number
  updatedAtMs: number
}

/** One check-in as the routes answer it. */
export type CheckInRow = HostCheckIn & { id: string }

/** A customer with something due on a day, as the search lists them. */
export interface CheckInCustomer {
  customerKey: string
  name: string | null
  email: string | null
  phone: string | null
  contactId: string | null
  /** Every check-in the customer has on the day. */
  unitsDue: number
  unitsCheckedIn: number
  /** What the check-ins are for, item names once each. */
  items: string[]
}

export interface CheckInDayTotals {
  /** Everyone due on the day, less the open rain checks waiting on it. */
  expected: number
  checkedIn: number
  /** Passes on the day with an open rain check: not expected until used. */
  rainChecks: number
}
