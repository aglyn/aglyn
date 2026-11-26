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
 * The Calendar element (AGL-4252): month grid on a wide screen, the agenda
 * list on a phone, category chips that filter the read, the details dialog
 * with tickets and add to calendar, and nothing at all where v2 is off.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type {
  CalendarOccurrence,
  CalendarRangeResponse,
} from '../model/event-calendar-feed'
import EventCalendar from './event-calendar'

let phone = false
jest.mock('@mui/material/useMediaQuery', () => ({
  __esModule: true,
  default: () => phone,
}))

const ZONE = 'UTC'
const NOW = Date.UTC(2026, 10, 10, 12)
const at = (day: number, hour: number) => Date.UTC(2026, 10, day, hour)

const occurrence = (
  overrides: Partial<CalendarOccurrence>,
): CalendarOccurrence => ({
  id: 'practice:2026-11-12',
  eventId: 'practice',
  title: 'Thursday night training',
  startsAtMs: at(12, 18),
  endsAtMs: at(12, 21),
  dayKey: '2026-11-12',
  timeZone: ZONE,
  location: 'Main track',
  categoryIds: ['mx'],
  repeatText: 'Every week on Thursday',
  ticket: {
    label: 'Get tickets',
    caption: '$20',
    action: {
      kind: 'post',
      endpoint: '/api/commerce/cart',
      body: { productId: 'pass' },
      notify: 'aglyn:cart-updated',
      done: 'Added to your cart',
    },
  },
  ...overrides,
})

const answer = (
  overrides: Partial<CalendarRangeResponse> = {},
): CalendarRangeResponse => ({
  enabled: true,
  timeZone: ZONE,
  categories: [
    { $id: 'mx', name: 'MX Training', color: '#1E88E5', order: 0 },
    { $id: 'kids', name: 'Kids Camp', color: '#43A047', order: 1 },
  ],
  occurrences: [
    occurrence({}),
    occurrence({
      id: 'camp:2026-11-21',
      eventId: 'camp',
      title: 'Kids camp',
      startsAtMs: at(21, 9),
      endsAtMs: at(21, 15),
      dayKey: '2026-11-21',
      categoryIds: ['kids'],
      repeatText: '',
      ticket: null,
    }),
  ],
  ...overrides,
})

const originalFetch = global.fetch
let calls: string[] = []
let posted: Array<{ url: string; body: unknown }> = []

function mount(body: CalendarRangeResponse, props = {}) {
  calls = []
  posted = []
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({}) }
    }
    calls.push(url)
    return { ok: true, json: async () => body }
  }) as any
  return render(
    <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
      <EventCalendar {...props} />
    </Aglyn.SiteContext.Provider>,
  )
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
  })
  phone = false
})
afterEach(() => {
  jest.useRealTimers()
  global.fetch = originalFetch
})

describe('the Calendar element', () => {
  it('draws the month with each date in its day and the category chips', async () => {
    mount(answer())
    await waitFor(() => expect(screen.getByText('November 2026')).toBeTruthy())
    expect(calls[0]).toContain(
      '/api/events/occurrences?hostId=host-1&from=2026-11-01&to=2026-12-06',
    )
    const cell = screen.getByRole('gridcell', { name: 'Thursday, November 12' })
    expect(within(cell).getByText('Thursday night training')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'MX Training' })).toBeTruthy()
  })

  it('filters by a category chip, reading again for it', async () => {
    mount(answer())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kids Camp' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Kids Camp' }))
    await waitFor(() =>
      expect(calls.some((url) => url.includes('category=kids'))).toBe(true),
    )
  })

  it('shows a phone the agenda list, by day, with the ticket button', async () => {
    phone = true
    mount(answer())
    await waitFor(() =>
      expect(screen.getByText('Thursday, November 12')).toBeTruthy(),
    )
    expect(screen.queryByRole('grid')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Calendar view' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Get tickets' })).toHaveLength(
      1,
    )
    expect(calls[0]).toContain('from=2026-11-10&to=2027-01-09')
  })

  it('opens a date with its details; Get tickets posts to the owning door and says so', async () => {
    mount(answer())
    await waitFor(() =>
      expect(screen.getByText('Thursday night training')).toBeTruthy(),
    )
    fireEvent.click(screen.getByText('Thursday night training'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Every week on Thursday')).toBeTruthy()
    const google = within(dialog).getByRole('link', {
      name: 'Add to Google Calendar',
    })
    expect(google.getAttribute('href')).toContain('calendar.google.com')
    expect(
      within(dialog)
        .getByRole('link', { name: 'Apple or Outlook (.ics)' })
        .getAttribute('href'),
    ).toBe('/api/events/ics?hostId=host-1&event=practice&on=2026-11-12')
    const notified = jest.fn()
    window.addEventListener('aglyn:cart-updated', notified)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get tickets' }))
    await waitFor(() =>
      expect(within(dialog).getByText('Added to your cart')).toBeTruthy(),
    )
    expect(posted).toEqual([
      { url: '/api/commerce/cart', body: { productId: 'pass' } },
    ])
    expect(notified).toHaveBeenCalled()
    window.removeEventListener('aglyn:cart-updated', notified)
  })

  it('renders nothing where calendar v2 is off', async () => {
    const { container } = mount({
      enabled: false,
      timeZone: ZONE,
      categories: [],
      occurrences: [],
    })
    await waitFor(() =>
      expect(container.querySelector('[role="progressbar"]')).toBeNull(),
    )
    expect(container.textContent).toBe('')
  })

  it('says why it is empty in Preview where v2 is off', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        enabled: false,
        timeZone: ZONE,
        categories: [],
        occurrences: [],
      }),
    })) as any
    render(
      <Aglyn.SiteContext.Provider value={{ hostId: 'host-1', preview: true }}>
        <EventCalendar />
      </Aglyn.SiteContext.Provider>,
    )
    await waitFor(() =>
      expect(
        screen.getByText(/once the new events calendar is on/),
      ).toBeTruthy(),
    )
  })
})
