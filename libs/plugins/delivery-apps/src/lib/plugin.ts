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
  DELIVERY_APPS_ENTITLEMENT,
  DELIVERY_APPS_PLUGIN_ID,
  DELIVERY_APPS_QUEUE_WIDGET_ID,
  DELIVERY_APPS_SETTINGS_WIDGET_ID,
} from './constants'

/** Code-split: each loads only when the store's settings or the register is opened. */
const DeliveryAppsCard = lazy(() => import('./components/delivery-apps-card.component'))
const DeliveryQueue = lazy(() => import('./components/delivery-queue.component'))

/**
 * The console surface (AGL-3644): no page of its own. It fills two zones the
 * commerce plugin hosts — the store's settings, with a card per delivery
 * service, and the POS register, with the delivery orders to accept, make
 * and hand over — and both draw nothing until the deployment offers a
 * service (its partner credentials on the console) and, for the register,
 * the site has a store connected. Gated on the plans with the register.
 */
export function registerDeliveryAppsConsole(): void {
  registerConsoleExtension({
    pluginId: DELIVERY_APPS_PLUGIN_ID,
    displayName: 'Delivery apps',
    featureFlag: DELIVERY_APPS_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: DELIVERY_APPS_SETTINGS_WIDGET_ID,
        title: 'Delivery apps',
        Component: DeliveryAppsCard,
      },
      {
        slot: 'posOrders',
        widgetId: DELIVERY_APPS_QUEUE_WIDGET_ID,
        title: 'Delivery orders',
        Component: DeliveryQueue,
      },
    ],
  })
}
