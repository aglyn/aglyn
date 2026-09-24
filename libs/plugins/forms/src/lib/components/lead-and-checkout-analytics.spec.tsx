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
 * The lead form reports to the HOST's GA4 property.
 *
 * `Form` is the generic lead form — the block behind a contact page, a quote
 * request, a survey — and it is the reason `generate_lead` has to mean the
 * same thing on every site. The other element every site is built from, the
 * Commerce Starter product block, is the MUI plugin's and reports
 * `begin_checkout`; its half of this suite is
 * `product-checkout-analytics.spec.tsx` beside it.
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
        <FormField fieldName="message" label="Message" />
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

    // The SUBMIT's answer, not the disclosure lookup the form makes when it
    // mounts (AGL-3320) — waiting on any call would pass before the refusal
    // arrived.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === '/api/forms/submit'),
      ).toBe(true),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
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
