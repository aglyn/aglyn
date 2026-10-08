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

import type {
  PluginEgressHostDeclaration,
  PluginSubprocessorDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { EASYPOST_API_BASE } from './providers/easypost'
import { EASYSHIP_API_BASE } from './providers/easyship'
import { SENDCLOUD_API_BASE } from './providers/sendcloud'
import { SHIPPERHQ_GRAPHQL_URL } from './providers/shipperhq'
import { SHIPPO_API_BASE } from './providers/shippo'

/**
 * Shipping's SUBPROCESSORS (AGL-3612), named under `subprocessors` in
 * `plugins.config.json`: the manifest generator calls this and the console's
 * subprocessor inventory folds the answer in. Each host is read off the
 * constant the adapter calls, so a moved endpoint moves its declaration.
 *
 * ⚑ Both flows are OFF until their environment variables are set
 * (`server/config.ts`): with neither `SHIPPO_API_TOKEN` nor
 * `EASYPOST_API_KEY` no request leaves for either host. `publishedOn` is the
 * Subprocessors change-log date that put both rows on the page, ahead of
 * either variable (AGL-3666).
 */

const DATA_RECEIVED =
  'For each workspace that uses carrier rates or labels: the workspace’s name and the email of the member who first used them, to open the workspace’s account at the provider; the site’s ship-from address; for a rate at checkout, the shopper’s delivery address and the parcel’s weight, size and value; for a label, the customer’s name, delivery address, phone number and email from the order, the parcel’s weight and size, and, for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; tracking numbers to follow; and, for a carrier account the merchant connects, its account number and the account holder’s name, email, phone and billing address. No card or bank details, and no password.'

export const SHIPPO_SUBPROCESSOR: PluginSubprocessorDeclaration = {
  host: new URL(SHIPPO_API_BASE).host,
  entity: 'Popout, Inc. (Shippo)',
  region: 'United States',
  purpose:
    'Shipping for merchants who sell physical goods: carrier rates, shipping labels, address validation and parcel tracking',
  publishedOn: '2026-10-07',
  reason:
    "The Shippo adapter (`libs/plugins/shipping/src/lib/providers/shippo.ts`), Platform Accounts: one managed account per workspace, every call the platform's token with the managed account's id. Reached from the shipping plugin's checkout quoter and its console label, address and carrier-account routes, only while `SHIPPO_API_TOKEN` and `SHIPPING_TOKEN_KEY` are set.",
  dataReceived: DATA_RECEIVED,
}

export const EASYPOST_SUBPROCESSOR: PluginSubprocessorDeclaration = {
  host: new URL(EASYPOST_API_BASE).host,
  entity: 'Simpler Postage, Inc. (EasyPost)',
  region: 'United States',
  purpose:
    'Shipping for merchants who sell physical goods: carrier rates, shipping labels, address validation and parcel tracking',
  publishedOn: '2026-10-07',
  reason:
    "The EasyPost adapter (`libs/plugins/shipping/src/lib/providers/easypost.ts`), Child Users: one child user per workspace, acting with its own key. The alternative to Shippo, reached only while `EASYPOST_API_KEY` and `SHIPPING_TOKEN_KEY` are set and Shippo's token is not (or `SHIPPING_PROVIDER` names EasyPost).",
  dataReceived: DATA_RECEIVED,
}

const OWN_LABEL_DATA =
  'For each rate and label the merchant asks for on their own account: the site’s ship-from address; the customer’s name, delivery address, phone number and email from the order; the parcel’s weight, size and value; for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; and the order’s reference. The merchant’s own API credentials authenticate each call. No card or bank details.'

/**
 * The merchant's OWN Easyship, Sendcloud and ShipperHQ accounts (AGL-3632).
 * A workspace connects its own account with its own credentials, and every
 * call goes to that account at the merchant's direction — Aglyn selects no
 * vendor and holds no account with any of them, as with the accounting
 * plugin's ledgers. So each is `not-a-subprocessor`, on the
 * customer-chosen-destination ground. ⚑ A classification for legal to
 * confirm before `SHIPPING_OWN_ACCOUNT_PROVIDERS` names any of them in
 * production; if it is not accepted, each becomes a published subprocessor
 * with its own row. Nothing reaches any of them until that variable names it
 * and a merchant connects an account.
 */
export const SHIPPING_OWN_ACCOUNT_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: new URL(EASYSHIP_API_BASE).host,
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. The Easyship API (2024-09) of the merchant’s own Easyship account, connected on the store’s Settings (`libs/plugins/shipping/src/lib/providers/easyship.ts`): rates and draft shipments, label purchase, cancellation, and the label file. Reached only while `SHIPPING_OWN_ACCOUNT_PROVIDERS` names `easyship`.',
    dataReceived: OWN_LABEL_DATA,
  },
  {
    host: new URL(SENDCLOUD_API_BASE).host,
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. The Sendcloud API v3 of the merchant’s own Sendcloud integration, connected on the store’s Settings (`libs/plugins/shipping/src/lib/providers/sendcloud.ts`): shipping options with quotes, shipment announcement, cancellation, tracking and the label file. Reached only while `SHIPPING_OWN_ACCOUNT_PROVIDERS` names `sendcloud`.',
    dataReceived: OWN_LABEL_DATA,
  },
  {
    host: new URL(SHIPPERHQ_GRAPHQL_URL).host,
    disposition: 'not-a-subprocessor',
    reason:
      'Customer-chosen destination. The ShipperHQ Rates API of the merchant’s own ShipperHQ website, connected on the store’s Settings (`libs/plugins/shipping/src/lib/providers/shipperhq.ts`): a token from the website’s API key and authentication code, and a shipping quote for each checkout that asks for carrier rates. Reached only while `SHIPPING_OWN_ACCOUNT_PROVIDERS` names `shipperhq`.',
    dataReceived:
      'For each checkout quote: the shopper’s destination country, state, city, street and postal code, and each parcel’s weight and share of the cart’s value. No name, email, phone or payment details. The merchant’s own API key and authentication code authenticate.',
  },
]

export function shippingSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [SHIPPO_SUBPROCESSOR, EASYPOST_SUBPROCESSOR], hosts: SHIPPING_OWN_ACCOUNT_HOSTS }
}
