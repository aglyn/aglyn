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
 * THE WIDGET SHOWS EVERY OPEN TIME OF THE DAYS IT SHOWS (AGL-3492).
 *
 * It used to cut each day at 24 times and the strip at 14 days of whatever
 * the listing's flat 120 slots happened to cover — on a 60-minute service
 * open 8 to 5 that hid Monday's 2:00–4:00 PM and every day after Thursday.
 * Now the listing is a page of whole days, the widget shows every time of
 * the day picked, grouped by part of the day, and "Later dates" pages on to
 * the horizon.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => jest.fn(),
}))

import Booking, {
  bookingDayLabel,
  bookingTimeLabel,
  groupSlotsByLocalDay,
} from './booking'
import { BOOKING_SLOT_PAGE_DAYS } from '../model/bookings'

const SERVICE = {
  $id: 'svc-estimate',
  name: 'Free on-site estimate',
  durationMinutes: 60,
  priceUsd: 0,
}

/** Local midnight of the `n`th day from Monday 2026-10-05. */
const dayStart = (n: number) => new Date(2026, 9, 5 + n).getTime()

/** A day open 8 AM to 5 PM, local: 33 starts, the last at 4 PM. */
function dayOfSlots(n: number) {
  return Array.from({ length: 33 }, (_, index) => {
    const startsAtMs = new Date(2026, 9, 5 + n, 8, index * 15).getTime()
    return { startsAtMs, endsAtMs: startsAtMs + 3_600_000 }
  })
}

const PAGE_ONE = {
  slots: Array.from({ length: BOOKING_SLOT_PAGE_DAYS }, (_, n) => dayOfSlots(n)).flat(),
  nextFromMs: new Date(2026, 9, 5 + BOOKING_SLOT_PAGE_DAYS, 8).getTime(),
  horizonDays: 60,
}
const PAGE_TWO = {
  slots: [0, 1, 2].map((n) => dayOfSlots(BOOKING_SLOT_PAGE_DAYS + n)).flat(),
  nextFromMs: null,
  horizonDays: 60,
}

let slotPayload: (url: URL) => unknown
const fetchMock = jest.fn()

beforeEach(() => {
  window.history.replaceState(null, '', `/contact?service=${SERVICE.$id}`)
  slotPayload = (url) => (url.searchParams.get('from') ? PAGE_TWO : PAGE_ONE)
  fetchMock.mockReset().mockImplementation(async (raw: string) => {
    const url = new URL(raw, 'https://site.test')
    return {
      ok: true,
      json: async () =>
        url.searchParams.get('serviceId') ? slotPayload(url) : { services: [SERVICE] },
    }
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

const slotRequests = () =>
  fetchMock.mock.calls
    .map(([raw]) => new URL(String(raw), 'https://site.test'))
    .filter((url) => url.searchParams.get('serviceId'))

describe('the booking widget day strip', () => {
  it('shows every open time of the picked day, afternoon included', async () => {
    render(<Booking />)
    fireEvent.click(await screen.findByText(bookingDayLabel(dayStart(0))))

    const morning = screen.getByRole('group', { name: 'Morning times' })
    const afternoon = screen.getByRole('group', { name: 'Afternoon times' })
    expect(within(morning).getAllByRole('button')).toHaveLength(16)
    expect(within(afternoon).getAllByRole('button')).toHaveLength(17)
    // The 2:00–4:00 PM starts the 24-chip cut used to hide.
    for (const hour of [14, 15, 16]) {
      expect(
        within(afternoon).getByText(
          bookingTimeLabel(new Date(2026, 9, 5, hour).getTime()),
        ),
      ).toBeTruthy()
    }
  })

  it('pages the strip on to later dates with the next page’s `from`', async () => {
    render(<Booking />)
    await screen.findByText(bookingDayLabel(dayStart(0)))
    for (let n = 0; n < BOOKING_SLOT_PAGE_DAYS; n += 1) {
      expect(screen.getByText(bookingDayLabel(dayStart(n)))).toBeTruthy()
    }
    expect(screen.queryByText(bookingDayLabel(dayStart(BOOKING_SLOT_PAGE_DAYS)))).toBeNull()
    expect(screen.queryByRole('button', { name: 'Earlier dates' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Later dates' }))

    await screen.findByText(bookingDayLabel(dayStart(BOOKING_SLOT_PAGE_DAYS)))
    expect(slotRequests().at(-1)?.searchParams.get('from')).toBe(String(PAGE_ONE.nextFromMs))
    expect(screen.queryByText(bookingDayLabel(dayStart(0)))).toBeNull()
    // The horizon is loaded and shown: nothing later to ask for.
    expect(screen.queryByRole('button', { name: 'Later dates' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Earlier dates' }))
    expect(await screen.findByText(bookingDayLabel(dayStart(0)))).toBeTruthy()
    // Already loaded: going back asks the server for nothing.
    expect(slotRequests()).toHaveLength(2)
  })

  it('names the configured horizon when nothing is open', async () => {
    slotPayload = () => ({ slots: [], nextFromMs: null, horizonDays: 90 })
    render(<Booking />)
    expect(await screen.findByText('No open times in the next 90 days.')).toBeTruthy()
  })

  it('asks for the next page itself when one held no open day', async () => {
    slotPayload = (url) =>
      url.searchParams.get('from')
        ? PAGE_TWO
        : { slots: [], nextFromMs: PAGE_ONE.nextFromMs, horizonDays: 365 }
    render(<Booking />)
    expect(
      await screen.findByText(bookingDayLabel(dayStart(BOOKING_SLOT_PAGE_DAYS))),
    ).toBeTruthy()
    await waitFor(() => expect(slotRequests()).toHaveLength(2))
  })
})

describe('groupSlotsByLocalDay', () => {
  it('holds back a day the page ended inside until the next page completes it', () => {
    const day = dayOfSlots(0)
    // The page stopped at noon: the morning is loaded, the afternoon is not.
    const noon = new Date(2026, 9, 5, 12).getTime()
    const morning = day.filter((slot) => slot.startsAtMs < noon)
    expect(groupSlotsByLocalDay(morning, noon)).toEqual([])
    // Once the horizon is reached nothing is held back.
    expect(groupSlotsByLocalDay(morning, null)).toHaveLength(1)
    // A page that stopped on the next day keeps the whole day.
    const days = groupSlotsByLocalDay(day, PAGE_ONE.nextFromMs)
    expect(days).toEqual([{ startMs: dayStart(0), slots: day }])
  })
})
