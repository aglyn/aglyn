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

import { registerConsoleExtension } from '@aglyn/aglyn'
import { lazy } from 'react'
import {
  FULFILLMENT_NETWORKS_ENTITLEMENT,
  FULFILLMENT_NETWORKS_ORDER_WIDGET_ID,
  FULFILLMENT_NETWORKS_PLUGIN_ID,
  FULFILLMENT_NETWORKS_SETTINGS_WIDGET_ID,
} from './constants'

/** Code-split: each loads only when the store's settings or an order is opened. */
const FulfillmentNetworksCard = lazy(() => import('./components/fulfillment-networks-card.component'))
const OrderNetworksWidget = lazy(() => import('./components/order-networks-widget.component'))

/**
 * The console surface (AGL-3634): no page of its own. It fills two zones the
 * commerce plugin hosts — the store's settings, with a card per network, and
 * the order dialog, with where the order stands at each — and both draw
 * nothing until the deployment offers a network (an app's credentials and
 * `FULFILLMENT_NETWORKS_TOKEN_KEY` on the console). Gated on the plans that sell.
 */
export function registerFulfillmentNetworksConsole(): void {
  registerConsoleExtension({
    pluginId: FULFILLMENT_NETWORKS_PLUGIN_ID,
    displayName: 'Fulfillment networks',
    featureFlag: FULFILLMENT_NETWORKS_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: FULFILLMENT_NETWORKS_SETTINGS_WIDGET_ID,
        title: 'Fulfillment networks',
        Component: FulfillmentNetworksCard,
      },
      {
        slot: 'orderDetail',
        widgetId: FULFILLMENT_NETWORKS_ORDER_WIDGET_ID,
        title: 'Fulfillment networks',
        Component: OrderNetworksWidget,
      },
    ],
  })
}
