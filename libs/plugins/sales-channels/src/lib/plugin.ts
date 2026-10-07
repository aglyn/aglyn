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
import { BUNDLE_ID, SALES_CHANNELS_ENTITLEMENT } from './constants/bundle-common'

const SalesChannelsCard = lazy(() => import('./components/sales-channels-card.component'))
const ProductChannelFields = lazy(() => import('./components/product-channel-fields.component'))

/**
 * Sales channels' console half (AGL-3637): no page of its own. It fills two
 * zones the commerce plugin hosts — the store's settings, with a card per
 * shopping channel, and the product editor, with the fields channels ask
 * for. Each widget's code loads only when its zone is drawn. Gated on the
 * plans that sell.
 */
export function registerSalesChannelsConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Sales channels',
    featureFlag: SALES_CHANNELS_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'sales-channels-feeds',
        title: 'Sales channels',
        Component: SalesChannelsCard,
      },
      {
        slot: 'productEditor',
        widgetId: 'sales-channels-product-fields',
        title: 'Shopping channels',
        Component: ProductChannelFields,
      },
    ],
  })
}
