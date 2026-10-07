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
 * Twilio, the first text-message vendor (AGL-3610).
 *
 * ⚠ NOTHING REACHES TWILIO UNTIL `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
 * AND `TWILIO_MESSAGING_SERVICE_SID` ARE SET — the adapter reports itself
 * unconfigured and every surface offers email only. `publishedOn` is the
 * /legal/subprocessors change-log date that put Twilio on the page, ahead of
 * those variables (AGL-3666).
 */
export function smsSubprocessors(): PluginSubprocessorDeclaration[] {
  return [
    {
      host: 'api.twilio.com',
      entity: 'Twilio Inc.',
      region: 'United States',
      purpose:
        'Delivery of text messages a site sends its own customers, such as order receipts and shipping updates',
      publishedOn: '2026-10-07',
      reason:
        'The Messages REST API, reached only from the SMS plugin’s Twilio adapter (`libs/plugins/sms/src/lib/twilio-provider.ts`) when a site texts a buyer an order update or a merchant re-sends a receipt by text. Inbound STOP replies arrive from Twilio on a signed webhook.',
      dataReceived:
        'The recipient’s phone number and the message text (the store name, order number, amounts, carrier tracking link and order status link). Twilio returns delivery status. No email address, payment detail or account credential is sent.',
    },
  ]
}
