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
 * The two elements every site is built from report to the HOST's GA4 property.
 *
 * `Form` is the generic lead form — the block behind a contact page, a quote
 * request, a survey — and it is the reason `generate_lead` has to mean the
 * same thing on every site. `Product` is the Commerce Starter block, which
 * takes real money through Stripe and reported nothing at all: a site built
 * from it alone showed GA4 a `purchase` with no checkout step in front of it,
 * which reads as a 0% checkout rate rather than as an unmeasured path.
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
import Form, { FormField, formNavigation } from './form'
import Product from './product'

const gtag = jest.fn()
let fetchMock: jest.Mock
let assign: jest.SpyInstance

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
  /*
   * The form navigates on its redirect setting, and jsdom's `location` is not
   * patchable — a real assign is refused by jsdom rather than performed, which
   * would leave the ordering assertion below with nothing to compare against.
   * Stubbing the seam the component already owns is the difference between
   * this suite testing the tracking and testing jsdom.
   */
  assign = jest
    .spyOn(formNavigation, 'assign')
    .mockImplementation(() => undefined)
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
  jest.restoreAllMocks()
})

/** A form with one text field, submitted the way a visitor submits it. */
function renderForm(props: Record<string, unknown> = {}) {
  const utils = render(
    <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
      <Form formName="Contact" {...props}>
        <FormField name="message" label="Message" />
      </Form>
    </Aglyn.SiteContext.Provider>,
  )
  return utils.container.querySelector('form') as HTMLFormElement
}

describe('the generic form block', () => {
  it('reports generate_lead once the server has accepted the submission', async () => {
    const form = renderForm()
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Please call me' },
    })
    fireEvent.submit(form)

    await waitFor(() => expect(hitsFor('generate_lead')).toHaveLength(1))
    expect(hitsFor('generate_lead')[0]).toMatchObject({
      form_name: 'Contact',
      form_location: '/',
    })
  })

  it('THE CONTROL: reports nothing when the submission is refused', async () => {
    /*
     * The case that decides whether the number means anything. Three of the
     * form's refusals are deliberate — a Preview write, a read-only lockdown
     * and the abuse ceiling — and a `generate_lead` count that included them
     * would report leads to a site owner who received no messages.
     */
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many submissions' }),
    })
    const form = renderForm()
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(hitsFor('generate_lead')).toHaveLength(0)
  })

  it('fires BEFORE the redirect that tears the page down', async () => {
    /*
     * The form can navigate in the same handler, and ordering the call ahead
     * of the `assign` is what `trackEventBeforeNavigation` is for. The obvious
     * reasoning about beacons is the wrong one — once a hit REACHES gtag a
     * navigation cannot destroy it — so what this pins is that the hit is
     * handed over first, which is the part a later transport could break.
     */
    const form = renderForm({
      afterSubmit: 'redirect',
      redirectUrl: 'https://example.com/thanks',
    })
    fireEvent.submit(form)

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(gtag).toHaveBeenCalled()
    expect(gtag.mock.invocationCallOrder[0]).toBeLessThan(
      assign.mock.invocationCallOrder[0],
    )
  })

  it('carries the form NAME but never a submitted field value', async () => {
    /*
     * A lead form is free text a visitor typed, shipped to a third party by an
     * owner who did not write the params. `form_name` is author-written site
     * content; everything the visitor typed stays on the wire to our own
     * endpoint and reaches GA from nowhere.
     */
    const form = renderForm()
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'ada@example.com — call me on 555 0123' },
    })
    fireEvent.submit(form)

    await waitFor(() => expect(hitsFor('generate_lead')).toHaveLength(1))
    const serialized = JSON.stringify(hitsFor('generate_lead')[0])
    expect(serialized).toContain('Contact')
    expect(serialized).not.toContain('ada@example.com')
    expect(serialized).not.toContain('555 0123')
  })
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

describe('what reaches the host', () => {
  it('THE CONTROL: nothing at all when the host has no GA configured', async () => {
    /*
     * `window.gtag` is defined by the host's own Analytics tag, which does not
     * exist until they configure GA and the visitor consents. Every assertion
     * above is only meaningful because this proves the absence of a hit is a
     * state this code can actually be in — and it proves the form still
     * submits and still redirects when it is, rather than throwing on a
     * missing global.
     */
    delete (window as unknown as { gtag?: unknown }).gtag
    const form = renderForm({
      afterSubmit: 'redirect',
      redirectUrl: 'https://example.com/thanks',
    })
    fireEvent.submit(form)

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(gtag).not.toHaveBeenCalled()
  })
})
