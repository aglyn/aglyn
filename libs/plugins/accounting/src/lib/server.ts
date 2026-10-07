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
 * The accounting plugin's SERVER half (AGL-3614),
 * `@aglyn/plugins-accounting/server`, named in `plugins.config.json` as
 * `consoleApi` and loaded by the console's server manifest alone.
 *
 * Every write to an `accounting*` collection is made here or by the tick in
 * `declarations.console-server.ts`: the Firestore rules name none of them, so
 * a connection, a mapping and a sync item only ever change through a handler
 * registered below, behind the session, permission and entitlement checks
 * that handler makes.
 */

import {
  registerPluginApiRoute,
  registerPluginPermissions,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { ACCOUNTING_API_ROUTES } from './constants/api-routes'
import { ACCOUNTING_PERMISSIONS, ACCOUNTING_PLUGIN_ID } from './constants/bundle-common'
import { createAccountingRoutes, type AccountingRouteDeps } from './server/accounting-routes'
import {
  accountingOAuthCallbackSubject,
  accountingOrgSubject,
  defaultAccountingRouteDeps,
} from './server/platform-deps'

/** No auth, no org, no data: proves this bundle loaded and registered. */
export const accountingPingHandler: PluginApiHandler = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  res.status(200).json({ ok: true, plugin: ACCOUNTING_PLUGIN_ID })
}

/** Registers every accounting route with its release subject. */
export function registerAccountingRoutes(deps: AccountingRouteDeps = defaultAccountingRouteDeps()): void {
  const routes = createAccountingRoutes(deps)
  const orgSubject = { subject: accountingOrgSubject }
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.status, { web: routes.status }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.connect, { web: routes.connect }, orgSubject)
  registerPluginApiRoute(
    ACCOUNTING_API_ROUTES.oauthCallback,
    { web: routes.oauthCallback },
    { subject: accountingOAuthCallbackSubject },
  )
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.connectComplete, { web: routes.connectComplete }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.selectTenant, { web: routes.selectTenant }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.options, { web: routes.options }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.settings, { web: routes.settings }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.log, { web: routes.log }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.retry, { web: routes.retry }, orgSubject)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.disconnect, { web: routes.disconnect }, orgSubject)
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerAccountingConsoleApi(): void {
  registerPluginPermissions(ACCOUNTING_PERMISSIONS)
  registerPluginApiRoute(ACCOUNTING_API_ROUTES.ping, accountingPingHandler)
  registerAccountingRoutes()
}
