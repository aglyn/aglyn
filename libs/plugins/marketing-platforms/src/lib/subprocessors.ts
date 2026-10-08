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
 * Mailchimp, Klaviyo, Omnisend, Attentive (AGL-3639) and Constant Contact
 * (AGL-3696): each the merchant's
 * OWN account, connected by the merchant with their own key or their own
 * consent, so each is a destination the customer chose rather than a
 * recipient of Aglyn's. Nothing reaches any of them until a site connects
 * one, and then only that site's people and orders.
 */

const CONTACT_DATA =
  "The site's contacts: each person's email address, name, phone number when it is in E.164 form, the tags the site holds on them, their lifetime value and order count at the site, and whether the site may send them marketing (subscribed or unsubscribed); a person the site holds no usable consent for is not sent at all. Read back: the addresses whose subscription changed in the account since the last sync. Also the merchant's own API key or OAuth token, which authenticates each call."

const EVENT_DATA =
  "For a person the site may market to, the commerce events the merchant's flows run on: a started checkout (its items, value and resume link), and a paid, fulfilled, refunded or canceled order (its number, total, currency, line items with product id, SKU, name, quantity and price, and a shipment's carrier and tracking link). No payment details are sent."

const destination = (host: string, platform: string, file: string, events: boolean): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. The ${platform} account a site's owner or admin connects on the site's setup page, reached only from the marketing-platforms plugin's adapter (\`libs/plugins/marketing-platforms/src/lib/providers/${file}.ts\`) with the merchant's own credential${events ? ', to keep its contacts and consent in step with the site and to deliver order events' : ', to keep its contacts and consent in step with the site'}.`,
  dataReceived: events ? `${CONTACT_DATA} ${EVENT_DATA}` : CONTACT_DATA,
})

const oauth = (host: string, platform: string): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. ${platform}'s OAuth token endpoint, for a deployment that registered the ${platform} app: the code exchange when a merchant connects their own account, and each refresh (\`libs/plugins/marketing-platforms/src/lib/server/oauth.ts\`).`,
  dataReceived:
    "The deployment's OAuth client credentials, and the authorization code or refresh token the platform itself issued — credentials, never contacts.",
})

const consentPage = (host: string, platform: string): PluginEgressHostDeclaration => ({
  host,
  disposition: 'no-request',
  reason: `${platform}'s consent page, built by \`authorizeUrl\` in \`libs/plugins/marketing-platforms/src/lib/server/oauth.ts\` and opened by the merchant's own browser to connect their own account. No server of ours requests it.`,
  dataReceived: 'Nothing from our servers. The browser carries the OAuth client id, the scopes, the redirect address and a single-use state.',
})

export const MARKETING_PLATFORMS_HOSTS: PluginEgressHostDeclaration[] = [
  {
    ...destination('api.mailchimp.com', 'Mailchimp', 'mailchimp', false),
    reason:
      "Customer-chosen destination. The Mailchimp Marketing API of the account a site's owner or admin connects on the site's setup page, at the account's own data-center host (`{dc}.api.mailchimp.com`, named by the merchant's API key or by Mailchimp's metadata endpoint), reached only from `libs/plugins/marketing-platforms/src/lib/providers/mailchimp.ts` with the merchant's own credential, to keep an audience's members, merge fields, tags and subscription status in step with the site.",
  },
  destination('a.klaviyo.com', 'Klaviyo', 'klaviyo', true),
  destination('api.omnisend.com', 'Omnisend', 'omnisend', true),
  destination('api.attentivemobile.com', 'Attentive', 'attentive', true),
  // Constant Contact is reached with a grant the merchant gives Aglyn's
  // registered app on their own account; the app registration makes it no
  // recipient of Aglyn's — the data goes to, and stays in, the merchant's account.
  destination('api.cc.email', 'Constant Contact', 'constant-contact', false),
  {
    ...oauth('login.mailchimp.com', 'Mailchimp'),
    reason:
      "Customer-chosen destination. Mailchimp's OAuth token and metadata endpoints, for a deployment that registered the Mailchimp app: the code exchange when a merchant connects their own account, and the read of which data center it lives in (`libs/plugins/marketing-platforms/src/lib/server/oauth.ts`). Its consent page is on the same host and is opened by the merchant's browser.",
  },
  consentPage('www.klaviyo.com', 'Klaviyo'),
  consentPage('ui.attentivemobile.com', 'Attentive'),
  {
    ...oauth('authz.constantcontact.com', 'Constant Contact'),
    reason:
      "Customer-chosen destination. Constant Contact's OAuth token endpoint, for a deployment that registered the Constant Contact app: the code exchange when a merchant connects their own account, and each refresh, which rotates the refresh token (`libs/plugins/marketing-platforms/src/lib/server/oauth.ts`). Its consent page is on the same host and is opened by the merchant's browser.",
  },
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destinations. */
export function marketingPlatformsSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: MARKETING_PLATFORMS_HOSTS }
}
