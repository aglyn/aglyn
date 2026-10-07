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
 * The register's receipts, customer lookup and lock pad (AGL-3609), rendered:
 * the cloud printer button exists only where a printer does and sends what it
 * says; the lookup asks the server, never filters a loaded list; and a lock
 * nobody holds a PIN for can still be closed.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

let mockPrinters: Array<Record<string, unknown>> | null = []
// One object, as the real hook keeps it: effects that depend on the user
// must not re-run on every render.
const mockUser = { data: { uid: 'cashier' } }
const mockFetch = jest.fn()
const mockSnack = jest.fn()
const mockPrint = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
  useFirestore: () => ({}),
  useFirestoreCollection: (factory: () => unknown) => ({ data: factory() ? mockPrinters : null }),
  useFirestoreDoc: () => ({ data: null }),
  useOrgPlan: () => ({ org: null }),
  useSitePluginConfig: () => ({ config: {} }),
}))
jest.mock('firebase/firestore', () => ({
  collection: (...path: unknown[]) => ({ path }),
  doc: (...path: unknown[]) => ({ path }),
  limit: () => ({}),
  query: (ref: unknown) => ref,
  where: () => ({}),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))
jest.mock('./pos-receipt', () => ({
  ...jest.requireActual('./pos-receipt'),
  printPosReceipt: (...args: unknown[]) => mockPrint(...args),
}))

import { PosCustomerLookup } from './pos-customer-lookup.component'
import { PosPinPad } from './pos-pin-pad.component'
import { PosReceiptActions } from './pos-receipt-actions.component'

const reply = (status: number, body: Record<string, unknown>) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const ORDER = {
  number: 12,
  status: 'paid',
  channel: 'pos',
  registerId: 'front',
  createdAtMs: 0,
  lineItems: [{ name: 'Mug', unitAmountCents: 1200, quantity: 1 }],
  totals: { itemsCents: 1200, totalCents: 1200 },
}

beforeEach(() => {
  mockPrinters = []
  mockFetch.mockReset()
  mockSnack.mockReset()
  mockPrint.mockReset()
})

describe('the receipt buttons', () => {
  it('prints the receipt and the gift receipt through the browser', () => {
    render(<PosReceiptActions hostId="shop" orderId="o1" order={ORDER as any} />)
    fireEvent.click(screen.getByText('Print receipt'))
    fireEvent.click(screen.getByText('Gift receipt'))
    expect(mockPrint).toHaveBeenCalledTimes(2)
    expect(mockPrint.mock.calls[0][0]).toMatchObject({ gift: false, orderNumber: '#12' })
    expect(mockPrint.mock.calls[1][0]).toMatchObject({ gift: true })
    expect(mockPrint.mock.calls[1][0].tenders).toEqual([])
  })

  it('offers no cloud printer where the register has none', () => {
    render(<PosReceiptActions hostId="shop" orderId="o1" order={ORDER as any} cloudPrint="reprint" />)
    expect(screen.queryByText('Receipt printer')).toBeNull()
  })

  it("sends the sale's own receipt to the register's printer right after the sale", async () => {
    mockPrinters = [{ $id: 'p1' }]
    mockFetch.mockResolvedValue(reply(200, { ok: true }))
    render(<PosReceiptActions hostId="shop" orderId="o1" order={ORDER as any} cloudPrint="sale" />)
    fireEvent.click(screen.getByText('Receipt printer'))
    await waitFor(() => expect(mockSnack).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commerce/pos-payment')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'shop', orderId: 'o1', action: 'receipt', channel: 'print' })
    expect(mockSnack.mock.calls[0][0]).toBe('Sent to the receipt printer')
  })

  it('reprints a past sale through the printer route, and says why when it cannot', async () => {
    mockPrinters = [{ $id: 'p1' }]
    mockFetch.mockResolvedValue(reply(404, { error: 'No printer for this register' }))
    render(<PosReceiptActions hostId="shop" orderId="o1" order={ORDER as any} cloudPrint="reprint" />)
    fireEvent.click(screen.getByText('Receipt printer'))
    await waitFor(() => expect(mockSnack).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commerce/printers')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'shop', orderId: 'o1', action: 'reprint' })
    expect(mockSnack.mock.calls[0][0]).toBe('No printer for this register')
  })
})

describe('the customer lookup', () => {
  it('asks the server once typing pauses, and attaches the person picked', async () => {
    mockFetch.mockResolvedValue(
      reply(200, {
        available: true,
        customers: [{ kind: 'crm', id: 'rec_1', name: 'Dana Diaz', email: 'dana@x.co', phone: null }],
      }),
    )
    const onChange = jest.fn()
    render(<PosCustomerLookup hostId="shop" value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'da' } })
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'dan' } })
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commerce/pos-customer')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'shop', action: 'search', text: 'dan' })
    fireEvent.click(await screen.findByText('Dana Diaz'))
    expect(onChange).toHaveBeenCalledWith({ kind: 'crm', id: 'rec_1', name: 'Dana Diaz', email: 'dana@x.co', phone: null })
  })

  it('falls back to an email for the receipt where the workspace keeps no people', async () => {
    mockFetch.mockResolvedValue(reply(200, { available: false, customers: [] }))
    const onChange = jest.fn()
    render(<PosCustomerLookup hostId="shop" value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Dana@X.co' } })
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    fireEvent.click(await screen.findByText('Use dana@x.co'))
    expect(onChange).toHaveBeenCalledWith({ kind: 'none', id: '', name: '', email: 'dana@x.co', phone: null })
  })
})

describe('the lock pad', () => {
  it('cannot be closed while someone on the site holds a PIN', async () => {
    mockFetch.mockResolvedValue(reply(200, { members: [{ uid: 'cashier', name: 'Cal' }] }))
    render(
      <PosPinPad open hostId="shop" registerId="front" purpose="cashier" dismissible={false} onClose={jest.fn()} onVerified={jest.fn()} />,
    )
    await screen.findByText('Cal')
    expect(screen.queryByText('Cancel')).toBeNull()
  })

  it('can be closed when nobody has a PIN, so an idle lock never strands the register', async () => {
    mockFetch.mockResolvedValue(reply(200, { members: [] }))
    const onClose = jest.fn()
    render(
      <PosPinPad open hostId="shop" registerId="front" purpose="cashier" dismissible={false} onClose={onClose} onVerified={jest.fn()} />,
    )
    fireEvent.click(await screen.findByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
