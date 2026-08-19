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
 * CANCELLING A PAID BOOKING REFUNDS THE GUEST (AGL-2315).
 *
 * Cancel used to be one `updateDoc` writing `status: 'canceled'`, for a paid
 * booking exactly as for a free one. The slot reopened, the appointment was
 * gone, and the guest had paid for it — no money moved and nothing in the
 * console said so. That was survivable only while the charge sat in Aglyn's
 * own balance and could be handed back later; a paid booking is a destination
 * charge now, so the funds are at the MERCHANT and there is no second chance
 * to notice.
 *
 * The FREE path is asserted as loudly as the paid one. It is the branch a
 * careless fix breaks — routing every cancel through a refund route would
 * make a free site's cancel button fail on a booking that never had a
 * payment — and it is the branch that must keep writing directly.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import BookingsConsolePage from './bookings-console-page'

const collections: Record<string, Array<Record<string, unknown>>> = {
  services: [],
  bookings: [],
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { getIdToken: async () => 'id-token-1' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

/** The confirmation dialog's copy, captured so the money can be asserted. */
const confirmCalls: Array<Record<string, unknown>> = []
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: (options: Record<string, unknown>) => {
      confirmCalls.push(options)
      return Promise.resolve(undefined)
    },
  }),
}))

const ORG = { plan: 'business' } as never

const FUTURE = Date.now() + 7 * 24 * 60 * 60_000

const PAID_BOOKING = {
  $id: 'booking-1',
  serviceName: 'Deep tissue massage',
  name: 'Rhea Salt',
  email: 'rhea@example.com',
  startsAtMs: FUTURE,
  endsAtMs: FUTURE + 3_600_000,
  status: 'confirmed',
  paidAmountCents: 7500,
  paymentIntentId: 'pi_booking_1',
}

const FREE_BOOKING = {
  $id: 'booking-2',
  serviceName: 'Intro call',
  name: 'Dana Fox',
  email: 'dana@example.com',
  startsAtMs: FUTURE,
  endsAtMs: FUTURE + 1_800_000,
  status: 'confirmed',
}

const fetchMock = jest.fn()
const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

beforeEach(() => {
  jest.clearAllMocks()
  confirmCalls.length = 0
  collections.bookings = []
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      refundedCents: 7500,
      totalRefundedCents: 7500,
      fullyRefunded: true,
    }),
  })
})

const renderPage = () =>
  render(<BookingsConsolePage hostId="host-1" entitled org={ORG} />)

const clickCancel = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

describe('cancelling a PAID booking (AGL-2315)', () => {
  it('refunds through the route instead of only marking it canceled', async () => {
    collections.bookings = [PAID_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/bookings/refund')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      bookingId: 'booking-1',
    })
    // THE DEFECT: this was the whole of cancel, and it moved no money. The
    // route sets `canceled` itself once the refund lands, so a direct write
    // here would also race it.
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('authenticates the refund and keys the attempt', async () => {
    collections.bookings = [PAID_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1]
    // The route is site-admin gated and rejects an unauthenticated call with a
    // 401, so a missing token would fail every cancel.
    expect(init.headers.Authorization).toBe('Bearer id-token-1')
    expect(init.headers['Idempotency-Key']).toBeTruthy()
  })

  it('tells the merchant what the guest gets back before they confirm', async () => {
    collections.bookings = [PAID_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(confirmCalls).toHaveLength(1))
    expect(String(confirmCalls[0].description)).toContain('$75.00')
    expect(confirmCalls[0].confirmationText).toBe('Cancel and refund')
  })

  it('offers only the OUTSTANDING amount when part is already refunded', async () => {
    collections.bookings = [
      { ...PAID_BOOKING, refundedCents: 3000 },
    ]
    renderPage()
    clickCancel()

    await waitFor(() => expect(confirmCalls).toHaveLength(1))
    // $45.00, not the $75.00 originally charged — quoting the full amount
    // would promise the guest money the route will cap away.
    expect(String(confirmCalls[0].description)).toContain('$45.00')
  })

  it('leaves the booking STANDING when the refund fails', async () => {
    // Cancelled-and-unrefunded is the worst of the three outcomes: the slot is
    // gone, the guest paid, and nothing remains on screen to say so. An admin
    // who sees the row still there knows the cancel did not happen.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'Refund failed' }),
    })
    collections.bookings = [PAID_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][1].variant).toBe('error')
    // And NOTHING reports success afterwards. Asserting only the first
    // snackbar leaves room for a fall-through that shows the error and then
    // cheerfully says "canceled and refunded" — the merchant reads the last
    // message, walks away, and the guest is neither cancelled nor refunded.
    expect(
      enqueueSnackbar.mock.calls.some(
        (call: any[]) => call[1]?.variant === 'success',
      ),
    ).toBe(false)
  })

  it('surfaces a 409 guard verbatim as a warning, not an error', async () => {
    // A booking paid before the PaymentIntent was recorded answers 409 with a
    // body naming the Stripe dashboard. That is the route REFUSING with
    // instructions, not the machinery failing (the AGL-1818 rule), and an
    // admin needs to read it.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Refund it in the Stripe dashboard, and tick “Reverse transfer”',
      }),
    })
    collections.bookings = [PAID_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    const [message, options] = enqueueSnackbar.mock.calls[0]
    expect(String(message)).toContain('Stripe dashboard')
    expect(options.variant).toBe('warning')
    expect(updateDoc).not.toHaveBeenCalled()
    expect(
      enqueueSnackbar.mock.calls.some(
        (call: any[]) => call[1]?.variant === 'success',
      ),
    ).toBe(false)
  })

  it('leaves the booking standing when the request itself throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    collections.bookings = [PAID_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
  })
})

describe('cancelling a FREE booking (AGL-2315)', () => {
  it('still writes directly and calls no refund route', async () => {
    // The branch a careless fix breaks. A free booking has no payment to
    // reverse, and routing it through the refund route would answer 409 "never
    // paid" and leave the merchant unable to cancel anything.
    collections.bookings = [FREE_BOOKING]
    renderPage()
    clickCancel()

    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
      status: 'canceled',
    })
    expect(String(confirmCalls[0].confirmationText)).toBe('Cancel booking')
    expect(String(confirmCalls[0].description)).not.toContain('$')
  })

  it('treats a fully refunded booking as having nothing left to return', async () => {
    collections.bookings = [
      { ...PAID_BOOKING, refundedCents: 7500 },
    ]
    renderPage()
    clickCancel()

    await waitFor(() => expect(updateDoc).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
