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
import { TAX_ENGINES_ENTITLEMENT, TAX_ENGINES_PLUGIN_ID } from './constants/bundle-common'

const TaxEngineCard = lazy(() => import('./components/tax-engine-card.component'))
const ProductTaxCodeField = lazy(() => import('./components/product-tax-code-field.component'))
const OrderTaxRecord = lazy(() => import('./components/order-tax-record.component'))

/**
 * The tax engines' console half (AGL-3631): no page of its own. It fills
 * three zones the commerce plugin hosts — the store's Taxes card, the
 * product editor and the order dialog — and each widget is code-split and
 * asks the server whether a tax service exists for the site before drawing
 * anything, so a deployment without the sealing key shows nothing at all.
 * Gated on the plans that sell.
 */
export function registerTaxEnginesConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: TAX_ENGINES_PLUGIN_ID,
    displayName: 'Tax services',
    featureFlag: TAX_ENGINES_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'tax-engines-connection',
        title: 'Tax service',
        Component: TaxEngineCard,
      },
      {
        slot: 'productEditor',
        widgetId: 'tax-engines-product-code',
        title: 'Tax code',
        Component: ProductTaxCodeField,
      },
      {
        slot: 'orderDetail',
        widgetId: 'tax-engines-order-record',
        title: 'Tax service record',
        Component: OrderTaxRecord,
      },
    ],
  })
}
