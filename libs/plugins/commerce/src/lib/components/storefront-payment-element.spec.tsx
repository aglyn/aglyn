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

/** What `useCheckoutElements()` reports; each test may move it off success. */
let checkoutState: any

/** The provider's options as last mounted — where the appearance rides. */
let providerOptions: any
/** The Payment Element's options as last mounted — where `wallets` rides. */
let paymentElementOptions: any
/** The Shipping Address Element's `onChange`, so a test can type an address. */
let shippingAddressOnChange: ((event: any) => void) | undefined

jest.mock('@stripe/react-stripe-js/checkout', () => ({
  // A pass-through provider: the real one boots Stripe.js against the network.
  CheckoutElementsProvider: ({ children, options }: any) => {
    providerOptions = options
    return children
  },
  PaymentElement: ({ options }: any) => {
    paymentElementOptions = options
    return <div data-testid="stripe-payment-element" />
  },
  ShippingAddressElement: ({ onChange }: any) => {
    shippingAddressOnChange = onChange
    return <div data-testid="stripe-shipping-address-element" />
  },
  useCheckoutElements: () => checkoutState,
}))

const amount = (minorUnitsAmount: number) => ({
  minorUnitsAmount,
  amount: `$${(minorUnitsAmount / 100).toFixed(2)}`,
})

/**
 * A session in the shape Stripe.js hands `useCheckoutElements()` — the
 * actions and the session state on one object. The server put an email on it
 * (the cart's `customer_email`) unless a test says otherwise.
 */
function session(overrides: Record<string, any> = {}) {
  return {
    confirm: confirmMock,
    updateEmail: updateEmailMock,
    updateShippingOption: updateShippingOptionMock,
    updateShippingAddress: updateShippingAddressMock,
    email: 'shopper@example.com',
    status: { type: 'open' },
    tax: { status: 'ready' },
    shippingOptions: [],
    shipping: null,
    total: {
      subtotal: amount(5000),
      discount: amount(0),
      shippingRate: amount(0),
      taxExclusive: amount(0),
      taxInclusive: amount(0),
      total: amount(5000),
    },
    ...overrides,
  }
}

const updateEmailMock = jest.fn()
const updateShippingOptionMock = jest.fn()
const updateShippingAddressMock = jest.fn()

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
  checkoutState = { type: 'success', checkout: session() }
  confirmMock.mockReset()
  updateEmailMock.mockReset()
  updateEmailMock.mockResolvedValue({ type: 'success' })
  updateShippingOptionMock.mockReset()
  updateShippingOptionMock.mockResolvedValue({ type: 'success' })
  updateShippingAddressMock.mockReset()
  updateShippingAddressMock.mockResolvedValue({ type: 'success' })
  providerOptions = undefined
  paymentElementOptions = undefined
  shippingAddressOnChange = undefined
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
    // The Stripe calls it may make: the confirm itself, and the session
    // updates that fill in what the hosted page used to ask for (AGL-3606).
    // Every one of them goes to Stripe and none of them reports anything.
    const calls = new Set(
      (code.match(/checkout\s*\.\s*(\w+)\(/g) ?? []).map((call) =>
        call.replace(/\s/g, ''),
      ),
    )
    expect(calls.has('checkout.confirm(')).toBe(true)
    for (const call of calls) {
      expect([
        'checkout.confirm(',
        'checkout.updateEmail(',
        'checkout.updateShippingOption(',
        'checkout.updateShippingAddress(',
      ]).toContain(call)
    }
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

describe('a checkout session Stripe cannot load', () => {
  it('says so and offers the way back instead of a form that cannot pay', () => {
    // An expired session, or one already completed in another tab. The
    // react-stripe-js v6 hook reports it rather than handing back a checkout
    // whose confirm() would fail on click (AGL-3410).
    checkoutState = { type: 'error', error: { message: 'expired' } }
    const onCancel = jest.fn()
    mount({ onCancel })

    expect(screen.getByRole('alert').textContent).toContain(
      'This checkout could not be loaded.',
    )
    expect(screen.queryByTestId('stripe-payment-element')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the store' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('offers a fresh session when one is wired, instead of a dead end', () => {
    checkoutState = { type: 'error', error: { message: 'expired' } }
    const onRestart = jest.fn()
    mount({ onRestart })
    fireEvent.click(screen.getByRole('button', { name: 'Start checkout again' }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('offers no pay button until the session has loaded', () => {
    checkoutState = { type: 'loading' }
    mount()
    expect(screen.queryByRole('button', { name: 'Pay $53.35' })).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('an EXPIRED session says nothing was charged and restarts on request', () => {
    // The session can expire while the form is open (24 hours, or sooner on a
    // replayed attempt). Its confirm would fail; a fresh one is what the
    // shopper needs, and it must be a new attempt, which the caller mints.
    checkoutState = {
      type: 'success',
      checkout: session({ status: { type: 'expired' } }),
    }
    const onRestart = jest.fn()
    mount({ onRestart })
    expect(screen.getByRole('alert').textContent).toContain('Nothing was charged')
    expect(screen.queryByTestId('stripe-payment-element')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start checkout again' }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('a session already PAID offers no second payment and no restart', () => {
    checkoutState = {
      type: 'success',
      checkout: session({
        status: { type: 'complete', paymentStatus: 'paid' },
      }),
    }
    mount({ onRestart: jest.fn() })
    expect(screen.getByRole('status').textContent).toContain('already paid')
    expect(screen.queryByRole('button', { name: 'Pay $53.35' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Start checkout again' }),
    ).toBeNull()
  })
})

describe('email is required (AGL-3606)', () => {
  it('shows the email the server put on the session, read-only', () => {
    mount()
    expect(screen.getByText('Receipt to shopper@example.com')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /email/i })).toBeNull()
  })

  it('refuses to confirm without an email when the session has none', async () => {
    checkoutState = { type: 'success', checkout: session({ email: null }) }
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    await waitFor(() =>
      expect(
        screen.getByText('Enter your email for the receipt.'),
      ).toBeTruthy(),
    )
    expect(confirmMock).not.toHaveBeenCalled()
    expect(updateEmailMock).not.toHaveBeenCalled()
  })

  it('sends the typed email to the session BEFORE confirming', async () => {
    checkoutState = { type: 'success', checkout: session({ email: null }) }
    const order: string[] = []
    updateEmailMock.mockImplementation(async () => {
      order.push('updateEmail')
      return { type: 'success' }
    })
    confirmMock.mockImplementation(async () => {
      order.push('confirm')
      return { type: 'success' }
    })
    mount()
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: ' buyer@example.com ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(updateEmailMock).toHaveBeenCalledWith('buyer@example.com')
    expect(order).toEqual(['updateEmail', 'confirm'])
  })

  it('shows Stripe\'s email rejection and does not confirm', async () => {
    checkoutState = { type: 'success', checkout: session({ email: null }) }
    updateEmailMock.mockResolvedValue({
      type: 'error',
      error: { code: 'invalidEmail', message: 'Your email is invalid.' },
    })
    mount()
    fireEvent.change(screen.getByRole('textbox', { name: /email/i }), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pay $53.35' }))
    await waitFor(() =>
      expect(screen.getByText('Your email is invalid.')).toBeTruthy(),
    )
    expect(confirmMock).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: 'Pay $53.35' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('prefills the field from what the storefront already has', () => {
    checkoutState = { type: 'success', checkout: session({ email: null }) }
    mount({ defaultEmail: 'known@example.com' })
    expect(
      (screen.getByRole('textbox', { name: /email/i }) as HTMLInputElement)
        .value,
    ).toBe('known@example.com')
  })
})

describe('shipping appears only when the session ships (AGL-3606)', () => {
  const options = [
    { id: 'shr_std', displayName: 'Standard', ...amount(799), currency: 'usd', deliveryEstimate: null },
    { id: 'shr_exp', displayName: 'Express', ...amount(1999), currency: 'usd', deliveryEstimate: null },
  ]

  it('mounts no address form and no picker for a store that does not ship', () => {
    mount()
    expect(screen.queryByTestId('stripe-shipping-address-element')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByText('Shipping')).toBeNull()
  })

  it('mounts the address form and lists the session\'s own options', () => {
    checkoutState = {
      type: 'success',
      checkout: session({
        shippingOptions: options,
        shipping: { shippingOption: options[0], taxAmounts: null },
      }),
    }
    mount()
    expect(screen.getByTestId('stripe-shipping-address-element')).toBeTruthy()
    expect(
      (screen.getByRole('radio', { name: 'Standard — $7.99' }) as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(screen.getByRole('radio', { name: 'Express — $19.99' })).toBeTruthy()
  })

  it('selects through updateShippingOption', async () => {
    checkoutState = {
      type: 'success',
      checkout: session({
        shippingOptions: options,
        shipping: { shippingOption: options[0], taxAmounts: null },
      }),
    }
    mount()
    fireEvent.click(screen.getByRole('radio', { name: 'Express — $19.99' }))
    await waitFor(() =>
      expect(updateShippingOptionMock).toHaveBeenCalledWith('shr_exp'),
    )
  })

  it('pre-selects the first rate when the session has none selected', async () => {
    checkoutState = {
      type: 'success',
      checkout: session({ shippingOptions: options, shipping: null }),
    }
    mount()
    await waitFor(() =>
      expect(updateShippingOptionMock).toHaveBeenCalledWith('shr_std'),
    )
    expect(updateShippingOptionMock).toHaveBeenCalledTimes(1)
  })

  it('re-prices on a COMPLETE address only, once it settles', async () => {
    jest.useFakeTimers()
    try {
      checkoutState = {
        type: 'success',
        checkout: session({
          shippingOptions: options,
          shipping: { shippingOption: options[0], taxAmounts: null },
        }),
      }
      mount()
      const value = {
        name: 'Ada Buyer',
        address: { line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
      }
      shippingAddressOnChange?.({ complete: false, value })
      jest.advanceTimersByTime(1000)
      expect(updateShippingAddressMock).not.toHaveBeenCalled()
      shippingAddressOnChange?.({ complete: true, value })
      shippingAddressOnChange?.({ complete: true, value })
      jest.advanceTimersByTime(1000)
      expect(updateShippingAddressMock).toHaveBeenCalledTimes(1)
      expect(updateShippingAddressMock).toHaveBeenCalledWith(value)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('the live total comes from the session (AGL-3606)', () => {
  it('shows subtotal, shipping, tax and total as Stripe computed them', () => {
    const option = { id: 'shr_std', displayName: 'Standard', ...amount(799), currency: 'usd', deliveryEstimate: null }
    checkoutState = {
      type: 'success',
      checkout: session({
        shippingOptions: [option],
        shipping: { shippingOption: option, taxAmounts: null },
        total: {
          subtotal: amount(5000),
          discount: amount(0),
          shippingRate: amount(799),
          taxExclusive: amount(413),
          taxInclusive: amount(0),
          total: amount(6212),
        },
      }),
    }
    mount()
    const summary = screen.getByTestId('storefront-checkout-total').textContent
    expect(summary).toContain('Subtotal$50.00')
    expect(summary).toContain('Shipping$7.99')
    expect(summary).toContain('Tax$4.13')
    expect(summary).toContain('Total$62.12')
  })

  it('says tax waits on the address instead of showing a zero', () => {
    checkoutState = {
      type: 'success',
      checkout: session({ tax: { status: 'requires_shipping_address' } }),
    }
    mount()
    expect(
      screen.getByTestId('storefront-checkout-total').textContent,
    ).toContain('Calculated from your address')
  })
})

describe('the form wears the site theme (AGL-3606)', () => {
  it('passes an appearance built from the theme to the provider', () => {
    mount()
    const appearance = providerOptions?.elementsOptions?.appearance
    expect(appearance).toBeTruthy()
    // The default MUI theme's tokens — what a storefront without a custom
    // theme renders under — reach Stripe as variables.
    expect(appearance.variables.colorPrimary).toBe('#1976d2')
    expect(appearance.variables.borderRadius).toBe('4px')
    expect(appearance.variables.fontFamily).toContain('Roboto')
    expect(providerOptions.elementsOptions.fonts).toEqual([
      {
        cssSrc: expect.stringContaining('fonts.googleapis.com/css2?family=Roboto'),
      },
    ])
    expect(providerOptions.clientSecret).toBe('cs_test_1_secret_abc')
  })
})

describe('the wallets the merchant hid (AGL-3629)', () => {
  it('passes nothing when the merchant hid nothing, so every wallet the device supports shows', () => {
    mount()
    expect(paymentElementOptions).toBeUndefined()
  })

  it('hands the Payment Element the wallets option the checkout answered with', () => {
    mount({ wallets: { applePay: 'never', googlePay: 'auto', link: 'never' } })
    expect(paymentElementOptions).toEqual({
      wallets: { applePay: 'never', googlePay: 'auto', link: 'never' },
    })
  })
})
