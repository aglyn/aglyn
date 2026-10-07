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
 * The customer display (AGL-3608), driven through its only boundary:
 * `fetch` at `/api/commerce/pos-display`. Pairing, the live basket, the tip
 * and receipt answers it sends, and a revoked token sending it back to
 * pairing.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PosDisplayPage from './pos-display-page.component'
import { POS_DISPLAY_TOKEN_KEY } from './pos-display/pos-display-api'

const TOKEN = 't'.repeat(43)
const BRANDING = {
  name: 'Corner Cafe',
  logoUrl: null,
  logoDarkUrl: null,
  message: 'Thanks for stopping by',
}

interface Call {
  method: string
  url: string
  token: string | null
  body: any
}

let calls: Call[] = []
/** What the next poll answers: a state, or a bare status. */
let pollAnswer: { status: number; body: any } = {
  status: 200,
  body: { state: { mode: 'idle', updatedAtMs: 1, answered: false } },
}

function respond(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  calls = []
  window.localStorage.clear()
  pollAnswer = {
    status: 200,
    body: { state: { mode: 'idle', updatedAtMs: 1, answered: false }, branding: BRANDING },
  }
  global.fetch = jest.fn((url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({
      method: init.method ?? 'GET',
      url,
      token: init.headers?.['X-Pos-Display-Token'] ?? null,
      body,
    })
    if (init.method === 'GET') return respond(pollAnswer.status, pollAnswer.body)
    if (body?.action === 'pair') {
      return body.code === '123456'
        ? respond(200, { token: TOKEN, branding: BRANDING })
        : respond(404, { error: 'That code is not valid. Show a new code on the register.' })
    }
    return respond(200, { ok: true })
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

const polls = () => calls.filter((call) => call.method === 'GET')
const posts = (action: string) =>
  calls.filter((call) => call.method === 'POST' && call.body?.action === action)

function paired(state: Record<string, unknown>) {
  window.localStorage.setItem(POS_DISPLAY_TOKEN_KEY, TOKEN)
  pollAnswer = {
    status: 200,
    body: { state: { updatedAtMs: 1, answered: false, ...state }, branding: BRANDING },
  }
}

describe('the customer display (AGL-3608)', () => {
  it('pairs with the code from the register and keeps the token', async () => {
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    const input = await screen.findByLabelText('Pairing code')
    expect(screen.getByText('Enter the code shown on the register')).toBeTruthy()
    expect(input.getAttribute('inputmode')).toBe('numeric')

    // Letters never reach the code; a wrong one says so and empties the box.
    fireEvent.change(input, { target: { value: '12a3' } })
    expect((input as HTMLInputElement).value).toBe('123')
    fireEvent.change(input, { target: { value: '999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair display' }))
    expect(await screen.findByText(/That code is not valid/)).toBeTruthy()
    expect(window.localStorage.getItem(POS_DISPLAY_TOKEN_KEY)).toBeNull()

    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pair display' }))

    expect(await screen.findByText('Thanks for stopping by')).toBeTruthy()
    expect(screen.getByText('Corner Cafe')).toBeTruthy()
    expect(window.localStorage.getItem(POS_DISPLAY_TOKEN_KEY)).toBe(TOKEN)
    expect(posts('pair').at(-1)?.body).toMatchObject({ action: 'pair', code: '123456' })
    // The pairing call carries no token; every poll after it carries the new one.
    expect(posts('pair').every((call) => call.token === null)).toBe(true)
    await waitFor(() => expect(polls().length).toBeGreaterThan(0))
    expect(polls().every((call) => call.token === TOKEN)).toBe(true)
    expect(polls()[0].url).toContain('action=poll')
  })

  it('shows the live basket with discount, tax, total, paid and due', async () => {
    paired({
      mode: 'cart',
      cart: {
        lines: [
          { name: 'Flat White', variantLabel: 'Oat milk', quantity: 2, amountCents: 900 },
          { name: 'Croissant', quantity: 1, amountCents: 375 },
        ],
        itemsCents: 1275,
        discountCents: 100,
        taxCents: 94,
        totalCents: 1269,
        paidCents: 500,
        dueCents: 769,
      },
    })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    expect(await screen.findByText('2 × Flat White')).toBeTruthy()
    expect(screen.getByText('Oat milk')).toBeTruthy()
    expect(screen.getByText('1 × Croissant')).toBeTruthy()
    expect(screen.getByText('$9.00')).toBeTruthy()
    expect(screen.getByText('−$1.00')).toBeTruthy()
    expect(screen.getByText('$0.94')).toBeTruthy()
    expect(screen.getByText('$12.69')).toBeTruthy()
    expect(screen.getByText('$5.00')).toBeTruthy()
    expect(screen.getByText('$7.69')).toBeTruthy()
    // The first poll after a reload asks for the store's look again.
    expect(polls()[0].url).toContain('branding=true')
  })

  it('shows a tip beside the sale total and the total with it, in the store currency', async () => {
    paired({
      mode: 'cart',
      currency: 'eur',
      cart: {
        lines: [{ name: 'Espresso', quantity: 1, amountCents: 1000 }],
        itemsCents: 1000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 1000,
        tipCents: 200,
      },
    })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    expect(await screen.findByText('Total with tip')).toBeTruthy()
    expect(screen.getByText('€12.00')).toBeTruthy()
    expect(screen.getByText('€2.00')).toBeTruthy()
    expect(screen.queryByText('$12.00')).toBeNull()
  })

  it('sends a preset tip as a percentage of the prompt it answers', async () => {
    paired({
      mode: 'tip',
      promptId: 'p-tip',
      tip: { baseCents: 2000, percentages: [15, 18, 20], allowCustom: true },
    })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    expect(await screen.findByText('Add a tip?')).toBeTruthy()
    // Each preset shows what it comes to.
    expect(screen.getByText('$3.60')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /18%/ }))
    await waitFor(() => expect(posts('respond')).toHaveLength(1))
    expect(posts('respond')[0].body).toEqual({
      action: 'respond',
      response: { promptId: 'p-tip', tipChoice: 'percent', tipPercent: 18 },
    })
    expect(posts('respond')[0].token).toBe(TOKEN)
    expect(await screen.findByText('Thanks — the cashier will finish up')).toBeTruthy()
  })

  it('refuses a custom tip above the amount and sends one within it in cents', async () => {
    paired({
      mode: 'tip',
      promptId: 'p-custom',
      tip: { baseCents: 2000, percentages: [15], allowCustom: true },
    })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Custom amount' }))
    const amount = screen.getByLabelText('Tip amount')
    fireEvent.change(amount, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tip' }))
    expect(await screen.findByText(/A tip can be at most/)).toBeTruthy()
    expect(posts('respond')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Tip amount'), { target: { value: '4.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tip' }))
    await waitFor(() => expect(posts('respond')).toHaveLength(1))
    expect(posts('respond')[0].body.response).toEqual({
      promptId: 'p-custom',
      tipChoice: 'custom',
      tipCents: 450,
    })
  })

  it('sends an email receipt with the opt-in only when ticked, and keeps no copy', async () => {
    paired({
      mode: 'receipt',
      promptId: 'p-receipt',
      receipt: { channels: ['email', 'sms', 'print', 'none'], offerMarketing: true },
    })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    expect(await screen.findByText('How would you like your receipt?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Text' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No receipt' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    const optIn = screen.getByRole('checkbox', { name: 'Email me news and offers' })
    expect((optIn as HTMLInputElement).checked).toBe(false)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Pat@Example.com ' } })
    fireEvent.click(optIn)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(posts('respond')).toHaveLength(1))
    expect(posts('respond')[0].body.response).toEqual({
      promptId: 'p-receipt',
      receiptChannel: 'email',
      email: 'pat@example.com',
      marketingOptIn: true,
    })
    expect(await screen.findByText('Thanks — the cashier will finish up')).toBeTruthy()
    // Nothing the customer typed is left on the screen.
    expect(screen.queryByDisplayValue(/example\.com/i)).toBeNull()
  })

  it('leaves the opt-in out when the store does not offer it', async () => {
    paired({
      mode: 'receipt',
      promptId: 'p-plain',
      receipt: { channels: ['email', 'none'], offerMarketing: false },
    })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Email' }))
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pat@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(posts('respond')).toHaveLength(1))
    expect(posts('respond')[0].body.response).toEqual({
      promptId: 'p-plain',
      receiptChannel: 'email',
      email: 'pat@example.com',
    })
  })

  it('goes back to pairing and forgets the token when the display is revoked', async () => {
    window.localStorage.setItem(POS_DISPLAY_TOKEN_KEY, TOKEN)
    pollAnswer = { status: 401, body: { error: 'This display is not paired.' } }
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    expect(await screen.findByLabelText('Pairing code')).toBeTruthy()
    expect(window.localStorage.getItem(POS_DISPLAY_TOKEN_KEY)).toBeNull()
  })

  it('unpairs from the tucked-away control after a confirmation', async () => {
    paired({ mode: 'idle' })
    render(<PosDisplayPage pluginId="commerce" path="/pos-display" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unpair this display' }))
    expect(posts('forget')).toHaveLength(0)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unpair' }))
    })
    expect(await screen.findByLabelText('Pairing code')).toBeTruthy()
    expect(posts('forget')).toHaveLength(1)
    expect(posts('forget')[0].token).toBe(TOKEN)
    expect(window.localStorage.getItem(POS_DISPLAY_TOKEN_KEY)).toBeNull()
  })
})
