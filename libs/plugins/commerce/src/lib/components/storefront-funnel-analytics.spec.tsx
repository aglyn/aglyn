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
 * Every step of a storefront's GA4 funnel reaches the MERCHANT's property.
 *
 * The holes this pins shut were all of one shape: a path that took money and
 * reported nothing, sitting beside a path that reported everything. A shopper
 * who used the cart produced `view_item` → `add_to_cart` → `begin_checkout` →
 * `purchase`; a shopper who pressed Buy now produced the same first two steps,
 * then silence, then a purchase. GA4's shopping-behavior report cannot tell an
 * unmeasured checkout from an abandoned one, so the merchant's checkout rate
 * did not read as "we do not measure this" — it read as a collapse.
 *
 * ## Asserted against `window.gtag`, not against a mocked tracker
 *
 * The tenant runtime registers no analytics transport, so `window.gtag` IS the
 * delivery path to the host's property. Spying on `trackEvent` instead would
 * pass on an event that never left the module — and would keep passing if the
 * name fell out of the taxonomy, if the sanitizer stripped the params, or if
 * the reserved-name refusal started rejecting it.
 *
 * ## No Stripe path is exercised
 *
 * Every request stops at a mocked endpoint. The redirects are real
 * `window.location.assign` calls, which jsdom refuses to perform and reports
 * on its virtual console; that refusal is inert here because the tracking call
 * is awaited BEFORE it, and each `assign` is the last statement of its branch.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'
import ProductDetail from './product-detail'
import ReservationWidget from './reservation-widget'

const gtag = jest.fn()

/** Every hit gtag received for `name`, as GA4 would see it. */
function hitsFor(name: string): Record<string, unknown>[] {
  return gtag.mock.calls
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => (call[2] ?? {}) as Record<string, unknown>)
}

const CART = {
  lines: [
    {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 2,
      name: 'Widget',
      unitAmountCents: 1500,
    },
  ],
  count: 2,
  // Under 2 × 1500 on purpose: a coupon moves the subtotal without moving the
  // line prices, and the cart's events must report the charged amount.
  subtotalCents: 2500,
}

const PRODUCT = {
  id: 'prod-1',
  name: 'Widget',
  slug: 'widget',
  mediaUrls: [],
  options: [],
  variants: [{ id: 'var-1', priceUsd: 15, soldOut: false }],
}

const RESOURCE = {
  resource: {
    name: 'Lakeside cabin',
    nightlyRateUsd: 100,
    depositPct: 30,
    minNights: 1,
  },
  unavailable: [],
}

/**
 * The GET endpoints each block loads itself with. They go through the bare
 * `fetch`, not `siteFetch`, so they are routed separately — answering both
 * from one mock makes a failure here look like a tracking failure.
 */
function mockPageLoads(): void {
  ;(global as unknown as { fetch: unknown }).fetch = jest
    .fn()
    .mockImplementation(async (url: string) => {
      if (String(url).includes('/api/commerce/product')) {
        return { ok: true, json: async () => ({ product: PRODUCT }) }
      }
      if (String(url).includes('reservation-availability')) {
        return { ok: true, json: async () => RESOURCE }
      }
      return { ok: true, json: async () => CART }
    })
}

beforeEach(() => {
  gtag.mockClear()
  ;(window as unknown as { gtag: unknown }).gtag = gtag
  mockSiteFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
  mockPageLoads()
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
  jest.restoreAllMocks()
})

describe('the cart reports being looked at', () => {
  it('reports view_cart when the drawer opens on a cart with lines', async () => {
    render(<Cart variant="button" />)
    await waitFor(() => expect(screen.getByLabelText('Cart')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cart'))

    await waitFor(() => expect(hitsFor('view_cart')).toHaveLength(1))
    expect(hitsFor('view_cart')[0]).toEqual({
      currency: 'USD',
      // The SERVER's subtotal, not the line arithmetic: the two differ in this
      // fixture precisely so a change back to summing the lines fails here.
      value: 25,
      items: [
        { item_id: 'prod-1', item_name: 'Widget', price: 15, quantity: 2 },
      ],
    })
  })

  it('THE CONTROL: the badge alone reports nothing', async () => {
    /*
     * The case that decides whether the number means anything. The button
     * variant renders on every page of a storefront, so a `view_cart` on mount
     * would make "looked at the cart" a synonym for "loaded a page" — and the
     * checkout rate a fraction of pageviews rather than of carts.
     */
    render(<Cart variant="button" />)
    await waitFor(() => expect(screen.getByLabelText('Cart')).toBeTruthy())

    expect(hitsFor('view_cart')).toHaveLength(0)
  })

  it('reports view_cart once, not once per re-render, while the drawer stays open', async () => {
    render(<Cart variant="button" />)
    await waitFor(() => expect(screen.getByLabelText('Cart')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cart'))
    await waitFor(() => expect(hitsFor('view_cart')).toHaveLength(1))

    // A quantity edit refetches the cart and replaces the state object.
    window.dispatchEvent(new Event('aglyn:cart-updated'))
    await waitFor(() => expect(hitsFor('view_cart')).toHaveLength(1))
  })
})

describe('the cart reports checking out', () => {
  const openCartWithCheckout = async () => {
    render(<Cart variant="inline" />)
    return await screen.findByRole('button', { name: 'Checkout' })
  }

  it('reports begin_checkout once the server has minted a session', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    fireEvent.click(await openCartWithCheckout())

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
    expect(hitsFor('begin_checkout')[0]).toEqual({
      currency: 'USD',
      value: 25,
      items: [
        { item_id: 'prod-1', item_name: 'Widget', price: 15, quantity: 2 },
      ],
    })
  })

  it('THE CONTROL: reports nothing when the checkout is refused', async () => {
    /*
     * An unserved shipping destination, an exhausted promotion, a store with
     * no payments configured. A `begin_checkout` count inflated by refusals
     * reads as a healthy intent step with a broken payment one, and sends the
     * merchant looking one screen further on than the problem.
     */
    mockSiteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Your cart is empty' }),
    })
    fireEvent.click(await openCartWithCheckout())

    await screen.findByText('Your cart is empty')
    expect(hitsFor('begin_checkout')).toHaveLength(0)
  })
})

describe('the product detail block', () => {
  const renderPdp = async () => {
    render(<ProductDetail slug="widget" />)
    return await screen.findByRole('button', { name: 'Buy now' })
  }

  it('prices add_to_cart with what was actually added', async () => {
    await renderPdp()
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }))

    await waitFor(() => expect(hitsFor('add_to_cart')).toHaveLength(1))
    expect(hitsFor('add_to_cart')[0]).toEqual({
      currency: 'USD',
      // ONE unit at $15 — the quantity field's default. `value` is what went
      // in, never the cart's running total, or a session's adds would sum to
      // more than the shopper ever put in a basket.
      value: 15,
      items: [
        { item_id: 'prod-1', item_name: 'Widget', price: 15, quantity: 1 },
      ],
    })
  })

  it('reports begin_checkout on the buy-now redirect', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    fireEvent.click(await renderPdp())

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
    expect(hitsFor('begin_checkout')[0]).toEqual({
      currency: 'USD',
      value: 15,
      // The PRODUCT id, never the variant's: it is what joins this hit to the
      // `view_item` above it and the `purchase` below it.
      items: [
        { item_id: 'prod-1', item_name: 'Widget', price: 15, quantity: 1 },
      ],
    })
  })

  it('reports begin_checkout on the in-page payment branch too', async () => {
    /*
     * Both branches, from the same place. A count that halved the day the
     * in-page payment flag flipped would look like a conversion collapse
     * rather than a checkout that stopped redirecting.
     */
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ clientSecret: 'cs_test', publishableKey: 'pk_test' }),
    })
    fireEvent.click(await renderPdp())

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
  })

  it('THE CONTROL: reports nothing when the product is sold out', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Sold out' }),
    })
    fireEvent.click(await renderPdp())

    await screen.findByText('Sold out')
    expect(hitsFor('begin_checkout')).toHaveLength(0)
  })
})

describe('the reservation widget', () => {
  const renderWidget = async () => {
    render(<ReservationWidget resourceId="res-1" />)
    await screen.findByText('Lakeside cabin')
    fireEvent.change(screen.getByLabelText('Check-in'), {
      target: { value: '2026-07-06' },
    })
    fireEvent.change(screen.getByLabelText('Check-out'), {
      target: { value: '2026-07-09' },
    })
    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Ada Lovelace' },
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'ada@example.com' },
    })
    return screen.getByRole('button', { name: 'Reserve now' })
  }

  it('reports the DEPOSIT it is about to charge, not the value of the stay', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    fireEvent.click(await renderWidget())

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
    // Three nights at $100, 30% deposit — `reserve.ts` charges
    // `depositCents || totalCents`, which is $90. Reporting the $300 stay
    // against a $90 payment would make this step disagree with the `purchase`
    // that follows it, and the gap would read as abandoned upsell.
    expect(hitsFor('begin_checkout')[0]).toEqual({
      currency: 'USD',
      value: 90,
      items: [
        {
          item_id: 'res-1',
          item_name: 'Lakeside cabin',
          price: 90,
          quantity: 1,
        },
      ],
    })
  })

  it('THE CONTROL: reports nothing when the dates lose the race', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Those dates just sold out' }),
    })
    fireEvent.click(await renderWidget())

    await screen.findByText('Those dates just sold out')
    expect(hitsFor('begin_checkout')).toHaveLength(0)
  })

  it('carries no guest name or email into the hit', async () => {
    /*
     * The params are shipped to a third party by a merchant who did not write
     * them. This form holds the densest personal data on the widget, and the
     * shared sanitizer is what keeps it out — this asserts the guarantee at
     * the wire, where a new param would have to pass it.
     */
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    fireEvent.click(await renderWidget())

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
    const serialized = JSON.stringify(hitsFor('begin_checkout')[0])
    expect(serialized).not.toContain('ada@example.com')
    expect(serialized).not.toContain('Ada Lovelace')
  })
})

describe('what reaches the host', () => {
  it('THE CONTROL: nothing at all when the host has no GA configured', async () => {
    /*
     * `window.gtag` is defined by the host's own Analytics tag, which does not
     * exist until they configure GA and the visitor consents. Every assertion
     * above is only meaningful because this proves the absence of a hit is a
     * state this code can actually be in — and it proves the storefront still
     * sells when it is, rather than throwing on a missing global.
     */
    delete (window as unknown as { gtag?: unknown }).gtag
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    render(<Cart variant="button" />)
    await waitFor(() => expect(screen.getByLabelText('Cart')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Cart'))
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }))

    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalled())
    expect(gtag).not.toHaveBeenCalled()
  })
})
