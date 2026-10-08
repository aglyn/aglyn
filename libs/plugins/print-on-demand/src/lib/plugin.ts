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
import { POD_ENTITLEMENT, POD_PLUGIN_ID } from './constants/bundle-common'

const PrintOnDemandCard = lazy(() => import('./components/print-on-demand-card.component'))
const ProductPodSource = lazy(() => import('./components/product-pod-source.component'))
const OrderPodParts = lazy(() => import('./components/order-pod-parts.component'))

/**
 * Print-on-demand's console half (AGL-3641): no page of its own. It fills
 * three zones the commerce plugin hosts — the store's settings, the product
 * editor and the order dialog — and each widget is code-split and asks the
 * server whether the site can hold a connection before drawing anything, so
 * a deployment without the sealing key shows nothing at all. Gated on the
 * plans that sell. Nothing here loads on a published page.
 */
export function registerPrintOnDemandConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: POD_PLUGIN_ID,
    displayName: 'Print on demand',
    featureFlag: POD_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'print-on-demand-connections',
        title: 'Print on demand',
        Component: PrintOnDemandCard,
      },
      {
        slot: 'productEditor',
        widgetId: 'print-on-demand-product-source',
        title: 'Print on demand',
        Component: ProductPodSource,
      },
      {
        slot: 'orderDetail',
        widgetId: 'print-on-demand-order-parts',
        title: 'Print on demand',
        Component: OrderPodParts,
      },
    ],
  })
}
