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
import { DELIVERY_APPS_API_ROUTES } from './constants'
import type { DeliveryRoutes } from './server/routes'

/**
 * The console API (AGL-3644), named in `plugins.config.json` as
 * `consoleApi`. Each handler loads the routes and their wiring on its first
 * request, so registering costs the console nothing. The three webhooks are
 * `machine` routes: no session and no enablement gate, because each service
 * signs its own and the route checks that signature first.
 */
let routes: Promise<DeliveryRoutes> | null = null

const loadRoutes = (): Promise<DeliveryRoutes> =>
  (routes ??= import('./server/platform-deps').then(({ platformRoutes }) => platformRoutes()))

const handler =
  (pick: (routes: DeliveryRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request): Promise<Response> =>
    pick(await loadRoutes())(request)

export function registerDeliveryAppsConsoleApi(): void {
  const R = DELIVERY_APPS_API_ROUTES
  const table: Array<[string, (routes: DeliveryRoutes) => (request: Request) => Promise<Response>]> = [
    [R.stores, (r) => r.stores],
    [R.store, (r) => r.store],
    [R.menu, (r) => r.menu],
    [R.items, (r) => r.items],
    [R.catalog, (r) => r.catalog],
    [R.queue, (r) => r.queue],
    [R.orderAction, (r) => r.orderAction],
  ]
  for (const [path, pick] of table) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) })
  }
  const webhooks: Array<[string, (routes: DeliveryRoutes) => (request: Request) => Promise<Response>]> = [
    [R.webhookDoordash, (r) => r.webhookDoordash],
    [R.webhookUberEats, (r) => r.webhookUberEats],
    [R.webhookGrubhub, (r) => r.webhookGrubhub],
  ]
  for (const [path, pick] of webhooks) {
    const run = handler(pick)
    registerPluginApiRoute(path, { web: (request) => run(request) }, { machine: true })
  }
}
