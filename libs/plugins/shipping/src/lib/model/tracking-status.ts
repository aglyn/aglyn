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
