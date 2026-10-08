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
  PluginSubprocessorDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { PAYPAL_API_BASES, PAYPAL_SDK_BASE } from './constants'

/**
 * PayPal's SUBPROCESSOR row (AGL-3630), named under `subprocessors` in
 * `plugins.config.json`; the manifest generator calls this and the
 * console's subprocessor inventory folds it in.
 *
 * ⚑ A SUBPROCESSOR, not a merchant-provided service. Aglyn's partner
 * account is what reaches PayPal: every call carries the platform's
 * credentials and partner attribution, the platform opens the order, takes
 * its fee and refunds — the merchant only grants permission in PayPal's own
 * onboarding. That is the shape of Stripe's row, not of the merchant-owned
 * shipping accounts. (PayPal is also an independent controller of its own
 * wallet for the buyer and the seller; that does not change what it does
 * for Aglyn.)
 *
 * ⚑ NOT YET PUBLISHED. `publishedOn` is the date the row must carry on
 * the Subprocessors page and in its Google Doc — Doc first — and both must
 * show it BEFORE any `PAYPAL_*` variable is set. Until those variables
 * are set, no request leaves for either host (`server/config.ts`).
 */
export const PAYPAL_SUBPROCESSOR: PluginSubprocessorDeclaration = {
  host: new URL(PAYPAL_API_BASES.live).host,
  entity: 'PayPal, Inc. (PayPal and Venmo)',
  region: 'United States',
  purpose:
    'Payments for merchants who accept PayPal and Venmo at their store’s checkout and register: taking the buyer’s payment, refunds, the platform fee, and onboarding the merchant’s PayPal account',
  publishedOn: '2026-10-07',
  reason:
    "The PayPal plugin (`libs/plugins/paypal`), PayPal's partner (multiparty) integration under Aglyn's partner account: Partner Referrals onboarding, Orders v2 with the platform fee, refunds and webhooks, every call with the platform's credentials. Reached only while every `PAYPAL_*` variable is set (`libs/plugins/paypal/src/lib/server/config.ts`); the buyer's browser loads PayPal's buttons from www.paypal.com on the plugin's own pay page and nowhere else.",
  dataReceived:
    'For each workspace that connects PayPal: a tracking id naming the workspace, and the merchant id PayPal returns. For each PayPal or Venmo checkout: the store’s name, each item’s name, SKU, quantity and price, the discount, tax and delivery options with their prices, the platform fee, the store’s order reference and the buyer’s return address on the store. PayPal returns the buyer’s name, email and delivery address, which Aglyn records on the order. For a refund: the payment, the amount and the note to the buyer. No card or bank details pass through Aglyn.',
}

export const PAYPAL_SDK_HOST = new URL(PAYPAL_SDK_BASE).host

/**
 * PayPal hosts the plugin's code NAMES without sending anything to them:
 * the OAuth scope identifiers PayPal grants under, and the sandbox page
 * PayPal's own onboarding link opens in the merchant's browser.
 */
export const PAYPAL_NAMED_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: 'uri.paypal.com',
    disposition: 'no-request',
    reason:
      'PayPal names the permissions a merchant grants as URIs on this host (`https://uri.paypal.com/services/payments/…`); the PayPal plugin reads them in a merchant integration and its specs spell them. They are identifiers, never fetched.',
    dataReceived: 'Nothing: no request is made to this host.',
  },
  {
    host: 'www.sandbox.paypal.com',
    disposition: 'no-request',
    reason:
      "PayPal's sandbox sign-up page, which PayPal's own onboarding link (`action_url`) opens in the merchant's browser in a sandbox deployment; the plugin's specs spell it. Aglyn's servers send it nothing.",
    dataReceived: 'Nothing from Aglyn: the merchant signs in to PayPal there themselves.',
  },
]

export function payPalSubprocessors(): PluginSubprocessorsAnswer {
  return {
    hosts: PAYPAL_NAMED_HOSTS,
    subprocessors: [
      PAYPAL_SUBPROCESSOR,
      { ...PAYPAL_SUBPROCESSOR, host: new URL(PAYPAL_API_BASES.sandbox).host },
      { ...PAYPAL_SUBPROCESSOR, host: PAYPAL_SDK_HOST },
    ],
  }
}
