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
 * Phone's console API routes, as the dispatcher keys them (AGL-4251). One
 * table both halves import. Every member route names its organization
 * (`orgId`, query or body) so the dispatcher's release gate asks about that
 * organization. The `hooks/*` routes are Twilio's, signed, with no session.
 */
export const PHONE_API_ROUTES = {
  /** `GET ?orgId` — the workspace's number, registration, settings and whether Phone can run here. */
  status: 'phone/status',
  /** `POST` — numbers for sale: `{ kind, areaCode?, contains? }`. */
  numbersSearch: 'phone/numbers/search',
  /** `POST` — buy one: `{ e164, kind, hostId, label }`. */
  numbersBuy: 'phone/numbers/buy',
  /** `POST` — rename it or move it to another site. */
  numbersUpdate: 'phone/numbers/update',
  /** `POST` — give it back to the phone company. */
  numbersRelease: 'phone/numbers/release',
  /** `GET ?orgId&archived&before` — the inbox. */
  threads: 'phone/threads',
  /** `GET ?orgId&threadId` — one conversation, its calls, and who it is with. */
  thread: 'phone/thread',
  /** `POST` — archive or bring back a conversation. */
  threadArchive: 'phone/thread/archive',
  /** `POST` — send a text: `{ threadId }` or `{ to, numberId? }`, and `body`. */
  send: 'phone/messages/send',
  /** `GET ?orgId` / `POST` — hours, forwarding, voicemail, templates. */
  settings: 'phone/settings',
  /** `GET ?orgId` / `POST` — the texting registration; `POST { submit: true }` sends it. */
  compliance: 'phone/compliance',
  /** `POST` — ask the registry where the registration stands. */
  complianceRefresh: 'phone/compliance/refresh',
  /** `POST` — move an existing number in. */
  ports: 'phone/ports',
  /** `GET ?orgId&threadId` — what the person has with the business: orders, bookings, stays, waivers. */
  person: 'phone/person',

  // Twilio's webhooks (signed by the subaccount's token).
  hookSms: 'phone/hooks/sms',
  hookSmsStatus: 'phone/hooks/sms-status',
  hookVoice: 'phone/hooks/voice',
  hookVoiceStatus: 'phone/hooks/voice-status',
  hookVoiceDial: 'phone/hooks/voice-dial',
  hookVoicemail: 'phone/hooks/voicemail',
  hookTranscription: 'phone/hooks/transcription',
  hookOutbound: 'phone/hooks/outbound',

  /**
   * `POST` — call a customer from the business line: `{ to }`. Phone rings the
   * member's own cell first and connects them, showing the business number.
   */
  callsPlace: 'phone/calls/place',
  /** `GET ?orgId` — the call log. */
  calls: 'phone/calls',
} as const

export type PhoneApiRoute = (typeof PHONE_API_ROUTES)[keyof typeof PHONE_API_ROUTES]
