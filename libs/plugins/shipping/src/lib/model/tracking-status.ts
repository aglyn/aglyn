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

import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'

/**
 * Each provider's tracking vocabulary, read into the carrier-neutral words
 * the seller records (AGL-3612). `null` is "nothing to say yet": an
 * `UNKNOWN` or a status the provider added after this was written is never
 * guessed at, because a guessed `delivered` would email a customer that a
 * parcel arrived which has not.
 */

/** Shippo's `tracking_status.status`, with its substatus code. */
export function shippoTrackingStatus(
  status: unknown,
  substatusCode?: unknown,
): PluginTrackingStatus | null {
  switch (String(status ?? '').toUpperCase()) {
    case 'PRE_TRANSIT':
      return 'pre_transit'
    case 'TRANSIT':
      return String(substatusCode ?? '') === 'out_for_delivery'
        ? 'out_for_delivery'
        : 'in_transit'
    case 'DELIVERED':
      return 'delivered'
    case 'RETURNED':
      return 'returned'
    case 'FAILURE':
      return 'exception'
    default:
      return null
  }
}

/** EasyPost's tracker `status`. */
export function easypostTrackingStatus(status: unknown): PluginTrackingStatus | null {
  switch (String(status ?? '').toLowerCase()) {
    case 'pre_transit':
      return 'pre_transit'
    case 'in_transit':
    case 'available_for_pickup':
      return 'in_transit'
    case 'out_for_delivery':
      return 'out_for_delivery'
    case 'delivered':
      return 'delivered'
    case 'return_to_sender':
      return 'returned'
    case 'failure':
    case 'error':
    case 'cancelled':
      return 'exception'
    default:
      return null
  }
}

/**
 * Easyship's tracking `status` (AGL-3632), a sentence such as "In Transit to
 * Customer" from a list of thirty-odd: read by its words, most specific
 * first, and anything not recognised is nothing to say yet.
 */
export function easyshipTrackingStatus(status: unknown): PluginTrackingStatus | null {
  const text = String(status ?? '').trim().toLowerCase()
  if (!text) return null
  if (text.includes('out for delivery')) return 'out_for_delivery'
  if (text.includes('return')) return 'returned'
  if (/\b(lost|exception|failed|failure|damaged|undeliverable|not delivered|refused)\b/.test(text)) return 'exception'
  if (/^delivered\b/.test(text) || text === 'delivered') return 'delivered'
  if (/\b(transit|shipped|picked up|in transit|handed over|at local|arrived)\b/.test(text)) return 'in_transit'
  if (/\b(pending|created|info received|label|awaiting|ready)\b/.test(text)) return 'pre_transit'
  return null
}

/**
 * Sendcloud's parcel status id (AGL-3632), as its webhook's
 * `parcel.status.id` carries it. Ids outside this table — announcement
 * errors, cancellations — say nothing about where the parcel is.
 */
export function sendcloudTrackingStatus(statusId: unknown): PluginTrackingStatus | null {
  const id = Number(statusId)
  if (!Number.isInteger(id)) return null
  if (id === 11 || id === 93) return 'delivered'
  if (id === 92) return 'out_for_delivery'
  if (id === 8 || id === 15 || id === 80) return 'exception'
  if ([3, 4, 5, 6, 7, 12, 22, 62, 91].includes(id)) return 'in_transit'
  if (id === 1 || id === 13 || id === 1000) return 'pre_transit'
  return null
}

/** How far along each status is, so an out-of-order webhook cannot walk a parcel back. */
export const TRACKING_PROGRESS: Readonly<Record<PluginTrackingStatus, number>> = {
  pre_transit: 0,
  in_transit: 1,
  out_for_delivery: 2,
  exception: 2,
  delivered: 3,
  returned: 3,
}

/** What a merchant reads for each status. */
export const TRACKING_STATUS_LABELS: Readonly<Record<PluginTrackingStatus, string>> = {
  pre_transit: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Delivery problem',
  returned: 'Returned to sender',
}
