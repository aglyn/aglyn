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
 * A stay's guest count after it is booked (AGL-4043), rendered: the dialog
 * reads the stay and what its resource sleeps, keeps the count in range,
 * posts it to `/api/commerce/reservations/guests`, and shows the route's own
 * refusal (a count below how many are checked in).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()
const mockDocs: Record<string, Record<string, unknown> | undefined> = {}

// One instance, as the app's provider gives: the dialog reads again when it changes.
const mockDb = {}
const mockSignedIn = { data: { uid: 'cashier' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockSignedIn,
  useFirestore: () => mockDb,
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: async (path: string) => ({ data: () => mockDocs[path] }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { ReservationGuestsDialog } from './reservation-guests-dialog.component'

const answer = (status: number, body: Record<string, unknown>) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

beforeEach(() => {
  mockFetch.mockReset()
  mockDocs['hosts/shop/reservations/family'] = {
    resourceId: 'cabin',
    status: 'confirmed',
    guestName: 'Pat Lee',
    guests: 3,
  }
  mockDocs['hosts/shop/resources/cabin'] = { name: 'Cabin 3', nightlyRateUsd: 90, capacity: 6 }
})

function open(onDone = jest.fn(), onClose = jest.fn()) {
  render(<ReservationGuestsDialog reservationId="family" hostId="shop" onClose={onClose} onDone={onDone} />)
  return { onDone, onClose }
}

const field = () => screen.getByRole('textbox', { name: 'Guests' }) as HTMLInputElement

describe('a stay’s guests', () => {
  it('opens on the stay’s count and what its resource sleeps', async () => {
    open()
    expect(await screen.findByText('Cabin 3 · Pat Lee')).toBeTruthy()
    await waitFor(() => expect(field().value).toBe('3'))
    expect(screen.getByText('Up to 6, what this stay sleeps')).toBeTruthy()
  })

  it('keeps the count from 1 to what the resource sleeps before it asks', async () => {
    open()
    await waitFor(() => expect(field().value).toBe('3'))
    fireEvent.change(field(), { target: { value: '7' } })
    expect(screen.getByText('Guests must be a whole number from 1 to 6')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field(), { target: { value: '0' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts the new count and says what the route did', async () => {
    mockFetch.mockResolvedValue(answer(200, { guests: 5, previousGuests: 3, checkIns: { added: 2, removed: 0 } }))
    const { onDone } = open()
    await waitFor(() => expect(field().value).toBe('3'))
    fireEvent.change(field(), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ guests: 5, added: 2, removed: 0, unchanged: false }))
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commerce/reservations/guests')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'shop', reservationId: 'family', guests: 5 })
  })

  it('shows the route’s refusal and stays open', async () => {
    const refusal = '3 of this stay’s guests are already checked in today. Undo a check-in first, or keep 3 or more.'
    mockFetch.mockResolvedValue(answer(409, { error: refusal }))
    const { onDone } = open()
    await waitFor(() => expect(field().value).toBe('3'))
    fireEvent.change(field(), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(refusal)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('still works when the stay cannot be read, leaving the bounds to the route', async () => {
    mockDocs['hosts/shop/reservations/family'] = undefined
    mockFetch.mockResolvedValue(answer(200, { guests: 2, checkIns: { added: 0, removed: 0 } }))
    const { onDone } = open()
    await waitFor(() => expect(field().disabled).toBe(false))
    fireEvent.change(field(), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
