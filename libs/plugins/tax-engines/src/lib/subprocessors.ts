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

/**
 * Avalara and TaxJar, the outside tax engines a merchant may connect
 * (AGL-3631).
 *
 * Nothing reaches either one until a merchant connects their OWN account with
 * their own credentials (and the deployment sets `TAX_ENGINES_TOKEN_KEY`, the
 * key those credentials are sealed under). Aglyn holds no account with either
 * vendor; the data is sent to the merchant's account, at the merchant's
 * instruction, from the tax-engines plugin's adapters. The sandbox hosts are
 * the same vendors' test environments, reached when a merchant connects a
 * sandbox account.
 */
const AVALARA_DATA =
  'For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the buyer’s email address as the customer code, the order id, each line’s product id or SKU, name, quantity, amount and tax code, the shipping amount, the tax charged, and an exemption type and certificate number where the merchant recorded one for the buyer. Refunds send the amount refunded. The merchant’s AvaTax account id and license key authenticate each call. No payment details are sent.'

const TAXJAR_DATA =
  'For each quote and each recorded sale: the store’s ship-from address, the buyer’s shipping address (or the store’s own for an in-person sale), the order id, each line’s product id or SKU, name, quantity, unit price, discount and tax code, the shipping amount, the tax charged, and an exemption type where the merchant recorded one for the buyer. Refunds send the amounts refunded. The merchant’s TaxJar API token authenticates each call. No email address or payment details are sent.'

export function taxEnginesSubprocessors(): PluginSubprocessorDeclaration[] {
  return [
    {
      host: 'rest.avatax.com',
      entity: 'Avalara, Inc.',
      region: 'United States',
      purpose:
        'Sales tax calculation and recording, in a merchant’s own Avalara account when the merchant connects one',
      publishedOn: '2026-10-07',
      reason:
        'AvaTax REST v2, reached only from the tax-engines plugin’s adapter (`libs/plugins/tax-engines/src/lib/providers/avalara.ts`) with the merchant’s own credentials: a quote at checkout and the POS, a committed sale when an order is paid, a refund or void when it is refunded or canceled, and address checks.',
      dataReceived: AVALARA_DATA,
    },
    {
      host: 'sandbox-rest.avatax.com',
      entity: 'Avalara, Inc.',
      region: 'United States',
      purpose: 'The same, for a merchant who connects an AvaTax sandbox account to test',
      publishedOn: '2026-10-07',
      reason: 'AvaTax’s sandbox environment, reached by the same adapter when the connection names it.',
      dataReceived: AVALARA_DATA,
    },
    {
      host: 'api.taxjar.com',
      entity: 'TaxJar (a Stripe company)',
      region: 'United States',
      purpose:
        'Sales tax calculation and recording, in a merchant’s own TaxJar account when the merchant connects one',
      publishedOn: '2026-10-07',
      reason:
        'TaxJar API v2, reached only from the tax-engines plugin’s adapter (`libs/plugins/tax-engines/src/lib/providers/taxjar.ts`) with the merchant’s own API token: a quote at checkout and the POS, an order transaction when an order is paid, a refund transaction or deletion when it is refunded or canceled, and address checks.',
      dataReceived: TAXJAR_DATA,
    },
    {
      host: 'api.sandbox.taxjar.com',
      entity: 'TaxJar (a Stripe company)',
      region: 'United States',
      purpose: 'The same, for a merchant who connects a TaxJar sandbox token to test',
      publishedOn: '2026-10-07',
      reason: 'TaxJar’s sandbox environment, reached by the same adapter when the connection names it.',
      dataReceived: TAXJAR_DATA,
    },
  ]
}
