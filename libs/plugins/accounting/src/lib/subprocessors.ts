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
 * The hosts this plugin's code names (AGL-3614), declared here rather than
 * in the console's subprocessor inventory. Named under `subprocessors` in
 * `plugins.config.json`; the manifest generator calls
 * {@link accountingSubprocessors} and the inventory folds the answer in.
 *
 * QuickBooks Online and Xero are the CUSTOMER's own accounting systems. A
 * business connects its own ledger, from its own Intuit or Xero login, and
 * the sync writes that business's own sales into it at its direction — Aglyn
 * selects no ledger vendor, any more than it selects the mail provider a rep
 * connects for Sequences. So each is `not-a-subprocessor`, on the
 * customer-chosen-destination ground. ⚑ A classification for legal to
 * confirm before `release_accounting` is switched on for customers: if it
 * is not accepted, Intuit and Xero become published subprocessors with an
 * Annex row each.
 *
 * CODAT is different (AGL-3636): Aglyn chooses it and holds the account —
 * one API key for the deployment, one Codat company per workspace — and the
 * ledger data passes through it on the way to the business's own software.
 * So Codat is a published SUBPROCESSOR. ⚑ Its row has to be on the published
 * Subprocessors page before `CODAT_API_KEY` is set in production; with the
 * key unset no request leaves for Codat. The accounting systems Codat
 * reaches are the customer's own, as above, and are not declared here:
 * Aglyn's code names none of their hosts.
 *
 * Each host is read off the constant the adapter calls, so a moved endpoint
 * moves its declaration with it.
 */

import type {
  PluginEgressHostDeclaration,
  PluginEgressUseDeclaration,
  PluginSubprocessorDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { STRIPE_API_BASE } from './server/payouts'
import { CODAT_ENDPOINTS } from './server/providers/codat'
import { QUICKBOOKS_ENDPOINTS } from './server/providers/quickbooks'
import { XERO_ENDPOINTS } from './server/providers/xero'

const host = (url: string) => new URL(url).host

const LEDGER_DATA =
  "The workspace's own sales as ledger documents: per order, its number, date, line descriptions, quantities and prices, shipping, discount, sales tax and total, and the buyer's name and email address as the customer or contact it is filed under; per refund, its amount and the order it reverses; per sale, the platform's fee; per Stripe payout, its amount and date. In daily-summary mode, one journal of the day's totals instead of the per-order documents. Also the deployment's OAuth client credentials and the grant's own tokens. Nothing about a site visitor who did not buy, and no card data."

/** The QuickBooks Online Accounting API, sandbox and production. */
export const ACCOUNTING_QUICKBOOKS_API_HOSTS: PluginEgressHostDeclaration[] = [
  QUICKBOOKS_ENDPOINTS.productionApi,
  QUICKBOOKS_ENDPOINTS.sandboxApi,
].map((url) => ({
  host: host(url),
  disposition: 'not-a-subprocessor',
  reason:
    "Customer-chosen destination. The QuickBooks Online Accounting API of the business's own QuickBooks company, which an owner or admin connects on the Accounting page (`libs/plugins/accounting/src/lib/server/providers/quickbooks.ts`): reading its chart of accounts and tax codes for the mapping, and writing the workspace's sales receipts, refund receipts, fee expenses, payout transfers or daily journals into it.",
  dataReceived: LEDGER_DATA,
}))

/** Intuit's OAuth token and revocation endpoints, and the consent page the browser opens. */
export const ACCOUNTING_INTUIT_OAUTH_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: host(QUICKBOOKS_ENDPOINTS.token),
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. Intuit's OAuth token endpoint for the business's own QuickBooks grant: the code exchange at connect and each access-token refresh (`quickbooks.ts`).",
    dataReceived:
      "The deployment's OAuth client credentials, and the authorization code and refresh token Intuit itself issued — credentials, never ledger content.",
  },
  {
    host: host(QUICKBOOKS_ENDPOINTS.revoke),
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. Intuit's token revocation endpoint, called when the workspace disconnects QuickBooks or is erased (`quickbooks.ts`).",
    dataReceived: "The deployment's OAuth client credentials and the grant's refresh token, to revoke it.",
  },
  {
    host: host(QUICKBOOKS_ENDPOINTS.authorize),
    disposition: 'no-request',
    reason:
      "Intuit's consent page, built by the QuickBooks adapter's `authorizeUrl` and opened by the member's own browser to grant access to their own company. No server of ours requests it.",
    dataReceived: 'Nothing from our servers. The browser carries the OAuth client id, the scope, the redirect address and a signed state.',
  },
]

/** Xero's API, identity endpoints and consent page. */
export const ACCOUNTING_XERO_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: host(XERO_ENDPOINTS.api),
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. The Xero Accounting API of the business's own Xero organization, which an owner or admin connects on the Accounting page (`libs/plugins/accounting/src/lib/server/providers/xero.ts`): listing the organizations the grant reaches, reading its chart of accounts and tax rates, and writing the workspace's invoices and payments, credit notes, fee bank transactions, payout bank transfers or daily manual journals into it; and deleting the connection on disconnect.",
    dataReceived: LEDGER_DATA,
  },
  {
    host: host(XERO_ENDPOINTS.token),
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. Xero's identity endpoints for the business's own grant: the code exchange, each refresh, and the revocation on disconnect or erasure (`xero.ts`).",
    dataReceived:
      "The deployment's OAuth client credentials, and the authorization code and refresh token Xero itself issued — credentials, never ledger content.",
  },
  {
    host: host(XERO_ENDPOINTS.authorize),
    disposition: 'no-request',
    reason:
      "Xero's consent page, built by the Xero adapter's `authorizeUrl` and opened by the member's own browser to grant access to their own organization. No server of ours requests it.",
    dataReceived: 'Nothing from our servers. The browser carries the OAuth client id, the scopes, the redirect address and a signed state.',
  },
]

/** Codat's API: the aggregator Aglyn holds the account with. */
export const CODAT_SUBPROCESSOR: PluginSubprocessorDeclaration = {
  host: host(CODAT_ENDPOINTS.api),
  entity: 'Codat Limited',
  region: 'United Kingdom',
  purpose:
    "Connecting a merchant's accounting software the platform does not connect directly (such as QuickBooks Desktop, NetSuite, Sage, FreshBooks, Zoho Books and Wave) and posting their sales, refunds, fees and payouts to it",
  publishedOn: '2026-10-07',
  reason:
    "The Codat adapter (`libs/plugins/accounting/src/lib/server/providers/codat.ts`): one Codat company per workspace, tagged with the workspace's id, made when a member starts a connect; reads of the linked ledger's company details, chart of accounts and tax rates for the mapping; and writes of the workspace's direct incomes, direct costs, transfers or journals, and one walk-in customer and one fee supplier, through Codat into the linked software. The company is deleted on disconnect or erasure. Reached only while `CODAT_API_KEY` and `ACCOUNTING_TOKEN_KEY` are set.",
  dataReceived:
    "The workspace's name and id, as its Codat company. The workspace's own sales as ledger documents: per order, its number, date, line descriptions, quantities and prices, shipping, discount, sales tax and total, with the buyer's name and email address in the document's note; per refund, its amount and the order it reverses; per sale, the platform's fee; per Stripe payout, its amount and date. In daily-summary mode, one journal of the day's totals instead of the per-order documents. The platform's own API key authenticates; Codat holds the credentials to the merchant's software. Nothing about a site visitor who did not buy, and no card data.",
}

/** Codat Link, which the member's browser opens to choose and sign in to their software. */
export const ACCOUNTING_CODAT_LINK_HOST: PluginEgressHostDeclaration = {
  host: host(CODAT_ENDPOINTS.link),
  disposition: 'no-request',
  reason:
    "Codat Link, whose address the Codat adapter's `authorizeUrl` answers and the member's own browser opens to pick their accounting software and sign in to it. No server of ours requests it.",
  dataReceived:
    "Nothing from our servers. The browser carries the Codat company's id and a signed state; what the member types there goes to Codat.",
}

/** Stripe, already declared by the inventory: this plugin reads the merchant's payouts. */
export const ACCOUNTING_STRIPE_USE: PluginEgressUseDeclaration = {
  host: host(STRIPE_API_BASE),
  reason:
    "Since AGL-3614 also the accounting sync's read of the merchant's own paid payouts (`GET /v1/payouts` on their connected account, `libs/plugins/accounting/src/lib/server/payouts.ts`), so each payout can be posted to their books as a transfer.",
  dataReceived: "The platform key and the connected account's id; Stripe answers with the account's payouts. Nothing is written.",
}

/** The plugin's `subprocessors` entry: Codat, its ledger hosts and one use. */
export function accountingSubprocessors(): PluginSubprocessorsAnswer {
  return {
    subprocessors: [CODAT_SUBPROCESSOR],
    hosts: [
      ...ACCOUNTING_QUICKBOOKS_API_HOSTS,
      ...ACCOUNTING_INTUIT_OAUTH_HOSTS,
      ...ACCOUNTING_XERO_HOSTS,
      ACCOUNTING_CODAT_LINK_HOST,
    ],
    uses: [ACCOUNTING_STRIPE_USE],
  }
}
