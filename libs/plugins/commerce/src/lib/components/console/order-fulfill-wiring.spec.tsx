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
 * AGL-1819: the Fulfill and Mark delivered buttons drive
 * `/api/commerce/fulfill-order`, not a client `updateDoc`.
 *
 * The route is where the re-asked transition guard lives, so the only thing
 * that makes it real is this wiring — the same argument as the cancel swap
 * (`order-cancel-wiring.spec.tsx`, AGL-1818), whose harness this file reuses.
 * Every case drives the real buttons through the real handlers to the fetch
 * call and asserts `updateDoc` untouched.
 *
 * The stale-dialog case is the reason the route exists: the dialog renders
 * its buttons from the order it was OPENED with, and the order was refunded
 * (or cancelled) in another tab meanwhile. The old client write landed
 * `fulfilled` straight onto that refunded order; the route refuses with a
 * 409, and the message shown must be the guard's refusal — not a failure of
 * the fulfil machinery.
 *
 * Message contract (AGL-1784/1786 — say what happened): the route's own 500
 * is a rolled-back transaction, so "nothing changed" is licensed by its JSON
 * word alone; an answer carrying no such word, or no answer at all, is NOT
 * KNOWN — never "nothing happened".
 *
 * Notes are timeline-only — no status — and stay a client write on purpose;
 * the last case pins that this swap did not move them.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrderDetailDialog from './order-detail-dialog.component'
import { updateDoc } from 'firebase/firestore'

jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: jest.fn(async () => undefined),
  runTransaction: jest.fn(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({
    data: {
      uid: 'uid-admin',
      getIdToken: jest.fn(async () => 'tok-fulfill-1819'),
    },
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return {
    useSnackbar: () => ({ enqueueSnackbar }),
    __snackbar: enqueueSnackbar,
  }
})

jest.mock('@aglyn/shared-ui-jsx', () => {
  const confirm = jest.fn(async () => undefined)
  return { useConfirmationContext: () => ({ confirm }), __confirm: confirm }
})

const clientWrite = updateDoc as jest.Mock
const snackbar = (
  jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock }
).__snackbar
const fetchMock = jest.fn()

/** A `paid` order — the status that renders the Fulfill button. */
const paidOrder = {
  $id: 'order-abc',
  number: 1042,
  status: 'paid',
  customerEmail: 'buyer@example.com',
  lineItems: [
    {
      productId: 'p1',
      name: 'Ceramic mug',
      quantity: 3,
      unitAmountCents: 1100,
    },
  ],
  timeline: [{ event: 'paid', atMs: Date.UTC(2026, 7, 10, 12, 0) }],
}

/** A `fulfilled` order — the status that renders Mark delivered. */
const fulfilledOrder = { ...paidOrder, status: 'fulfilled' }

const answer = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as never

const show = (order: Record<string, unknown> = paidOrder) =>
  render(
    <OrderDetailDialog
      hostId="host-1"
      order={order as never}
      onClose={jest.fn()}
    />,
  )

/** Opens the tracking form and fills it, up to the final Fulfill click. */
const openFulfillForm = (carrier = 'UPS', number = '1Z999') => {
  fireEvent.click(screen.getByRole('button', { name: 'Fulfill…' }))
  fireEvent.change(screen.getByLabelText('Carrier'), {
    target: { value: carrier },
  })
  fireEvent.change(screen.getByLabelText('Tracking number'), {
    target: { value: number },
  })
}

const fulfillButton = () => screen.getByRole('button', { name: 'Fulfill' })
const deliveredButton = () =>
  screen.getByRole('button', { name: 'Mark delivered' })

beforeEach(() => {
  jest.clearAllMocks()
  ;(global as { fetch: unknown }).fetch = fetchMock
})

describe('the Fulfill button drives the fulfill-order route (AGL-1819)', () => {
  it('POSTs the route with the tracking and writes nothing client-side', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true }))
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // The request, decomposed — a call count alone would pass on a fetch of
    // the wrong route with an empty body.
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commerce/fulfill-order')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer tok-fulfill-1819')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      orderId: 'order-abc',
      to: 'fulfilled',
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })
    // The old path is DEAD, not merely shadowed.
    expect(clientWrite).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order fulfilled',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
    // Success closes the tracking form, as the client write used to.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Fulfill' })).toBeNull(),
    )
  })

  it('omits empty tracking fields from the body', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true }))
    show()
    openFulfillForm('', '')
    fireEvent.click(fulfillButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      hostId: 'host-1',
      orderId: 'order-abc',
      to: 'fulfilled',
    })
  })

  it('surfaces a stale-dialog 409 as the refusal it is, not a failure', async () => {
    // The dialog was opened on a `paid` order — the button IS rendered — and
    // the order was refunded in another tab before the click. The refusal
    // below comes solely from the server's answer.
    fetchMock.mockResolvedValue(
      answer(409, { error: 'Orders in "refunded" cannot be fulfilled' }),
    )
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Orders in "refunded" cannot be fulfilled',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    // The pre-AGL-1819 bug was exactly this write landing anyway.
    expect(clientWrite).not.toHaveBeenCalled()
    expect(snackbar).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variant: 'success' }),
    )
    // The refused form stays open — there is nothing to celebrate.
    expect(fulfillButton()).toBeTruthy()
  })

  it("reports the route's own 500 as rolled back and safe to retry", async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Fulfill failed' }))
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Fulfill failed — nothing changed, the order is as it was. Retrying is safe.',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
  })

  it('reports an answer with no JSON word from the handler as NOT known', async () => {
    // A gateway page or proxy timeout: the handler may or may not have run,
    // so nothing licenses "nothing changed".
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    } as never)
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() => expect(snackbar).toHaveBeenCalledTimes(1))
    const [message, options] = snackbar.mock.calls[0]
    expect(message).toContain('NOT known')
    expect(message).not.toContain('nothing changed')
    expect(options).toEqual(expect.objectContaining({ variant: 'error' }))
  })

  it('reports a network death as NOT known, and re-arms the button', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() => expect(snackbar).toHaveBeenCalledTimes(1))
    const [message] = snackbar.mock.calls[0]
    expect(message).toContain('NOT known whether the order was fulfilled')
    expect(message).not.toContain('nothing changed')
    // `busy` must reset on this path too, or the merchant cannot retry the
    // retry-safe case.
    await waitFor(() =>
      expect((fulfillButton() as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('treats a retry of an already-fulfilled order as the success it is', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true, already: true }))
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order was already fulfilled',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
    expect(clientWrite).not.toHaveBeenCalled()
  })

  it('disables the button while the request is in flight', async () => {
    let release: (value: unknown) => void = () => undefined
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    show()
    openFulfillForm()
    fireEvent.click(fulfillButton())
    await waitFor(() =>
      expect((fulfillButton() as HTMLButtonElement).disabled).toBe(true),
    )
    release(answer(200, { ok: true }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Fulfill' })).toBeNull(),
    )
  })
})

describe('the Mark delivered button drives the same route (AGL-1819)', () => {
  it('POSTs to: delivered and writes nothing client-side', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true }))
    show(fulfilledOrder)
    fireEvent.click(deliveredButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commerce/fulfill-order')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-fulfill-1819')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      orderId: 'order-abc',
      to: 'delivered',
    })
    expect(clientWrite).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order marked delivered',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('surfaces a stale-dialog 409 verbatim as a warning', async () => {
    // Opened on a `fulfilled` order, refunded in another tab meanwhile.
    fetchMock.mockResolvedValue(
      answer(409, { error: 'Orders in "refunded" cannot be marked delivered' }),
    )
    show(fulfilledOrder)
    fireEvent.click(deliveredButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Orders in "refunded" cannot be marked delivered',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(clientWrite).not.toHaveBeenCalled()
  })

  it('disables the button while the request is in flight, and re-arms after', async () => {
    let release: (value: unknown) => void = () => undefined
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    show(fulfilledOrder)
    fireEvent.click(deliveredButton())
    await waitFor(() =>
      expect((deliveredButton() as HTMLButtonElement).disabled).toBe(true),
    )
    release(answer(200, { ok: true }))
    await waitFor(() =>
      expect((deliveredButton() as HTMLButtonElement).disabled).toBe(false),
    )
  })
})

describe('what deliberately stays client-side', () => {
  it('adds a note with the client write — timeline only, no status, no fetch', async () => {
    show()
    fireEvent.change(screen.getByLabelText('Add note'), {
      target: { value: 'gift wrap please' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(clientWrite).toHaveBeenCalledTimes(1))
    const patch = clientWrite.mock.calls[0][1]
    // The whole patch, decomposed: a timeline append and NOTHING else — the
    // moment a status rides along, notes must move server-side too.
    expect(Object.keys(patch)).toEqual(['timeline'])
    expect(patch.timeline[patch.timeline.length - 1]).toEqual(
      expect.objectContaining({ event: 'note', detail: 'gift wrap please' }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
