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
 * The self-service kiosk (AGL-3623), driven through its only boundary:
 * `fetch` at `/api/commerce/pos-kiosk`. Pairing with a kiosk code, building
 * a cart, the server's total, pay at counter and the order number, and the
 * idle reset that voids the order and forgets the cart.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PosKioskPage, { POS_KIOSK_SEARCH_DEBOUNCE_MS } from './pos-kiosk-page.component'
import { POS_KIOSK_TOKEN_KEY } from './pos-kiosk/pos-kiosk-api'

const TOKEN = 'k'.repeat(43)

const CONTEXT = {
  branding: { name: 'Corner Cafe', logoUrl: null, logoDarkUrl: null, message: 'Order here' },
  currency: 'eur',
  tipping: { enabled: false, percentages: [15] },
  payments: { reader: false, cardPresent: false, payAtCounter: true },
  receipts: ['email', 'none'],
  offerMarketing: false,
  idleSeconds: 30,
  testMode: true,
}

const CATALOG = {
  currency: 'eur',
  categories: [{ id: 'drinks', name: 'Drinks' }],
  products: [
    {
      id: 'flat-white',
      name: 'Flat white',
      categoryIds: ['drinks'],
      options: [],
      variants: [{ id: 'default', options: {}, priceCents: 450, soldOut: false }],
      modifierGroups: [],
    },
    {
      id: 'cortado',
      name: 'Cortado',
      categoryIds: ['drinks'],
      options: [],
      variants: [{ id: 'default', options: {}, priceCents: 300, soldOut: true }],
      modifierGroups: [],
    },
  ],
}

function sale(status: string) {
  return {
    orderId: 'order-1',
    number: 42,
    status,
    lines: [{ name: 'Flat white', quantity: 2, amountCents: 900 }],
    itemsCents: 900,
    discountCents: 0,
    taxCents: 72,
    totalCents: 972,
    tipCents: 0,
    paidCents: 0,
    dueCents: 972,
    payment: null,
  }
}

let calls: Array<{ method: string; url: string; token: string | null; body: any; key: string | null }> = []

function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  calls = []
  window.localStorage.clear()
  global.fetch = jest.fn((url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({
      method: init.method ?? 'GET',
      url,
      token: init.headers?.['X-Pos-Display-Token'] ?? null,
      body,
      key: init.headers?.['Idempotency-Key'] ?? null,
    })
    if (url.includes('/pos-display')) {
      return body?.code === '123456' && body?.mode === 'kiosk'
        ? respond(200, { token: TOKEN, mode: 'kiosk', branding: CONTEXT.branding })
        : respond(409, { error: 'That code is for a customer display.' })
    }
    if (url.includes('action=context')) return respond(200, CONTEXT)
    if (url.includes('action=catalog')) return respond(200, CATALOG)
    if (body?.action === 'checkout') return respond(200, { sale: sale('open') })
    if (body?.action === 'counter') return respond(200, { sale: sale('queued') })
    if (body?.action === 'abandon') return respond(200, { sale: sale('voided') })
    return respond(200, { ok: true })
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const posts = (action: string) => calls.filter((call) => call.method === 'POST' && call.body?.action === action)

describe('the self-service kiosk (AGL-3623)', () => {
  it('pairs only with a kiosk code and keeps the token', async () => {
    render(<PosKioskPage pluginId="commerce" path="/pos-kiosk" />)
    expect(await screen.findByText('Pair this kiosk')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair kiosk' }))
    expect(await screen.findByRole('button', { name: 'Start order' })).toBeTruthy()
    expect(window.localStorage.getItem(POS_KIOSK_TOKEN_KEY)).toBe(TOKEN)
    expect(calls.find((call) => call.body?.action === 'pair')?.body).toMatchObject({ mode: 'kiosk' })
  })

  it('builds a cart, gets the server total, and sends it to the counter with its number', async () => {
    window.localStorage.setItem(POS_KIOSK_TOKEN_KEY, TOKEN)
    render(<PosKioskPage pluginId="commerce" path="/pos-kiosk" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start order' }))
    // A sold-out item cannot be added; the store's currency is used throughout.
    expect(await screen.findByText('Sold out')).toBeTruthy()
    fireEvent.click(screen.getByText('Flat white'))
    fireEvent.click(screen.getByText('Flat white'))
    const checkout = await screen.findByRole('button', { name: /Checkout · €9\.00/ })
    fireEvent.click(checkout)
    expect(await screen.findByText('Review your order')).toBeTruthy()
    const sent = posts('checkout')[0]!
    expect(sent.body.lines).toEqual([{ productId: 'flat-white', quantity: 2 }])
    expect(sent.key).toBeTruthy()
    expect(sent.token).toBe(TOKEN)
    expect(screen.getByText('€9.72')).toBeTruthy()
    // No card reader: pay at counter is the only way to pay.
    expect(screen.queryByRole('button', { name: 'Pay with card' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pay at counter' }))
    expect(await screen.findByText('Please pay at the counter')).toBeTruthy()
    expect(screen.getByLabelText('Order number').textContent).toBe('42')
  })

  it('the idle reset voids the open order and forgets the cart', async () => {
    window.localStorage.setItem(POS_KIOSK_TOKEN_KEY, TOKEN)
    window.localStorage.setItem('aglyn.posKiosk.leftover', 'ann@example.com')
    // The idle clock is the page's own interval: faked from the start, and
    // still advancing on its own so the screens can load.
    jest.useFakeTimers({ advanceTimers: true })
    render(<PosKioskPage pluginId="commerce" path="/pos-kiosk" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start order' }))
    fireEvent.click(await screen.findByText('Flat white'))
    fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
    await screen.findByText('Review your order')
    await act(async () => {
      jest.advanceTimersByTime((30 + 1) * 1000)
    })
    expect(screen.getByText('Still there?')).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(21 * 1000)
    })
    jest.useRealTimers()
    await waitFor(() => expect(posts('abandon')).toHaveLength(1))
    expect(posts('abandon')[0]!.body.orderId).toBe('order-1')
    expect(await screen.findByRole('button', { name: 'Start order' })).toBeTruthy()
    expect(window.localStorage.getItem('aglyn.posKiosk.leftover')).toBeNull()
    expect(window.localStorage.getItem(POS_KIOSK_TOKEN_KEY)).toBe(TOKEN)
    fireEvent.click(screen.getByRole('button', { name: 'Start order' }))
    await screen.findByText('Flat white')
    expect(screen.queryByRole('button', { name: /Checkout/ })).toBeNull()
  })

  describe('the search on a catalog longer than the menu (AGL-4060)', () => {
    const item = (id: string, name: string) => ({
      id,
      name,
      categoryIds: [],
      options: [],
      variants: [{ id: 'default', options: {}, priceCents: 300, soldOut: false }],
      modifierGroups: [],
    })
    /** The server's menu: the first of a catalog past its length. */
    const LONG = {
      ...CATALOG,
      truncated: true,
      products: Array.from({ length: 200 }, (_, index) => item(`p${index}`, `Item ${index}`)),
    }
    const searches = () => calls.filter((call) => call.url.includes('search='))
    /** The catalog route, answering a search with `answer`. */
    function catalogAnswers(menu: unknown, answer: () => Promise<unknown>) {
      const real = (global.fetch as jest.Mock).getMockImplementation()!
      ;(global.fetch as jest.Mock).mockImplementation((url: string, init: any = {}) => {
        if (url.includes('search=')) {
          calls.push({ method: 'GET', url, token: null, body: null, key: null })
          return answer()
        }
        if (url.includes('action=catalog')) return respond(200, menu)
        return real(url, init)
      })
    }
    async function openMenu() {
      window.localStorage.setItem(POS_KIOSK_TOKEN_KEY, TOKEN)
      render(<PosKioskPage pluginId="commerce" path="/pos-kiosk" />)
      fireEvent.click(await screen.findByRole('button', { name: 'Start order' }))
    }
    const type = (value: string) =>
      fireEvent.change(screen.getByLabelText('Search the menu'), { target: { value } })

    it('a menu that lists the whole catalog shows no search', async () => {
      await openMenu()
      await screen.findByText('Flat white')
      expect(screen.queryByLabelText('Search the menu')).toBeNull()
    })

    it('finds a product the menu never loaded, asked once when the typing rests', async () => {
      catalogAnswers(LONG, () => respond(200, { ...CATALOG, categories: [], products: [item('zebra', 'Zebra Latte')] }))
      await openMenu()
      await screen.findByText('Item 0')
      expect(screen.queryByText('Zebra Latte')).toBeNull()
      expect(POS_KIOSK_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(250)
      // Each key restarts the wait: no read until the typing has rested for all of it.
      jest.useFakeTimers()
      for (const value of ['z', 'ze', 'zeb']) {
        type(value)
        await act(async () => {
          jest.advanceTimersByTime(POS_KIOSK_SEARCH_DEBOUNCE_MS - 1)
        })
        expect(searches()).toHaveLength(0)
      }
      await act(async () => {
        jest.advanceTimersByTime(1)
      })
      expect(searches()).toHaveLength(1)
      jest.useRealTimers()
      expect(await screen.findByText('Zebra Latte')).toBeTruthy()
      expect(searches()).toHaveLength(1)
      expect(searches()[0]!.url).toContain('search=zeb')
      expect(screen.queryByText('Item 0')).toBeNull()
    })

    it('adds what it found to the cart', async () => {
      catalogAnswers(LONG, () => respond(200, { ...CATALOG, categories: [], products: [item('zebra', 'Zebra Latte')] }))
      await openMenu()
      await screen.findByText('Item 0')
      type('zebra')
      fireEvent.click(await screen.findByText('Zebra Latte'))
      fireEvent.click(await screen.findByRole('button', { name: /Checkout/ }))
      await screen.findByText('Review your order')
      expect(posts('checkout')[0]!.body.lines).toEqual([{ productId: 'zebra', quantity: 1 }])
    })

    it('with no connection, keeps narrowing what it has loaded', async () => {
      catalogAnswers(LONG, () => Promise.reject(new Error('offline')))
      await openMenu()
      await screen.findByText('Item 0')
      type('item 199')
      expect(await screen.findByText('Item 199')).toBeTruthy()
      expect(screen.queryByText('Item 0')).toBeNull()
      expect(await screen.findByText('Reconnecting…')).toBeTruthy()
      // The menu it had is still there to come back to.
      type('')
      expect(await screen.findByText('Item 0')).toBeTruthy()
    })

    it('says so when nothing matches, once the server has answered', async () => {
      catalogAnswers(LONG, () => respond(200, { ...CATALOG, categories: [], products: [] }))
      await openMenu()
      await screen.findByText('Item 0')
      type('nothing like it')
      expect(screen.queryByText('Nothing on the menu matches that.')).toBeNull()
      expect(await screen.findByText('Nothing on the menu matches that.')).toBeTruthy()
    })

    it('a category chip clears the word typed, and clearing it reads nothing again', async () => {
      catalogAnswers(LONG, () => respond(200, { ...CATALOG, categories: [], products: [item('zebra', 'Zebra Latte')] }))
      await openMenu()
      await screen.findByText('Item 0')
      type('zebra')
      await screen.findByText('Zebra Latte')
      const reads = calls.filter((call) => call.url.includes('action=catalog')).length
      type('')
      expect(await screen.findByText('Item 0')).toBeTruthy()
      expect(calls.filter((call) => call.url.includes('action=catalog'))).toHaveLength(reads)
      type('zebra')
      await screen.findByText('Zebra Latte')
      fireEvent.click(screen.getByRole('button', { name: 'All' }))
      expect(await screen.findByText('Item 0')).toBeTruthy()
      expect((screen.getByLabelText('Search the menu') as HTMLInputElement).value).toBe('')
    })

    it('the next customer finds nothing of the word the last one typed', async () => {
      catalogAnswers(LONG, () => respond(200, { ...CATALOG, categories: [], products: [item('zebra', 'Zebra Latte')] }))
      jest.useFakeTimers({ advanceTimers: true })
      await openMenu()
      await screen.findByText('Item 0')
      type('zebra')
      await screen.findByText('Zebra Latte')
      await act(async () => {
        jest.advanceTimersByTime((30 + 1) * 1000)
      })
      await act(async () => {
        jest.advanceTimersByTime(21 * 1000)
      })
      jest.useRealTimers()
      fireEvent.click(await screen.findByRole('button', { name: 'Start order' }))
      await screen.findByText('Item 0')
      expect((screen.getByLabelText('Search the menu') as HTMLInputElement).value).toBe('')
      expect(screen.queryByText('Zebra Latte')).toBeNull()
    })
  })

  it('a revoked kiosk goes back to pairing', async () => {
    window.localStorage.setItem(POS_KIOSK_TOKEN_KEY, TOKEN)
    ;(global.fetch as jest.Mock).mockImplementation(() => respond(401, { error: 'This kiosk is not paired.' }))
    render(<PosKioskPage pluginId="commerce" path="/pos-kiosk" />)
    expect(await screen.findByText('Pair this kiosk')).toBeTruthy()
    expect(window.localStorage.getItem(POS_KIOSK_TOKEN_KEY)).toBeNull()
  })
})
