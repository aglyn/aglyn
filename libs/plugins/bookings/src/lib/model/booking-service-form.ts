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

import { type BookingFieldAsk, bookingContactAsks } from './booking-contact-fields'
import { type BookingPriceDisplay, bookingPriceDisplay } from './booking-price'

/**
 * THE SERVICE DIALOG'S RULES: what a service's editor starts from and what
 * one save stores in `hosts/{hostId}/services/{id}`. The console's Bookings
 * page and the native apps' service editors both hand their form to
 * {@link bookingServiceFields} and store exactly what it answers (the apps
 * replay its cases), so a duration is clamped, a price rounded and an
 * hours line read the same way whichever of them saved it.
 *
 * Pure: no Firestore, no clock, no React.
 */

/** The weekday names the dialog labels each hours line with, Sunday first (`windows` keys 0–6). */
export const BOOKING_WEEKDAYS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** One open interval on a weekday, in minutes since midnight in the service's zone. */
export interface BookingWindow {
  start: number
  end: number
}

/** Longest stored service name. */
export const BOOKING_SERVICE_NAME_MAX = 80
/** Longest stored service description. */
export const BOOKING_SERVICE_DESCRIPTION_MAX = 500

/** The service dialog's fields as typed: numbers and hours are text until saved. */
export interface BookingServiceDraft {
  name: string
  durationMinutes: string
  priceUsd: string
  timezone: string
  description: string
  /** Per-weekday hours, Sunday first, e.g. "09:00-12:00, 13:00-17:00". */
  windowText: string[]
  crmMeetingActivity: boolean
  crmFollowUpTask: boolean
  askPhone: BookingFieldAsk
  askAddress: BookingFieldAsk
  priceDisplay: BookingPriceDisplay
}

/** What one save stores: every editable key of the service, written explicitly. */
export interface BookingServiceFields {
  name: string
  durationMinutes: number
  priceUsd: number
  timezone: string
  /** `''` when cleared, so a merge does not keep the old text. */
  description: string
  /** Every weekday, 0–6, with `[]` for a closed day. */
  windows: Record<string, BookingWindow[]>
  crmMeetingActivity: boolean
  crmFollowUpTask: boolean
  askPhone: BookingFieldAsk
  askAddress: BookingFieldAsk
  priceDisplay: BookingPriceDisplay
}

/** "09:00-12:00, 13:00-17:00" → open intervals in minutes; anything unreadable is skipped. */
export function parseBookingWindows(input: string): BookingWindow[] {
  const windows: BookingWindow[] = []
  for (const chunk of String(input ?? '').split(',')) {
    const match = chunk.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
    if (!match) continue
    const start = Number(match[1]) * 60 + Number(match[2])
    const end = Number(match[3]) * 60 + Number(match[4])
    if (end > start && end <= 24 * 60) windows.push({ start, end })
  }
  return windows
}

/** Open intervals → "09:00-12:00, 13:00-17:00". */
export function formatBookingWindows(windows: readonly BookingWindow[] | null | undefined): string {
  const pad = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return (windows ?? []).map((window) => `${pad(window.start)}-${pad(window.end)}`).join(', ')
}

/**
 * A new service's dialog: thirty minutes, free, the editor's own zone, open
 * nine to five on weekdays, a meeting on the contact's record and no
 * follow-up, and only name and email asked.
 */
export function newBookingServiceDraft(timeZone: string): BookingServiceDraft {
  return {
    name: '',
    durationMinutes: '30',
    priceUsd: '0',
    timezone: timeZone || 'UTC',
    description: '',
    windowText: BOOKING_WEEKDAYS.map((_, index) => (index >= 1 && index <= 5 ? '09:00-17:00' : '')),
    crmMeetingActivity: true,
    crmFollowUpTask: false,
    askPhone: 'off',
    askAddress: 'off',
    priceDisplay: 'fixed',
  }
}

/** The dialog seeded from a stored service, so its switches show what the service does. */
export function bookingServiceDraftFrom(service: {
  name?: unknown
  durationMinutes?: unknown
  priceUsd?: unknown
  timezone?: unknown
  description?: unknown
  windows?: Partial<Record<number | string, BookingWindow[]>> | null
  crmMeetingActivity?: unknown
  crmFollowUpTask?: unknown
  askPhone?: unknown
  askAddress?: unknown
  priceDisplay?: unknown
}): BookingServiceDraft {
  const asks = bookingContactAsks(service)
  return {
    name: typeof service.name === 'string' ? service.name : '',
    durationMinutes: String(service.durationMinutes ?? 30),
    priceUsd: String(service.priceUsd ?? 0),
    timezone: typeof service.timezone === 'string' ? service.timezone : 'UTC',
    description: typeof service.description === 'string' ? service.description : '',
    windowText: BOOKING_WEEKDAYS.map((_, index) => formatBookingWindows(service.windows?.[index])),
    // Absent reads as ON for the meeting and OFF for the follow-up: the
    // model's defaults.
    crmMeetingActivity: service.crmMeetingActivity !== false,
    crmFollowUpTask: service.crmFollowUpTask === true,
    askPhone: asks.phone,
    askAddress: asks.address,
    priceDisplay: bookingPriceDisplay(service.priceDisplay),
  }
}

/** Why the dialog cannot save, or null. */
export function bookingServiceDraftProblem(draft: Pick<BookingServiceDraft, 'name'>): string | null {
  return String(draft.name ?? '').trim() ? null : 'A service needs a name.'
}

/**
 * What one save stores. Every editable key is written explicitly, because
 * the edit is a `merge` and an absent key would keep its stored value: a
 * switch turned off has to land `false`, and a weekday cleared has to land
 * `[]`, or the old hours would go on taking bookings; a description
 * cleared lands `''` for the same reason.
 */
export function bookingServiceFields(draft: BookingServiceDraft): BookingServiceFields {
  const windows: Record<string, BookingWindow[]> = {}
  BOOKING_WEEKDAYS.forEach((_, weekday) => {
    windows[String(weekday)] = parseBookingWindows(draft.windowText?.[weekday] ?? '')
  })
  const description = String(draft.description ?? '').trim()
  return {
    name: String(draft.name ?? '').trim().slice(0, BOOKING_SERVICE_NAME_MAX),
    durationMinutes: Math.max(5, Math.min(480, Math.round(Number(draft.durationMinutes) || 30))),
    priceUsd: Math.max(0, Math.round(Number(draft.priceUsd) || 0)),
    timezone: String(draft.timezone ?? '').trim() || 'UTC',
    description: description.slice(0, BOOKING_SERVICE_DESCRIPTION_MAX),
    windows,
    crmMeetingActivity: draft.crmMeetingActivity,
    crmFollowUpTask: draft.crmFollowUpTask,
    askPhone: draft.askPhone,
    askAddress: draft.askAddress,
    priceDisplay: draft.priceDisplay,
  }
}
