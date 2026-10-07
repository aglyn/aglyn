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
 * Shipping's SERVER half (AGL-3612), `@aglyn/plugins-shipping/server`: the
 * console routes behind the `shipping` prefix and the providers' webhook
 * doors. Every write to a `shipping*` collection is made from here or from
 * the server declarations; the Firestore rules refuse all of them to
 * clients.
 */

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { SHIPPING_API_ROUTES } from './constants/api-routes'

const lazy =
  (pick: (routes: typeof import('./server/routes')) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./server/routes'))(request)

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerShippingConsoleApi(): void {
  const routes: Array<[string, Parameters<typeof lazy>[0]]> = [
    [SHIPPING_API_ROUTES.availability, (routes) => routes.availabilityRoute],
    [SHIPPING_API_ROUTES.settings, (routes) => routes.settingsRoute],
    [SHIPPING_API_ROUTES.account, (routes) => routes.accountRoute],
    [SHIPPING_API_ROUTES.carrierAccounts, (routes) => routes.carrierAccountsRoute],
    [SHIPPING_API_ROUTES.carrierAccountsConnect, (routes) => routes.carrierAccountsConnectRoute],
    [SHIPPING_API_ROUTES.carrierAccountsActive, (routes) => routes.carrierAccountsActiveRoute],
    [SHIPPING_API_ROUTES.rates, (routes) => routes.ratesRoute],
    [SHIPPING_API_ROUTES.labels, (routes) => routes.labelsRoute],
    [SHIPPING_API_ROUTES.labelsBuy, (routes) => routes.labelsBuyRoute],
    [SHIPPING_API_ROUTES.labelsVoid, (routes) => routes.labelsVoidRoute],
    [SHIPPING_API_ROUTES.addressValidate, (routes) => routes.addressValidateRoute],
    [SHIPPING_API_ROUTES.batchRates, (routes) => routes.batchRatesRoute],
    [SHIPPING_API_ROUTES.batchBuy, (routes) => routes.batchBuyRoute],
    [SHIPPING_API_ROUTES.ownAccounts, (routes) => routes.ownAccountsRoute],
    [SHIPPING_API_ROUTES.ownAccountsConnect, (routes) => routes.ownAccountsConnectRoute],
    [SHIPPING_API_ROUTES.ownAccountsDisconnect, (routes) => routes.ownAccountsDisconnectRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
  // Billing → Usage names its workspace, not a site: the release gate asks
  // about that organization.
  registerPluginApiRoute(
    SHIPPING_API_ROUTES.spend,
    { web: (request) => lazy((routes) => routes.spendRoute)(request) },
    {
      subject: (request) => ({ orgId: new URL(request.url).searchParams.get('orgId') || null }),
    },
  )
  // The providers' webhooks: machines that prove themselves with a secret
  // the route verifies, naming no site.
  registerPluginApiRoute(
    SHIPPING_API_ROUTES.webhookShippo,
    {
      web: async (request) => (await import('./server/webhook-routes')).shippoWebhookRoute(request),
    },
    { machine: true },
  )
  registerPluginApiRoute(
    SHIPPING_API_ROUTES.webhookEasypost,
    {
      web: async (request) => (await import('./server/webhook-routes')).easypostWebhookRoute(request),
    },
    { machine: true },
  )
  // The merchant-account webhooks (AGL-3632), one address per workspace,
  // each verified with that workspace's own secret.
  registerPluginApiRoute(
    SHIPPING_API_ROUTES.webhookEasyship,
    {
      web: async (request) => (await import('./server/webhook-routes')).easyshipWebhookRoute(request),
    },
    { machine: true },
  )
  registerPluginApiRoute(
    SHIPPING_API_ROUTES.webhookSendcloud,
    {
      web: async (request) => (await import('./server/webhook-routes')).sendcloudWebhookRoute(request),
    },
    { machine: true },
  )
  // A label file a provider serves only to its own caller (AGL-3632): the
  // address carries the label's own token, so a packing slip or a return
  // email opens it with no session.
  registerPluginApiRoute(
    SHIPPING_API_ROUTES.labelFile,
    { web: (request) => lazy((routes) => routes.labelFileRoute)(request) },
    { machine: true },
  )
}
