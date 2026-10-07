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
  MARKETPLACES_ENTITLEMENT,
  MARKETPLACES_ORDER_WIDGET_ID,
  MARKETPLACES_PLUGIN_ID,
  MARKETPLACES_SETTINGS_WIDGET_ID,
} from './constants'

/** Code-split: each loads only when the store's settings or an order is opened. */
const MarketplacesCard = lazy(() => import('./components/marketplaces-card.component'))
const OrderMarketplaceWidget = lazy(() => import('./components/order-marketplace-widget.component'))

/**
 * The console surface (AGL-3638): no page of its own. It fills two zones the
 * commerce plugin hosts — the store's settings, with a card per marketplace,
 * and the order dialog, with where a marketplace order stands — and both draw
 * nothing until the deployment offers a marketplace (an app's credentials
 * and `MARKETPLACES_TOKEN_KEY` on the console). Gated on the plans that sell.
 */
export function registerMarketplacesConsole(): void {
  registerConsoleExtension({
    pluginId: MARKETPLACES_PLUGIN_ID,
    displayName: 'Marketplaces',
    featureFlag: MARKETPLACES_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: MARKETPLACES_SETTINGS_WIDGET_ID,
        title: 'Marketplaces',
        Component: MarketplacesCard,
      },
      {
        slot: 'orderDetail',
        widgetId: MARKETPLACES_ORDER_WIDGET_ID,
        title: 'Marketplace',
        Component: OrderMarketplaceWidget,
      },
    ],
  })
}
