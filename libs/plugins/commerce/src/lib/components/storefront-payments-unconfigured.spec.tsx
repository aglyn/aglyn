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
 * A store with no Stripe key does not tell shoppers their payment failed
 * (AGL-2019).
 *
 * The cart had a `423` lockdown branch and NO `501` branch, so an
 * unconfigured-payments refusal fell through to the generic tail —
 * `setStatus('error')`, rendered as `<Alert severity="error">`. On a
 * self-hosted store that had never been given a Stripe key, a shopper clicked
 * an enabled **Checkout** button and got a RED alert. Red says *your card was
 * declined*; nothing was declined, and nothing was even attempted.
 *
 * ⚠️ THE SEVERITY IS THE ASSERTION, not the sentence. A test that only checked
 * the copy would pass on the exact bug this covers, because the copy was
 * already correct and safe — it was the styling around it that lied. Both
 * cases below therefore assert the rendered MUI severity class, and assert the
 * ABSENCE of the error one.
 *
 * NO STRIPE PATH IS EXERCISED: the checkout endpoint is mocked at the 501 it
 * returns before touching Stripe. No production writes are made.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

const LINE = {
  productId: 'prod-1',
  variantId: 'var-1',
  quantity: 1,
  name: 'Widget',
  unitAmountCents: 1500,
}

const cartView = () => ({
  lines: [LINE],
  count: 1,
  subtotalCents: LINE.unitAmountCents,
})

/** The server's answer when this deployment has no STRIPE_SECRET_KEY. */
const UNCONFIGURED = {
  ok: false,
  status: 501,
  json: async () => ({ error: 'Purchases are not configured on this site.' }),
}

/** A real failure, for the control: this one SHOULD be red. */
const REAL_FAILURE = {
  ok: false,
  status: 500,
  json: async () => ({ error: 'Checkout could not be started.' }),
}

/**
 * The alert MUI actually rendered, by SEVERITY class — `MuiAlert-colorError`
 * / `MuiAlert-colorInfo`. Read off the rendered DOM rather than guessed: the
 * older `MuiAlert-standardError` spelling is not what this MUI version emits,
 * and a selector that matches nothing would make every case below pass by
 * finding no error alert.
 */
const alertOfSeverity = (severity: 'error' | 'info') =>
  document.querySelector(
    `.MuiAlert-color${severity === 'error' ? 'Error' : 'Info'}`,
  )

beforeEach(() => {
  mockSiteFetch.mockReset()
  ;(global as any).fetch = jest
    .fn()
    .mockImplementation(async () => ({ ok: true, json: async () => cartView() }))
})

const renderCart = async () => {
  render(<Cart variant="inline" />)
  return await screen.findByRole('button', { name: /checkout/i })
}

describe('an unconfigured-payments 501 is not a payment failure (AGL-2019)', () => {
  it('renders as INFO, never as the red error alert', async () => {
    mockSiteFetch.mockImplementation(async () => UNCONFIGURED)
    const button = await renderCart()

    fireEvent.click(button)

    await waitFor(() => expect(alertOfSeverity('info')).toBeTruthy())
    expect(alertOfSeverity('error')).toBeNull()
  })

  it('says it about the store, and leaks no variable name to the visitor', async () => {
    mockSiteFetch.mockImplementation(async () => UNCONFIGURED)
    const button = await renderCart()

    fireEvent.click(button)

    const alert = await waitFor(() => {
      const found = alertOfSeverity('info')
      expect(found).toBeTruthy()
      return found as Element
    })
    expect(alert.textContent).toMatch(/not set up to take payments/i)
    // A shopper is a stranger on someone else's site.
    expect(alert.textContent).not.toMatch(/STRIPE|SECRET|env|deployment/i)
  })

  it('LATCHES the buy control off — a retry could only get the same 501', async () => {
    mockSiteFetch.mockImplementation(async () => UNCONFIGURED)
    const button = await renderCart()

    fireEvent.click(button)

    await waitFor(() => expect(alertOfSeverity('info')).toBeTruthy())
    expect((button as HTMLButtonElement).disabled).toBe(true)

    // And the disabled control really does stop the traffic.
    const callsAfterFirst = mockSiteFetch.mock.calls.length
    fireEvent.click(button)
    expect(mockSiteFetch.mock.calls.length).toBe(callsAfterFirst)
  })

  it('THE CONTROL: a real failure is still RED, and still lets them retry', async () => {
    // Without this case the fix could have been "never show an error alert",
    // which would hide genuine failures just as badly as it showed false ones.
    mockSiteFetch.mockImplementation(async () => REAL_FAILURE)
    const button = await renderCart()

    fireEvent.click(button)

    await waitFor(() => expect(alertOfSeverity('error')).toBeTruthy())
    expect(alertOfSeverity('info')).toBeNull()
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
