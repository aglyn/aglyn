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
  PluginEgressUseDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

/**
 * Amazon, eBay, Etsy, TikTok Shop, Walmart and Faire (AGL-3638): each the
 * merchant's OWN seller account, connected by the merchant's own consent
 * through the deployment's app, so each is a destination the customer chose
 * rather than a recipient of Aglyn's — the shape the fulfillment networks
 * and Mailchimp already take. Nothing reaches any of them until a site
 * connects one, and then only that site's listings, and the shipments of
 * the orders that marketplace itself sold.
 *
 * Amazon's Selling Partner API, its token endpoint and its consent pages are
 * declared by the fulfillment-networks plugin, which reaches the same hosts
 * for the same kind of grant; this plugin adds its USE of each.
 */

const LISTING_AND_ORDER_DATA =
  "For each product the merchant's store lists there: its SKU, title, description, photos' addresses, price in the store's currency, units in stock, and the brand, GTIN, MPN, condition, weight and size the merchant entered. For each order that marketplace itself sold and the merchant ships from the store: the marketplace's own order and line ids, the carrier, the tracking number and the ship date. Read back: that marketplace's orders for the merchant's account (its buyer's name and shipping address, the items, the amounts and the marketplace's fees), and its listings' ids. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent, and no customer of the store who did not buy on that marketplace is ever sent."

const TOKEN_DATA =
  "The deployment's OAuth client credentials, and the authorization code or refresh token the marketplace itself issued — credentials, never orders or listings."

const file = (name: string) => `\`libs/plugins/marketplaces/src/lib/providers/${name}.ts\``

const api = (host: string, marketplace: string, adapter: string, sandbox = false): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. The ${marketplace} ${sandbox ? 'sandbox ' : ''}API of the seller account a site's admin connects in the store's settings, reached only from ${file(adapter)} with the merchant's own grant, to keep its listings in step with the store and bring its orders in.${sandbox ? ' Used only by a deployment pointed at the sandbox, where nothing real sells.' : ''}`,
  dataReceived: LISTING_AND_ORDER_DATA,
})

const token = (host: string, marketplace: string, adapter: string, consentToo: boolean): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. ${marketplace}'s OAuth token endpoint, for a deployment that registered a ${marketplace} app: the code exchange when a merchant connects their own account, and each refresh (${file(adapter)}).${consentToo ? " Its consent page is on the same host and is opened by the merchant's browser." : ''}`,
  dataReceived: TOKEN_DATA,
})

const consent = (host: string, marketplace: string, adapter: string): PluginEgressHostDeclaration => ({
  host,
  disposition: 'no-request',
  reason: `${marketplace}'s app consent page, built by the authorize address in ${file(adapter)} and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.`,
  dataReceived: 'Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.',
})

const amazonUse = (host: string, what: 'api' | 'token' | 'consent'): PluginEgressUseDeclaration => ({
  host,
  reason:
    what === 'api'
      ? `Also the marketplaces plugin (${file('amazon')}): the Listings Items, Orders, Sellers and Finances APIs of the seller account a site's admin connects, with the merchant's own grant, to keep its listings' quantity and price in step with the store, bring its orders in, confirm their shipments and read the fees Amazon charged.`
      : what === 'token'
        ? `Also the marketplaces plugin (${file('amazon')}): the code exchange when a merchant connects their seller account for listings and orders, and each refresh.`
        : `Also the marketplaces plugin (${file('amazon')}): the consent page a merchant's browser opens to connect their seller account for listings and orders. No server of ours requests it.`,
  dataReceived: what === 'api' ? LISTING_AND_ORDER_DATA : what === 'token' ? TOKEN_DATA : 'Nothing from our servers.',
})

export const MARKETPLACES_HOSTS: PluginEgressHostDeclaration[] = [
  // eBay
  consent('auth.ebay.com', 'eBay', 'ebay'),
  consent('auth.sandbox.ebay.com', 'eBay sandbox', 'ebay'),
  api('api.ebay.com', 'eBay', 'ebay'),
  api('api.sandbox.ebay.com', 'eBay', 'ebay', true),
  api('apiz.ebay.com', 'eBay identity', 'ebay'),
  api('apiz.sandbox.ebay.com', 'eBay identity', 'ebay', true),
  // Etsy: the token endpoint is on the API host.
  consent('www.etsy.com', 'Etsy', 'etsy'),
  api('api.etsy.com', 'Etsy', 'etsy'),
  // TikTok Shop
  consent('services.us.tiktokshop.com', 'TikTok Shop (US)', 'tiktok'),
  consent('services.tiktokshop.com', 'TikTok Shop', 'tiktok'),
  token('auth.tiktok-shops.com', 'TikTok Shop', 'tiktok', false),
  api('open-api.tiktokglobalshop.com', 'TikTok Shop', 'tiktok'),
  // Walmart: the token endpoint is on the API host.
  consent('login.account.wal-mart.com', 'Walmart', 'walmart'),
  api('marketplace.walmartapis.com', 'Walmart Marketplace', 'walmart'),
  api('sandbox.walmartapis.com', 'Walmart Marketplace', 'walmart', true),
  // Faire: the token endpoint is on the API host.
  consent('faire.com', 'Faire', 'faire'),
  api('www.faire.com', 'Faire', 'faire'),
]

export const MARKETPLACES_USES: PluginEgressUseDeclaration[] = [
  ...['na', 'eu', 'fe'].flatMap((region) => [
    amazonUse(`sellingpartnerapi-${region}.amazon.com`, 'api'),
    amazonUse(`sandbox.sellingpartnerapi-${region}.amazon.com`, 'api'),
  ]),
  amazonUse('api.amazon.com', 'token'),
  amazonUse('sellercentral.amazon.com', 'consent'),
  amazonUse('sellercentral-europe.amazon.com', 'consent'),
  amazonUse('sellercentral.amazon.co.jp', 'consent'),
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destinations. */
export function marketplacesSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: MARKETPLACES_HOSTS, uses: MARKETPLACES_USES }
}
