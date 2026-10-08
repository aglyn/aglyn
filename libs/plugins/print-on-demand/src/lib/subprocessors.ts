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
 * The hosts this plugin's code names (AGL-3641), declared here rather than
 * in the console's subprocessor inventory. Named under `subprocessors` in
 * `plugins.config.json`; the manifest generator calls
 * {@link printOnDemandSubprocessors} and the inventory folds the answer in.
 *
 * Printful and Printify are the MERCHANT's own suppliers. A merchant
 * connects their own account with a token they made there, and the store
 * sends that merchant's own orders to it at their direction so the goods are
 * made and shipped — Aglyn selects no supplier and holds no account with
 * either, any more than it selects the accounting system a business
 * connects. So each is `not-a-subprocessor`, on the customer-chosen-
 * destination ground the accounting plugin's ledgers stand on.
 *
 * Each host is read off the constant the code calls, so a moved endpoint
 * moves its declaration with it.
 */

import type { PluginEgressHostDeclaration, PluginSubprocessorsAnswer } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { POD_IMAGE_ORIGINS } from './constants/bundle-common'
import { POD_TOKEN_HELP } from './model/print-on-demand'
import { PRINTFUL_API_BASE } from './providers/printful'
import { PRINTIFY_API_BASE } from './providers/printify'

const host = (url: string) => new URL(url).host

const ORDER_DATA =
  'For each paid order whose products the merchant imported from the service: the buyer’s name, shipping address, phone number and email address as the recipient, the order number, and each line’s service variant, quantity and the price the buyer paid. A test-mode order is sent as a draft that is never confirmed. Cancellations and reads of the orders sent. The merchant’s own token authenticates each call. No card or payment details are sent.'

export const POD_API_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: host(PRINTFUL_API_BASE),
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. The Printful API of the merchant’s own Printful store, connected with a private token the merchant made (`libs/plugins/print-on-demand/src/lib/providers/printful.ts`): listing and reading the store’s products and their catalog costs for import, sending, confirming, reading and canceling the merchant’s orders, and setting the store’s notice address.',
    dataReceived: `${ORDER_DATA} When the notice address is set: the console’s webhook address, carrying the connection’s secret.`,
  },
  {
    host: host(PRINTIFY_API_BASE),
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. The Printify API of the merchant’s own Printify shop, connected with a personal access token the merchant made (`libs/plugins/print-on-demand/src/lib/providers/printify.ts`): listing and reading the shop’s products for import, sending, sending to production, reading and canceling the merchant’s orders, and registering the shop’s webhooks.',
    dataReceived: `${ORDER_DATA} When webhooks are registered: the console’s webhook address and the connection’s signing secret.`,
  },
  ...POD_IMAGE_ORIGINS.map(
    (origin): PluginEgressHostDeclaration => ({
      host: host(origin),
      disposition: 'not-a-subprocessor',
      reason:
        'The service’s own image host. When a member imports a product, its photos are fetched from here once and copied into the site’s media library (`libs/plugins/print-on-demand/src/lib/server/media.ts`), because a published page loads images only from the site’s own addresses.',
      dataReceived: 'Nothing but a plain GET of the photo’s address the service itself gave: no customer data, no personal data and no credential.',
    }),
  ),
  ...Object.values(POD_TOKEN_HELP).map(
    (help): PluginEgressHostDeclaration => ({
      host: host(help.url),
      disposition: 'no-request',
      reason:
        'A help link on the Print on demand card, to the page where a merchant makes the token they paste. Opened by the member’s own browser; no server of ours requests it.',
      dataReceived: 'Nothing from our servers.',
    }),
  ),
]

export function printOnDemandSubprocessors(): PluginSubprocessorsAnswer {
  return { hosts: POD_API_HOSTS }
}
