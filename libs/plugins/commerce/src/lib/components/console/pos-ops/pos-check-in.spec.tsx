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
 * Check-in at the window (AGL-4043), rendered: the register asks the server
 * for who is due, checks each person in with a wristband, says who already
 * did it, and draws the generic check-in zone with one customer's day and
 * nothing else.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ReactNode } from 'react'

const mockUser = { data: { uid: 'cashier' } }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [{ $id: 'front' }], status: 'success' }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import { PosCheckInDialog } from './pos-check-in-dialog.component'
import { PosCustomerLookup } from './pos-customer-lookup.component'

const reply = (status: number, body: Record<string, unknown>) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const ROW = {
  source: 'order',
  orderId: 'o1',
  orderLabel: '#1042',
  channel: 'online',
  reservationId: null,
  lineIndex: 0,
  unitCount: 2,
  productId: 'pass',
  variantId: 'adult',
  itemName: 'Day pass',
  variantLabel: 'Adult',
  dayKey: '2027-01-15',
  customerKey: 'email:jordan@example.com',
  customerName: 'Jordan Lee',
  customerEmail: 'Jordan@Example.com',
  customerEmailLower: 'jordan@example.com',
  customerPhone: null,
  contactId: null,
  searchTokens: [],
  status: 'expected',
  checkedInAtMs: null,
  checkedInBy: null,
  checkedInByName: null,
  wristband: null,
  checkInAttempt: null,
  undoneAtMs: null,
  undoneBy: null,
  createdAtMs: 0,
  updatedAtMs: 0,
}
const ROWS = [
  { ...ROW, id: 'o_o1_0_0', unitIndex: 0 },
  { ...ROW, id: 'o_o1_0_1', unitIndex: 1 },
]
const CUSTOMER = {
  customerKey: 'email:jordan@example.com',
  name: 'Jordan Lee',
  email: 'Jordan@Example.com',
  phone: null,
  contactId: null,
  unitsDue: 2,
  unitsCheckedIn: 0,
  items: ['Day pass'],
}
const DAY = { dayKey: '2027-01-15', timeZone: 'America/Chicago' }

/** Every zone the dialog draws, with the props it was handed. */
const zones: Array<Record<string, unknown>> = []
function Shell(props: { children: ReactNode }) {
  return (
    <ConsoleWidgetSlotContext.Provider
      value={(zoneProps) => {
        zones.push(zoneProps)
        return <span>{`zone:${String(zoneProps['placement'])}`}</span>
      }}
    >
      {props.children}
    </ConsoleWidgetSlotContext.Provider>
  )
}

const bodyOf = (call: unknown[]) => JSON.parse(String((call[2] as RequestInit).body))

beforeEach(() => {
  mockFetch.mockReset()
  zones.length = 0
})

describe('the check-in dialog', () => {
  it('searches on the server, then lists the customer with what they have left', async () => {
    mockFetch.mockResolvedValue(reply(200, { ...DAY, customers: [CUSTOMER] }))
    render(
      <Shell>
        <PosCheckInDialog open hostId="shop" registerId="front" onClose={jest.fn()} />
      </Shell>,
    )
    fireEvent.change(screen.getByLabelText('Find a customer'), { target: { value: 'jor' } })
    expect(await screen.findByText('Jordan Lee')).toBeTruthy()
    expect(screen.getByText(/0 of 2 checked in · Day pass/)).toBeTruthy()
    const [, url] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commerce/pos-check-in')
    expect(bodyOf(mockFetch.mock.calls[0])).toEqual({ hostId: 'shop', action: 'search', text: 'jor' })
    // The zone gets one customer on one day, and nothing about why.
    expect(zones.find((zone) => zone['placement'] === 'check-in-row')).toEqual({
      slot: 'posCheckIn',
      hostId: 'shop',
      orgId: undefined,
      contactId: null,
      email: 'jordan@example.com',
      dayKey: '2027-01-15',
      name: 'Jordan Lee',
      unitsDue: 2,
      placement: 'check-in-row',
    })
  })

  it('checks one person in with a wristband number, once per tap, as the PIN’s cashier', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, { ...DAY, customer: CUSTOMER, checkIns: ROWS }))
    render(
      <Shell>
        <PosCheckInDialog
          open
          hostId="shop"
          registerId="front"
          cashierAssertion="pin-token"
          initialCustomer={{ email: 'jordan@example.com' }}
          onClose={jest.fn()}
        />
      </Shell>,
    )
    expect(await screen.findByText('Day pass · Adult (1 of 2)')).toBeTruthy()
    expect(bodyOf(mockFetch.mock.calls[0])).toEqual({ hostId: 'shop', action: 'customer', email: 'jordan@example.com' })
    expect(screen.getByText('zone:check-in-customer')).toBeTruthy()
    mockFetch.mockResolvedValueOnce(
      reply(200, {
        checkedIn: [
          {
            ...ROWS[0],
            status: 'checked_in',
            checkedInAtMs: Date.UTC(2027, 0, 15, 15, 14),
            checkedInByName: 'Sam',
            wristband: { number: '214', color: null },
          },
        ],
        alreadyCheckedIn: [],
      }),
    )
    fireEvent.change(screen.getAllByLabelText('Wristband number')[0]!, { target: { value: '214' } })
    fireEvent.click(screen.getAllByText('Check in')[0]!)
    expect(await screen.findByText('Checked in at 9:14 AM by Sam · #214')).toBeTruthy()
    const [, , init] = mockFetch.mock.calls[1]
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'shop',
      action: 'check_in',
      checkIns: [{ id: 'o_o1_0_0', wristband: { number: '214', color: '' } }],
      day: '2027-01-15',
      registerId: 'front',
      cashierAssertion: 'pin-token',
    })
    expect(init.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('says who already checked a person in, and when', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, { ...DAY, customer: CUSTOMER, checkIns: ROWS }))
    render(<PosCheckInDialog open hostId="shop" initialCustomer={{ customerKey: CUSTOMER.customerKey }} onClose={jest.fn()} />)
    await screen.findByText('Day pass · Adult (1 of 2)')
    mockFetch.mockResolvedValueOnce(
      reply(200, {
        checkedIn: [],
        alreadyCheckedIn: [{ ...ROWS[0], status: 'checked_in', checkedInAtMs: Date.UTC(2027, 0, 15, 15, 14), checkedInByName: 'Sam' }],
      }),
    )
    fireEvent.click(screen.getByText('Check in all 2'))
    expect(await screen.findByText('Already checked in at 9:14 AM by Sam')).toBeTruthy()
  })

  it('undoes a check-in', async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, {
        ...DAY,
        customer: CUSTOMER,
        checkIns: [{ ...ROWS[0], status: 'checked_in', checkedInAtMs: 1, checkedInByName: 'Sam' }],
      }),
    )
    render(<PosCheckInDialog open hostId="shop" initialCustomer={{ customerKey: CUSTOMER.customerKey }} onClose={jest.fn()} />)
    mockFetch.mockResolvedValueOnce(reply(200, { checkIn: { ...ROWS[0], status: 'expected' } }))
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(screen.getByText('Check in')).toBeTruthy())
    expect(bodyOf(mockFetch.mock.calls[1])).toEqual({ hostId: 'shop', action: 'undo', id: 'o_o1_0_0' })
  })
})

describe('rain checks at the window (pass dates)', () => {
  const open = async (rows: unknown[]) => {
    mockFetch.mockResolvedValueOnce(reply(200, { ...DAY, customer: CUSTOMER, checkIns: rows }))
    render(
      <PosCheckInDialog
        open
        hostId="shop"
        registerId="front"
        cashierAssertion="pin-token"
        initialCustomer={{ customerKey: CUSTOMER.customerKey }}
        onClose={jest.fn()}
      />,
    )
    await screen.findByText('Day pass · Adult (1 of 2)')
  }
  const rainCheck = {
    kind: 'open',
    fromDayKey: '2027-01-15',
    toDayKey: null,
    claimedDayKey: null,
    byUid: 'cashier',
    byName: 'Cal',
    atMs: 1,
  }

  it('gives an open rain check on a pass, as the PIN’s cashier, and says so on the row', async () => {
    await open(ROWS)
    fireEvent.click(screen.getAllByText('Rain check')[0]!)
    expect(screen.getByLabelText('Open: good on any later day until it is used')).toBeTruthy()
    mockFetch.mockResolvedValueOnce(
      reply(200, { checkIn: { ...ROWS[0], rainCheck, rainCheckOpen: true } }),
    )
    fireEvent.click(screen.getByText('Give rain check'))
    expect(await screen.findByText(/Rain check from Fri, Jan 15: good on any later day/)).toBeTruthy()
    expect(bodyOf(mockFetch.mock.calls[1])).toEqual({
      hostId: 'shop',
      action: 'rain_check',
      id: 'o_o1_0_0',
      kind: 'open',
      registerId: 'front',
      cashierAssertion: 'pin-token',
    })
    // An open rain check is used one at a time: "Check in all" leaves it.
    expect(screen.queryByText('Check in all 2')).toBeNull()
    expect(screen.getByText('Undo rain check')).toBeTruthy()
  })

  it('asks for the new day before moving a pass', async () => {
    await open(ROWS)
    fireEvent.click(screen.getAllByText('Rain check')[0]!)
    fireEvent.click(screen.getByLabelText('Move it to a day'))
    expect(screen.getAllByLabelText('New day').length).toBeGreaterThan(0)
    expect((screen.getByText('Give rain check').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a pass moved to another day with only its undo, and takes the rain check back', async () => {
    const moved = {
      ...ROWS[0],
      dayKey: '2027-01-17',
      rainCheck: { ...rainCheck, kind: 'date', toDayKey: '2027-01-17' },
      rainCheckOpen: false,
    }
    await open([moved, ROWS[1]])
    expect(screen.getByText(/Rain check: moved from Fri, Jan 15 to Sun, Jan 17/)).toBeTruthy()
    expect(screen.getAllByText('Check in')).toHaveLength(1)
    mockFetch.mockResolvedValueOnce(reply(200, { checkIn: { ...ROWS[0], rainCheck: null } }))
    fireEvent.click(screen.getByText('Undo rain check'))
    await waitFor(() => expect(screen.getAllByText('Check in')).toHaveLength(2))
    expect(bodyOf(mockFetch.mock.calls[1])).toEqual({
      hostId: 'shop',
      action: 'undo_rain_check',
      id: 'o_o1_0_0',
      registerId: 'front',
      cashierAssertion: 'pin-token',
    })
  })

  it('offers no rain check on a stay', async () => {
    await open([{ ...ROWS[0], source: 'reservation', orderId: null, orderLabel: null }, ROWS[1]])
    expect(screen.getAllByText('Rain check')).toHaveLength(1)
  })
})

describe('the register’s customer panel', () => {
  it('offers the check-in when the attached customer has someone due, bringing the day in line only if it is in use', async () => {
    mockFetch.mockImplementation(async (_user: unknown, url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (url === '/api/commerce/pos-check-in') return reply(200, { ...DAY, customer: CUSTOMER, checkIns: ROWS })
      return reply(200, body.action === 'stats' ? { orderCount: 0, lifetimeSpendCents: 0 } : {})
    })
    render(
      <Shell>
        <PosCustomerLookup
          hostId="shop"
          value={{ kind: 'contact', id: 'c1', name: 'Jordan Lee', email: 'jordan@example.com', phone: null }}
          onChange={jest.fn()}
        />
      </Shell>,
    )
    expect(await screen.findByText('Check in (2)')).toBeTruthy()
    const call = mockFetch.mock.calls.find((one) => one[1] === '/api/commerce/pos-check-in')!
    expect(bodyOf(call)).toEqual({ hostId: 'shop', action: 'customer', reconcile: 'if-used', email: 'jordan@example.com' })
    expect(zones.find((zone) => zone['placement'] === 'register-customer')).toMatchObject({
      contactId: 'c1',
      email: 'jordan@example.com',
      dayKey: '2027-01-15',
      unitsDue: 2,
    })
  })
})
