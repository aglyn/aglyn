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
import { SALES_CHANNELS_API_ROUTES } from './constants/bundle-common'

/**
 * Sales channels' SERVER half (AGL-3637), `@aglyn/plugins-sales-channels/server`.
 * Every module behind a route loads with the route's first request.
 */

type ConsoleRoutes = typeof import('./server/console-routes')

const consoleRoute =
  (pick: (routes: ConsoleRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./server/console-routes'))(request)

/**
 * The tenant's routes: the feeds a channel fetches from the store's own
 * domain. A channel's fetcher is a machine with no session that proves
 * itself with the token in the URL, so the dispatcher's per-site gates are
 * skipped and the route asks them itself (`server/site-gate.ts`).
 */
export function registerSalesChannelsApi(): void {
  registerPluginApiRoute(
    SALES_CHANNELS_API_ROUTES.feed,
    {
      web: async (request, context) =>
        (await import('./server/feed-route')).feedRoute(request, context.params),
    },
    { machine: true },
  )
}

/** The console's routes: the card's reads and writes, and the API connections. */
export function registerSalesChannelsConsoleApi(): void {
  const routes: Array<[string, Parameters<typeof consoleRoute>[0]]> = [
    [SALES_CHANNELS_API_ROUTES.state, (routes) => routes.stateRoute],
    [SALES_CHANNELS_API_ROUTES.channel, (routes) => routes.channelRoute],
    [SALES_CHANNELS_API_ROUTES.rotate, (routes) => routes.rotateRoute],
    [SALES_CHANNELS_API_ROUTES.legacy, (routes) => routes.legacyRoute],
    [SALES_CHANNELS_API_ROUTES.settings, (routes) => routes.settingsRoute],
    [SALES_CHANNELS_API_ROUTES.diagnostics, (routes) => routes.diagnosticsRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = consoleRoute(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
  registerSalesChannelsConnectApi()
}

type ConnectRoutes = typeof import('./server/connect/connect-routes')

const connectRoute =
  (pick: (routes: ConnectRoutes) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./server/connect/connect-routes'))(request)

/**
 * The channel API connections (phase 2). Each route answers 404 until the
 * deployment configures its provider. The callback is Google's or Meta's
 * redirect, which carries no bearer token and no site: its organization and
 * member come from the signed state, so the release gate asks about the
 * right organization.
 */
function registerSalesChannelsConnectApi(): void {
  const routes: Array<[string, Parameters<typeof connectRoute>[0]]> = [
    [SALES_CHANNELS_API_ROUTES.connectStart, (routes) => routes.connectStartRoute],
    [SALES_CHANNELS_API_ROUTES.connectSelect, (routes) => routes.connectSelectRoute],
    [SALES_CHANNELS_API_ROUTES.disconnect, (routes) => routes.disconnectRoute],
    [SALES_CHANNELS_API_ROUTES.sync, (routes) => routes.syncRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = connectRoute(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
  const callback = connectRoute((routes) => routes.connectCallbackRoute)
  registerPluginApiRoute(
    SALES_CHANNELS_API_ROUTES.connectCallback,
    { web: (request) => callback(request) },
    {
      subject: async (request) =>
        (await import('./server/connect/connect-routes')).connectCallbackSubject(request),
    },
  )
}
