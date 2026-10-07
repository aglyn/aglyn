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
 * The buyer's return form (AGL-3611): reads the order the link names after
 * hydration, lets the buyer choose units and a reason per line, and sends
 * only the lines they chose.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ReturnRequest from './return-request'

const mockSiteFetch = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const DAY = 86_400_000

const orderData = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  windowEndsAtMs: Date.UTC(2026, 10, 5, 12),
  windowOpen: true,
  lines: [
    { lineItemId: 0, name: 'Mug', variantLabel: 'Blue', productType: 'physical', returnable: 2, blocked: null },
    { lineItemId: 1, name: 'Poster', variantLabel: null, productType: 'physical', returnable: 1, blocked: null },
    { lineItemId: 2, name: 'Ebook', variantLabel: null, productType: 'digital', returnable: 0, blocked: 'Not returnable' },
  ],
  reasons: [
    { value: 'damaged', label: 'Arrived damaged' },
    { value: 'other', label: 'Other' },
  ],
  returns: [],
  ...overrides,
})

function openAt(search: string) {
  window.history.replaceState({}, '', `/order-return${search}`)
}

beforeEach(() => {
  mockSiteFetch.mockReset()
  openAt('?o=order-9&t=tok.en')
})

async function renderLoaded(data = orderData()) {
  mockSiteFetch.mockResolvedValueOnce(reply(200, data))
  render(<ReturnRequest />)
  await screen.findByText('Choose items to return')
}

describe('ReturnRequest', () => {
  it('reads the order the link names, with its token', async () => {
    await renderLoaded()
    const url = String(mockSiteFetch.mock.calls[0][0])
    expect(url).toMatch(/^\/api\/commerce\/return-request\?/)
    const query = new URLSearchParams(url.split('?')[1])
    expect(Object.fromEntries(query)).toEqual({ hostId: 'host-1', orderId: 'order-9', t: 'tok.en' })
    expect(screen.getByText('Mug (Blue)')).toBeTruthy()
    expect(screen.getByText('Poster')).toBeTruthy()
    expect(screen.getByText(/Returns are accepted until November 5, 2026/)).toBeTruthy()
  })

  it('shows a blocked line with its reason, and disables it', async () => {
    await renderLoaded()
    expect(screen.getByText('Not returnable')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'More of Ebook' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(/Reason for returning Ebook/) as HTMLSelectElement).disabled).toBe(true)
  })

  it('steps a quantity between 0 and what can be returned', async () => {
    await renderLoaded()
    const more = screen.getByRole('button', { name: 'More of Poster' }) as HTMLButtonElement
    const fewer = screen.getByRole('button', { name: 'Fewer of Poster' }) as HTMLButtonElement
    expect(fewer.disabled).toBe(true)
    fireEvent.click(more)
    expect(more.disabled).toBe(true)
    expect(fewer.disabled).toBe(false)
  })

  it('sends only the lines with a quantity, each with its reason', async () => {
    await renderLoaded()
    const submit = screen.getByRole('button', { name: 'Request return' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'More of Mug (Blue)' }))
    fireEvent.click(screen.getByRole('button', { name: 'More of Mug (Blue)' }))
    // A chosen line still needs its reason.
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Reason for returning Mug \(Blue\)/), {
      target: { value: 'damaged' },
    })
    fireEvent.change(screen.getByLabelText(/Anything the store should know/), {
      target: { value: '  Box was crushed  ' },
    })
    expect(submit.disabled).toBe(false)

    mockSiteFetch.mockResolvedValueOnce(reply(200, { ok: true, returnId: 'ret-1', status: 'requested' }))
    mockSiteFetch.mockResolvedValueOnce(reply(200, orderData()))
    fireEvent.click(submit)

    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockSiteFetch.mock.calls[1]
    expect(url).toBe('/api/commerce/return-request')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      orderId: 'order-9',
      t: 'tok.en',
      lines: [{ lineItemId: 0, quantity: 2, reason: 'damaged' }],
      note: 'Box was crushed',
    })
    expect(await screen.findByText(/Your return request was sent/)).toBeTruthy()
  })

  it('shows what the store refused, and keeps the form', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'More of Poster' }))
    fireEvent.change(screen.getByLabelText(/Reason for returning Poster/), { target: { value: 'other' } })
    mockSiteFetch.mockResolvedValueOnce(reply(409, { error: 'Only 0 of one item can be returned.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Request return' }))

    expect(await screen.findByText('Only 0 of one item can be returned.')).toBeTruthy()
    expect(screen.queryByText(/Your return request was sent/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Request return' })).toBeTruthy()
  })

  it('says so when the order cannot be found', async () => {
    mockSiteFetch.mockResolvedValueOnce(reply(404, { error: 'We could not find that order' }))
    render(<ReturnRequest />)
    expect(await screen.findByText('We could not find that order')).toBeTruthy()
  })

  it('asks for the link when the page was opened without an order', async () => {
    openAt('')
    render(<ReturnRequest />)
    expect(await screen.findByText(/Open this page from the orders in your account/)).toBeTruthy()
    expect(mockSiteFetch).not.toHaveBeenCalled()
  })

  it('closes the form once the window has passed', async () => {
    mockSiteFetch.mockResolvedValueOnce(
      reply(200, orderData({ windowOpen: false, windowEndsAtMs: Date.UTC(2026, 8, 1, 12) - DAY })),
    )
    render(<ReturnRequest />)
    expect(await screen.findByText(/The return window for this order has closed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request return' })).toBeNull()
  })

  it('says the store takes no online returns when it is switched off', async () => {
    mockSiteFetch.mockResolvedValueOnce(reply(200, orderData({ enabled: false })))
    render(<ReturnRequest />)
    expect(await screen.findByText(/does not take return requests online/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request return' })).toBeNull()
  })

  it('lists earlier returns with their status, label and the store’s note', async () => {
    await renderLoaded(
      orderData({
        returns: [
          {
            id: 'ret-1',
            status: 'approved',
            lines: [{ lineItemId: 0, quantity: 1, reason: 'damaged' }],
            createdAtMs: Date.UTC(2026, 9, 1, 12),
            returnLabel: { labelUrl: 'https://labels.example/1.pdf', carrier: 'USPS', trackingNumber: '9400' },
          },
          {
            id: 'ret-2',
            status: 'declined',
            lines: [{ lineItemId: 1, quantity: 1, reason: 'other' }],
            createdAtMs: Date.UTC(2026, 9, 2, 12),
            merchantNote: 'Posters are final sale.',
          },
        ],
      }),
    )
    expect(screen.getByText('Approved')).toBeTruthy()
    expect(screen.getByText('Declined')).toBeTruthy()
    const label = screen.getByRole('link', { name: 'Print your return label' })
    expect(label.getAttribute('href')).toBe('https://labels.example/1.pdf')
    expect(within(label.parentElement as HTMLElement).getByText(/USPS 9400/)).toBeTruthy()
    expect(screen.getByText('From the store: Posters are final sale.')).toBeTruthy()
  })
})
