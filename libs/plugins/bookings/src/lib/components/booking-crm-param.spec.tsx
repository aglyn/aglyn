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
 * A BOOKING LINK FROM THE CRM, AS THE WIDGET READS IT (AGL-2660).
 *
 * The link a rep drops into an email names the service and the record:
 * `?service=…&crm=contact:…`. The widget opens on that service and carries
 * the record onto the booking request, so the booking lands on the record
 * even when the visitor books with a different address. A value that is
 * not a reference is never sent, and a service the site no longer offers
 * leaves the picker for the visitor.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Booking from './booking'

const FREE = {
  $id: 'svc-free',
  name: 'Intro consultation',
  durationMinutes: 15,
  priceUsd: 0,
}
const OTHER = {
  $id: 'svc-other',
  name: 'Deep tissue massage',
  durationMinutes: 60,
  priceUsd: 120,
}

const SLOT_MS = Date.UTC(2026, 8, 14, 17, 0)

/** The page the widget is on, as a booking link would open it. */
function openAt(search: string) {
  window.history.replaceState(null, '', `/book${search}`)
}

beforeEach(() => {
  mockSiteFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      services: [OTHER, FREE],
      slots: [{ startsAtMs: SLOT_MS, endsAtMs: SLOT_MS + 900_000 }],
    }),
  }))
})

afterEach(() => {
  openAt('')
  jest.restoreAllMocks()
})

/** The body the widget posted to `/api/bookings/book`. */
function postedBody(): Record<string, unknown> {
  const call = mockSiteFetch.mock.calls.find((one) => one[0] === '/api/bookings/book')
  return JSON.parse(String(call?.[1]?.body ?? '{}'))
}

/** From a preselected service: pick the slot, fill the form, confirm. */
async function bookThroughTheLink() {
  fireEvent.click(await screen.findByText(new Date(SLOT_MS).toLocaleDateString()))
  fireEvent.click(
    await screen.findByText(
      new Date(SLOT_MS).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    ),
  )
  fireEvent.change(await screen.findByLabelText('Your name'), {
    target: { value: 'Ada Lovelace' },
  })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
  await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
}

describe('a booking link from a CRM record', () => {
  it('opens the widget on the service it names and carries the record onto the request', async () => {
    openAt('?service=svc-free&crm=contact%3Acontact-1')
    render(<Booking />)
    // Preselected: the select prints the service without a click.
    await screen.findByText(/Intro consultation · 15 min/)
    await bookThroughTheLink()
    expect(postedBody()).toMatchObject({
      hostId: 'host-1',
      serviceId: 'svc-free',
      crmRef: 'contact:contact-1',
    })
  })

  it('sends no reference for a value that is not one', async () => {
    openAt('?service=svc-free&crm=company%3Ax')
    render(<Booking />)
    await screen.findByText(/Intro consultation · 15 min/)
    await bookThroughTheLink()
    expect(postedBody()).not.toHaveProperty('crmRef')
  })

  it('leaves the picker for the visitor when the service is gone', async () => {
    openAt('?service=svc-retired')
    render(<Booking />)
    await screen.findByLabelText('Service')
    expect(screen.queryByText(/Intro consultation · 15 min/)).toBeNull()
    expect(screen.queryByText(/Deep tissue massage · 60 min/)).toBeNull()
  })
})
