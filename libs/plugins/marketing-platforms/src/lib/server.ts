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
import { MARKETING_PLATFORMS_API_ROUTES } from './constants'
import type { MarketingRoutes } from './server/routes'

/**
 * The console API (AGL-3639), named in `plugins.config.json` as
 * `consoleApi`. Each handler loads the routes and their wiring on its first
 * request, so registering costs the console nothing.
 */
let routes: Promise<MarketingRoutes> | null = null

const loadRoutes = (): Promise<MarketingRoutes> =>
  (routes ??= Promise.all([import('./server/routes'), import('./server/platform-deps')]).then(
    ([{ createMarketingRoutes }, { platformRouteDeps }]) => createMarketingRoutes(platformRouteDeps()),
  ))

const handler =
  (pick: (routes: MarketingRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await loadRoutes())(request)

export function registerMarketingPlatformsConsoleApi(): void {
  const table: Array<[string, (routes: MarketingRoutes) => (request: Request) => Promise<Response>]> = [
    [MARKETING_PLATFORMS_API_ROUTES.connections, (r) => (request) => (request.method === 'POST' ? r.connect(request) : r.list(request))],
    [MARKETING_PLATFORMS_API_ROUTES.connection, (r) => r.connection],
    [MARKETING_PLATFORMS_API_ROUTES.syncNow, (r) => r.syncNow],
    [MARKETING_PLATFORMS_API_ROUTES.log, (r) => r.log],
    [MARKETING_PLATFORMS_API_ROUTES.oauthStart, (r) => r.oauthStart],
    [MARKETING_PLATFORMS_API_ROUTES.oauthCallback, (r) => r.oauthCallback],
  ]
  for (const [path, pick] of table) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) })
  }
}
