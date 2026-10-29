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
import { buildQuotePageView } from '../model'
import QuotePage from './quote-page'

/**
 * The customer's quote page (AGL-4094): it reads the pay link from the URL
 * after hydration, shows the quote as the route allow-lists it, and Pay asks
 * the server for a payment for the version it shows, carrying no price.
 */
const mockSiteFetch = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

const ORDER = {
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [
    { productId: 'canopy', name: 'Canopy 10x10', variantLabel: 'Red', sku: 'CAN-R', quantity: 2, unitAmountCents: 120_000, description: 'Logo on all sides' },
    { productId: '', custom: true, name: 'Installation', quantity: 1, unitAmountCents: 30_000 },
    { productId: 'bag', name: 'Carry bag', quantity: 1, unitAmountCents: 0, included: true },
  ],
  quote: {
    stage: 'draft',
    revision: 1,
    customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
    shipTo: { name: 'Jordan Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
    notes: 'Thanks for asking',
    terms: 'Half up front',
    discount: { kind: 'percent', pct: 10 },
    shipping: { amountCents: 4_500 },
    tax: { kind: 'rate', pct: 8.25, label: 'Texas sales tax' },
    createdAtMs: Date.UTC(2026, 9, 20),
    updatedAtMs: Date.UTC(2026, 9, 21),
    createdBy: 'a',
    updatedBy: 'a',
  },
}

const view = (order: Record<string, unknown> = ORDER) =>
  buildQuotePageView({ order: order as never, orderId: 'q-1', storeName: 'Acme Tents', currency: 'USD' })

const json = (body: unknown, ok = true) => ({ ok, json: async () => body })

beforeEach(() => {
  mockSiteFetch.mockReset()
  window.history.replaceState({}, '', '/pay-quote?q=q-1&t=1.tok')
})

describe('the quote page', () => {
  it('loads the quote from the pay link and shows it', async () => {
    mockSiteFetch.mockResolvedValue(json(view()))
    render(<QuotePage />)
    expect(await screen.findByRole('heading', { name: 'Quote #1042' })).toBeTruthy()
    expect(mockSiteFetch).toHaveBeenCalledWith('/api/commerce/quote-view?hostId=host-1&q=q-1&t=1.tok')
    expect(screen.getByText('Acme Tents')).toBeTruthy()
    expect(screen.getByText('Unpaid')).toBeTruthy()
    expect(screen.getByText('Canopy 10x10 (Red)')).toBeTruthy()
    expect(screen.getByText('Logo on all sides')).toBeTruthy()
    expect(screen.getByText('2 × $1,200.00 · SKU CAN-R')).toBeTruthy()
    expect(screen.getByText('Included')).toBeTruthy()
    expect(screen.getByText('Discount (10% off)')).toBeTruthy()
    expect(screen.getByText('Texas sales tax (8.25%)')).toBeTruthy()
    expect(screen.getByText('Thanks for asking')).toBeTruthy()
    expect(screen.getByText('Half up front')).toBeTruthy()
    expect(screen.getByText('Ship to')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pay $2,675.48' })).toBeTruthy()
  })

  it('downloads the quote’s PDF by the same signed link (AGL-4095)', async () => {
    mockSiteFetch.mockResolvedValue(json(view()))
    render(<QuotePage />)
    const download = await screen.findByRole('link', { name: 'Download PDF' })
    expect(download.getAttribute('href')).toBe('/api/commerce/quote-pdf?hostId=host-1&q=q-1&t=1.tok')
    expect(download.hasAttribute('download')).toBe(true)
  })

  // The redirect to Stripe's page is a real `window.location.assign`, which
  // jsdom refuses and reports on its console; the button stays busy behind it.
  it('pays for the version it shows, carrying no price, and goes to Stripe’s page', async () => {
    mockSiteFetch
      .mockResolvedValueOnce(json(view()))
      .mockResolvedValueOnce(json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }))
    render(<QuotePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $2,675.48' }))
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Opening…' })).toBeTruthy()
    const [url, init] = mockSiteFetch.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/commerce/quote-pay')
    expect(JSON.parse(String(init.body))).toEqual({ hostId: 'host-1', q: 'q-1', t: '1.tok', v: Date.UTC(2026, 9, 21) })
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
  })

  it('shows the server’s refusal beside the button', async () => {
    mockSiteFetch
      .mockResolvedValueOnce(json(view()))
      .mockResolvedValueOnce(json({ error: 'Acme Tents can’t take payments online right now.', reason: 'payments-unavailable' }, false))
    render(<QuotePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay $2,675.48' }))
    expect(await screen.findByText('Acme Tents can’t take payments online right now.')).toBeTruthy()
  })

  it('asks for the proof’s approval in place of Pay when the business requires it', async () => {
    mockSiteFetch.mockResolvedValue(
      json(view({ ...ORDER, quote: { ...ORDER.quote, requireProofApproval: true, proofs: [{ id: 'p1', revision: 1 }] } })),
    )
    render(<QuotePage />)
    expect(await screen.findByText('Acme Tents asks you to approve the proof before you pay.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
  })

  it('shows a paid quote as paid, with its receipt and no Pay', async () => {
    mockSiteFetch.mockResolvedValue(
      json({
        ...view({ ...ORDER, status: 'paid', quote: { ...ORDER.quote, paidAtMs: Date.UTC(2026, 9, 30, 12) } }),
        receiptUrl: 'https://acme.aglyn.app/order-status?o=q-1&t=abc',
      }),
    )
    render(<QuotePage />)
    expect(await screen.findByText('Paid', { selector: '.MuiChip-label' })).toBeTruthy()
    expect(screen.getByText(/^Paid .*2026\. Thank you\.$/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View your order' }).getAttribute('href')).toBe(
      'https://acme.aglyn.app/order-status?o=q-1&t=abc',
    )
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull()
  })

  it('says calmly that a replaced link was replaced, and shows nothing of the quote', async () => {
    mockSiteFetch.mockResolvedValue(json({ state: 'replaced', storeName: 'Acme Tents' }))
    render(<QuotePage />)
    expect(await screen.findByRole('heading', { name: 'This quote was updated' })).toBeTruthy()
    expect(screen.getByText(/Acme Tents updated this quote and sent you a newer link/)).toBeTruthy()
    expect(screen.queryByText('Canopy 10x10 (Red)')).toBeNull()
  })

  it('says a payment that did not go through charged nothing, after returning from it', async () => {
    window.history.replaceState({}, '', '/pay-quote?q=q-1&t=1.tok&session_id=cs_test_1')
    mockSiteFetch
      .mockResolvedValueOnce(json(view()))
      .mockResolvedValueOnce(json({ status: 'open', paymentStatus: 'unpaid' }))
    render(<QuotePage />)
    expect(await screen.findByText('Your payment did not go through. Nothing was charged.')).toBeTruthy()
    expect(mockSiteFetch).toHaveBeenNthCalledWith(2, '/api/commerce/checkout-status?hostId=host-1&sessionId=cs_test_1')
  })

  it('says what to do without a link, and fetches nothing', async () => {
    window.history.replaceState({}, '', '/pay-quote')
    render(<QuotePage />)
    expect(await screen.findByText('Open this page from the link you were sent with your quote.')).toBeTruthy()
    expect(mockSiteFetch).not.toHaveBeenCalled()
  })
})
