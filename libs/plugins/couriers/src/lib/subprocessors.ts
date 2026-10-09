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

import type {
  PluginEgressUseDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

/**
 * DoorDash Drive (AGL-3695): the merchant's OWN developer account, connected
 * with keys the merchant pastes in, so it is a destination the customer chose
 * rather than a recipient of Aglyn's. Nothing reaches it until a site
 * connects one and a member sends a courier for an order, and then only that
 * order's drop.
 *
 * The host is DoorDash's one API host, which the delivery-apps plugin
 * declares; this is a USE of it, with this plugin's reason and data.
 */

export const COURIERS_USES: PluginEgressUseDeclaration[] = [
  {
    host: 'openapi.doordash.com',
    reason:
      "Also customer-chosen: DoorDash Drive's API, reached only from `libs/plugins/couriers/src/lib/providers/doordash.ts` with the merchant's own developer keys (live, or test for DoorDash's sandbox) when a member of the site asks for a courier's quote, books one, cancels one or checks one, and from the console job that follows open deliveries. DoorDash bills the delivery to the merchant's own account.",
    dataReceived:
      "For each order a courier is sent for: the order's number and value, the store's name, pickup address, phone and pickup note, and the buyer's name, delivery address and phone number. Read back: the delivery's status, fee, pickup and drop-off estimates, tracking link and any cancellation reason. Each request carries a short-lived token signed with the merchant's signing secret; the secret itself is never sent. No payment details are sent.",
  },
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destination. */
export function couriersSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], uses: COURIERS_USES }
}
