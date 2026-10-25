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
 * Day totals (AGL-4037), rendered: the card asks the route for the store's
 * day, shows the server's figures as they came, exports the server's CSV and
 * prints the 80 mm report, and says plainly when the viewer may not read it
 * or the days held nothing.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PosDayReport } from '../../../model/commerce-pos-day-report'

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

import { PosDayTotalsCard } from './pos-day-totals-card.component'

const TOTALS = {
  orderCount: 3,
  grossSalesCents: 8000,
  discountsCents: 200,
  taxCents: 560,
  tipsCents: 500,
  refundCount: 1,
  refundsCents: 1000,
  netSalesCents: 7000,
  salesByTender: { cash: 4000, card_present: 4000 },
}

const REPORT: PosDayReport = {
  hostId: 'shop',
  storeName: 'Corner Shop',
  currency: 'usd',
  timeZone: 'America/Chicago',
  from: '2026-10-24',
  to: '2026-10-24',
  startMs: 0,
  endMs: 1,
  days: 1,
  generatedAtMs: 0,
  totals: TOTALS,
  byTender: [
    { method: 'cash', label: 'Cash', salesCents: 4000, refundsCents: 1000, netCents: 3000 },
    { method: 'card_present', label: 'Card', salesCents: 4000, refundsCents: 0, netCents: 4000 },
  ],
  byRegister: [
    { ...TOTALS, registerId: 'back', name: 'Back', orderCount: 1, netSalesCents: 5000 },
    { ...TOTALS, registerId: 'front', name: 'Front', orderCount: 2, netSalesCents: 2000 },
  ],
  byCashier: [{ ...TOTALS, memberId: 'cashier', name: 'Pat Lee' }],
  shifts: [
    {
      shiftId: 's1',
      registerId: 'front',
      registerName: 'Front',
      status: 'closed',
      openedAtMs: 1,
      closedAtMs: 2,
      openedByName: 'Pat Lee',
      closedByName: 'Pat Lee',
      openingFloatCents: 10_000,
      netSalesCents: 2000,
      expectedCashCents: 13_000,
      countedCashCents: 12_900,
      varianceCents: -100,
    },
  ],
  cash: {
    openingFloatCents: 10_000,
    cashSalesCents: 4000,
    cashRefundsCents: 1000,
    paidInCents: 0,
    paidOutCents: 0,
    dropsCents: 0,
    closedShiftCount: 1,
    openShiftCount: 0,
    expectedCashCents: 13_000,
    countedCashCents: 12_900,
    varianceCents: -100,
    openExpectedCashCents: 0,
  },
}

const reply = (status: number, body: unknown, text = '') => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => text,
})

beforeEach(() => {
  mockRegisters = [{ $id: 'front' }]
  mockFetch.mockReset()
  mockPrint.mockReset()
})

describe('the day totals card', () => {
  it("asks for today's totals and shows the server's figures", async () => {
    mockFetch.mockResolvedValue(reply(200, { report: REPORT }))
    render(<PosDayTotalsCard hostId="shop" canManagePos />)
    expect((await screen.findAllByText('$70.00')).length).toBeGreaterThan(0)
    const [, url, init] = mockFetch.mock.calls[0]!
    expect(url).toBe('/api/commerce/pos-day-report?hostId=shop')
    expect(init).toEqual({ method: 'GET' })
    expect(screen.getByText('2026-10-24 · America/Chicago · every register and cashier')).toBeTruthy()
    const tenders = screen.getByRole('grid', { name: 'Day totals by tender' })
    expect(within(tenders).getByText('Cash')).toBeTruthy()
    expect(within(tenders).getByText('$30.00')).toBeTruthy()
    const shifts = screen.getByRole('grid', { name: 'Shifts on these days' })
    expect(within(shifts).getByText('-$1.00')).toBeTruthy()
    // The drawers, summed over every register.
    expect(screen.getByText('Short')).toBeTruthy()
    expect(screen.getByText('Expected (1 closed)')).toBeTruthy()
  })

  it('says so when the days held nothing', async () => {
    mockFetch.mockResolvedValue(
      reply(200, {
        report: {
          ...REPORT,
          totals: { ...TOTALS, orderCount: 0, refundCount: 0 },
          byTender: [],
          byRegister: [],
          byCashier: [],
          shifts: [],
        },
      }),
    )
    render(<PosDayTotalsCard hostId="shop" canManagePos />)
    expect(await screen.findByText('No register sales, returns or shifts on these days.')).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('shows the prerequisite instead of asking when the viewer cannot use the register', () => {
    render(<PosDayTotalsCard hostId="shop" canManagePos={false} />)
    expect(screen.getByText(/Day totals are for members who can use the register/)).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
    expect((screen.getByText('Export CSV').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('Print').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the server's refusal", async () => {
    mockFetch.mockResolvedValue(reply(400, { error: 'Choose 31 days or fewer.' }))
    render(<PosDayTotalsCard hostId="shop" canManagePos />)
    expect(await screen.findByText('Choose 31 days or fewer.')).toBeTruthy()
  })

  it("exports the server's spreadsheet", async () => {
    mockFetch.mockResolvedValueOnce(reply(200, { report: REPORT }))
    mockFetch.mockResolvedValueOnce(reply(200, {}, 'Report,Day totals'))
    const createObjectURL = jest.fn(() => 'blob:csv')
    Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<PosDayTotalsCard hostId="shop" canManagePos />)
    await screen.findAllByText('$70.00')
    fireEvent.click(screen.getByText('Export CSV'))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(mockFetch.mock.calls[1]![1]).toBe('/api/commerce/pos-day-report?hostId=shop&format=csv')
    expect(createObjectURL).toHaveBeenCalled()
    click.mockRestore()
  })

  it('prints an 80 mm report headed with the store', async () => {
    mockFetch.mockResolvedValue(reply(200, { report: REPORT }))
    render(<PosDayTotalsCard hostId="shop" canManagePos />)
    await screen.findAllByText('$70.00')
    fireEvent.click(screen.getByText('Print'))
    const html = String(mockPrint.mock.calls[0]![0])
    expect(html).toContain('DAY TOTALS')
    expect(html).toContain('Corner Shop')
    expect(html).toContain('BY REGISTER')
    expect(html).toContain('$70.00')
  })

  it('sorts a table by any of its columns', async () => {
    mockFetch.mockResolvedValue(reply(200, { report: REPORT }))
    render(<PosDayTotalsCard hostId="shop" canManagePos />)
    await screen.findAllByText('$70.00')
    const registers = screen.getByRole('grid', { name: 'Day totals by register' })
    const names = () =>
      within(registers)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent ?? '')
    expect(names()[0]).toContain('Back')
    fireEvent.click(within(registers).getByText('Orders'))
    await waitFor(() => expect(names()[0]).toContain('Back'))
    fireEvent.click(within(registers).getByText('Orders'))
    await waitFor(() => expect(names()[0]).toContain('Front'))
  })

  it('draws nothing for a store without a register', () => {
    mockRegisters = []
    const { container } = render(<PosDayTotalsCard hostId="shop" canManagePos />)
    expect(container.textContent).toBe('')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
