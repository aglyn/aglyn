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
 * THE WIDGET ASKS FOR WHAT THE SERVICE ASKS FOR (AGL-3493).
 *
 * An on-site service asks the booker for a phone and the job's address.
 * The widget renders the fields the service's listing names, holds Confirm
 * until the required ones read, and posts them; a service that asks for
 * neither shows a name and an email, as it always did.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Booking, { bookingDayLabel, bookingTimeLabel } from './booking'

const ON_SITE = {
  $id: 'svc-estimate',
  name: 'Free on-site estimate',
  durationMinutes: 60,
  priceUsd: 0,
  askPhone: 'required',
  askAddress: 'required',
}
const CALL = {
  $id: 'svc-call',
  name: 'Intro call',
  durationMinutes: 15,
  priceUsd: 0,
  askPhone: 'off',
  askAddress: 'off',
}

const SLOT_MS = new Date(2026, 9, 5, 9).getTime()

beforeEach(() => {
  mockSiteFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      services: [ON_SITE, CALL],
      slots: [{ startsAtMs: SLOT_MS, endsAtMs: SLOT_MS + 3_600_000 }],
      nextFromMs: null,
    }),
  }))
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

async function pickSlotAndName(serviceId: string) {
  window.history.replaceState(null, '', `/contact?service=${serviceId}`)
  render(<Booking />)
  fireEvent.click(await screen.findByText(bookingDayLabel(SLOT_MS)))
  fireEvent.click(await screen.findByText(bookingTimeLabel(SLOT_MS)))
  fireEvent.change(await screen.findByLabelText('Your name'), {
    target: { value: 'Ada Lovelace' },
  })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
}

const confirmButton = () => screen.getByRole('button', { name: 'Confirm booking' })

describe('a service that asks for a phone and an address', () => {
  it('holds Confirm until both read, then posts them', async () => {
    await pickSlotAndName(ON_SITE.$id)
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: 'soon' } })
    expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '(512) 555-0107' } })
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/^Address/), {
      target: { value: '12 Oak St\nAustin, TX 78701' },
    })
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(confirmButton())
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    const body = JSON.parse(String(mockSiteFetch.mock.calls[0][1].body))
    expect(body).toMatchObject({
      serviceId: ON_SITE.$id,
      phone: '+15125550107',
      address: '12 Oak St\nAustin, TX 78701',
    })
  })
})

describe('a service that asks for neither', () => {
  it('shows a name and an email only, and posts neither field', async () => {
    await pickSlotAndName(CALL.$id)
    expect(screen.queryByLabelText(/^Phone/)).toBeNull()
    expect(screen.queryByLabelText(/^Address/)).toBeNull()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    const body = JSON.parse(String(mockSiteFetch.mock.calls[0][1].body))
    expect(body).not.toHaveProperty('phone')
    expect(body).not.toHaveProperty('address')
  })
})
