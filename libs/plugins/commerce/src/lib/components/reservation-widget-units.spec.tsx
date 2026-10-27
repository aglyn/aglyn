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
 * The reservation widget on a several-unit resource (AGL-4044): a range is
 * refused only across a FULL night, and a guest is told "Only 2 left" when
 * the stay's scarcest night has a few units free. A one-unit resource never
 * sees the line.
 */

import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => jest.fn(),
}))

import ReservationWidget from './reservation-widget'

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

let payload: Record<string, unknown> = {}

beforeEach(() => {
  ;(global as unknown as { fetch: unknown }).fetch = jest
    .fn()
    .mockImplementation(async () => ({ ok: true, json: async () => payload }))
})

const pick = async (checkIn: string, checkOut: string) => {
  render(<ReservationWidget resourceId="res-1" />)
  await screen.findByText('RV hookups')
  fireEvent.change(screen.getByLabelText('Check-in'), {
    target: { value: checkIn },
  })
  fireEvent.change(screen.getByLabelText('Check-out'), {
    target: { value: checkOut },
  })
}

const resource = { name: 'RV hookups', nightlyRateUsd: 60, minNights: 1 }

describe('a several-unit resource', () => {
  beforeEach(() => {
    payload = {
      resource,
      // The 12th is full; the 10th and 11th have a few left.
      unavailable: [{ fromDayMs: day('2026-07-12'), toDayMs: day('2026-07-13') }],
      fewLeft: [
        { dayMs: day('2026-07-10'), unitsLeft: 3 },
        { dayMs: day('2026-07-11'), unitsLeft: 2 },
      ],
    }
  })

  it('says how few are left across the stay', async () => {
    await pick('2026-07-10', '2026-07-12')

    expect(await screen.findByText('Only 2 left')).toBeTruthy()
    expect(screen.queryByText('Those dates are unavailable.')).toBeNull()
  })

  it('says nothing when no night of the stay is scarce', async () => {
    await pick('2026-07-06', '2026-07-09')

    expect(await screen.findByText('3 nights')).toBeTruthy()
    expect(screen.queryByText(/^Only \d+ left$/)).toBeNull()
  })

  it('follows the threshold the store set for the resource (AGL-4044)', async () => {
    payload = {
      ...payload,
      resource: { ...resource, fewLeftAt: 10 },
      fewLeft: [{ dayMs: day('2026-07-10'), unitsLeft: 8 }],
    }
    await pick('2026-07-10', '2026-07-11')

    expect(await screen.findByText('Only 8 left')).toBeTruthy()
  })

  it('never shows the line when the store turned it off', async () => {
    payload = { ...payload, resource: { ...resource, fewLeftAt: 0 } }
    await pick('2026-07-10', '2026-07-12')

    expect(await screen.findByText('2 nights')).toBeTruthy()
    expect(screen.queryByText(/^Only \d+ left$/)).toBeNull()
  })

  it('refuses a stay across the full night', async () => {
    await pick('2026-07-11', '2026-07-14')

    expect(await screen.findByText('Those dates are unavailable.')).toBeTruthy()
    expect(screen.queryByText(/^Only \d+ left$/)).toBeNull()
  })
})

describe('a one-unit resource', () => {
  it('never shows the line, and refuses a booked night as before', async () => {
    payload = {
      resource,
      unavailable: [{ fromDayMs: day('2026-07-11'), toDayMs: day('2026-07-13') }],
    }

    await pick('2026-07-08', '2026-07-10')
    expect(await screen.findByText('2 nights')).toBeTruthy()
    expect(screen.queryByText(/^Only \d+ left$/)).toBeNull()

    fireEvent.change(screen.getByLabelText('Check-out'), {
      target: { value: '2026-07-12' },
    })
    expect(await screen.findByText('Those dates are unavailable.')).toBeTruthy()
  })
})

describe('how many guests (AGL-4043)', () => {
  it('asks up to what one unit sleeps, and holds the button for more', async () => {
    payload = { resource: { ...resource, capacity: 4 }, unavailable: [] }
    await pick('2026-07-08', '2026-07-10')
    expect(await screen.findByText('Up to 4')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'guest@example.com' } })
    fireEvent.change(screen.getByLabelText('Guests (optional)'), { target: { value: '5' } })
    expect(screen.getByText('Guests must be a whole number from 1 to 4')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reserve now' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Guests (optional)'), { target: { value: '3' } })
    expect((screen.getByRole('button', { name: 'Reserve now' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
