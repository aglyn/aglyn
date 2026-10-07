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

import type { PluginSubprocessorDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { EASYPOST_API_BASE } from './providers/easypost'
import { SHIPPO_API_BASE } from './providers/shippo'

/**
 * Shipping's SUBPROCESSORS (AGL-3612), named under `subprocessors` in
 * `plugins.config.json`: the manifest generator calls this and the console's
 * subprocessor inventory folds the answer in. Each host is read off the
 * constant the adapter calls, so a moved endpoint moves its declaration.
 *
 * ⚑ Both flows are OFF until their environment variables are set
 * (`server/config.ts`): with neither `SHIPPO_API_TOKEN` nor
 * `EASYPOST_API_KEY` no request leaves for either host. The rows have to be
 * on the published Subprocessors page before either variable is set in
 * production.
 */

const DATA_RECEIVED =
  'For each workspace that uses carrier rates or labels: the workspace’s name and the email of the member who first used them, to open the workspace’s account at the provider; the site’s ship-from address; for a rate at checkout, the shopper’s delivery address and the parcel’s weight, size and value; for a label, the customer’s name, delivery address, phone number and email from the order, the parcel’s weight and size, and, for a parcel crossing a border, each item’s description, quantity, value, weight, tariff code and country of origin; tracking numbers to follow; and, for a carrier account the merchant connects, its account number and the account holder’s name, email, phone and billing address. No card or bank details, and no password.'

export const SHIPPO_SUBPROCESSOR: PluginSubprocessorDeclaration = {
  host: new URL(SHIPPO_API_BASE).host,
  entity: 'Popout, Inc. (Shippo)',
  region: 'United States',
  purpose:
    'Shipping for merchants who sell physical goods: live carrier rates at checkout, shipping labels, address validation and parcel tracking',
  publishedOn: '2026-10-06',
  reason:
    "The Shippo adapter (`libs/plugins/shipping/src/lib/providers/shippo.ts`), Platform Accounts: one managed account per workspace, every call the platform's token with the managed account's id. Reached from the shipping plugin's checkout quoter and its console label, address and carrier-account routes, only while `SHIPPO_API_TOKEN` and `SHIPPING_TOKEN_KEY` are set.",
  dataReceived: DATA_RECEIVED,
}

export const EASYPOST_SUBPROCESSOR: PluginSubprocessorDeclaration = {
  host: new URL(EASYPOST_API_BASE).host,
  entity: 'Simpler Postage, Inc. (EasyPost)',
  region: 'United States',
  purpose:
    'Shipping for merchants who sell physical goods: live carrier rates at checkout, shipping labels, address validation and parcel tracking',
  publishedOn: '2026-10-06',
  reason:
    "The EasyPost adapter (`libs/plugins/shipping/src/lib/providers/easypost.ts`), Child Users: one child user per workspace, acting with its own key. The alternative to Shippo, reached only while `EASYPOST_API_KEY` and `SHIPPING_TOKEN_KEY` are set and Shippo's token is not (or `SHIPPING_PROVIDER` names EasyPost).",
  dataReceived: DATA_RECEIVED,
}

export function shippingSubprocessors(): PluginSubprocessorDeclaration[] {
  return [SHIPPO_SUBPROCESSOR, EASYPOST_SUBPROCESSOR]
}
