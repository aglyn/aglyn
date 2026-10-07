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

import {
  registerPluginTransferResourceUi,
  type TransferWizardStepProps,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { createElement, lazy, Suspense } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  COMMERCE_CATEGORIES_TRANSFER,
  COMMERCE_COUPONS_TRANSFER,
  COMMERCE_DISCOUNTS_TRANSFER,
  COMMERCE_GIFT_CARDS_TRANSFER,
  COMMERCE_ORDERS_TRANSFER,
  COMMERCE_PRODUCTS_TRANSFER,
  COMMERCE_TRACKING_TRANSFER,
  GIFT_CARD_CONFIRM_STEP_ID,
} from './transfer-keys'

/** The After import step loads with the wizard, not with the products page. */
const ProductImportOptionsStep = lazy(() => import('./product-import-step.component'))

function AfterImportStep(props: TransferWizardStepProps) {
  return createElement(Suspense, { fallback: null }, createElement(ProductImportOptionsStep, props))
}

/** The gift card import's Confirm step loads with the wizard, not with the Gift cards card. */
const GiftCardConfirmStepBody = lazy(() => import('./gift-card-confirm-step.component'))

function GiftCardConfirmStep(props: TransferWizardStepProps) {
  return createElement(Suspense, { fallback: null }, createElement(GiftCardConfirmStepBody, props))
}

/**
 * The client halves of the commerce transfer resources (AGL-3531): how the
 * wizard and the dialog name each, the products wizard's own After import
 * step, where the `productImport` zone sets what happens to new products,
 * and the gift card import's Confirm step (AGL-3551).
 */
export function registerCommerceTransferUi(): void {
  const owner = { pluginId: BUNDLE_ID }
  registerPluginTransferResourceUi(
    COMMERCE_PRODUCTS_TRANSFER,
    {
      label: 'Products',
      extraSteps: [
        { id: 'afterImport', label: 'After import', after: 'conflicts', component: AfterImportStep },
      ],
    },
    owner,
  )
  registerPluginTransferResourceUi(COMMERCE_CATEGORIES_TRANSFER, { label: 'Product categories' }, owner)
  registerPluginTransferResourceUi(COMMERCE_ORDERS_TRANSFER, { label: 'Orders' }, owner)
  registerPluginTransferResourceUi(COMMERCE_DISCOUNTS_TRANSFER, { label: 'Discounts' }, owner)
  registerPluginTransferResourceUi(COMMERCE_TRACKING_TRANSFER, { label: 'Tracking numbers' }, owner)
  registerPluginTransferResourceUi(COMMERCE_COUPONS_TRANSFER, { label: 'Coupons' }, owner)
  registerPluginTransferResourceUi(
    COMMERCE_GIFT_CARDS_TRANSFER,
    {
      label: 'Gift cards',
      // Every card and its value, and the total typed back (AGL-3551).
      extraSteps: [
        { id: GIFT_CARD_CONFIRM_STEP_ID, label: 'Confirm the cards', after: 'conflicts', component: GiftCardConfirmStep },
      ],
    },
    owner,
  )
}
