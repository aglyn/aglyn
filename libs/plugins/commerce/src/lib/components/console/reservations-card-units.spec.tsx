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
 * The Reservations card for a resource with several identical units
 * (AGL-4044): the editor's "Spots or units available" field beside "Sleeps",
 * the units left on each of the next 14 nights, and a walk-in that takes any
 * unit free on every night. A one-unit resource draws and saves as before.
 *
 * The walk-in is written by `/api/commerce/reservations/walk-in` (AGL-4046),
 * not by the browser: the card keeps its instant check for the message, then
 * posts, and shows the route's refusal when another device took the unit.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import ReservationsCard from './reservations-card.component'

const DAY = 86_400_000
const now = new Date()
const TODAY = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
const iso = (dayMs: number) => new Date(dayMs).toISOString().slice(0, 10)

const collections: Record<string, Array<Record<string, unknown>>> = {
  resources: [],
  reservations: [],
}
/** Every query a collection listener was built from, `null` included. */
const builtQueries: unknown[] = []

const signedIn = { uid: 'staff-1' }
const authorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetch(...args),
}))
const answer = (status: number, body: Record<string, unknown>) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: signedIn }),
  useMerchantPayments: () => ({ blocked: false, reason: null, href: null }),
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => {
    const built = build()
    builtQueries.push(built)
    return {
      data: built ? (collections[built as string] ?? []) : [],
      status: 'success',
      fromCache: false,
    }
  },
  usePagedCollection: () => ({
    rows: [],
    hasMore: false,
    page: 0,
    setPage: () => undefined,
    pageSize: 25,
    setPageSize: () => undefined,
  }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
  getDocs: jest.fn(async () => ({
    docs: (collections['reservations'] ?? []).map((row) => ({
      data: () => row,
    })),
  })),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

const hookups = {
  $id: 'hookups',
  name: 'RV hookups',
  nightlyRateUsd: 60,
  units: 12,
}
const cabin = { $id: 'cabin', name: 'Cabin', nightlyRateUsd: 120 }

const stayOn = (
  resourceId: string,
  fromDay: number,
  toDay: number,
  status = 'confirmed',
) => ({
  resourceId,
  status,
  checkInDayMs: TODAY + fromDay * DAY,
  checkOutDayMs: TODAY + toDay * DAY,
  createdAtMs: Date.now() - DAY,
})

beforeEach(() => {
  jest.clearAllMocks()
  authorizedFetch.mockResolvedValue(answer(200, { reservationId: 'stay-1' }))
  builtQueries.length = 0
  collections['resources'] = []
  collections['reservations'] = []
})

describe('units left on the next 14 nights', () => {
  it('draws a several-unit resource night by night', () => {
    collections['resources'] = [hookups]
    collections['reservations'] = [
      stayOn('hookups', 0, 2),
      stayOn('hookups', 1, 3),
      stayOn('hookups', 1, 2, 'cancelled'),
      // Another resource's stay never counts against the hookups.
      stayOn('cabin', 0, 5),
    ]

    render(<ReservationsCard hostId="host-1" />)

    expect(screen.getByText('RV hookups · $60/night · 12 units')).toBeTruthy()
    const nights = screen.getAllByText(/ of 12 left$/)
    expect(nights).toHaveLength(14)
    expect(nights[0].textContent).toMatch(/· 11 of 12 left$/)
    expect(nights[1].textContent).toMatch(/· 10 of 12 left$/)
    expect(nights[2].textContent).toMatch(/· 11 of 12 left$/)
    expect(nights[3].textContent).toMatch(/· 12 of 12 left$/)
  })

  it('reads no stays and draws nothing while every resource has one unit', () => {
    collections['resources'] = [cabin]
    collections['reservations'] = [stayOn('cabin', 0, 2)]

    render(<ReservationsCard hostId="host-1" />)

    expect(screen.getByText('Cabin · $120/night')).toBeTruthy()
    expect(screen.queryByText(/ left$/)).toBeNull()
    expect(builtQueries).toContain(null)
    expect(builtQueries.filter((built) => built === 'reservations')).toEqual([])
  })
})

describe('the resource editor', () => {
  const openEditor = (index = 0) => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[index])
  }

  it('labels units apart from how many a unit sleeps', () => {
    collections['resources'] = [cabin]
    render(<ReservationsCard hostId="host-1" />)
    openEditor()

    expect(screen.getByLabelText('Spots or units available')).toBeTruthy()
    expect(screen.getByLabelText('Sleeps')).toBeTruthy()
  })

  it('leaves a one-unit resource’s stored fields as they were', async () => {
    collections['resources'] = [cabin]
    render(<ReservationsCard hostId="host-1" />)
    openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload).not.toHaveProperty('units')
  })

  it('saves the units typed', async () => {
    collections['resources'] = [cabin]
    render(<ReservationsCard hostId="host-1" />)
    openEditor()
    fireEvent.change(screen.getByLabelText('Spots or units available'), {
      target: { value: '12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect((setDoc as jest.Mock).mock.calls[0][1].units).toBe(12)
  })

  it('writes a cleared field back as one unit', async () => {
    collections['resources'] = [hookups]
    render(<ReservationsCard hostId="host-1" />)
    openEditor()
    fireEvent.change(screen.getByLabelText('Spots or units available'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    expect((setDoc as jest.Mock).mock.calls[0][1].units).toBe(1)
  })

  it('refuses a count out of range', () => {
    collections['resources'] = [cabin]
    render(<ReservationsCard hostId="host-1" />)
    openEditor()
    fireEvent.change(screen.getByLabelText('Spots or units available'), {
      target: { value: '501' },
    })

    expect(screen.getByText('A whole number from 1 to 500')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe('a walk-in on a several-unit resource', () => {
  const walkIn = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Walk-in' }))
    fireEvent.change(screen.getByLabelText('Check-in'), {
      target: { value: iso(TODAY + 1 * DAY) },
    })
    fireEvent.change(screen.getByLabelText('Check-out'), {
      target: { value: iso(TODAY + 3 * DAY) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reserve' }))
  }

  it('takes a unit that is free on every night, through the walk-in route', async () => {
    collections['resources'] = [{ ...hookups, units: 3 }]
    collections['reservations'] = [
      stayOn('hookups', 1, 3),
      stayOn('hookups', 2, 4),
    ]
    render(<ReservationsCard hostId="host-1" />)

    await walkIn()

    await waitFor(() => expect(authorizedFetch).toHaveBeenCalledTimes(1))
    const [user, url, init] = authorizedFetch.mock.calls[0]
    expect(user).toBe(signedIn)
    expect(url).toBe('/api/commerce/reservations/walk-in')
    expect(init.method).toBe('POST')
    const sent = JSON.parse(init.body)
    expect(sent).toMatchObject({
      hostId: 'host-1',
      resourceId: 'hookups',
      checkInDayMs: TODAY + 1 * DAY,
      checkOutDayMs: TODAY + 3 * DAY,
    })
    expect(typeof sent.reservationId).toBe('string')
    // The browser no longer writes the stay itself.
    expect(setDoc).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Walk-in reserved — collect payment at POS',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('shows the route’s refusal when another device took the last unit', async () => {
    collections['resources'] = [{ ...hookups, units: 3 }]
    authorizedFetch.mockResolvedValue(
      answer(409, { error: 'Every unit is taken on at least one of those nights' }),
    )
    render(<ReservationsCard hostId="host-1" />)

    await walkIn()

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Every unit is taken on at least one of those nights',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(enqueueSnackbar).not.toHaveBeenCalledWith(
      'Walk-in reserved — collect payment at POS',
      expect.anything(),
    )
    // The dialog stays open on the dates, to pick others.
    expect(screen.getByRole('button', { name: 'Reserve' })).toBeTruthy()
  })

  it('sends one attempt id for a retry of the same walk-in', async () => {
    collections['resources'] = [cabin]
    authorizedFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(200, { reservationId: 'stay-1' }))
    render(<ReservationsCard hostId="host-1" />)

    await walkIn()
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Could not reserve the walk-in — try again',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reserve' }))

    await waitFor(() => expect(authorizedFetch).toHaveBeenCalledTimes(2))
    const ids = authorizedFetch.mock.calls.map(
      ([, , init]) => JSON.parse(init.body).reservationId,
    )
    expect(ids[0]).toBe(ids[1])
  })

  it('is refused when one night has no unit left', async () => {
    collections['resources'] = [{ ...hookups, units: 3 }]
    collections['reservations'] = [
      stayOn('hookups', 1, 3),
      stayOn('hookups', 2, 4),
      stayOn('hookups', 2, 3),
    ]
    render(<ReservationsCard hostId="host-1" />)

    await walkIn()

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Every unit is taken on at least one of those nights',
        expect.anything(),
      ),
    )
    expect(authorizedFetch).not.toHaveBeenCalled()
  })

  it('still says "Those dates are taken" on a one-unit resource', async () => {
    collections['resources'] = [cabin]
    collections['reservations'] = [stayOn('cabin', 2, 3)]
    render(<ReservationsCard hostId="host-1" />)

    await walkIn()

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Those dates are taken',
        expect.anything(),
      ),
    )
    expect(authorizedFetch).not.toHaveBeenCalled()
  })
})
