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
import { POST_PURCHASE_ENTITLEMENT, POST_PURCHASE_PLUGIN_ID } from './constants/bundle-common'

const PostPurchaseSettingsCards = lazy(() => import('./components/post-purchase-settings-card.component'))
const PostPurchaseOrderWidget = lazy(() => import('./components/post-purchase-order-widget.component'))

/**
 * Post-purchase's console half (AGL-3635): no page of its own. It fills two
 * zones the commerce plugin hosts — the store's settings and the order
 * dialog. Every widget asks the server which services exist for the site
 * before drawing anything, so a deployment that offers none shows nothing.
 * Gated on the plans that sell.
 */
export function registerPostPurchaseConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: POST_PURCHASE_PLUGIN_ID,
    displayName: 'Tracking and protection',
    featureFlag: POST_PURCHASE_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'post-purchase-services',
        title: 'Tracking and protection',
        Component: PostPurchaseSettingsCards,
      },
      {
        slot: 'orderDetail',
        widgetId: 'post-purchase-order',
        title: 'Tracking and protection',
        Component: PostPurchaseOrderWidget,
      },
    ],
  })
}
