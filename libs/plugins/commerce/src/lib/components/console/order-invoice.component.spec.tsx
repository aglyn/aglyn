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
/** What `useMerchantPayments` answers: the owner's payment account, settled. */
let mockPayments: Record<string, unknown> = { state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }
/** The store's settings document, as the Send invoice form reads it. */
let mockStore: Record<string, unknown> | undefined = { currency: 'USD', tax: { mode: 'manual' } }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useFirestoreDoc: () => ({ data: mockStore, status: 'success', fromCache: false }),
  firestoreDocPhase: (read: { data?: unknown; status: string }) =>
    read.data ? 'ready' : read.status === 'loading' ? 'loading' : 'missing',
  useMerchantPayments: (hostId: string | undefined) =>
    hostId ? mockPayments : { state: 'pending', settled: false, ready: false, blocked: false, reason: null, href: null },
  useStoreSettingsHref: (_hostId: string | undefined, page: string) => `/acme/hosts/shop/products/${page}`,
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
  mockPayments = { state: 'ready', settled: true, ready: true, blocked: false, reason: null, href: null }
  mockStore = { currency: 'USD', tax: { mode: 'manual' } }
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

  /** An unpaid draft order whose invoice carries its lasting pay link (AGL-4099). */
  const DRAFT = {
    number: 1042,
    status: 'pending',
    channel: 'draft',
    customerEmail: 'jordan@example.com',
    taxMode: 'manual',
    lineItems: [{ productId: 'p1', name: 'Design', productType: 'service', quantity: 1, unitAmountCents: 9_000 }],
    totals: { itemsCents: 9_000, discountCents: 0, shippingCents: 0, taxCents: 0, totalCents: 9_000, feeCents: 0 },
  } as never

  it('says customers can’t pay this invoice online yet, with the fix, and sends all the same (AGL-4162)', async () => {
    mockPayments = {
      state: 'not-connected',
      settled: true,
      ready: false,
      blocked: true,
      reason: 'Connect Stripe to take card payments.',
      href: '/acme/hosts/shop/products/payments',
    }
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sent: true, to: 'jordan@example.com', paid: false }) })
    await openForm(DRAFT)
    expect(screen.getByText('Customers can’t pay this invoice online yet.')).toBeTruthy()
    expect(screen.getByText('Connect Stripe to take card payments.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Payments' }).getAttribute('href')).toBe('/acme/hosts/shop/products/payments')
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('Invoice #1042 sent to jordan@example.com', expect.anything()))
  })

  it('says nothing of payments for a paid order’s invoice, which is the record', async () => {
    mockPayments = { state: 'not-connected', settled: true, ready: false, blocked: true, reason: 'Connect Stripe to take card payments.', href: null }
    await openForm()
    expect(screen.queryByText(/online yet/)).toBeNull()
  })

  it('names an undecided sales tax once, with Open Taxes, and holds the send with its reason', async () => {
    mockStore = { currency: 'USD' }
    await openForm(DRAFT)
    expect(screen.getByText('Choose how this store handles sales tax.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Taxes' }).getAttribute('href')).toBe('/acme/hosts/shop/products/taxes')
    expect(screen.queryByText(/^Sales tax isn’t set up/)).toBeNull()
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
