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
 * The popup's email capture is a lead, and it reports as one.
 *
 * The overlay already reported its impression, its dismiss and its CTA click
 * as `aglyn_overlay`, so the one thing it exists to do — collect an address —
 * was the only part of it a site owner could not see. An announcement popup is
 * frequently the highest-converting capture on a marketing site, and its
 * conversion rate was unanswerable while the interruption it costs was
 * plainly visible.
 *
 * ## Asserted against `window.gtag`, not against a mocked tracker
 *
 * The tenant runtime registers no analytics transport, so `window.gtag` IS the
 * delivery path to the host's property. Spying on `trackEvent` instead would
 * pass on an event that never left the module.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MarketingSiteRuntime } from './site-runtime'

const gtag = jest.fn()
let fetchMock: jest.Mock

/** Every hit gtag received for `name`, as GA4 would see it. */
function hitsFor(name: string): Record<string, unknown>[] {
  return gtag.mock.calls
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => (call[2] ?? {}) as Record<string, unknown>)
}

const POPUP = {
  body: 'Ten percent off your first order.',
  // Shown immediately, so the suite exercises the capture rather than a timer.
  trigger: 'delay',
  triggerValue: 0,
  frequencyDays: 1,
  collectEmail: true,
  contentHash: 'popup-hash',
  overlayId: 'overlay-1',
}

const renderPopup = () =>
  render(
    <MarketingSiteRuntime
      hostId="host-1"
      screens={[] as never}
      page={{ popup: POPUP } as never}
    />,
  )

beforeEach(() => {
  gtag.mockClear()
  ;(window as unknown as { gtag: unknown }).gtag = gtag
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  global.fetch = fetchMock as unknown as typeof fetch
  // The overlay beacon is `navigator.sendBeacon`, which jsdom does not
  // implement — and its absence would throw out of the impression effect
  // before the capture form ever rendered.
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: jest.fn(() => true),
  })
  // A popup caps itself per browser; a leftover stamp would suppress it.
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
  jest.restoreAllMocks()
})

/** Fill the capture and submit it the way a visitor does. */
async function capture(address = 'ada@example.com'): Promise<void> {
  renderPopup()
  const field = await screen.findByLabelText('Email address')
  fireEvent.change(field, { target: { value: address } })
  // The handler awaits the POST and then swaps the form for the thank-you, so
  // the state update lands outside the event's own act() scope.
  await act(async () => {
    fireEvent.submit(field.closest('form') as HTMLFormElement)
  })
}

describe('the popup email capture', () => {
  it('reports generate_lead once the server has accepted the address', async () => {
    await capture()

    await waitFor(() => expect(hitsFor('generate_lead')).toHaveLength(1))
    expect(hitsFor('generate_lead')[0]).toMatchObject({
      // The block's own name, matching the `formName` on the wire, so the
      // popup is separable from the contact form in one breakdown.
      form_name: 'Popup',
      form_location: '/',
    })
  })

  it('THE CONTROL: reports nothing when the submission is refused', async () => {
    /*
     * The case that decides whether the number means anything. The capture
     * still thanks the visitor on a refusal — telling a real person to try
     * again after a honeypot verdict would leak the honeypot — so the visible
     * outcome is identical and only the count may differ. A `generate_lead`
     * that followed the thank-you instead of the acceptance would report
     * leads that were never written, and spam would read as conversion.
     */
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many submissions' }),
    })
    await capture()

    await screen.findByText(/on the list/)
    expect(hitsFor('generate_lead')).toHaveLength(0)
  })

  it('carries no visitor address into the hit', async () => {
    /*
     * The one field this overlay has is an email address, and the params are
     * shipped to a third party by an owner who did not write them. The shared
     * sanitizer is what keeps it out; this asserts the guarantee at the wire.
     */
    await capture('ada@example.com')

    await waitFor(() => expect(hitsFor('generate_lead')).toHaveLength(1))
    expect(JSON.stringify(hitsFor('generate_lead')[0])).not.toContain(
      'ada@example.com',
    )
  })
})

describe('what reaches the host', () => {
  it('THE CONTROL: nothing at all when the host has no GA configured', async () => {
    /*
     * `window.gtag` is defined by the host's own Analytics tag, which does not
     * exist until they configure GA and the visitor consents. Every assertion
     * above is only meaningful because this proves the absence of a hit is a
     * state this code can actually be in — and it proves the capture still
     * collects when it is, rather than throwing on a missing global.
     */
    delete (window as unknown as { gtag?: unknown }).gtag
    await capture()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await screen.findByText(/on the list/)
    expect(gtag).not.toHaveBeenCalled()
  })
})
