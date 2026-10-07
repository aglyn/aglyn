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
 * The hosts this plugin's code names (AGL-3637), declared here rather than
 * in the console's subprocessor inventory. Named under `subprocessors` in
 * `plugins.config.json`; the manifest generator calls
 * {@link salesChannelsSubprocessors} and the inventory folds the answer in.
 *
 * The product feeds themselves are FETCHED by the channels from the store's
 * own domain: nothing of ours sends them, so they name no host. What does
 * send data is the env-gated API connection, which pushes a store's products
 * into the merchant's OWN Google Merchant Center account or Meta catalog,
 * from the merchant's own Google or Facebook login, at the merchant's
 * direction. Aglyn selects neither destination for anyone, so each is
 * `not-a-subprocessor` on the customer-chosen-destination ground, the same
 * footing as the accounting plugin's ledgers. ⚑ A classification for legal
 * to confirm before a deployment configures either provider for customers:
 * if it is not accepted, Google LLC (Merchant API) and Meta Platforms, Inc.
 * (Graph API) become published subprocessors with an Annex row each.
 *
 * Google's consent page (`accounts.google.com`) is declared by the Sequences
 * plugin as `no-request`, which is true of this plugin's use too: the
 * admin's own browser opens it.
 *
 * Each host is read off the constant the adapter calls, so a moved endpoint
 * moves its declaration with it.
 */

import type {
  PluginEgressHostDeclaration,
  PluginEgressUseDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { SALES_CHANNELS } from './model/channels'
import { GOOGLE_ENDPOINTS } from './server/connect/google-merchant'
import { META_HOSTS } from './server/connect/meta-catalog'

const host = (url: string) => new URL(url).host

const PRODUCT_DATA =
  "The store's own listed products as the channel's feed states them: per product configuration, its id, title, description, page link, photo links, price and sale price, availability, stock quantity (Meta), condition, brand, GTIN, MPN, categories, variant group, color, size, weight and packed size, and the store's shipping price per country. Also the deployment's OAuth client credentials and the grant's own tokens. No order, no buyer and nothing about a site visitor."

/** Google's Merchant API and Meta's Graph API: where the products go. */
export const SALES_CHANNELS_API_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: host(GOOGLE_ENDPOINTS.merchantApi),
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. The Merchant API of the merchant's own Google Merchant Center account, which a site admin connects on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/server/connect/google-merchant.ts`): listing the Merchant Center accounts the grant reaches, creating one API data source in the chosen account, and inserting and deleting the store's product inputs in it when a member syncs.",
    dataReceived: PRODUCT_DATA,
  },
  {
    host: host(META_HOSTS.graph),
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. The Graph API of the merchant's own Meta business, which a site admin connects on the store's Sales channels card (`libs/plugins/sales-channels/src/lib/server/connect/meta-catalog.ts`): the code exchange and long-lived token exchange at connect, listing the businesses and product catalogs the grant reaches, writing the store's products into the chosen catalog through its `items_batch` edge when a member syncs, and revoking the app's permissions on disconnect.",
    dataReceived: PRODUCT_DATA,
  },
]

/** Hosts declared elsewhere that the connections reach as well. */
export const SALES_CHANNELS_USES: PluginEgressUseDeclaration[] = [
  {
    host: host(GOOGLE_ENDPOINTS.token),
    reason:
      "Since AGL-3637 also the Sales channels OAuth token endpoint for a merchant's own Merchant Center grant — the code exchange at connect, the access-token refresh before each sync, and the revocation on disconnect (`google-merchant.ts`) — the merchant's own account at the merchant's own provider, the same footing as `merchantapi.googleapis.com`.",
    dataReceived:
      "For Sales channels: the deployment's OAuth client credentials and, for the merchant's own grant, the authorization code, refresh token and access token Google itself issued — credentials, never product data.",
  },
  {
    host: host(META_HOSTS.dialog),
    reason:
      "Since AGL-3637 also Facebook Login's consent dialog for a merchant's catalog grant, built by `metaAuthorizeUrl` and opened by the admin's own browser. No server of ours requests it.",
    dataReceived:
      'Nothing from our servers. The browser carries the app id, the `catalog_management` and `business_management` scopes, the redirect address and a signed state.',
  },
]

/**
 * The channels' own pages the card links a merchant to — where to set up the
 * channel, and its product data rules — read off each channel's definition.
 */
export const SALES_CHANNELS_LINK_HOSTS: PluginEgressHostDeclaration[] = [
  ...new Set(SALES_CHANNELS.flatMap((channel) => [host(channel.setupUrl), host(channel.specUrl)])),
].map((linked) => ({
  host: linked,
  disposition: 'no-request',
  reason: `A link on the store's Sales channels card (\`libs/plugins/sales-channels/src/lib/model/channels.ts\`): a channel's own page where the merchant sets up its product feed, or its product data specification. No server of ours requests it.`,
  dataReceived: 'Nothing until a member clicks. A link is rendered; clicking it opens the channel in the member’s own browser.',
}))

/** The plugin's `subprocessors` entry: no recipient of its own, its hosts and its uses. */
export function salesChannelsSubprocessors(): PluginSubprocessorsAnswer {
  return {
    subprocessors: [],
    hosts: [...SALES_CHANNELS_API_HOSTS, ...SALES_CHANNELS_LINK_HOSTS],
    uses: SALES_CHANNELS_USES,
  }
}
