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
 * A booking reports to the MERCHANT's GA4 property at both of its ends.
 *
 * AGL-2481 wired the paid booking's `purchase` and stopped there, which left
 * two halves of the widget dark for opposite reasons:
 *
 * - A PAID booking sent `purchase` with no `begin_checkout` in front of it, so
 *   GA4's shopping funnel had a terminal step and no intent step — every sale
 *   arrived looking like it had skipped checkout entirely.
 * - A FREE booking has no Stripe leg at all, so nothing downstream would ever
 *   see it. A merchant whose services are free watched appointments fill a
 *   calendar while their analytics reported no conversions of any kind.
 *
 * ## Asserted against `window.gtag`, not against a mocked tracker
 *
 * The tenant runtime registers no analytics transport, so `window.gtag` IS the
 * delivery path to the host's property. Spying on `trackEvent` instead would
 * pass on an event that never left the module.
 *
 * ## No Stripe path is exercised
 *
 * Every request stops at a mocked endpoint. The paid branch's redirect is a
 * real `window.location.assign`, which jsdom refuses and reports on its
 * virtual console; that refusal is inert here because the tracking call is
 * awaited before it and the `assign` is the last statement of its branch.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Booking from './booking'

const gtag = jest.fn()

/** Every hit gtag received for `name`, as GA4 would see it. */
function hitsFor(name: string): Record<string, unknown>[] {
  return gtag.mock.calls
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => (call[2] ?? {}) as Record<string, unknown>)
}

const PAID = {
  $id: 'svc-paid',
  name: 'Deep tissue massage',
  durationMinutes: 60,
  priceUsd: 120,
}
const FREE = {
  $id: 'svc-free',
  name: 'Intro consultation',
  durationMinutes: 15,
  priceUsd: 0,
}

/** A fixed slot so the day chip and time chip are deterministic. */
const SLOT_MS = Date.UTC(2026, 8, 14, 17, 0)

beforeEach(() => {
  gtag.mockClear()
  ;(window as unknown as { gtag: unknown }).gtag = gtag
  mockSiteFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
  ;(global as unknown as { fetch: unknown }).fetch = jest
    .fn()
    .mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        services: [PAID, FREE],
        slots: [{ startsAtMs: SLOT_MS, endsAtMs: SLOT_MS + 3_600_000 }],
      }),
    }))
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
  jest.restoreAllMocks()
})

/** Drive the widget the way a guest does, up to the Confirm button. */
async function fillBooking(service: typeof PAID): Promise<HTMLElement> {
  render(<Booking />)
  // A MUI Select opens on `mousedown`, not on click, and its options are
  // portalled — so the menu item is found on the document, not inside the
  // field. Driving it any other way silently selects nothing.
  fireEvent.mouseDown(await screen.findByLabelText('Service'))
  fireEvent.click(
    await screen.findByRole('option', {
      name: new RegExp(service.name),
    }),
  )
  fireEvent.click(
    await screen.findByText(new Date(SLOT_MS).toLocaleDateString()),
  )
  fireEvent.click(
    await screen.findByText(
      new Date(SLOT_MS).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    ),
  )
  fireEvent.change(await screen.findByLabelText('Your name'), {
    target: { value: 'Ada Lovelace' },
  })
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'ada@example.com' },
  })
  return screen.getByRole('button', { name: 'Confirm booking' })
}

describe('a paid booking', () => {
  it('reports begin_checkout once the server has held the slot', async () => {
    mockSiteFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay' }),
    })
    fireEvent.click(await fillBooking(PAID))

    await waitFor(() => expect(hitsFor('begin_checkout')).toHaveLength(1))
    expect(hitsFor('begin_checkout')[0]).toEqual({
      currency: 'USD',
      value: 120,
      // The SERVICE id, matching what `buildBookingPurchaseParams` puts on the
      // completed hit — otherwise the two steps name the same service twice
      // and GA reports two products where the merchant sells one.
      items: [
        {
          item_id: 'svc-paid',
          item_name: 'Deep tissue massage',
          price: 120,
          quantity: 1,
        },
      ],
    })
    // A payment that has not happened is not a purchase.
    expect(hitsFor('purchase')).toHaveLength(0)
  })

  it('THE CONTROL: reports nothing when the slot is already taken', async () => {
    /*
     * The case that decides whether the number means anything. Two guests
     * racing for the last 4pm slot both press Confirm; one is refused. A
     * `begin_checkout` count that included the loser would describe attempts,
     * and the merchant's checkout rate would fall as their calendar filled.
     */
    mockSiteFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'That time was just taken' }),
    })
    fireEvent.click(await fillBooking(PAID))

    await screen.findByText('That time was just taken')
    expect(hitsFor('begin_checkout')).toHaveLength(0)
    expect(hitsFor('generate_lead')).toHaveLength(0)
  })
})

describe('a free booking', () => {
  it('reports generate_lead when the appointment is confirmed', async () => {
    mockSiteFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    fireEvent.click(await fillBooking(FREE))

    await screen.findByText(/Booking confirmed/)
    expect(hitsFor('generate_lead')).toHaveLength(1)
    expect(hitsFor('generate_lead')[0]).toMatchObject({ form_name: 'Booking' })
    // Not a sale. A zero-value `purchase` would put a free appointment into
    // the merchant's revenue reports as something sold for nothing.
    expect(hitsFor('purchase')).toHaveLength(0)
    expect(hitsFor('begin_checkout')).toHaveLength(0)
  })

  it('carries no guest name or email into the hit', async () => {
    /*
     * The params are shipped to a third party by a merchant who did not write
     * them, and this form holds the two most identifying fields on the widget.
     * The shared sanitizer is what keeps them out; this asserts the guarantee
     * at the wire, where a new param would have to pass it.
     */
    mockSiteFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    fireEvent.click(await fillBooking(FREE))

    await waitFor(() => expect(hitsFor('generate_lead')).toHaveLength(1))
    const serialized = JSON.stringify(hitsFor('generate_lead')[0])
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
     * state this code can actually be in — and it proves the widget still
     * books when it is, rather than throwing on a missing global.
     */
    delete (window as unknown as { gtag?: unknown }).gtag
    mockSiteFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    fireEvent.click(await fillBooking(FREE))

    await screen.findByText(/Booking confirmed/)
    expect(gtag).not.toHaveBeenCalled()
  })
})
