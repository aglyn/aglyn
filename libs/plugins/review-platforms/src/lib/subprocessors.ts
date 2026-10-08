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
import { TRUSTPILOT_INVITE_DOMAIN } from './model/review-platforms-settings'
import { TRUSTPILOT_INVITATIONS_API_BASE, TRUSTPILOT_TOKEN_URL } from './providers/trustpilot'
import { YOTPO_API_BASE } from './providers/yotpo'

/**
 * Review platforms' OTHER HOSTS (AGL-3699), named under `subprocessors` in
 * `plugins.config.json`. None is a published recipient: each is reached only
 * with an account the MERCHANT connected — their Trustpilot invitation
 * address or API key, their Yotpo app key and secret — so the merchant, not
 * Aglyn, chose the service, and the data goes to the merchant's own account
 * there. Each host is read off the constant the code uses, so a moved
 * endpoint moves its declaration.
 *
 * ⚑ Nothing is sent to any of them until the merchant connects the service
 * for a site, and then only for a buyer the site may market to.
 */
export function reviewPlatformsSubprocessors(): PluginSubprocessorsAnswer {
  return {
    hosts: [
      {
        host: TRUSTPILOT_INVITE_DOMAIN,
        disposition: 'not-a-subprocessor',
        reason:
          "The Trustpilot invitation address the merchant pasted from their own Trustpilot account (`libs/plugins/review-platforms/src/lib/server/invitations.ts`): blind-copied on one buyer email per order so Trustpilot invites the buyer to review the store. Customer-chosen: the merchant chose Trustpilot and the copy lands in the merchant's account.",
        dataReceived:
          "A copy of one order email (shipped, delivered or picked up, as the merchant chose) with a data block naming the buyer's name, email and the order number. Only for a buyer the site may market to.",
      },
      {
        host: new URL(TRUSTPILOT_TOKEN_URL).host,
        disposition: 'not-a-subprocessor',
        reason:
          "The Trustpilot adapter (`libs/plugins/review-platforms/src/lib/providers/trustpilot.ts`), with the API key and secret the merchant connected from their own Trustpilot account: exchanges them for an access token. Customer-chosen: the merchant chose Trustpilot.",
        dataReceived: "The merchant's own Trustpilot API key and secret. No buyer data.",
      },
      {
        host: new URL(TRUSTPILOT_INVITATIONS_API_BASE).host,
        disposition: 'not-a-subprocessor',
        reason:
          "The Trustpilot adapter (`libs/plugins/review-platforms/src/lib/providers/trustpilot.ts`), with the merchant's own API key: creates one service-review invitation per order. Customer-chosen: the merchant chose Trustpilot and the data lands in the merchant's account.",
        dataReceived:
          "For each invited order: the buyer's name and email and the order number. Only for a buyer the site may market to. No address, phone or payment detail.",
      },
      {
        host: new URL(YOTPO_API_BASE).host,
        disposition: 'not-a-subprocessor',
        reason:
          "The Yotpo Reviews adapter (`libs/plugins/review-platforms/src/lib/providers/yotpo.ts`), with the app key and secret key the merchant connected from their own Yotpo account: sends each fulfilled order so Yotpo sends the buyer its review request. Customer-chosen: the merchant chose Yotpo and the data lands in the merchant's account.",
        dataReceived:
          "For each invited order: its id, date, currency and total, the buyer's name and email, the items (product id, name, SKU, quantity, price) and the fulfillment date. Only for a buyer the site may market to. No address, phone or payment detail.",
      },
    ],
  }
}
