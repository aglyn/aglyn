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

import type { PluginSubprocessorsAnswer } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { AFTERSHIP_API_BASE, NARVAR_API_BASE, ROUTE_API_BASE } from './server/config'

/**
 * Post-purchase's OTHER HOSTS (AGL-3635), named under `subprocessors` in
 * `plugins.config.json`. None is a published recipient: each is reached only
 * with an account the MERCHANT connected — their AfterShip key, their Route
 * token, their Narvar credentials — so the merchant, not Aglyn, chose the
 * vendor, and the data goes to the merchant's own account there. Each host
 * is read off the constant the adapter calls, so a moved endpoint moves its
 * declaration.
 *
 * ⚑ Nothing is sent to any of them until `POST_PURCHASE_VENDORS` names the
 * service and `POST_PURCHASE_TOKEN_KEY` is set (`server/config.ts`), and then
 * only for a site whose merchant connected it.
 */
export function postPurchaseSubprocessors(): PluginSubprocessorsAnswer {
  return {
    hosts: [
      {
        host: new URL(AFTERSHIP_API_BASE).host,
        disposition: 'not-a-subprocessor',
        reason:
          "The AfterShip adapter (`libs/plugins/post-purchase/src/lib/providers/aftership.ts`), with the API key the merchant connected from their own AfterShip account: starts following each parcel the merchant ships. The merchant chose AfterShip and the data lands in the merchant's account.",
        dataReceived:
          "For each parcel: its tracking number and carrier, the order's id and number, the buyer's name, and the site's id. No address, email, phone or payment detail.",
      },
      {
        host: new URL(ROUTE_API_BASE).host,
        disposition: 'not-a-subprocessor',
        reason:
          "The Route adapter (`libs/plugins/post-purchase/src/lib/providers/route.ts`), with the secret token the merchant connected from their own Route account: quotes package protection at the cart and opens, updates and cancels the policy a buyer pays for. The merchant chose Route and the data lands in the merchant's account.",
        dataReceived:
          "For a quote: the basket's shipped items (name, SKU, quantity, price) and subtotal. For a policy: the order's id, number and date, the buyer's name, email and delivery address, the covered items, the premium paid, and each parcel's tracking number and carrier. No phone or payment detail.",
      },
      {
        host: new URL(NARVAR_API_BASE).host,
        disposition: 'not-a-subprocessor',
        reason:
          "The Narvar adapter (`libs/plugins/post-purchase/src/lib/providers/narvar.ts`), with the account id and auth token the merchant connected from their own Narvar account: sends each order and its parcels so Narvar can run the merchant's tracking page and notifications. The merchant chose Narvar and the data lands in the merchant's account.",
        dataReceived:
          "For each order: its number, date, status and currency, the items (name, SKU, quantity, price), the buyer's name, email and delivery address, and each parcel's tracking number, carrier and ship date. No phone or payment detail.",
      },
    ],
  }
}
