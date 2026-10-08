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
 * Print-on-demand's SERVER half (AGL-3641), `@aglyn/plugins-print-on-demand/server`:
 * the console routes behind the `print-on-demand` prefix and the services'
 * webhook doors. Every write to a `pod*` collection is made from here, the
 * server declarations' event handlers or the console job; the Firestore rules
 * refuse all of them to clients.
 */

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { POD_API_ROUTES } from './constants/api-routes'

type Routes = typeof import('./server/routes')

const lazy =
  (pick: (routes: Routes) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./server/routes'))(request)

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerPrintOnDemandConsoleApi(): void {
  const routes: Array<[string, (routes: Routes) => (request: Request) => Promise<Response>]> = [
    [POD_API_ROUTES.connections, (routes) => routes.connectionsRoute],
    [POD_API_ROUTES.stores, (routes) => routes.storesRoute],
    [POD_API_ROUTES.connect, (routes) => routes.connectRoute],
    [POD_API_ROUTES.settings, (routes) => routes.settingsRoute],
    [POD_API_ROUTES.disconnect, (routes) => routes.disconnectRoute],
    [POD_API_ROUTES.catalog, (routes) => routes.catalogRoute],
    [POD_API_ROUTES.importProducts, (routes) => routes.importRoute],
    [POD_API_ROUTES.imported, (routes) => routes.importedRoute],
    [POD_API_ROUTES.unlink, (routes) => routes.unlinkRoute],
    [POD_API_ROUTES.productLink, (routes) => routes.productLinkRoute],
    [POD_API_ROUTES.order, (routes) => routes.orderRoute],
    [POD_API_ROUTES.orders, (routes) => routes.ordersRoute],
    [POD_API_ROUTES.orderAction, (routes) => routes.orderActionRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
  // The services' webhooks: machines that prove themselves with the secret
  // their address carries, naming no site.
  registerPluginApiRoute(
    POD_API_ROUTES.webhookPrintful,
    { web: async (request) => (await import('./server/webhook-routes')).printfulWebhookRoute(request) },
    { machine: true },
  )
  registerPluginApiRoute(
    POD_API_ROUTES.webhookPrintify,
    { web: async (request) => (await import('./server/webhook-routes')).printifyWebhookRoute(request) },
    { machine: true },
  )
}
