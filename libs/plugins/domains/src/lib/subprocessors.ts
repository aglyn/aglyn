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

/**
 * Domains' SUBPROCESSORS (AGL-3962), named under `subprocessors` in
 * `plugins.config.json`. The registrar is Vercel, already a published
 * subprocessor for hosting and custom domains (`api.vercel.com` in the
 * console's inventory), so this declares a further USE of that host rather
 * than a second row: buying and renewing a name sends it the registrant's
 * contact, which the published row's data does not yet name.
 *
 * ⚑ Nothing reaches the registrar until `DOMAINS_REGISTRAR` names `vercel`.
 *
 * ONE-CLICK DNS (AGL-3963) adds no row, and that is the registry's own rule
 * rather than an omission. Its discovery and template check call the
 * Domain Connect API of the customer's OWN DNS provider, at an address the
 * customer's DNS publishes (`_domainconnect.<their domain>` TXT) and that
 * Aglyn's code never names. The registry's header
 * (`apps/console/constants/subprocessor-inventory.ts`, "A host an AUTHOR
 * typed") is explicit: a destination only the customer names has no literal
 * to declare and gets no entry, `not-a-subprocessor` is for a customer-chosen
 * host OUR CODE NAMES, and the sweep refuses a declaration whose host no
 * literal in the tree carries. What the calls send is the zone root alone —
 * `GET /v2/<root>/settings` and the template check — never an account, a
 * site or a person, and they go through `readConfiguredPublicUrl`, so only
 * a public https server is ever reached.
 */
export function domainsSubprocessors(): PluginSubprocessorsAnswer {
  return {
    uses: [
      {
        host: 'api.vercel.com',
        reason:
          'The domains plugin’s registrar driver (`libs/plugins/domains/src/lib/server/registrar-vercel.ts`): searching names and prices, registering a name a customer buys, renewing it, its auto-renew setting, ICANN’s registrant verification status, and the transfer code a customer asks for. Reached only while `DOMAINS_REGISTRAR` is `vercel`.',
        dataReceived:
          'The names a customer searches for; and, for a name they buy, the registrant’s first and last name, email, phone number, postal address and company name, which the registrar holds as the name’s ICANN registrant contact and redacts from public WHOIS. No card or bank details: the customer pays Aglyn, and Aglyn pays the registrar.',
      },
    ],
  }
}
