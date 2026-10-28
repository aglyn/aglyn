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
 * The Reservations card's "Guests" on a stay (AGL-4043): offered while the
 * stay is booked or checked in, never once it has ended or was cancelled,
 * and it opens the guests dialog (its own spec covers the route call).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import ReservationsCard from './reservations-card.component'

const stays: Array<Record<string, unknown>> = []
const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'staff-1' } }),
  useMerchantPayments: () => ({ blocked: false, reason: null, href: null }),
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: [{ $id: 'cabin', name: 'Cabin 3', nightlyRateUsd: 90, capacity: 6 }],
    status: 'success',
    fromCache: false,
  }),
  usePagedCollection: () => ({
    rows: stays,
    hasMore: false,
    page: 0,
    setPage: () => undefined,
    pageSize: 25,
    setPageSize: () => undefined,
  }),
  writeGuardedBySeed: jest.fn(),
}))
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: () => 'reservations',
  query: (name: string) => name,
  where: () => undefined,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
  getDocs: jest.fn(),
  deleteDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('./reservation-guests-dialog.component', () => ({
  __esModule: true,
  default: (props: { reservationId: string; onDone: (answer: unknown) => void }) => (
    <button onClick={() => props.onDone({ guests: 4, added: 1, removed: 0, unchanged: false })}>
      {`Save guests of ${props.reservationId}`}
    </button>
  ),
}))

const stay = (id: string, status: string) => ({
  $id: id,
  resourceId: 'cabin',
  status,
  checkInDayMs: Date.UTC(2027, 0, 14),
  checkOutDayMs: Date.UTC(2027, 0, 17),
  guestName: 'Pat Lee',
  guests: 3,
})

beforeEach(() => {
  jest.clearAllMocks()
  stays.length = 0
})

describe('a stay’s guests on the Reservations card', () => {
  it('is offered on a stay that is booked or checked in, never on one that has ended', () => {
    stays.push(
      stay('pending', 'pending'),
      stay('confirmed', 'confirmed'),
      stay('in', 'checked_in'),
      stay('out', 'checked_out'),
      stay('cancelled', 'cancelled'),
      stay('no-show', 'no_show'),
    )
    render(<ReservationsCard hostId="shop" />)
    expect(screen.getAllByRole('button', { name: 'Guests' })).toHaveLength(3)
    expect(screen.getAllByText(/3 guests/)).toHaveLength(6)
  })

  it('opens the guests dialog for the stay and says what changed', async () => {
    stays.push(stay('family', 'confirmed'))
    render(<ReservationsCard hostId="shop" />)
    fireEvent.click(screen.getByRole('button', { name: 'Guests' }))
    fireEvent.click(await screen.findByText('Save guests of family'))
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith('Guests changed to 4', { variant: 'success', persist: false }),
    )
    expect(screen.queryByText('Save guests of family')).toBeNull()
  })
})
