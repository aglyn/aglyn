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

/**
 * ShipBob and Amazon (AGL-3634): each the merchant's OWN account, connected
 * by the merchant's own consent, so each is a destination the customer chose
 * rather than a recipient of Aglyn's. Nothing reaches either until a site
 * connects one, and then only that site's orders and stock.
 */

const ORDER_DATA =
  "For each paid order the merchant's store sends to the network: the order's number and date, the shipping address (name, street, city, state, postal code, country, and the phone number and email address when the order has them), and the items the network ships (SKU, name, quantity and unit price). Read back: the network's order and shipment records for those orders (status, carrier, tracking number and link, which items each parcel held) and its count of each SKU it holds. Also the access token the merchant's grant issued, which authenticates each call. No payment details are sent."

const SHIPBOB_FILE = '`libs/plugins/fulfillment-networks/src/lib/providers/shipbob.ts`'
const AMAZON_FILE = '`libs/plugins/fulfillment-networks/src/lib/providers/amazon-mcf.ts`'
const OAUTH_FILE = '`libs/plugins/fulfillment-networks/src/lib/server/oauth.ts`'

const api = (host: string, network: string, file: string, sandbox: boolean): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. The ${network} ${sandbox ? 'sandbox ' : ''}API of the account a site's admin connects in the store's settings, reached only from ${file} with the merchant's own grant, to send the orders the merchant routes to it and read their shipments and stock back.${sandbox ? ' Used only by a deployment pointed at the sandbox, where nothing real ships.' : ''}`,
  dataReceived: ORDER_DATA,
})

const token = (host: string, network: string, consentToo: boolean): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. ${network}'s OAuth token endpoint, for a deployment that registered the ${network} app: the code exchange when a merchant connects their own account, and each refresh (${OAUTH_FILE}).${consentToo ? ' Its consent page is on the same host and is opened by the merchant\'s browser.' : ''}`,
  dataReceived:
    "The deployment's OAuth client credentials, and the authorization code or refresh token the network itself issued — credentials, never orders.",
})

const consentPage = (host: string): PluginEgressHostDeclaration => ({
  host,
  disposition: 'no-request',
  reason: `Amazon Seller Central's app consent page, built by \`networkAuthorizeUrl\` in ${OAUTH_FILE} and opened by the merchant's own browser to connect their own seller account. No server of ours requests it.`,
  dataReceived: 'Nothing from our servers. The browser carries the app id, the redirect address and a single-use state.',
})

export const FULFILLMENT_NETWORKS_HOSTS: PluginEgressHostDeclaration[] = [
  api('api.shipbob.com', 'ShipBob', SHIPBOB_FILE, false),
  api('sandbox-api.shipbob.com', 'ShipBob', SHIPBOB_FILE, true),
  token('auth.shipbob.com', 'ShipBob', true),
  token('authstage.shipbob.com', 'ShipBob sandbox', true),
  api('sellingpartnerapi-na.amazon.com', 'Amazon Selling Partner (North America)', AMAZON_FILE, false),
  api('sellingpartnerapi-eu.amazon.com', 'Amazon Selling Partner (Europe)', AMAZON_FILE, false),
  api('sellingpartnerapi-fe.amazon.com', 'Amazon Selling Partner (Far East)', AMAZON_FILE, false),
  api('sandbox.sellingpartnerapi-na.amazon.com', 'Amazon Selling Partner (North America)', AMAZON_FILE, true),
  api('sandbox.sellingpartnerapi-eu.amazon.com', 'Amazon Selling Partner (Europe)', AMAZON_FILE, true),
  api('sandbox.sellingpartnerapi-fe.amazon.com', 'Amazon Selling Partner (Far East)', AMAZON_FILE, true),
  token('api.amazon.com', 'Login with Amazon', false),
  consentPage('sellercentral.amazon.com'),
  consentPage('sellercentral-europe.amazon.com'),
  consentPage('sellercentral.amazon.co.jp'),
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destinations. */
export function fulfillmentNetworksSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: FULFILLMENT_NETWORKS_HOSTS }
}
