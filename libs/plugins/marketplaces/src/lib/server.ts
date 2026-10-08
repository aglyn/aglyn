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
import { MARKETPLACES_API_ROUTES } from './constants'
import type { MarketplaceRoutes } from './server/routes'

/**
 * The console API (AGL-3638), named in `plugins.config.json` as
 * `consoleApi`. Each handler loads the routes and their wiring on its first
 * request, so registering costs the console nothing.
 */
let routes: Promise<MarketplaceRoutes> | null = null

const loadRoutes = (): Promise<MarketplaceRoutes> =>
  (routes ??= import('./server/platform-deps').then(({ platformRoutes }) => platformRoutes()))

const handler =
  (pick: (routes: MarketplaceRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await loadRoutes())(request)

export function registerMarketplacesConsoleApi(): void {
  const table: Array<[string, (routes: MarketplaceRoutes) => (request: Request) => Promise<Response>]> = [
    [MARKETPLACES_API_ROUTES.connections, (r) => r.list],
    [MARKETPLACES_API_ROUTES.connection, (r) => r.connection],
    [MARKETPLACES_API_ROUTES.connect, (r) => r.connect],
    [MARKETPLACES_API_ROUTES.oauthCallback, (r) => r.oauthCallback],
    [MARKETPLACES_API_ROUTES.syncNow, (r) => r.syncNow],
    [MARKETPLACES_API_ROUTES.activity, (r) => r.activity],
    [MARKETPLACES_API_ROUTES.order, (r) => r.order],
    [MARKETPLACES_API_ROUTES.orderRetry, (r) => r.orderRetry],
  ]
  for (const [path, pick] of table) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) })
  }
}
