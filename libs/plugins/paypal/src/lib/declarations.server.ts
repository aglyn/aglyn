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
  registerPluginPaymentProvider,
  type PluginPaymentProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-payment-providers'
import { PAYPAL_PLUGIN_ID, PAYPAL_PROVIDER_ID } from './constants'

/**
 * PayPal's SERVER declarations (AGL-3630), loaded by both apps' servers
 * before any plugin handler runs: the payment provider a seller consults
 * beside its card account. Registered whether or not the deployment is
 * configured; an unconfigured one answers `available() === null`, which a
 * seller reads as "no PayPal", exactly as if nothing were registered.
 *
 * Each method reaches the provider through a dynamic import: its modules
 * read Firestore through the tenant data layer, whose barrel would otherwise
 * load in every app's boot before a single sale asks for PayPal.
 */
const lazyProvider: PluginPaymentProvider = {
  async available(request) {
    return (await import('./server/provider')).payPalProvider.available(request)
  },
  async createCheckout(request) {
    return (await import('./server/provider')).payPalProvider.createCheckout(request)
  },
  async refund(request) {
    return (await import('./server/provider')).payPalProvider.refund(request)
  },
}

export function registerPayPalServerDeclarations(): void {
  registerPluginPaymentProvider(PAYPAL_PROVIDER_ID, lazyProvider, { pluginId: PAYPAL_PLUGIN_ID })
}

registerPayPalServerDeclarations()
