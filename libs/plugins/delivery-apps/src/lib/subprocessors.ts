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
import type { PluginEgressHostDeclaration, PluginSubprocessorsAnswer } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

/**
 * DoorDash, Uber Eats and Grubhub (AGL-3644): each the merchant's OWN store
 * on that service, which the merchant signed up for, contracts with and
 * links to their site by its store id. The service sold the order, holds its
 * buyer and pays the merchant; it SENDS the order here, and what this
 * plugin's code sends back carries no personal data: the service's own order
 * id with yes, no or ready, the store order's number, and the menu built
 * from the merchant's catalog. So each host is a destination the customer
 * chose, the shape marketplaces and fulfillment networks already take,
 * reached with the deployment's partner credentials only for a store a site
 * connected.
 */

const CALLS =
  "For an order the service sent a store connected here: the service's own order id and store id, the answer (accepted with the minutes the kitchen needs, rejected with the merchant's reason, or ready for pickup), and the number of the store order it became. For the menu, when the merchant sends it: each product's name, choices, description, price, photo address and whether it is in stock. No buyer's details are sent: the buyer's name, phone and the order's items come FROM the service, in its webhook or when its order is read. Each call is signed with the deployment's partner credentials."

const file = (name: string) => `\`libs/plugins/delivery-apps/src/lib/providers/${name}.ts\``

const api = (host: string, service: string, adapter: string, extra = ''): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. The ${service} API for the merchant's own ${service} store, which a site's admin links by its store id in the store's settings, reached only from ${file(adapter)} to answer that store's orders and send its menu.${extra}`,
  dataReceived: CALLS,
})

export const DELIVERY_APPS_HOSTS: PluginEgressHostDeclaration[] = [
  api('openapi.doordash.com', 'DoorDash', 'doordash'),
  api('api.uber.com', 'Uber Eats', 'uber-eats'),
  {
    host: 'auth.uber.com',
    disposition: 'not-a-subprocessor',
    reason: `Customer-chosen destination. Uber's OAuth token endpoint, for the client-credentials token each Uber Eats call carries (${file('uber-eats')}).`,
    dataReceived: "The deployment's Uber client id and secret and the scopes asked for — credentials, never orders or menus.",
  },
  api('api-third-party-gtm.grubhub.com', 'Grubhub', 'grubhub'),
  api('api-third-party-gtm-pp.grubhub.com', 'Grubhub', 'grubhub', ' Its pre-production host, used only by a deployment set to the sandbox, where nothing real sells.'),
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen services. */
export function deliveryAppsSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: DELIVERY_APPS_HOSTS }
}
