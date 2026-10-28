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
 * Staff → Hardware orders, for an order sold in person at the platform's
 * own store (AGL-4038): a filter for the sales still to attach, the sale it
 * came from, how it was paid and into which account, and whose it is — and
 * none of the Stripe hardware shop's fields, since nothing was ordered there.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const requested: string[] = []
let rows: any[] = []

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/aglyn/app-utils/staff-role-gate', () => ({ resolveStaffRoleGate: () => ({ blocked: false, reason: '' }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: { children: ReactNode; header: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <section aria-label={String(header)}>
      {HeaderProps?.action}
      {children}
    </section>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/blocked-control.component', () => ({
  BlockedControl: ({ children }: { children: ReactNode }) => children,
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({ ListPagination: () => null }))
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: ({ rows: shown, columns, onOpen }: { rows: any[]; columns: any[]; onOpen: (id: string, row: any) => void }) => (
    <table>
      <tbody>
        {shown.map((row) => (
          <tr key={row.$id} data-testid="order-row" onClick={() => onOpen(row.$id, row)}>
            {columns.map((column) => (
              <td key={column.field}>
                {column.valueGetter ? column.valueGetter(undefined, row) : String(row[column.field] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: { uid: 'staff-1' } }) }))
jest.mock('./pos/pos-hardware-api', () => ({
  PosHardwareRequestError: class extends Error {},
  staffHardwareOrderAction: jest.fn(),
  staffHardwareOrders: async (_user: unknown, filter: string) => {
    requested.push(filter)
    return { orders: rows, next: null, pageSize: 25, canWrite: true }
  },
}))

import PosHardwareOrdersStaffPage from './pos-hardware-orders-staff-page.component'

const inPerson = {
  id: 'hw_aaaaaaaaaaaaaaaaaaaa',
  number: 'HW-AAAAAA',
  orgId: 'org-seller',
  hostId: '',
  status: 'delivered',
  contactEmail: 'receipt@example.com',
  lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 30_000, lineCents: 30_000 }],
  subtotalCents: 30_000,
  shipping: { method: 'in_person', label: 'Handed over in person', cents: 0, name: null, phone: null, address: null },
  taxCents: 2_475,
  totalCents: 32_475,
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: null,
  stripeHardwareOrderId: null,
  tracking: null,
  livemode: true,
  refundPending: false,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
  source: 'in_person',
  discountCents: 0,
  posSale: { hostId: 'host-seller', orgId: 'org-seller', orderId: 'order-1', number: 41, registerId: 'r', kiosk: true, offline: false, paymentLinkSessionId: null },
  paidTo: { account: 'seller_store', hostId: 'host-seller', orgId: 'org-seller', tenders: ['cash'], stripeAccountId: 'acct_seller' },
  attachment: { state: 'pending', email: null, uid: null, orgId: null, hostId: null, attachedBy: null, attachedAtMs: null },
  units: [],
  refundedCents: 0,
  refunds: [],
  returnRequest: null,
}

describe('Staff → Hardware orders, sold in person', () => {
  beforeEach(() => {
    requested.length = 0
    rows = [inPerson]
  })

  it('filters to the sales still to attach', async () => {
    render(<PosHardwareOrdersStaffPage basePath="/admin" />)
    await waitFor(() => expect(requested).toEqual(['paid']))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Sold in person, to attach'))
    await waitFor(() => expect(requested).toEqual(['paid', 'to-attach']))
    expect(screen.getByTestId('order-row').textContent).toContain('In person · to attach')
  })

  it('shows the register sale, the tender and the store’s account, and no Stripe shop fields', async () => {
    render(<PosHardwareOrdersStaffPage basePath="/admin" />)
    fireEvent.click(await screen.findByTestId('order-row'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Sold in person')).toBeTruthy()
    expect(within(dialog).getByText(/Register sale #41 · at the kiosk · paid \$324\.75 · by cash/)).toBeTruthy()
    expect(within(dialog).getByText(/Into the store's own account \(acct_seller\)/)).toBeTruthy()
    expect(within(dialog).getByText('To attach')).toBeTruthy()
    expect(within(dialog).queryByLabelText('Stripe hardware order id')).toBeNull()
    expect(within(dialog).queryByText('Order in the Stripe hardware shop')).toBeNull()
    // A buyer who never made an account is removed from here, on a privacy request.
    expect(within(dialog).getByRole('button', { name: "Remove buyer's details" })).toBeTruthy()
  })
})

describe('Staff → Hardware orders, a return requested', () => {
  beforeEach(() => {
    requested.length = 0
    rows = [
      {
        ...inPerson,
        status: 'registered',
        attachment: { ...inPerson.attachment, state: 'attached', orgId: 'org-pat' },
        returnRequest: {
          state: 'requested',
          reason: 'Not needed',
          requestedBy: 'uid-pat',
          requestedAtMs: 2_000,
          decidedBy: null,
          decidedAtMs: null,
          note: null,
        },
      },
    ]
  })

  it('filters to the requests, says what was asked, and offers the refund and a decline with a note', async () => {
    render(<PosHardwareOrdersStaffPage basePath="/admin" />)
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Status' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Return requested'))
    await waitFor(() => expect(requested).toContain('returns'))
    fireEvent.click(await screen.findByTestId('order-row'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Return requested .*“Not needed”/)).toBeTruthy()
    // A reader handed over at the sale is refunded, never canceled.
    expect(within(dialog).queryByRole('button', { name: 'Cancel and refund' })).toBeNull()
    expect((within(dialog).getByRole('button', { name: 'Refund' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline return' }))
    expect(await screen.findByText('Decline this return?')).toBeTruthy()
  })
})

/*==========================================
 * EMAIL THE BUYER (AGL-4038): canceling or refunding from this page asks
 * whether to tell the buyer, on by default; the server gets the choice as
 * `notifyBuyer`, explicitly, either way.
 *=========================================*/
describe('Staff → Hardware orders, canceling or refunding', () => {
  const online = {
    ...inPerson,
    id: 'hw_bbbbbbbbbbbbbbbbbbbb',
    number: 'HW-BBBBBB',
    orgId: 'org-buyer',
    hostId: 'host-buyer',
    status: 'paid',
    source: 'online',
    shipping: { method: 'standard', label: 'Standard shipping', cents: 1_000, name: 'Pat Lee', phone: null, address: null },
    stripePaymentIntentId: 'pi_test_1',
    posSale: null,
    paidTo: null,
    attachment: null,
  }
  const action = () =>
    jest.requireMock('./pos/pos-hardware-api').staffHardwareOrderAction as jest.Mock

  beforeEach(() => {
    requested.length = 0
    rows = [online]
    action().mockReset()
    action().mockImplementation(async (_user: unknown, body: Record<string, unknown>) => ({
      ok: true,
      order: { ...online, status: 'canceled' },
      buyerEmail: body['notifyBuyer'] ? 'sent' : 'off',
    }))
  })

  const openCancel = async (button: 'Cancel and refund' | 'Refund') => {
    render(<PosHardwareOrdersStaffPage basePath="/admin" />)
    fireEvent.click(await screen.findByTestId('order-row'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: button }))
    return screen.findByRole('dialog', { name: button === 'Refund' ? 'Refund this order?' : 'Cancel and refund this order?' })
  }

  it('emails the buyer by default, and says what goes back', async () => {
    const confirm = await openCancel('Cancel and refund')
    const toggle = within(confirm).getByLabelText('Email the buyer') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(within(confirm).getByText(/\$324\.75 goes back to the card it was paid with/)).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel and refund' }))
    await waitFor(() => expect(action()).toHaveBeenCalledTimes(1))
    expect(action().mock.calls[0][1]).toEqual({
      action: 'cancel',
      notifyBuyer: true,
      orgId: 'org-buyer',
      orderId: 'hw_bbbbbbbbbbbbbbbbbbbb',
    })
  })

  it('sends no email when staff turn it off', async () => {
    const confirm = await openCancel('Refund')
    fireEvent.click(within(confirm).getByLabelText('Email the buyer'))
    expect((within(confirm).getByLabelText('Email the buyer') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Refund' }))
    await waitFor(() => expect(action()).toHaveBeenCalledTimes(1))
    expect(action().mock.calls[0][1]).toMatchObject({ action: 'refund', notifyBuyer: false })
  })

  it('offers the same choice on a refund of a reader sold in person', async () => {
    rows = [{ ...inPerson, attachment: { ...inPerson.attachment, state: 'attached', orgId: 'org-pat' } }]
    const confirm = await openCancel('Refund')
    expect(within(confirm).getByText(/goes back to the card the register sale was paid with/)).toBeTruthy()
    expect((within(confirm).getByLabelText('Email the buyer') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Refund' }))
    await waitFor(() => expect(action()).toHaveBeenCalledTimes(1))
    expect(action().mock.calls[0][1]).toMatchObject({ action: 'refund', notifyBuyer: true, orgId: 'org-seller' })
  })
})
