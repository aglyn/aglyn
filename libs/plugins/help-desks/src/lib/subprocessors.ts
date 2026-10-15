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
 * Gorgias, Re:amaze, Kustomer, Gladly and Richpanel (AGL-3824): each the
 * merchant's OWN help desk account, connected by the merchant with their
 * own credential, so each is a destination the customer chose rather than a
 * recipient of Aglyn's. Nothing reaches any of them until a site connects
 * one, and then only that site's buyers, their orders and — where the
 * merchant switched it on — its contact form messages.
 */

const BUYER_DATA =
  "For each person who has ordered at the site: email address, name, and phone number when it is in E.164 form. For each of their paid orders: number, date, status, total, refunded amount, currency, line items (product id, name, SKU, quantity and price) and a link to the order in the console. No payment details, and no person who never ordered. Also the merchant's own API key or token, which authenticates each call."

const TICKET_DATA =
  "Where the merchant switched on sending contact form messages: each message submitted through the site's forms, with every answer given, the sender's email address and name, the form's name and the page it was sent from."

const destination = (host: string, desk: string, file: string, how: string): PluginEgressHostDeclaration => ({
  host,
  disposition: 'not-a-subprocessor',
  reason: `Customer-chosen destination. The ${desk} account a site's owner or admin connects on the site's Setup → Integrations page${how}, reached only from the help-desks plugin's adapter (\`libs/plugins/help-desks/src/lib/providers/${file}.ts\`) with the merchant's own credential, to keep the site's buyers and their orders in front of the merchant's support agents and to open contact form messages as tickets.`,
  dataReceived: `${BUYER_DATA} ${TICKET_DATA}`,
})

export const HELP_DESKS_HOSTS: PluginEgressHostDeclaration[] = [
  destination('gorgias.com', 'Gorgias', 'gorgias', ", at the account's own subdomain (`{domain}.gorgias.com`)"),
  destination('reamaze.io', 'Re:amaze', 'reamaze', ", at the brand's own subdomain (`{brand}.reamaze.io`)"),
  destination('api.kustomerapp.com', 'Kustomer', 'kustomer', ''),
  destination('gladly.com', 'Gladly', 'gladly', ", at the organization's own subdomain (`{organization}.gladly.com`)"),
  destination('api.richpanel.com', 'Richpanel', 'richpanel', ''),
]

/** The plugin's `subprocessors` entry: no recipient of Aglyn's own, only the merchant's chosen destinations. */
export function helpDesksSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: HELP_DESKS_HOSTS }
}
