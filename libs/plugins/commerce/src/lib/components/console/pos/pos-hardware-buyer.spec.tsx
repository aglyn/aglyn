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
 * The register's card reader buyer step (AGL-4038): nothing on a store that
 * is not the platform's hardware seller; on a sale with a card reader, the
 * buyer is looked up and attached, and an address with no account is
 * invited; the To attach list opens the same step for an earlier sale.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockStatus = jest.fn()
const mockFind = jest.fn()
const mockAttach = jest.fn()
const mockToAttach = jest.fn()
const mockSerials = jest.fn()
const mockBooth = jest.fn()
jest.mock('./pos-hardware-sale-api', () => ({
  posHardwareSerials: (...args: unknown[]) => mockSerials(...args),
  posHardwareRegisterAtBooth: (...args: unknown[]) => mockBooth(...args),
  posHardwareSaleStatus: (...args: unknown[]) => mockStatus(...args),
  posHardwareFindBuyer: (...args: unknown[]) => mockFind(...args),
  posHardwareAttach: (...args: unknown[]) => mockAttach(...args),
  posHardwareToAttach: (...args: unknown[]) => mockToAttach(...args),
}))

import PosHardwareBuyer from './pos-hardware-buyer.component'

const user = { uid: 'cashier-1' } as never
const PERSON = {
  uid: 'uid-pat',
  name: 'Pat Lee',
  email: 'p***@example.com',
  workspaces: [
    {
      orgId: 'org-pat',
      name: 'Acme Builders',
      posPlan: false,
      stores: [{ hostId: 'host-pat-1', name: 'Main Street', hasLocation: false }],
    },
  ],
}

describe('the card reader buyer step', () => {
  beforeEach(() => {
    for (const mock of [mockStatus, mockFind, mockAttach, mockToAttach, mockSerials, mockBooth]) mock.mockReset()
  })

  it('draws nothing on a store that is not the seller', async () => {
    mockStatus.mockResolvedValue({ seller: false })
    const { container } = render(<PosHardwareBuyer user={user} hostId="host-1" saleOrderId="order-1" notify={jest.fn()} />)
    await waitFor(() => expect(mockStatus).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('finds the buyer, says what their workspace still needs, and attaches the sale to the chosen store', async () => {
    mockStatus.mockResolvedValue({ seller: true, items: [] })
    mockFind.mockResolvedValue({ kind: 'name', people: [PERSON], workspaces: [], noAccount: false })
    mockAttach.mockResolvedValue({ outcome: 'waiting' })
    const notify = jest.fn()
    render(<PosHardwareBuyer user={user} hostId="host-seller" saleOrderId="order-1" notify={notify} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Attach buyer' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Email, name or workspace'), { target: { value: 'pat' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Search' }))
    const store = await within(dialog).findByLabelText(/Pat Lee \(p\*\*\*@example\.com\) · Acme Builders · Main Street/)
    expect(within(dialog).getAllByText(/No point of sale plan yet/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/No card reader location on this store yet/)).toBeTruthy()
    fireEvent.click(store)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(mockAttach).toHaveBeenCalled())
    expect(mockAttach.mock.calls[0][2]).toEqual({
      hostId: 'host-seller',
      buyer: { uid: 'uid-pat', orgId: 'org-pat', hostId: 'host-pat-1' },
      registerOrderId: 'order-1',
    })
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/as soon as the sale is paid/), 'success'))
    expect(await screen.findByRole('button', { name: 'Change' })).toBeTruthy()
    // With their store chosen, the reader can be registered to it here.
    mockBooth.mockResolvedValue({ ok: true, readerId: 'tmr_1', order: {} })
    fireEvent.change(screen.getByLabelText('Code on the reader'), { target: { value: 'abc-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() =>
      expect(mockBooth.mock.calls[0][2]).toEqual({ hostId: 'host-seller', registerOrderId: 'order-1', registrationCode: 'abc-123' }),
    )
  })

  it("takes the readers' serial numbers on the sale", async () => {
    mockStatus.mockResolvedValue({ seller: true, items: [] })
    mockSerials.mockResolvedValue({ ok: true, serials: ['A-1', 'A-2'], recorded: false })
    const notify = jest.fn()
    render(<PosHardwareBuyer user={user} hostId="host-seller" saleOrderId="order-1" notify={notify} />)
    fireEvent.change(await screen.findByLabelText('Reader serial numbers'), { target: { value: 'a-1, a-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockSerials).toHaveBeenCalledWith(user, { hostId: 'host-seller', registerOrderId: 'order-1', serials: ['a-1', 'a-2'] }),
    )
    // No store chosen yet: no registration here.
    expect(screen.queryByLabelText('Code on the reader')).toBeNull()
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Serial numbers saved', 'success'))
  })

  it('offers to invite an address with no account', async () => {
    mockStatus.mockResolvedValue({ seller: true, items: [] })
    mockFind.mockResolvedValue({ kind: 'email', people: [], workspaces: [], noAccount: true })
    mockAttach.mockResolvedValue({ outcome: 'pending', order: {} })
    render(<PosHardwareBuyer user={user} hostId="host-seller" saleOrderId="order-1" notify={jest.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Attach buyer' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Email, name or workspace'), { target: { value: 'new@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Search' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Invite them' }))
    await waitFor(() => expect(mockAttach.mock.calls[0][2]).toMatchObject({ buyer: { email: 'new@example.com' } }))
  })

  it('opens an earlier sale from the To attach list', async () => {
    mockStatus.mockResolvedValue({ seller: true, items: [] })
    mockToAttach.mockResolvedValue({
      orders: [
        {
          id: 'hw_aaaaaaaaaaaaaaaaaaaa',
          number: 'HW-AAAAAA',
          registerOrderId: 'order-0',
          registerNumber: 12,
          kiosk: true,
          offline: false,
          lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1 }],
          totalCents: 32_475,
          createdAtMs: 1_000,
          contactEmail: null,
          attached: false,
          awaitingWorkspace: false,
          invited: false,
        },
      ],
    })
    render(<PosHardwareBuyer user={user} hostId="host-seller" saleOrderId={null} notify={jest.fn()} />)
    expect(screen.queryByRole('button', { name: 'Attach buyer' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'To attach' }))
    const list = await screen.findByRole('dialog')
    expect(await within(list).findByText(/Sale #12 · .* · at the kiosk/)).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: 'Attach' }))
    expect(await screen.findByText('Who is the card reader for?')).toBeTruthy()
  })
})
