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
import { FULFILLMENT_NETWORKS_API_ROUTES } from './constants'
import type { NetworkRoutes } from './server/routes'

/**
 * The console API (AGL-3634), named in `plugins.config.json` as
 * `consoleApi`. Each handler loads the routes and their wiring on its first
 * request, so registering costs the console nothing. ShipBob's webhook is a
 * machine route: the dispatcher skips its per-site gates and the route
 * verifies the token its address carries before it reads the body.
 */
let routes: Promise<NetworkRoutes> | null = null

const loadRoutes = (): Promise<NetworkRoutes> =>
  (routes ??= import('./server/platform-deps').then(({ platformRoutes }) => platformRoutes()))

const handler =
  (pick: (routes: NetworkRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await loadRoutes())(request)

export function registerFulfillmentNetworksConsoleApi(): void {
  const routesTable = FULFILLMENT_NETWORKS_API_ROUTES
  const table: Array<[string, (routes: NetworkRoutes) => (request: Request) => Promise<Response>]> = [
    [routesTable.connections, (r) => r.list],
    [routesTable.connection, (r) => r.connection],
    [routesTable.connect, (r) => r.connect],
    [routesTable.oauthCallback, (r) => r.oauthCallback],
    [routesTable.syncNow, (r) => r.syncNow],
    [routesTable.log, (r) => r.log],
    [routesTable.order, (r) => r.order],
    [routesTable.orderSend, (r) => r.orderSend],
    [routesTable.orderCancel, (r) => r.orderCancel],
  ]
  for (const [path, pick] of table) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) })
  }
  const webhook = handler((r) => r.webhookShipbob)
  registerPluginApiRoute(routesTable.webhookShipbob, { web: (request) => webhook(request) }, { machine: true })
}
