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
import { COURIERS_API_ROUTES } from './constants'
import type { CourierRoutes } from './server/routes'

/**
 * The console API (AGL-3695), named in `plugins.config.json` as
 * `consoleApi`. Each handler loads the routes and their wiring on its first
 * request, so registering costs the console nothing. DoorDash's webhook is a
 * machine route: the dispatcher skips its per-site gates and the route
 * verifies the Authorization it carries before it reads the body.
 */
let routes: Promise<CourierRoutes> | null = null

const loadRoutes = (): Promise<CourierRoutes> =>
  (routes ??= import('./server/platform-deps').then(({ platformRoutes }) => platformRoutes()))

const handler =
  (pick: (routes: CourierRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await loadRoutes())(request)

export function registerCouriersConsoleApi(): void {
  const table = COURIERS_API_ROUTES
  const entries: Array<[string, (routes: CourierRoutes) => (request: Request) => Promise<Response>]> = [
    [table.connection, (r) => r.list],
    [table.connect, (r) => r.connect],
    [table.test, (r) => r.test],
    [table.settings, (r) => r.settings],
    [table.webhookToken, (r) => r.webhookToken],
    [table.disconnect, (r) => r.disconnect],
    [table.order, (r) => r.order],
    [table.quote, (r) => r.quote],
    [table.dispatch, (r) => r.dispatch],
    [table.cancel, (r) => r.cancel],
    [table.refresh, (r) => r.refresh],
  ]
  for (const [path, pick] of entries) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) })
  }
  const webhook = handler((r) => r.webhookDoordash)
  registerPluginApiRoute(table.webhookDoordash, { web: (request) => webhook(request) }, { machine: true })
}
