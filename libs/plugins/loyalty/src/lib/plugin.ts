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

import * as Aglyn from '@aglyn/aglyn'
import { lazy } from 'react'
import { LOYALTY_ENTITLEMENT, LOYALTY_PLUGIN_ID } from './constants/bundle-common'

const LoyaltyPromotionsWidget = lazy(() => import('./components/loyalty-promotions-widget.component'))
const LoyaltyOrderWidget = lazy(() => import('./components/loyalty-order-widget.component'))

/**
 * Rewards' console half (AGL-3640): no page of its own. It fills two zones
 * the commerce plugin hosts — the store's Promotions, beside discounts and
 * gift cards, and the order dialog. Gated on the plans that sell.
 */
export function registerLoyaltyConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: LOYALTY_PLUGIN_ID,
    displayName: 'Rewards',
    featureFlag: LOYALTY_ENTITLEMENT,
    widgets: [
      {
        slot: 'commercePromotions',
        widgetId: 'loyalty-program',
        title: 'Rewards',
        Component: LoyaltyPromotionsWidget,
      },
      {
        slot: 'orderDetail',
        widgetId: 'loyalty-order',
        title: 'Rewards',
        Component: LoyaltyOrderWidget,
      },
    ],
  })
}
