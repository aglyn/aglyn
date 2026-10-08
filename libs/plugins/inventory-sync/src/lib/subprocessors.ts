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
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { BRIGHTPEARL_OAUTH_BASE } from './providers/brightpearl'
import { CIN7_CORE_API_BASE } from './providers/cin7-core'
import { INFLOW_API_BASE } from './providers/inflow'

/**
 * Cin7 Core, inFlow and Brightpearl (AGL-3642): each the merchant's OWN
 * account, connected with the merchant's own API keys (Cin7 Core, inFlow) or
 * by the merchant's own consent to this deployment's app (Brightpearl), so
 * each is a destination the customer chose rather than a recipient of
 * Aglyn's. Brightpearl's app registration is the deployment's, as Intuit's
 * and Xero's are for accounting, but the data goes into the merchant's own
 * Brightpearl account and no account of Aglyn's holds any. Nothing reaches
 * any of them until a site connects one, and then only that site's orders,
 * products and counts.
 *
 * Each host is read off the constant the adapter calls, so a moved endpoint
 * moves its declaration with it. Brightpearl's API is reached at the
 * account's own datacenter, which its grant names at connect time; the code
 * builds that address and names no datacenter host of its own.
 */

const host = (url: string) => new URL(url).host

const SYNC_DATA =
  "For each paid order the store sends to the system: its number and our reference, its date, the buyer's name and email address, the shipping address (name, street, city, state, postal code, country and phone), its items (SKU, name, quantity and unit price), shipping, discount, tax and total, under the customer the merchant chose. For stock kept in step from the store: each SKU's count adjustment at the merchant's chosen location. For products made in the system from the store: SKU, name, description, price, weight and barcode. Read back: the system's products (id, SKU, name, description, price, weight, barcode, status), its count of each SKU, its locations and customers, and the orders it recorded under our references. Also the merchant's own API key or access token, which authenticates each call. No payment details are sent."

export const CIN7_CORE_HOST: PluginEgressHostDeclaration = {
  host: host(CIN7_CORE_API_BASE),
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. The Cin7 Core (formerly DEAR Inventory) API of the merchant's own Cin7 Core account, reached with the Account ID and application key the merchant made there and pasted into the store's settings (`libs/plugins/inventory-sync/src/lib/providers/cin7-core.ts`), to read its stock and products and to record the merchant's paid orders, count adjustments and products in it.",
  dataReceived: SYNC_DATA,
}

export const INFLOW_HOST: PluginEgressHostDeclaration = {
  host: host(INFLOW_API_BASE),
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. The inFlow Cloud API of the merchant's own inFlow Inventory account, reached with the company id and API key the merchant made there and pasted into the store's settings (`libs/plugins/inventory-sync/src/lib/providers/inflow.ts`), to read its stock and products and to record the merchant's paid orders, count adjustments and products in it.",
  dataReceived: SYNC_DATA,
}

export const BRIGHTPEARL_OAUTH_HOST: PluginEgressHostDeclaration = {
  host: host(BRIGHTPEARL_OAUTH_BASE),
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. Brightpearl's OAuth host, for a deployment that registered a Brightpearl app: its consent page, which the merchant's own browser opens to grant access to their own Brightpearl account, and its token endpoint, for the code exchange and each refresh (`libs/plugins/inventory-sync/src/lib/server/oauth.ts`). The grant names the account's own datacenter (a `brightpearl.com` or `brightpearlconnect.com` host), where every API call of `libs/plugins/inventory-sync/src/lib/providers/brightpearl.ts` then goes, with the same data as Cin7 Core and inFlow receive.",
  dataReceived:
    "At this host: the deployment's app reference (and client secret, for an app with confidential OAuth), the merchant's account code, and the authorization code or refresh token Brightpearl itself issued — credentials, never orders. At the account's datacenter: " +
    SYNC_DATA,
}

export const INVENTORY_SYNC_HOSTS: PluginEgressHostDeclaration[] = [CIN7_CORE_HOST, INFLOW_HOST, BRIGHTPEARL_OAUTH_HOST]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destinations. */
export function inventorySyncSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: INVENTORY_SYNC_HOSTS }
}
