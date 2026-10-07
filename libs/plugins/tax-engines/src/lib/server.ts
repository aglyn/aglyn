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
 * The tax engines' SERVER half (AGL-3631), `@aglyn/plugins-tax-engines/server`:
 * the console routes behind the `tax-engines` prefix. Every write to a
 * `taxEngine*` collection is made from here or from the event handlers the
 * server declarations subscribe; the Firestore rules refuse all of them to
 * clients.
 */

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { TAX_ENGINES_API_ROUTES } from './constants/api-routes'

type Routes = typeof import('./server/routes')

const lazy =
  (pick: (routes: Routes) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./server/routes'))(request)

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerTaxEnginesConsoleApi(): void {
  const routes: Array<[string, (routes: Routes) => (request: Request) => Promise<Response>]> = [
    [TAX_ENGINES_API_ROUTES.connection, (routes) => routes.connectionRoute],
    [TAX_ENGINES_API_ROUTES.connect, (routes) => routes.connectRoute],
    [TAX_ENGINES_API_ROUTES.test, (routes) => routes.testRoute],
    [TAX_ENGINES_API_ROUTES.disconnect, (routes) => routes.disconnectRoute],
    [TAX_ENGINES_API_ROUTES.settings, (routes) => routes.settingsRoute],
    [TAX_ENGINES_API_ROUTES.addressValidate, (routes) => routes.addressValidateRoute],
    [TAX_ENGINES_API_ROUTES.productTaxCode, (routes) => routes.productTaxCodeRoute],
    [TAX_ENGINES_API_ROUTES.exemptions, (routes) => routes.exemptionsRoute],
    [TAX_ENGINES_API_ROUTES.exemptionsDelete, (routes) => routes.exemptionsDeleteRoute],
    [TAX_ENGINES_API_ROUTES.orderTransaction, (routes) => routes.orderTransactionRoute],
    [TAX_ENGINES_API_ROUTES.orderTransactionRetry, (routes) => routes.orderTransactionRetryRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
}
