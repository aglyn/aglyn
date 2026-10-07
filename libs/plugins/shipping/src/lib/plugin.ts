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
import { SHIPPING_ENTITLEMENT, SHIPPING_PLUGIN_ID } from './constants/bundle-common'

const ShippingSettingsCard = lazy(() => import('./components/shipping-settings-card.component'))
const CarrierAccountsCard = lazy(() => import('./components/carrier-accounts-card.component'))
const OrderLabelsWidget = lazy(() => import('./components/order-labels-widget.component'))
const ReturnLabelWidget = lazy(() => import('./components/return-label-widget.component'))
const OrdersBatchWidget = lazy(() => import('./components/orders-batch-widget.component'))
const ProductShippingFields = lazy(() => import('./components/product-shipping-fields.component'))
const LabelSpendCard = lazy(() => import('./components/label-spend-card.component'))

/**
 * Shipping's console half (AGL-3612): no page of its own. It fills the
 * zones the commerce plugin hosts — the store's settings, the order dialog,
 * the return dialog, the orders list's bulk actions, the product editor —
 * and the billing page's usage zone. Every widget asks the server whether shipping exists
 * for the site before drawing anything, so a deployment with no carrier
 * provider shows no shipping surface at all. Gated on the plans that sell.
 */
export function registerShippingConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: SHIPPING_PLUGIN_ID,
    displayName: 'Shipping',
    featureFlag: SHIPPING_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'shipping-label-settings',
        title: 'Shipping labels',
        Component: ShippingSettingsCard,
      },
      {
        slot: 'commerceSettings',
        widgetId: 'shipping-carrier-accounts',
        title: 'Carrier accounts',
        Component: CarrierAccountsCard,
      },
      {
        slot: 'orderDetail',
        widgetId: 'shipping-order-labels',
        title: 'Shipping labels',
        Component: OrderLabelsWidget,
      },
      {
        slot: 'returnDetail',
        widgetId: 'shipping-return-label',
        title: 'Return label',
        Component: ReturnLabelWidget,
      },
      {
        slot: 'ordersBulk',
        widgetId: 'shipping-batch-labels',
        title: 'Buy labels',
        Component: OrdersBatchWidget,
      },
      {
        slot: 'productEditor',
        widgetId: 'shipping-product-fields',
        title: 'Shipping',
        Component: ProductShippingFields,
      },
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.orgBillingUsage,
        widgetId: 'shipping-label-spend',
        title: 'Shipping labels',
        permission: 'billing.view',
        Component: LabelSpendCard,
      },
    ],
  })
}
