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
 * The storefront Payment Element's two client-side obligations (AGL-1944).
 *
 * The redirect flow handled both of these for us and neither survives the move
 * in-page, so they are the two things this file pins:
 *
 *   1. **A decline is recoverable, not a dead end.** The form stays mounted
 *      with the shopper's details in it and a plain error beside it. A payment
 *      form that unmounts on a declined card has thrown away the basket, the
 *      address and the chosen method to say "no" — which is a lost sale
 *      dressed as an error message.
 *   2. **Nothing here fulfils, or tells our server anything.** No fetch, no
 *      callback, no "paid" signal. `billing-webhook.ts` creates the order from
 *      `checkout.session.completed` and is the only thing that does.
 *
 * Stripe.js is mocked at the module boundary — no network, no live keys, and
 * `@stripe/react-stripe-js` mounts real iframes it cannot mount in jsdom.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every `confirm()` this file drives, so a fulfilment call cannot hide. */
const confirmMock = jest.fn()
const loadStripeMock = jest.fn(() => Promise.resolve({ __stripe: true }))

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: (...args: unknown[]) => loadStripeMock(...(args as [])),
}))

jest.mock('@stripe/react-stripe-js', () => ({
  // A pass-through provider: the real one boots Stripe.js against the network.
  CheckoutProvider: ({ children }: any) => children,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useCheckout: () => ({ confirm: confirmMock }),
}))

import {
  StorefrontPaymentElement,
  __resetStripePromises,
} from './storefront-payment-element'

/** The one thing the browser must never be able to do. */
const fetchSpy = jest.fn(async () => {
  throw new Error('the payment element must not call our server')
})

function mount(props: Partial<Record<string, any>> = {}) {
  return render(
    <StorefrontPaymentElement
      clientSecret="cs_test_1_secret_abc"
      publishableKey="pk_test_key"
      payLabel="Pay $53.35"
      {...props}
    />,
  )
}

beforeEach(() => {
  confirmMock.mockReset()
  loadStripeMock.mockClear()
  __resetStripePromises()
  ;(global as any).fetch = fetchSpy
  fetchSpy.mockClear()
})

describe('a declined card is recoverable', () => {
  it('shows the decline and KEEPS the form mounted', async () => {
    confirmMock.mockResolvedValue({
      type: 'error',
      error: { message: 'Your card was declined.' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Your card was declined.',
      ),
    )
    // The whole point: the shopper can try another card without starting over.
    expect(screen.getByTestId('stripe-payment-element')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Pay $53.35' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('lets a second attempt through after a decline', async () => {
    confirmMock
      .mockResolvedValueOnce({
        type: 'error',
        error: { message: 'Your card was declined.' },
      })
      .mockResolvedValueOnce({ type: 'success' })
    mount()
    const pay = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    pay()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    pay()
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2))
  })

  it('says something plain when Stripe gives no message at all', async () => {
    // A thrown confirm, or an error object with no `message`, must not render
    // an empty red box — which reads as "something is broken", not "try again".
    confirmMock.mockRejectedValue(new Error('network'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'That payment could not be completed. Try another card.',
      ),
    )
  })
})

describe('3DS and double-submit', () => {
  it('holds the button disabled for the whole confirm', async () => {
    // A 3DS challenge is an open await that can last a minute. A second
    // confirm during it is the double-submit the server claim exists to
    // survive, and there is no reason to make it lean on that.
    let release: (value: unknown) => void = () => undefined
    confirmMock.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    )
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Paying…' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Paying…' }))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    release({ type: 'success' })
  })
})

describe('the browser cannot fulfil', () => {
  it('never calls our server on a successful confirm', async () => {
    confirmMock.mockResolvedValue({ type: 'success' })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(fetchSpy).not.toHaveBeenCalled()
    // And the button does NOT come back: a successful confirm hands the page
    // to Stripe's redirect, so re-enabling it would offer a second payment for
    // an order that is already being made.
    expect(screen.getByRole('button', { name: 'Paying…' })).toBeTruthy()
  })

  it('never calls our server on a decline either', async () => {
    confirmMock.mockResolvedValue({
      type: 'error',
      error: { message: 'Your card was declined.' },
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('has no fulfilment call or success callback anywhere in the module', () => {
    // A source guard, because the risk is a FUTURE edit rather than this one:
    // someone adds `onSuccess` to make the page feel snappier, or posts to
    // `/api/commerce/...` "just to refresh the order", and fulfilment quietly
    // moves into the browser — where a closed tab loses it and a refresh
    // doubles it. Reading the file is the only check that sees a call this
    // file's own mocks would otherwise absorb.
    const source = readFileSync(
      join(__dirname, 'storefront-payment-element.tsx'),
      'utf8',
    )
    // Strip comments first: the doc block above deliberately NAMES the thing
    // it forbids, and a grep over the raw file would match its own warning.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/onSuccess|onPaid|onComplete|onFulfil/)
    expect(code).not.toMatch(/fetch\(|siteFetch|XMLHttpRequest|sendBeacon/)
    // The only Stripe call it may make is the confirm itself.
    expect(code.match(/checkout\.\w+\(/g) ?? []).toEqual(['checkout.confirm('])
  })
})

describe('it refuses to render half a payment form', () => {
  it('renders nothing without a client secret', () => {
    const { container } = mount({ clientSecret: '' })
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing without a publishable key', () => {
    // Belt and braces with the server's gate. An empty white box where a card
    // form should be is worse than the redirect it replaced.
    const { container } = mount({ publishableKey: '' })
    expect(container.firstChild).toBeNull()
    expect(loadStripeMock).not.toHaveBeenCalled()
  })
})
