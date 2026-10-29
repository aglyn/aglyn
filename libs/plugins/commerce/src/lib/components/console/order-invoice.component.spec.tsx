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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OrderInvoiceButton } from './order-invoice.component'

/**
 * The order dialog's Invoice (AGL-3611, AGL-4095): a menu of the printable
 * invoice and the branded PDF the server makes, which is saved under the name
 * the server gives it.
 */

const mockFetch = jest.fn()
const mockSnack = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ __path: path.join('/') }),
  getDoc: async () => ({ data: () => ({ businessName: 'Juniper Street Co.', displayName: 'Juniper Street Co.', currency: 'USD' }) }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: (...args: unknown[]) => mockSnack(...args) }),
}))

const ORDER = {
  number: 1042,
  status: 'paid',
  lineItems: [{ productId: 'p1', name: 'Mug', quantity: 1, unitAmountCents: 900 }],
  totals: { itemsCents: 900, totalCents: 900, feeCents: 0 },
} as never

const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

beforeEach(() => {
  mockFetch.mockReset()
  mockSnack.mockReset()
  click.mockClear()
  Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:invoice'), revokeObjectURL: jest.fn() })
})

afterAll(() => click.mockRestore())

it('offers the printable invoice and the PDF', () => {
  render(<OrderInvoiceButton hostId="h1" orderId="o1" order={ORDER} />)
  fireEvent.click(screen.getByRole('button', { name: 'Invoice' }))
  expect(screen.getByRole('menuitem', { name: 'Print invoice' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: 'Download PDF' })).toBeTruthy()
})

it('downloads the invoice PDF the server makes, under the name it gives', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => 'attachment; filename="juniper-street-co-invoice-1042.pdf"' },
    blob: async () => new Blob(['%PDF-']),
  })
  render(<OrderInvoiceButton hostId="h1" orderId="o1" order={ORDER} />)
  fireEvent.click(screen.getByRole('button', { name: 'Invoice' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download PDF' }))
  await waitFor(() => expect(click).toHaveBeenCalled())
  expect(mockFetch.mock.calls[0][1]).toBe('/api/commerce/order-print?hostId=h1&orderId=o1&kind=invoice-pdf')
  expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('juniper-street-co-invoice-1042.pdf')
})

it('says why when the server refuses', async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'Your role does not include "Manage orders" — ask an organization admin' }),
  })
  render(<OrderInvoiceButton hostId="h1" orderId="o1" order={ORDER} />)
  fireEvent.click(screen.getByRole('button', { name: 'Invoice' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download PDF' }))
  await waitFor(() =>
    expect(mockSnack).toHaveBeenCalledWith('Your role does not include "Manage orders" — ask an organization admin', expect.anything()),
  )
  expect(click).not.toHaveBeenCalled()
})

describe('Send invoice (AGL-4099)', () => {
  const PAID = {
    number: 1042,
    status: 'paid',
    channel: 'online',
    customerEmail: 'jordan@example.com',
    lineItems: [{ productId: 'p1', name: 'Mug', quantity: 1, unitAmountCents: 900 }],
    totals: { itemsCents: 900, totalCents: 900, feeCents: 0 },
  } as never

  const openForm = async (order: never = PAID, canSend?: boolean) => {
    render(<OrderInvoiceButton hostId="h1" orderId="o1" order={order} canSend={canSend} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invoice' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Send invoice/ }))
    await waitFor(() => expect((screen.getByLabelText(/Subject/) as HTMLInputElement).value).toBe('Invoice #1042 from Juniper Street Co.'))
  }

  it('emails the invoice to the order’s customer, once per attempt', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sent: true, to: 'jordan@example.com', paid: true }) })
    await openForm()
    expect((screen.getByLabelText(/^To/) as HTMLInputElement).value).toBe('jordan@example.com')
    expect(screen.getByText(/shows the invoice as paid/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'Thanks!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('Invoice #1042 sent to jordan@example.com', expect.anything()))
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commerce/order-invoice-send')
    expect(init.headers['Idempotency-Key']).toBeTruthy()
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'h1',
      orderId: 'o1',
      to: 'jordan@example.com',
      subject: 'Invoice #1042 from Juniper Street Co.',
      message: 'Thanks!',
    })
  })

  it('says up front why a canceled order has no invoice, and sends nothing', async () => {
    await openForm({ ...(PAID as object), status: 'cancelled' } as never)
    expect(screen.getByText('This order was canceled or refunded, so it has no invoice to send.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is held, with the reason, without "Send quotes and invoices to customers"', () => {
    render(<OrderInvoiceButton hostId="h1" orderId="o1" order={PAID} canSend={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invoice' }))
    const item = screen.getByRole('menuitem', { name: /Send invoice/ })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.textContent).toContain('Send quotes and invoices to customers')
  })
})
