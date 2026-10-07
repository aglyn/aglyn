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
 * Shipping's console API routes, as the dispatcher keys them (AGL-3612).
 * One table both halves import: the server registers each path and the
 * console fetches it. Every path sits under the `shipping` prefix
 * `plugins.config.json` gives this plugin, so the dispatcher gates it on the
 * plugin being on for the site before a handler runs. Client-safe.
 */
export const SHIPPING_API_ROUTES = {
  /** `GET ?hostId` — whether labels and carrier rates are offered for the site. */
  availability: 'shipping/availability',
  /** `GET ?hostId` — the site's settings, places and services; `POST` — save them. */
  settings: 'shipping/settings',
  /** `GET ?hostId` — the workspace's provider account and debit consent; `POST` — consent. */
  account: 'shipping/account',
  /** `GET ?hostId` — carrier accounts on the workspace's provider account. */
  carrierAccounts: 'shipping/carrier-accounts',
  /** `POST` — connect a carrier account of the merchant's own. */
  carrierAccountsConnect: 'shipping/carrier-accounts/connect',
  /** `POST` — switch a carrier account on or off. */
  carrierAccountsActive: 'shipping/carrier-accounts/active',
  /** `POST` — rates for a label on one order. */
  rates: 'shipping/rates',
  /** `GET ?hostId&recordId` — an order's labels. */
  labels: 'shipping/labels',
  /** `POST` — buy a quoted rate. */
  labelsBuy: 'shipping/labels/buy',
  /** `POST` — void a label. */
  labelsVoid: 'shipping/labels/void',
  /** `POST` — check an order's address, or one typed in. */
  addressValidate: 'shipping/address/validate',
  /** `POST` — rates for many orders at once, with a service rule. */
  batchRates: 'shipping/batch/rates',
  /** `POST` — buy the batch's rates. */
  batchBuy: 'shipping/batch/buy',
  /** `GET ?hostId` — the workspace's label spend by month. */
  spend: 'shipping/spend',
  /** `POST` — Shippo's webhook; verified by its URL token. */
  webhookShippo: 'shipping/webhooks/shippo',
  /** `POST` — EasyPost's webhook; verified by its signature. */
  webhookEasypost: 'shipping/webhooks/easypost',
} as const
