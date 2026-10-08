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
 * Smile.io and Yotpo Loyalty, the loyalty accounts a merchant may connect in
 * place of the built-in points (AGL-3677), named under `subprocessors` in
 * `plugins.config.json`.
 *
 * Neither is a published recipient. Nothing reaches either one until a
 * merchant connects their OWN account with their own API key (and the
 * deployment sets `LOYALTY_CONNECTORS_TOKEN_KEY`, the key those are sealed
 * under). Aglyn holds no account and no app with either vendor; the data goes
 * to the merchant's account at the merchant's instruction, from the rewards
 * plugin's adapters. So each host is `not-a-subprocessor` on the
 * customer-chosen-destination ground, like the tax and shipping services a
 * merchant connects: the generalized "services you connect with your own
 * account" sentence on the Subprocessors page covers them.
 */
const SMILE_DATA =
  'For each points movement: the buyer’s email address (to find their Smile.io member), the signed number of points, a short description, and an Aglyn reference. No order contents, amounts, addresses or payment details are sent. The merchant’s Smile.io API key authenticates each call.'

const YOTPO_DATA =
  'For each points movement: the buyer’s email address, and their name when Yotpo is asked to enroll them, the signed number of points, a short history title with an Aglyn reference. No order contents, amounts, addresses or payment details are sent. The merchant’s Yotpo GUID and API key authenticate each call.'

export function loyaltySubprocessors(): PluginSubprocessorsAnswer {
  return {
    hosts: [
      {
        host: 'api.smile.io',
        disposition: 'not-a-subprocessor',
        reason:
          'Smile.io REST API v1, reached only from the rewards plugin’s adapter (`libs/plugins/loyalty/src/lib/connectors/smile.ts`) with the merchant’s own API key: a member’s balance when a buyer or cashier names them, and a points transaction for each sale, refund, redemption and hand adjustment. Customer-chosen: the merchant chose Smile.io and the data lands in the merchant’s own Smile account.',
        dataReceived: SMILE_DATA,
      },
      {
        host: 'loyalty.yotpo.com',
        disposition: 'not-a-subprocessor',
        reason:
          'Yotpo Loyalty & Referrals API v2, reached only from the rewards plugin’s adapter (`libs/plugins/loyalty/src/lib/connectors/yotpo.ts`) with the merchant’s own GUID and API key: a member’s balance when a buyer or cashier names them, enrollment of a buyer Yotpo lacks, and a points adjustment for each sale, refund, redemption and hand adjustment. Customer-chosen: the merchant chose Yotpo and the data lands in the merchant’s own Yotpo account.',
        dataReceived: YOTPO_DATA,
      },
    ],
  }
}
