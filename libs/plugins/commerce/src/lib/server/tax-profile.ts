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

import { registerPluginTaxProfile } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { BUNDLE_ID } from '../constants/bundle-common'
import { type FlatTaxRate, resolveFlatTaxCents } from '../model'
import { storefrontTaxModeOf } from './storefront-tax'

/**
 * The merchant's tax rule, published for every plugin that charges.
 *
 * A merchant sets tax once, in the store settings this plugin keeps. A plugin
 * that sells something else — an appointment — prices its own charge, and used
 * to import `resolveFlatTaxCents` and `storefrontTaxModeOf` from here to do it.
 * It asks the tax-profile contract now, and gets these same two functions: one
 * rounding rule, one reading of a settled payment, wherever money is taken.
 *
 * Registered from BOTH server registrars, because a booking is priced in the
 * tenant app and confirmed by the console's billing webhook.
 */
export function registerCommerceTaxProfile(): void {
  registerPluginTaxProfile(
    {
      flatTax: (rate, chargeCents, fallbackLabel) =>
        resolveFlatTaxCents(
          rate as FlatTaxRate | undefined | null,
          chargeCents,
          fallbackLabel,
        ),
      taxModeOf: (settledPayment, manualTaxCents) =>
        storefrontTaxModeOf(settledPayment, manualTaxCents),
    },
    { pluginId: BUNDLE_ID },
  )
}
