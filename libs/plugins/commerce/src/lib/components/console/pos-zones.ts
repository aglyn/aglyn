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
 * The register's zone (AGL-3644): `posOrders`, above the till's product grid,
 * where orders another channel sends to the counter — a delivery app's, say
 * — wait to be accepted, made and handed over.
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

/** Declares it, from the console registrar. */
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
}
