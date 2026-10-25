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
  definePluginZone,
  registerPluginZone,
} from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { BUNDLE_ID } from '../../constants/bundle-common'

/**
 * The register's zones. `posOrders` (AGL-3644), above the till's product grid,
 * where orders another channel sends to the counter — a delivery app's, say
 * — wait to be accepted, made and handed over. `posCheckIn` (AGL-4043), on
 * the register's check-in, where another plugin shows what a customer at the
 * window needs for the day.
 *
 * Declared here because zones are declared by the plugin that hosts them. A
 * widget from another plugin restates these props rather than importing
 * this package, and it writes no order of this plugin's itself: what it
 * records goes through core's channel-orders seam, under this plugin's rules.
 * The register's own gate — `managePos` and the `pos` entitlement — stands
 * in front of the page, and a widget's routes ask it again.
 */

/** What `posOrders` hands a widget. */
export interface ConsolePosOrdersZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  /** The register the till is open on, or `null` before one is chosen. */
  registerId: string | null
}

export const POS_ORDERS_ZONE = definePluginZone<ConsolePosOrdersZoneProps>('posOrders')

/**
 * Where the register's check-in zone is drawn (AGL-4043): a customer row in
 * the check-in search, the customer the check-in screen has open, or the
 * customer attached to a sale on the register.
 */
export type PosCheckInZonePlacement = 'check-in-row' | 'check-in-customer' | 'register-customer'

/**
 * What `posCheckIn` hands a widget (AGL-4043): one customer at the window on
 * one day, and nothing about why anybody is checking them. A widget reads
 * its own records for the customer (by contact id, else by email) and shows
 * what it knows — a status, a button that starts its own flow.
 */
export interface ConsolePosCheckInZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  /** The customer's contact in the workspace's people records, or `null` when none is known. */
  contactId: string | null
  /** The customer's email address, lower case, or `null` when none is known. */
  email: string | null
  /** The day being checked in, `YYYY-MM-DD` in the site's time zone. */
  dayKey: string
  /** The customer's name as the order or the stay gave it, or `null`. */
  name: string | null
  /**
   * How many check-ins the customer has due on `dayKey` (each person a pass
   * or a stay covers), or `null` where the host does not know.
   */
  unitsDue: number | null
  placement: PosCheckInZonePlacement
}

export const POS_CHECK_IN_ZONE = definePluginZone<ConsolePosCheckInZoneProps>('posCheckIn')

/** Declares them, from the console registrar. */
export function registerCommercePosZones(): void {
  registerPluginZone(
    {
      zone: POS_ORDERS_ZONE,
      label: 'Register orders',
      surface: 'console',
      layout: 'bare',
      description:
        'Above the POS register’s product grid. A widget here shows orders another channel sends to the counter, for staff to accept, make and hand over; it records them through its own routes and core’s channel-orders seam, never by writing an order.',
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginZone(
    {
      zone: POS_CHECK_IN_ZONE,
      label: 'Register check-in',
      surface: 'console',
      layout: 'bare',
      description:
        'On each customer row of the register’s check-in, on the customer the check-in screen has open, and on the customer attached to a sale. A widget here shows a status the customer needs for the day from its own records, and may offer a button that starts its own flow; it never checks anybody in and writes no check-in.',
    },
    { pluginId: BUNDLE_ID },
  )
}
