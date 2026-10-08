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
  INVENTORY_SYNC_ENTITLEMENT,
  INVENTORY_SYNC_ORDER_WIDGET_ID,
  INVENTORY_SYNC_PLUGIN_ID,
  INVENTORY_SYNC_SETTINGS_WIDGET_ID,
} from './constants'

/** Code-split: each loads only when the store's settings or an order is opened. */
const InventorySyncCard = lazy(() => import('./components/inventory-sync-card.component'))
const OrderInventoryWidget = lazy(() => import('./components/order-inventory-widget.component'))

/**
 * The console surface (AGL-3642): no page of its own. It fills two zones the
 * commerce plugin hosts — the store's settings, with the connection's card,
 * and the order dialog, with where the order stands in the connected system
 * — and both draw nothing until the deployment offers a system
 * (`INVENTORY_SYNC_TOKEN_KEY` on the console). Gated on the plans that sell.
 */
export function registerInventorySyncConsole(): void {
  registerConsoleExtension({
    pluginId: INVENTORY_SYNC_PLUGIN_ID,
    displayName: 'Inventory sync',
    featureFlag: INVENTORY_SYNC_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: INVENTORY_SYNC_SETTINGS_WIDGET_ID,
        title: 'Inventory and ERP',
        Component: InventorySyncCard,
      },
      {
        slot: 'orderDetail',
        widgetId: INVENTORY_SYNC_ORDER_WIDGET_ID,
        title: 'Inventory system',
        Component: OrderInventoryWidget,
      },
    ],
  })
}
