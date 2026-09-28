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
 * A send held for staff review (AGL-3356) is STORED as `scheduled`, parked at
 * a time no processor run reaches. Read literally it is "Scheduled" for the
 * year 9999. These pin what every surface draws instead.
 */

import {
  campaignHeldForReviewNotice,
  campaignSendDisplay,
  campaignSendHeldForReview,
  type CampaignSend,
} from './campaign-container'
import { emailListTimeMs, emailSendTimeMs } from './email-record'

const PARKED = 253402300799000

const held = (patch: Partial<CampaignSend> = {}): CampaignSend =>
  ({
    $id: 'send-1',
    status: 'scheduled',
    sendAtMs: PARKED,
    createdAtMs: 1_755_000_000_000,
    staffReview: { state: 'held', reference: 'HS-ABCDEF1234' },
    ...patch,
  }) as CampaignSend

describe('a send held for review', () => {
  it('reads as "Held for review", not "Scheduled"', () => {
    expect(campaignSendDisplay(held())).toMatchObject({
      state: 'held',
      label: 'Held for review',
    })
  })

  it('is held whether it was parked as scheduled or as a draft', () => {
    expect(campaignSendHeldForReview(held({ status: 'draft' }))).toBe(true)
  })

  it('stops being held once staff decide', () => {
    // Released: back on the clock, an ordinary scheduled send.
    expect(
      campaignSendDisplay(
        held({ sendAtMs: 1_755_000_100_000, staffReview: { state: 'released' } }),
      ).state,
    ).toBe('pending')
    // Rejected: canceled by the decision.
    expect(
      campaignSendHeldForReview(held({ status: 'canceled', staffReview: { state: 'rejected' } })),
    ).toBe(false)
  })

  it('has no send time, so no surface prints the parked year', () => {
    expect(emailSendTimeMs(held())).toBe(0)
    // …and a list orders it where the merchant created it.
    expect(emailListTimeMs(held())).toBe(1_755_000_000_000)
  })

  it('tells the merchant they cannot release it, and the reference', () => {
    const notice = campaignHeldForReviewNotice(held())
    expect(notice).toContain('held for review')
    expect(notice).toContain('cannot be released')
    expect(notice).toContain('HS-ABCDEF1234')
  })

  it('leaves an ordinary scheduled send alone', () => {
    const plain = { $id: 's', status: 'scheduled', sendAtMs: 1_755_000_100_000 } as CampaignSend
    expect(campaignSendDisplay(plain).label).toBe('Scheduled')
    expect(emailSendTimeMs(plain)).toBe(1_755_000_100_000)
  })
})
