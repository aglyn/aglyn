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
import type { ConsoleOrderZoneAddress } from './order-zones'

/**
 * The zone the return dialog hosts (AGL-3611): `returnDetail`, among the
 * return's details, where a shipping plugin buys the buyer a return label.
 *
 * Declared here, by the plugin that hosts it, as the order zones are. A
 * widget restates the props it reads rather than importing this package, and
 * it never writes the return itself: the label it bought is attached through
 * `attachReturnLabel`, which posts this plugin's own route (`attach-label`),
 * with its role gate and its https check.
 */

/** One line coming back. `lineItemId` is the order line's index. */
export interface ConsoleReturnZoneLine {
  lineItemId: number
  name: string
  variantLabel: string | null
  quantity: number
  /** A `ReturnReason` key, e.g. `damaged`. */
  reason: string
}

/** The label already on the return, when one was attached. */
export interface ConsoleReturnZoneLabel {
  carrier: string
  trackingNumber: string
  labelUrl: string
  trackingUrl: string | null
  attachedAtMs: number
}

/** The return a widget is handed. */
export interface ConsoleReturnZoneReturn {
  id: string
  /** A `ReturnStatus`: `requested`, `approved`, `received`, … */
  status: string
  orderId: string
  /** The order's human number, e.g. `#1042`. */
  orderNumber: string
  customerName: string | null
  customerEmail: string | null
  lines: readonly ConsoleReturnZoneLine[]
  /**
   * Where the parcel comes FROM: the order's ship-to address, as the buyer
   * gave it. `null` for an order that never shipped anywhere.
   */
  fromAddress: ConsoleOrderZoneAddress | null
  returnLabel: ConsoleReturnZoneLabel | null
}

/** A return label a widget asks the dialog to attach. */
export interface ConsoleReturnLabelRequest {
  carrier: string
  trackingNumber: string
  /** The printable label, an https URL. */
  labelUrl: string
  /** An explicit https tracking link; derived from the carrier when absent. */
  trackingUrl?: string
}

/**
 * What the `returnDetail` zone hands each widget. `attachReturnLabel`
 * resolves once the route stored the label, and throws with a message a
 * person can act on when it refuses: a finished return, a link that is not
 * https.
 */
export interface ConsoleReturnDetailZoneProps {
  hostId: string
  /** The org the page names; `undefined` where the host does not know it. */
  orgId: string | undefined
  return: ConsoleReturnZoneReturn
  attachReturnLabel: (label: ConsoleReturnLabelRequest) => Promise<void>
}

export const RETURN_DETAIL_ZONE =
  definePluginZone<ConsoleReturnDetailZoneProps>('returnDetail')

/** Declares the return zone, from the console registrar. */
export function registerCommerceReturnZones(): void {
  registerPluginZone(
    {
      zone: RETURN_DETAIL_ZONE,
      label: 'Return detail',
      surface: 'console',
      layout: 'bare',
      description:
        'In the return dialog, above its actions. A widget here reads the return — its lines, the buyer and the address the parcel comes from — and attaches a return label through `attachReturnLabel`, the dialog’s own route.',
    },
    { pluginId: BUNDLE_ID },
  )
}
