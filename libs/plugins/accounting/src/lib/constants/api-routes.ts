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
 * The accounting plugin's console API routes, as the dispatcher keys them.
 *
 * One table both halves import: the server registers each path and the
 * console page fetches it. Every path sits under the `accounting` prefix
 * `plugins.config.json` gives the plugin, so the console's
 * `/api/[...pluginApi]` dispatcher refuses a request while
 * `release_accounting` is off for the organization it names. Client-safe:
 * constants only.
 */
export const ACCOUNTING_API_ROUTES = {
  /** `GET` — proves the server bundle loaded; no auth, no data. */
  ping: 'accounting/ping',
  /**
   * `GET ?orgId` — which providers this deployment can connect, the
   * connection, its mapping and the sync counts.
   */
  status: 'accounting/status',
  /** `POST` — the provider's consent address for a new connect. */
  connect: 'accounting/connect',
  /**
   * `GET` — the provider's redirect back. It carries no bearer token: the
   * signed state names the organization and the member, and the route hands
   * the code to the Accounting page in a fragment rather than acting on it.
   */
  oauthCallback: 'accounting/oauth/callback',
  /** `POST` — finishes a connect with the member's own session. */
  connectComplete: 'accounting/connect/complete',
  /** `POST` — picks one of several Xero organizations a grant reaches. */
  selectTenant: 'accounting/connect/tenant',
  /** `GET ?orgId` — the ledger's accounts and tax codes, for the mapping form. */
  options: 'accounting/options',
  /** `POST` — saves the account and tax mapping, the sync mode and the start date. */
  settings: 'accounting/settings',
  /** `GET ?orgId&filter` — the sync log, newest first, or what needs attention. */
  log: 'accounting/log',
  /** `POST` — retries one sync item, or every item that needs attention. */
  retry: 'accounting/retry',
  /** `POST` — revokes the grant at the provider and removes the connection. */
  disconnect: 'accounting/disconnect',
} as const

export type AccountingApiRoute = (typeof ACCOUNTING_API_ROUTES)[keyof typeof ACCOUNTING_API_ROUTES]
