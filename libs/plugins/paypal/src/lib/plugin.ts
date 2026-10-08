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
import { PAYPAL_ENTITLEMENT, PAYPAL_PLUGIN_ID } from './constants'

const PayPalSettingsCard = lazy(() => import('./components/paypal-settings-card.component'))

/**
 * PayPal's console half (AGL-3630): one card on the store's Settings, in
 * the zone commerce hosts. The card asks the server whether PayPal is
 * offered before drawing anything, so a deployment without the
 * `PAYPAL_*` variables shows no PayPal surface at all.
 */
export function registerPayPalConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: PAYPAL_PLUGIN_ID,
    displayName: 'PayPal',
    featureFlag: PAYPAL_ENTITLEMENT,
    widgets: [
      {
        slot: 'commerceSettings',
        widgetId: 'paypal-seller',
        title: 'PayPal and Venmo',
        Component: PayPalSettingsCard,
      },
    ],
  })
}
