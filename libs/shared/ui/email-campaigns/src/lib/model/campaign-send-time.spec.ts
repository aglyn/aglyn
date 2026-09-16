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

import {
  CAMPAIGN_SEND_TIME_MIN_DELIVERED,
  CAMPAIGN_SEND_TIME_MIN_SENDS,
  campaignSendTimeLabel,
  suggestCampaignSendTime,
} from './campaign-send-time'

/** Tuesday 2026-09-08 at an hour, UTC. */
const tuesdayAt = (hour: number) => Date.UTC(2026, 8, 8, hour, 12)
/** Thursday 2026-09-10 at an hour, UTC. */
const thursdayAt = (hour: number) => Date.UTC(2026, 8, 10, hour, 40)

describe('suggestCampaignSendTime', () => {
  it('picks the slot whose sends were opened by the largest pooled share of the people they reached', () => {
    const suggestion = suggestCampaignSendTime([
      { sentAtMs: tuesdayAt(9), delivered: 1_000, uniqueOpens: 420 },
      { sentAtMs: tuesdayAt(9), delivered: 800, uniqueOpens: 300 },
      { sentAtMs: thursdayAt(17), delivered: 1_200, uniqueOpens: 310 },
    ])
    expect(suggestion).toEqual({
      weekday: 2,
      hour: 9,
      timeZone: 'UTC',
      openRate: 720 / 1_800,
      sends: 2,
      measured: 3,
    })
    expect(campaignSendTimeLabel(suggestion!)).toBe('Tuesdays around 9 AM (UTC)')
  })

  it('pools rather than averages, so one tiny send that everyone opened does not win', () => {
    const suggestion = suggestCampaignSendTime([
      { sentAtMs: thursdayAt(6), delivered: CAMPAIGN_SEND_TIME_MIN_DELIVERED, uniqueOpens: 19 },
      { sentAtMs: tuesdayAt(10), delivered: 5_000, uniqueOpens: 1_000 },
      { sentAtMs: tuesdayAt(10), delivered: 5_000, uniqueOpens: 3_200 },
      { sentAtMs: thursdayAt(6), delivered: 4_000, uniqueOpens: 900 },
    ])
    // Thursday 6 AM pools 919 / 4,020; Tuesday 10 AM pools 4,200 / 10,000.
    expect(suggestion).toMatchObject({ weekday: 2, hour: 10, sends: 2, measured: 4 })
  })

  it('says nothing from too few measurable sends, leaving out thin and self-contradicting records', () => {
    const measurable = { sentAtMs: tuesdayAt(9), delivered: 500, uniqueOpens: 100 }
    expect(suggestCampaignSendTime([])).toBeNull()
    expect(
      suggestCampaignSendTime(Array.from({ length: CAMPAIGN_SEND_TIME_MIN_SENDS - 1 }, () => measurable)),
    ).toBeNull()
    expect(
      suggestCampaignSendTime([
        measurable,
        measurable,
        { sentAtMs: tuesdayAt(9), delivered: CAMPAIGN_SEND_TIME_MIN_DELIVERED - 1, uniqueOpens: 5 },
        { sentAtMs: tuesdayAt(9), delivered: 100, uniqueOpens: 101 },
        { sentAtMs: 0, delivered: 500, uniqueOpens: 100 },
      ]),
    ).toBeNull()
    expect(suggestCampaignSendTime([measurable, measurable, measurable])).toMatchObject({ measured: 3 })
  })

  it('states the slot in the zone asked for, and falls back to UTC for a zone it cannot read', () => {
    const samples = [
      { sentAtMs: tuesdayAt(14), delivered: 900, uniqueOpens: 400 },
      { sentAtMs: tuesdayAt(14), delivered: 900, uniqueOpens: 380 },
      { sentAtMs: thursdayAt(14), delivered: 900, uniqueOpens: 100 },
    ]
    const chicago = suggestCampaignSendTime(samples, { timeZone: 'America/Chicago' })
    expect(chicago).toMatchObject({ weekday: 2, hour: 9, timeZone: 'America/Chicago' })
    expect(campaignSendTimeLabel(chicago!)).toBe('Tuesdays around 9 AM (America/Chicago)')
    expect(suggestCampaignSendTime(samples, { timeZone: 'Mars/Olympus' })).toMatchObject({
      hour: 14,
      timeZone: 'UTC',
    })
  })

  it('breaks a tie on rate by the slot with more sends, then by the earlier slot in the week', () => {
    const suggestion = suggestCampaignSendTime([
      { sentAtMs: thursdayAt(8), delivered: 100, uniqueOpens: 50 },
      { sentAtMs: tuesdayAt(20), delivered: 100, uniqueOpens: 50 },
      { sentAtMs: thursdayAt(8), delivered: 100, uniqueOpens: 50 },
    ])
    expect(suggestion).toMatchObject({ weekday: 4, hour: 8, sends: 2 })
    expect(
      suggestCampaignSendTime([
        { sentAtMs: thursdayAt(8), delivered: 100, uniqueOpens: 50 },
        { sentAtMs: tuesdayAt(20), delivered: 100, uniqueOpens: 50 },
        { sentAtMs: tuesdayAt(21), delivered: 100, uniqueOpens: 50 },
      ]),
    ).toMatchObject({ weekday: 2, hour: 20 })
    expect(campaignSendTimeLabel({ weekday: 0, hour: 0, timeZone: 'UTC' })).toBe('Sundays around 12 AM (UTC)')
    expect(campaignSendTimeLabel({ weekday: 6, hour: 12, timeZone: 'UTC' })).toBe('Saturdays around 12 PM (UTC)')
  })
})
