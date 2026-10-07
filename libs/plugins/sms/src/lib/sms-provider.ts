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
 * The vendor half of a text message (AGL-3610): what a carrier adapter must
 * do, and nothing about who may be texted, how it is metered or whether it is
 * allowed — that is `sms-messaging.ts`, the same for every vendor.
 *
 * Twilio is the first adapter (`twilio-provider.ts`). A second vendor is a
 * second implementation of this interface and a choice in
 * `activeSmsProvider()`; no caller changes.
 */
export interface SmsProviderSendInput {
  /** E.164, already normalized and suppression-checked. */
  to: string
  body: string
  /** A sender override; the adapter's configured sender otherwise. */
  from?: string
}

export type SmsProviderSendResult =
  | { ok: true; id: string; segments: number }
  | { ok: false; error: string; /** The number itself was refused. */ invalidNumber?: boolean }

export interface SmsProvider {
  /** Stable id, for logs and the usage record. */
  readonly id: string
  isConfigured(): boolean
  send(input: SmsProviderSendInput): Promise<SmsProviderSendResult>
}

/**
 * How many segments a body takes: 160 GSM-7 characters in one, 153 per
 * segment once it splits; 70 / 67 when any character needs UCS-2. Used for
 * the cost estimate when the vendor does not say.
 */
export function smsSegmentCount(body: string): number {
  const text = String(body ?? '')
  if (!text) return 0
  // GSM 03.38 basic set plus the extension table (counted as two).
  const basic =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
  const extended = '^{}\\[~]|€\f'
  let septets = 0
  for (const character of text) {
    if (basic.includes(character)) septets += 1
    else if (extended.includes(character)) septets += 2
    else {
      const units = [...text].length
      return units <= 70 ? 1 : Math.ceil(units / 67)
    }
  }
  return septets <= 160 ? 1 : Math.ceil(septets / 153)
}
