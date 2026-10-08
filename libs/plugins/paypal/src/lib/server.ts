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

/**
 * PayPal's SERVER half (AGL-3630), `@aglyn/plugins-paypal/server`: the
 * buyer's pay page on both apps, and on the console the workspace owner's
 * seller routes and PayPal's webhook. Every handler is reached through a
 * dynamic import, so neither app loads PayPal's code until a request names
 * one of its routes.
 */

import { registerPluginApiRoute, type PluginApiRequestSubject } from '@aglyn/aglyn/server'
import { PAYPAL_API_ROUTES } from './constants'

type Routes = typeof import('./server/routes')

const lazy =
  (pick: (routes: Routes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await import('./server/routes'))(request)

/** A console route names its workspace, not a site. */
const orgSubject = (request: Request): PluginApiRequestSubject => ({
  orgId: new URL(request.url).searchParams.get('orgId') || null,
})

/** The buyer's page and the calls PayPal's buttons make from it. */
function registerPayPalPayRoutes(): void {
  const routes: Array<[string, Parameters<typeof lazy>[0]]> = [
    [PAYPAL_API_ROUTES.pay, (routes) => routes.payRoute],
    [PAYPAL_API_ROUTES.payOrder, (routes) => routes.payOrderRoute],
    [PAYPAL_API_ROUTES.payShipping, (routes) => routes.payShippingRoute],
    [PAYPAL_API_ROUTES.payAddress, (routes) => routes.payAddressRoute],
    [PAYPAL_API_ROUTES.payCapture, (routes) => routes.payCaptureRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
}

/** The storefront's API registration, named in `plugins.config.json` as `tenantApi`. */
export function registerPayPalTenantApi(): void {
  registerPayPalPayRoutes()
}

/** The console's API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerPayPalConsoleApi(): void {
  // A register's QR code opens the pay page on the console's own host.
  registerPayPalPayRoutes()
  const seller: Array<[string, Parameters<typeof lazy>[0]]> = [
    [PAYPAL_API_ROUTES.seller, (routes) => routes.sellerRoute],
    [PAYPAL_API_ROUTES.sellerOnboard, (routes) => routes.sellerOnboardRoute],
    [PAYPAL_API_ROUTES.sellerRefresh, (routes) => routes.sellerRefreshRoute],
    [PAYPAL_API_ROUTES.sellerDisconnect, (routes) => routes.sellerDisconnectRoute],
  ]
  for (const [path, pick] of seller) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) }, { subject: orgSubject })
  }
  // PayPal itself, proving the delivery with a signature PayPal verifies.
  registerPluginApiRoute(
    PAYPAL_API_ROUTES.webhook,
    { web: (request) => lazy((routes) => routes.webhookRoute)(request) },
    { machine: true },
  )
}
