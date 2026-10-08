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
import { INVENTORY_SYNC_API_ROUTES } from './constants'
import type { InventoryRoutes } from './server/routes'

/**
 * The console API (AGL-3642), named in `plugins.config.json` as
 * `consoleApi`. Each handler loads the routes and their wiring on its first
 * request, so registering costs the console nothing.
 */
let routes: Promise<InventoryRoutes> | null = null

const loadRoutes = (): Promise<InventoryRoutes> =>
  (routes ??= import('./server/platform-deps').then(({ platformRoutes }) => platformRoutes()))

const handler =
  (pick: (routes: InventoryRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await loadRoutes())(request)

export function registerInventorySyncConsoleApi(): void {
  const table = INVENTORY_SYNC_API_ROUTES
  const entries: Array<[string, (routes: InventoryRoutes) => (request: Request) => Promise<Response>]> = [
    [table.connection, (r) => r.connection],
    [table.connectKeys, (r) => r.connectKeys],
    [table.connectOAuth, (r) => r.connectOAuth],
    [table.oauthCallback, (r) => r.oauthCallback],
    [table.settings, (r) => r.settings],
    [table.locations, (r) => r.locations],
    [table.syncNow, (r) => r.syncNow],
    [table.log, (r) => r.log],
    [table.orders, (r) => r.orders],
    [table.order, (r) => r.order],
    [table.orderSend, (r) => r.orderSend],
  ]
  for (const [path, pick] of entries) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) })
  }
}
