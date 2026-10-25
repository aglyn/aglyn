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

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'

type Routes = typeof import('./routes')

const lazy =
  (pick: (routes: Routes) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./routes'))(request)

/**
 * Buying and managing a domain (AGL-3962), at a site or across the workspace
 * (AGL-4040), each handler loaded on first use.
 */
export function registerRegistrarRoutes(): void {
  const routes: Array<[string, Parameters<typeof lazy>[0]]> = [
    [DOMAINS_API_ROUTES.search, (routes) => routes.searchRoute],
    [DOMAINS_API_ROUTES.registrations, (routes) => routes.registrationsRoute],
    [DOMAINS_API_ROUTES.purchase, (routes) => routes.purchaseRoute],
    [DOMAINS_API_ROUTES.autoRenew, (routes) => routes.autoRenewRoute],
    [DOMAINS_API_ROUTES.renewNow, (routes) => routes.renewNowRoute],
    [DOMAINS_API_ROUTES.transferOut, (routes) => routes.transferOutRoute],
    [DOMAINS_API_ROUTES.reconnect, (routes) => routes.reconnectRoute],
    [DOMAINS_API_ROUTES.workspace, (routes) => routes.workspaceRoute],
    [DOMAINS_API_ROUTES.connect, (routes) => routes.connectRoute],
    [DOMAINS_API_ROUTES.disconnect, (routes) => routes.disconnectRoute],
    [DOMAINS_API_ROUTES.contact, (routes) => routes.contactRoute],
    [DOMAINS_API_ROUTES.dns, (routes) => routes.dnsRoute],
    [DOMAINS_API_ROUTES.transferInQuote, (routes) => routes.transferInQuoteRoute],
    [DOMAINS_API_ROUTES.transferIn, (routes) => routes.transferInRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
}
