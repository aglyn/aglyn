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
 * What the Zapier plugin sends where (AGL-3643). One host: the REST hook
 * URLs Zapier mints for a merchant's Zaps. Not a subprocessor — the merchant
 * connects THEIR OWN Zapier account with their own API key, and chooses what
 * each Zap receives; Aglyn holds no Zapier account that receives a site's
 * data. The hook endpoint refuses any other host, so this is the whole of the
 * plugin's egress.
 */
export const ZAPIER_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: 'hooks.zapier.com',
    disposition: 'not-a-subprocessor',
    reason:
      "Customer-chosen destination. The REST hook URL Zapier mints for a Zap the merchant built in their own Zapier account, subscribed with the merchant's own API key through `POST /v1/sites/{siteId}/hooks` and posted to only by the Zapier plugin's delivery (`libs/plugins/zapier/src/lib/server/deliver.ts`), until the Zap is turned off, the key is revoked or Zapier answers 410.",
    dataReceived:
      "Only the events the merchant's Zap subscribed to, each held to the scope its key holds: an order as the REST API publishes it (number, status, totals, line items, the buyer's name, email and shipping address, shipments and refunds), a booking (service, time, the guest's name, email, phone and address when asked, what was paid), a new contact (id, email, name, source, lifecycle stage), or a form submission (the form, the page and every submitted field). No payment details, API keys or passwords are sent.",
  },
]

export function zapierSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: ZAPIER_HOSTS }
}
