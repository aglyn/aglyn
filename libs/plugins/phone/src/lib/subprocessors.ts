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
 * Twilio, for Aglyn Phone (AGL-4251). The same vendor the sms plugin already
 * lists for order texts; this declares Phone's own hosts and what Phone sends.
 *
 * ⚠ NOTHING REACHES TWILIO FROM PHONE UNTIL `release_phone` IS ON FOR A
 * WORKSPACE, IT HOLDS THE PHONE ADD-ON, AND `TWILIO_ACCOUNT_SID` /
 * `TWILIO_AUTH_TOKEN` ARE SET. The /legal/subprocessors Twilio row today says
 * order texts only; it must widen to calls, voicemail and two-way texts
 * before the flag is turned on for anyone (LANE-PHONE.md, legal wording).
 */
export function phoneSubprocessors(): PluginSubprocessorDeclaration[] {
  return [
    {
      host: 'api.twilio.com',
      entity: 'Twilio Inc.',
      region: 'United States',
      purpose:
        'A workspace’s business phone number: two-way texts with its customers, calls to and from the number, call forwarding and voicemail',
      publishedOn: '2026-10-07',
      reason:
        'Phone’s Twilio client (`libs/plugins/phone/src/lib/twilio/twilio-client.ts`) buys and releases a workspace’s number in its own Twilio subaccount, sends the texts a member writes, places the calls a member starts, and answers Twilio’s signed webhooks for texts and calls to the number.',
      dataReceived:
        'The customer’s and the business’s phone numbers, the text of every message sent or received, call audio as it is carried, voicemail recordings and their transcripts, and the member cell numbers calls are forwarded to. No email address, payment detail or account credential is sent.',
    },
    {
      host: 'messaging.twilio.com',
      entity: 'Twilio Inc.',
      region: 'United States',
      purpose: 'Registering a workspace’s number for texting with US carriers (A2P 10DLC or toll-free verification)',
      publishedOn: '2026-10-07',
      reason: 'Phone’s texting registration form, submitted by a workspace owner or admin.',
      dataReceived:
        'The business’s legal name, EIN, address, website, a contact person’s name, email and phone, what its texts are for, and two example texts.',
    },
    {
      host: 'trusthub.twilio.com',
      entity: 'Twilio Inc.',
      region: 'United States',
      purpose: 'The business profile carriers require before a local number may text',
      publishedOn: '2026-10-07',
      reason: 'Phone’s texting registration for a local number (A2P 10DLC brand).',
      dataReceived: 'The same business details as the texting registration.',
    },
    {
      host: 'numbers.twilio.com',
      entity: 'Twilio Inc.',
      region: 'United States',
      purpose: 'Moving a workspace’s existing number in from its current carrier (number porting)',
      publishedOn: '2026-10-07',
      reason: 'Phone’s Move my number form, submitted by a workspace owner or admin.',
      dataReceived:
        'The number, the account holder’s name, the account number and transfer PIN at the current carrier, and the service address.',
    },
  ]
}
