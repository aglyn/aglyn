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
 * The Commerce Starter product block reports to the HOST's GA4 property.
 *
 * `Product` takes real money through Stripe and reported nothing at all: a
 * site built from it alone showed GA4 a `purchase` with no checkout step in
 * front of it, which reads as a 0% checkout rate rather than as an unmeasured
 * path. The lead form's half of this claim is `generate_lead`, held by the
 * forms plugin's `lead-and-checkout-analytics.spec.tsx`.
 *
 * ## Asserted against `window.gtag`, not against a mocked tracker
 *
 * The tenant runtime registers no analytics transport, so `window.gtag` IS the
 * delivery path to the host's property. Spying on `trackEvent` instead would
 * pass on an event that never left the module — and would keep passing if the
 * name fell out of the taxonomy or the sanitizer stripped the params.
 */

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Product from './product'

const gtag = jest.fn()
let fetchMock: jest.Mock

/** Every hit gtag received for `name`, as GA4 would see it. */
function hitsFor(name: string): Record<string, unknown>[] {
  return gtag.mock.calls
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => (call[2] ?? {}) as Record<string, unknown>)
}

beforeEach(() => {
  gtag.mockClear()
  ;(window as unknown as { gtag: unknown }).gtag = gtag
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
  jest.restoreAllMocks()
})

describe('the Commerce Starter product block', () => {
  const renderProduct = (props: Record<string, unknown> = {}) =>
    render(
      <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
        <Product
          productId="prod-1"
          name="Widget"
          priceUsd="29.50"
          {...props}
        />
      </Aglyn.SiteContext.Provider>,
    )

  it('reports begin_checkout once the server has minted a session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    renderProduct()
    fireEvent.click(screen.getByRole('button', { name: 'Buy now' }))

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
    expect(hitsFor('begin_checkout')[0]).toEqual({
      currency: 'USD',
      value: 29.5,
      items: [
        {
          item_id: 'prod-1',
          item_name: 'Widget',
          price: 29.5,
          quantity: 1,
        },
      ],
    })
  })

  it('THE CONTROL: reports nothing when the coupon is rejected', async () => {
    /*
     * `/api/commerce/checkout` refuses a sold-out product, an expired coupon
     * and a store that has not connected Stripe. Counting those would report
     * checkouts that Stripe never saw, on exactly the storefronts where the
     * merchant is trying to work out why nothing sells.
     */
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid or expired coupon' }),
    })
    renderProduct()
    fireEvent.click(screen.getByRole('button', { name: 'Buy now' }))

    await screen.findByText('Invalid or expired coupon')
    expect(hitsFor('begin_checkout')).toHaveLength(0)
  })

  it('sends nothing rather than a zero when the block has no price', async () => {
    /*
     * The block's price is a display prop; the charge is priced server-side
     * from the product doc. With no price typed there is no truthful `value`
     * to report, and a `begin_checkout` worth 0 on a real sale is a wrong
     * number in the merchant's report rather than a missing one.
     */
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/c/session' }),
    })
    renderProduct({ priceUsd: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Buy now' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(hitsFor('begin_checkout')).toHaveLength(0)
  })
})
