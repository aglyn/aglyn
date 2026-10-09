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
  COURIERS_ENTITLEMENT,
  COURIERS_ORDER_WIDGET_ID,
  COURIERS_PLUGIN_ID,
  COURIERS_ROW_WIDGET_ID,
  COURIERS_SETTINGS_WIDGET_ID,
} from './constants'

/** Code-split: each loads only when the store's settings, an order or the delivery queue is opened. */
const CouriersCard = lazy(() => import('./components/couriers-card.component'))
const OrderCourierWidget = lazy(() => import('./components/order-courier-widget.component'))
const QueueCourierButton = lazy(() => import('./components/queue-courier-button.component'))

/**
 * The console surface (AGL-3695): no page of its own. It fills three zones
 * the commerce plugin hosts — the store's settings, with the Couriers card;
 * the order dialog, with the order's courier; and a local delivery's row of
 * the Pickup & delivery queue, with "Send a courier" — and each draws nothing
 * until the deployment holds `COURIERS_TOKEN_KEY` and the site sells.
 */
export function registerCouriersConsole(): void {
  registerConsoleExtension({
    pluginId: COURIERS_PLUGIN_ID,
    displayName: 'Couriers',
    featureFlag: COURIERS_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: COURIERS_SETTINGS_WIDGET_ID,
        title: 'Couriers',
        Component: CouriersCard,
      },
      {
        slot: 'orderDetail',
        widgetId: COURIERS_ORDER_WIDGET_ID,
        title: 'Courier',
        Component: OrderCourierWidget,
      },
      {
        slot: 'localDeliveryRow',
        widgetId: COURIERS_ROW_WIDGET_ID,
        title: 'Send a courier',
        Component: QueueCourierButton,
      },
    ],
  })
}
