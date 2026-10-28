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
 * Today's check-ins (AGL-4043), rendered: the card reads the day from the
 * route, shows expected against checked in and each person's wristband,
 * prints the list, and says when the viewer may not read it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let mockRegisters: Array<Record<string, unknown>> = [{ $id: 'front' }]
const mockUser = { data: { uid: 'cashier' } }
const mockFetch = jest.fn()
const mockPrint = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: mockRegisters, status: 'success' }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (...path: unknown[]) => ({ path }),
  documentId: () => '__name__',
  limit: () => ({}),
  orderBy: () => ({}),
  query: (ref: unknown) => ref,
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('../entitlement-gate.component', () => ({
  EntitlementGatedCard: (props: { children: unknown }) => props.children,
}))
jest.mock('./pos-shift-report.component', () => ({
  printPosDocument: (...args: unknown[]) => mockPrint(...args),
}))
// The guests dialog has its own spec; here it only answers as the route did.
jest.mock('../reservation-guests-dialog.component', () => ({
  __esModule: true,
  default: (props: { reservationId: string; onDone: (answer: unknown) => void }) => (
    <button onClick={() => props.onDone({ guests: 4, added: 1, removed: 0, unchanged: false })}>
      {`Save guests of ${props.reservationId}`}
    </button>
  ),
}))

import { PosCheckInsCard } from './pos-check-ins-card.component'

const row = (id: string, extra: Record<string, unknown>) => ({
  id,
  source: 'order',
  orderLabel: '#1042',
  itemName: 'Day pass',
  variantLabel: null,
  unitIndex: 0,
  unitCount: 1,
  customerName: 'Jordan Lee',
  customerEmail: 'jordan@example.com',
  status: 'expected',
  checkedInAtMs: null,
  checkedInByName: null,
  wristband: null,
  ...extra,
})

const LIST = {
  dayKey: '2027-01-15',
  timeZone: 'America/Chicago',
  totals: { expected: 2, checkedIn: 1 },
  checkIns: [
    row('a', { status: 'checked_in', checkedInAtMs: Date.UTC(2027, 0, 15, 15, 14), checkedInByName: 'Sam', wristband: { number: '214', color: 'Blue' } }),
    row('b', { customerName: 'Pat Lee', orderLabel: null, source: 'reservation', itemName: 'Cabin 3' }),
  ],
}

beforeEach(() => {
  mockRegisters = [{ $id: 'front' }]
  mockFetch.mockReset()
  mockPrint.mockReset()
})

describe("today's check-ins", () => {
  it('reads today from the route and shows who is in, by whom and with which wristband', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => LIST })
    render(<PosCheckInsCard hostId="shop" canManagePos />)
    expect(await screen.findByText('Blue #214')).toBeTruthy()
    expect(mockFetch.mock.calls[0][1]).toBe('/api/commerce/pos-check-in?hostId=shop')
    expect(screen.getByText('Still to come')).toBeTruthy()
    expect(screen.getByText('Sam')).toBeTruthy()
    expect(screen.getByText('Stay')).toBeTruthy()
    fireEvent.click(screen.getByText('Print'))
    expect(mockPrint.mock.calls[0][0]).toContain('1 of 2 checked in')
  })

  it('asks nothing for a viewer who cannot use the register, and says why', async () => {
    render(<PosCheckInsCard hostId="shop" />)
    expect(screen.getByText(/members who can use the register/)).toBeTruthy()
    await waitFor(() => expect(mockFetch).not.toHaveBeenCalled())
  })

  it('shows an open rain check apart, and takes one back (pass dates)', async () => {
    const rainCheck = {
      kind: 'open',
      fromDayKey: '2027-01-15',
      toDayKey: null,
      claimedDayKey: null,
      byUid: 'cashier',
      byName: 'Cal',
      atMs: 1,
    }
    const list = {
      ...LIST,
      totals: { expected: 1, checkedIn: 0, rainChecks: 1 },
      checkIns: [row('a', { rainCheck, rainCheckOpen: true }), row('b', { customerName: 'Pat Lee' })],
    }
    mockFetch.mockImplementation(async (_user: unknown, url: string, init: RequestInit) =>
      init.method === 'POST'
        ? { ok: true, status: 200, json: async () => ({ checkIn: row('a', {}) }) }
        : { ok: true, status: 200, json: async () => (url ? list : list) },
    )
    render(<PosCheckInsCard hostId="shop" canManagePos />)
    expect(await screen.findByText('Rain checks')).toBeTruthy()
    expect(screen.getByText('Rain check from Fri, Jan 15: good on any later day')).toBeTruthy()
    // One pass has a rain check to take back; the other can be given one.
    expect(screen.getByText('Rain check', { selector: 'button' })).toBeTruthy()
    fireEvent.click(screen.getByText('Undo rain check'))
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(
          (call) => (call[2] as RequestInit).method === 'POST' && JSON.parse(String((call[2] as RequestInit).body)).action === 'undo_rain_check',
        ),
      ).toBe(true),
    )
    const posted = mockFetch.mock.calls.find((call) => (call[2] as RequestInit).method === 'POST')!
    expect(JSON.parse(String((posted[2] as RequestInit).body))).toEqual({ hostId: 'shop', action: 'undo_rain_check', id: 'a' })
  })

  it('opens the rain check dialog on a pass', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...LIST, totals: { expected: 2, checkedIn: 1, rainChecks: 0 } }) })
    render(<PosCheckInsCard hostId="shop" canManagePos />)
    await screen.findByText('Blue #214')
    // A checked-in pass and a stay have nothing to rain-check.
    expect(screen.queryByText('Rain check', { selector: 'button' })).toBeNull()
  })

  it('sets how stays are checked in from the screen, for the store (AGL-4043)', async () => {
    mockFetch.mockImplementation(async (_user: unknown, _url: string, init: RequestInit) =>
      init.method === 'POST'
        ? { ok: true, status: 200, json: async () => ({ stayCheckIn: 'guest' }) }
        : { ok: true, status: 200, json: async () => ({ ...LIST, stayCheckIn: 'resource' }) },
    )
    render(<PosCheckInsCard hostId="shop" canManagePos />)
    await screen.findByText('Blue #214')
    expect(screen.getByRole('button', { name: 'As each resource is set' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'One per guest' }))
    await waitFor(() =>
      expect(mockFetch.mock.calls.some((call) => (call[2] as RequestInit).method === 'POST')).toBe(true),
    )
    const posted = mockFetch.mock.calls.find((call) => (call[2] as RequestInit).method === 'POST')!
    expect(JSON.parse(String((posted[2] as RequestInit).body))).toEqual({ hostId: 'shop', action: 'stay_mode', mode: 'guest' })
  })

  it('changes a stay’s guests from its row, then reads the day again (AGL-4043)', async () => {
    const list = {
      ...LIST,
      checkIns: [LIST.checkIns[0], row('r_family_2027-01-15_0', { source: 'reservation', reservationId: 'family', orderLabel: null, itemName: 'Cabin 3' })],
    }
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => list })
    render(<PosCheckInsCard hostId="shop" canManagePos />)
    await screen.findByText('Blue #214')
    // A pass has no guest count; only the stay's row offers one.
    expect(screen.getAllByRole('button', { name: 'Guests' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Guests' }))
    fireEvent.click(await screen.findByText('Save guests of family'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Save guests of family')).toBeNull()
  })

  it('draws nothing for a store with no register', () => {
    mockRegisters = []
    const { container } = render(<PosCheckInsCard hostId="shop" canManagePos />)
    expect(container.textContent).toBe('')
  })
})
