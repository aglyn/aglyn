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
 * Meta, TikTok and Pinterest (AGL-3694): each the site owner's OWN ad
 * account, connected by the owner with their own access token, so each is a
 * destination the customer chose rather than a recipient of Aglyn's. Nothing
 * reaches any of them until a site connects one, and then only conversions of
 * that site's visitors who allowed advertising.
 */

const EVENT_DATA =
  "For a site visitor who allowed advertising on that site, and only then: a purchase (its order id, value excluding tax, currency, and each item's product id, name, quantity and price) or a submitted form (no field values), each with the event's id and time and the page it happened on. The visitor's details are sent as SHA-256 hashes of the normalized values — email address, phone number, first and last name, city, state, postal code and country, whichever the order or form holds — together, unhashed as each vendor requires, the visitor's IP address and browser user agent and the vendor's own first-party browser ids (Meta's _fbp and _fbc, TikTok's _ttp and ttclid, Pinterest's _epik). No payment details. Also the merchant's own access token, which authenticates each call."

const reason = (platform: string, api: string, file: string) =>
  `Customer-chosen destination. The ${api} of the ${platform} ad account a site's owner or admin connects on the site's setup page, reached only from the ad-conversions plugin's adapter (\`libs/plugins/ad-conversions/src/lib/providers/${file}.ts\`) with the merchant's own access token, to report the site's purchases and leads server-side alongside the site's own ${platform} browser tag.`

export const AD_CONVERSIONS_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: 'business-api.tiktok.com',
    disposition: 'not-a-subprocessor',
    reason: reason('TikTok', 'Events API', 'tiktok'),
    dataReceived: EVENT_DATA,
  },
  {
    host: 'api.pinterest.com',
    disposition: 'not-a-subprocessor',
    reason: reason('Pinterest', 'Conversions API', 'pinterest'),
    dataReceived: EVENT_DATA,
  },
]

/** `graph.facebook.com` is declared by the sales-channels plugin; this plugin reaches it too. */
export const AD_CONVERSIONS_USES: PluginEgressUseDeclaration[] = [
  {
    host: 'graph.facebook.com',
    reason: reason('Meta', 'Conversions API', 'meta'),
    dataReceived: EVENT_DATA,
  },
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destinations. */
export function adConversionsSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: AD_CONVERSIONS_HOSTS, uses: AD_CONVERSIONS_USES }
}
