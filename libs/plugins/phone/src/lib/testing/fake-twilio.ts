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

import type { TwilioClient } from '../twilio/twilio-client'

/**
 * A Twilio that records every call and never reaches the network (AGL-4251).
 * Every spec builds Phone on this; nothing in development spends money.
 */
export function createFakeTwilio(overrides: Partial<TwilioClient> = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const record =
    <T>(method: string, answer: (...args: any[]) => T) =>
    async (...args: unknown[]) => {
      calls.push({ method, args })
      return answer(...args)
    }
  let sent = 0
  const client: TwilioClient = {
    isConfigured: () => true,
    createSubaccount: record('createSubaccount', () => ({ sid: 'AC_sub_1' })),
    subaccountAuthToken: record('subaccountAuthToken', () => 'sub-token'),
    searchNumbers: record('searchNumbers', () => [
      {
        e164: '+18305550100',
        friendlyName: '(830) 555-0100',
        locality: 'New Braunfels',
        region: 'TX',
        capabilities: { sms: true, voice: true, mms: true },
      },
    ]),
    purchaseNumber: record('purchaseNumber', (_sub: string, input: { e164: string }) => ({
      sid: 'PN_1',
      e164: input.e164,
    })),
    updateNumberWebhooks: record('updateNumberWebhooks', () => undefined),
    releaseNumber: record('releaseNumber', () => undefined),
    sendMessage: record('sendMessage', () => ({ sid: `SM${String(++sent).padStart(32, '0')}`, status: 'queued', segments: 1 })),
    createCall: record('createCall', () => ({ sid: 'CA_out_1', status: 'queued' })),
    submitTollFreeVerification: record('submitTollFreeVerification', () => ({ sid: 'HH_1', status: 'PENDING_REVIEW' })),
    readTollFreeVerification: record('readTollFreeVerification', () => ({ status: 'TWILIO_APPROVED', rejectionReason: null })),
    submitA2pBrand: record('submitA2pBrand', () => ({ brandSid: 'BN_1', customerProfileSid: 'BU_1', trustProductSid: 'BU_2' })),
    readA2pBrand: record('readA2pBrand', () => ({ status: 'APPROVED', rejectionReason: null })),
    createA2pCampaign: record('createA2pCampaign', () => ({ campaignSid: 'QE_1', messagingServiceSid: 'MG_1' })),
    requestPortIn: record('requestPortIn', () => ({ sid: 'KW_1', status: 'submitted' })),
    closeSubaccount: record('closeSubaccount', () => undefined),
    ...overrides,
  }
  return { client, calls, called: (method: string) => calls.filter((one) => one.method === method) }
}
