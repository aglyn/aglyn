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
  bookingServiceDraftFrom,
  bookingServiceDraftProblem,
  bookingServiceFields,
  formatBookingWindows,
  newBookingServiceDraft,
  parseBookingWindows,
} from './booking-service-form'

describe('booking service form', () => {
  it('reads an hours line and skips what it cannot read', () => {
    expect(parseBookingWindows('09:00-12:00, 13:00-17:30')).toEqual([
      { start: 540, end: 720 },
      { start: 780, end: 1050 },
    ])
    expect(parseBookingWindows('9:00 - 10:00, nonsense, 18:00-17:00, 23:00-24:30')).toEqual([{ start: 540, end: 600 }])
    expect(parseBookingWindows('')).toEqual([])
  })

  it('writes hours back the way it reads them', () => {
    expect(formatBookingWindows([{ start: 540, end: 720 }, { start: 780, end: 1050 }])).toBe('09:00-12:00, 13:00-17:30')
    expect(formatBookingWindows(undefined)).toBe('')
  })

  it('starts a new service open on weekdays', () => {
    const draft = newBookingServiceDraft('America/Chicago')
    expect(draft.windowText).toEqual(['', '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', ''])
    expect(draft.crmMeetingActivity).toBe(true)
    expect(draft.crmFollowUpTask).toBe(false)
    expect(newBookingServiceDraft('').timezone).toBe('UTC')
  })

  it('writes every weekday, a closed one as an empty list, so a merge clears old hours', () => {
    const draft = { ...newBookingServiceDraft('UTC'), name: '  Haircut  ', description: '  ' }
    const fields = bookingServiceFields(draft)
    expect(Object.keys(fields.windows)).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(fields.windows['0']).toEqual([])
    expect(fields.windows['1']).toEqual([{ start: 540, end: 1020 }])
    expect(fields.name).toBe('Haircut')
    expect(fields.description).toBe('')
  })

  it('clamps the duration, rounds the price and caps the text', () => {
    const fields = bookingServiceFields({
      ...newBookingServiceDraft('UTC'),
      name: 'x'.repeat(100),
      durationMinutes: '1000',
      priceUsd: '19.6',
      description: 'y'.repeat(600),
      timezone: ' ',
    })
    expect(fields.durationMinutes).toBe(480)
    expect(fields.priceUsd).toBe(20)
    expect(fields.name).toHaveLength(80)
    expect(fields.description).toHaveLength(500)
    expect(fields.timezone).toBe('UTC')
    expect(bookingServiceFields({ ...newBookingServiceDraft('UTC'), durationMinutes: 'abc', priceUsd: '-3' })).toMatchObject({
      durationMinutes: 30,
      priceUsd: 0,
    })
  })

  it('seeds the dialog from a stored service with the model defaults', () => {
    const draft = bookingServiceDraftFrom({
      name: 'Color',
      durationMinutes: 45,
      priceUsd: 60,
      windows: { 2: [{ start: 600, end: 660 }] },
      priceDisplay: 'nope',
      askPhone: 'required',
    })
    expect(draft.windowText[2]).toBe('10:00-11:00')
    expect(draft.windowText[1]).toBe('')
    expect(draft.crmMeetingActivity).toBe(true)
    expect(draft.priceDisplay).toBe('fixed')
    expect(draft.askPhone).toBe('required')
    expect(draft.askAddress).toBe('off')
    expect(draft.timezone).toBe('UTC')
  })

  it('refuses a nameless service', () => {
    expect(bookingServiceDraftProblem({ name: '  ' })).toBe('A service needs a name.')
    expect(bookingServiceDraftProblem({ name: 'Cut' })).toBeNull()
  })
})
