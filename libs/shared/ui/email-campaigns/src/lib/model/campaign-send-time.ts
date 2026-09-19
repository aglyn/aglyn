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

import { campaignRate } from './campaign-report'

/**
 * WHEN A LIST READS ITS MAIL: a suggested send time, taken from the sends that
 * already went to it.
 *
 * A rule and not a guess. Each past send is put in the slot it went out in —
 * its weekday and hour, in one named time zone — and the slot whose sends were
 * opened by the largest share of the people they reached is the suggestion.
 * The share is POOLED across a slot's sends (every unique open over every
 * delivered message) rather than averaged, so one small send that happened to
 * be opened by all nine of its recipients does not outrank a slot that reached
 * thousands.
 *
 * Only sends that can be measured are counted: a send with no delivered count
 * large enough to say anything is left out, and so is one whose opens exceed
 * its deliveries, which is a record that disagrees with itself. With fewer
 * measured sends than the minimum there is no suggestion at all — "not enough
 * history" is an answer a composer can say, and a slot picked from one send is
 * not.
 *
 * Pure, with the reads left to the caller that holds the credentials.
 */

/** One past send to the list, as the suggestion needs it. */
export interface CampaignSendTimeSample {
  /** When the send went out. */
  sentAtMs: number
  /** Messages the provider delivered. */
  delivered: number
  /** Distinct recipients who opened it. */
  uniqueOpens: number
}

export interface CampaignSendTimeSuggestion {
  /** 0 for Sunday through 6 for Saturday, in `timeZone`. */
  weekday: number
  /** 0 to 23, in `timeZone`. */
  hour: number
  /** The IANA zone the slot is stated in. */
  timeZone: string
  /** The pooled unique-open rate of the sends in the slot, 0 to 1. */
  openRate: number
  /** Measured sends that went out in the slot. */
  sends: number
  /** Measured sends the slot was chosen among. */
  measured: number
}

/** The fewest measured sends a suggestion is taken from. */
export const CAMPAIGN_SEND_TIME_MIN_SENDS = 3

/** The fewest delivered messages that make a send measurable. */
export const CAMPAIGN_SEND_TIME_MIN_DELIVERED = 20

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function slotFormatter(timeZone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    })
  } catch {
    return null
  }
}

/** The weekday and hour an instant falls in, in a zone. */
function slotOf(
  formatter: Intl.DateTimeFormat,
  atMs: number,
): { weekday: number; hour: number } | null {
  let weekday: number | undefined
  let hour: number | undefined
  for (const part of formatter.formatToParts(new Date(atMs))) {
    if (part.type === 'weekday') weekday = WEEKDAYS[part.value]
    if (part.type === 'hour') hour = Number(part.value) % 24
  }
  return weekday === undefined || hour === undefined || !Number.isFinite(hour)
    ? null
    : { weekday, hour }
}

/**
 * The slot the list's past sends were opened most in, or `null` when too few
 * sends can be measured. An unknown time zone is read as UTC, and the answer
 * says so.
 */
export function suggestCampaignSendTime(
  samples: ReadonlyArray<CampaignSendTimeSample>,
  options: { timeZone?: string } = {},
): CampaignSendTimeSuggestion | null {
  const requested = options.timeZone?.trim() || 'UTC'
  const formatter = slotFormatter(requested) ?? slotFormatter('UTC')
  const timeZone = slotFormatter(requested) ? requested : 'UTC'
  if (!formatter) return null
  const slots = new Map<string, { weekday: number; hour: number; delivered: number; opens: number; sends: number }>()
  let measured = 0
  for (const sample of samples) {
    const delivered = Number(sample.delivered)
    const opens = Number(sample.uniqueOpens)
    if (!Number.isFinite(sample.sentAtMs) || sample.sentAtMs <= 0) continue
    if (!Number.isFinite(delivered) || delivered < CAMPAIGN_SEND_TIME_MIN_DELIVERED) continue
    if (!Number.isFinite(opens) || opens < 0 || opens > delivered) continue
    const slot = slotOf(formatter, sample.sentAtMs)
    if (!slot) continue
    measured += 1
    const key = `${slot.weekday}:${slot.hour}`
    const held = slots.get(key) ?? { ...slot, delivered: 0, opens: 0, sends: 0 }
    held.delivered += delivered
    held.opens += opens
    held.sends += 1
    slots.set(key, held)
  }
  if (measured < CAMPAIGN_SEND_TIME_MIN_SENDS) return null
  let best: CampaignSendTimeSuggestion | null = null
  for (const slot of slots.values()) {
    const rate = campaignRate(slot.opens, slot.delivered, 'delivered')
    if (!rate) continue
    const candidate: CampaignSendTimeSuggestion = {
      weekday: slot.weekday,
      hour: slot.hour,
      timeZone,
      openRate: rate.value,
      sends: slot.sends,
      measured,
    }
    const better =
      !best ||
      candidate.openRate > best.openRate ||
      (candidate.openRate === best.openRate &&
        (candidate.sends > best.sends ||
          (candidate.sends === best.sends &&
            candidate.weekday * 24 + candidate.hour < best.weekday * 24 + best.hour)))
    if (better) best = candidate
  }
  return best
}

/** The slot as a person reads it: "Tuesdays around 9 AM (UTC)". */
export function campaignSendTimeLabel(
  suggestion: Pick<CampaignSendTimeSuggestion, 'weekday' | 'hour' | 'timeZone'>,
): string {
  const hour12 = suggestion.hour % 12 === 0 ? 12 : suggestion.hour % 12
  const meridiem = suggestion.hour < 12 ? 'AM' : 'PM'
  return `${WEEKDAY_NAMES[suggestion.weekday]}s around ${hour12} ${meridiem} (${suggestion.timeZone})`
}
