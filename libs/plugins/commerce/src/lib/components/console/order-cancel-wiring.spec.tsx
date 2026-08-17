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
 * AGL-1818: the cancel button drives `/api/commerce/cancel-order`, not a
 * client `updateDoc`.
 *
 * The route (AGL-1808) is where the stock release and the re-asked transition
 * guard live, so the ONLY thing that makes either real is this wiring — a
 * suite that asserted the button renders would pass against the old client
 * write. Every case here drives the real button through the real handler to
 * the fetch call and asserts `updateDoc` untouched.
 *
 * The stale-dialog case is the reason the guard exists: the dialog renders
 * the cancel button from the order it was OPENED with (`can('cancelled')` on
 * a `paid` order), and the order ships in another tab meanwhile. The old
 * client write landed `cancelled` on that `fulfilled` order; the route
 * refuses with a 409, and the message shown must be the guard's refusal —
 * not a failure of the cancel machinery.
 *
 * Message contract (AGL-1784/1786 — say what happened): the route's own 500
 * is a rolled-back transaction, so "nothing changed" is licensed by its JSON
 * word alone; an answer carrying no such word, or no answer at all, is NOT
 * KNOWN — never "nothing happened".
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrderDetailDialog from './order-detail-dialog.component'
import { updateDoc } from 'firebase/firestore'

jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({
    data: {
      uid: 'uid-admin',
      getIdToken: jest.fn(async () => 'tok-cancel-1818'),
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
const confirm = (
  jest.requireMock('@aglyn/shared-ui-jsx') as { __confirm: jest.Mock }
).__confirm
const snackbar = (
  jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock }
).__snackbar
const fetchMock = jest.fn()

/** A `paid` order — the one status that renders the cancel button AND whose
 * sale decremented stock, so the route has something to release. */
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

const cancelButton = () => screen.getByRole('button', { name: 'Cancel order' })

beforeEach(() => {
  jest.clearAllMocks()
  ;(global as { fetch: unknown }).fetch = fetchMock
})

describe('the cancel button drives the cancel-order route (AGL-1818)', () => {
  it('POSTs the route with the id token and writes nothing client-side', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { ok: true, released: 2, units: 3 }),
    )
    show()
    fireEvent.click(cancelButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // The request, decomposed — a call count alone would pass on a fetch of
    // the wrong route with an empty body.
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commerce/cancel-order')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer tok-cancel-1818')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      orderId: 'order-abc',
    })
    // The old path is DEAD, not merely shadowed: the client write the route
    // replaced must not fire alongside it.
    expect(clientWrite).not.toHaveBeenCalled()
    // …and the user asked first.
    expect(confirm).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order cancelled — 3 units returned to stock',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('says "1 unit", and says nothing about stock for an untracked store', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { ok: true, released: 1, units: 1 }),
    )
    const first = show()
    fireEvent.click(cancelButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order cancelled — 1 unit returned to stock',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
    first.unmount()
    fetchMock.mockResolvedValue(
      answer(200, { ok: true, released: 0, units: 0 }),
    )
    show()
    fireEvent.click(cancelButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order cancelled',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('surfaces a stale-dialog 409 as the refusal it is, not a failure', async () => {
    // The dialog was opened on a `paid` order — the button IS rendered — and
    // the order shipped in another tab before the click. The refusal below
    // comes solely from the server's answer.
    fetchMock.mockResolvedValue(
      answer(409, { error: 'Orders in "fulfilled" cannot cancel' }),
    )
    show()
    fireEvent.click(cancelButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Orders in "fulfilled" cannot cancel',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    // The pre-AGL-1818 bug was exactly this write landing anyway.
    expect(clientWrite).not.toHaveBeenCalled()
    expect(snackbar).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it("reports the route's own 500 as rolled back and safe to retry", async () => {
    fetchMock.mockResolvedValue(answer(500, { error: 'Cancel failed' }))
    show()
    fireEvent.click(cancelButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Cancel failed — nothing changed, the order is still open. Retrying is safe.',
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
    fireEvent.click(cancelButton())
    await waitFor(() => expect(snackbar).toHaveBeenCalledTimes(1))
    const [message, options] = snackbar.mock.calls[0]
    expect(message).toContain('NOT known')
    expect(message).not.toContain('nothing changed')
    expect(options).toEqual(expect.objectContaining({ variant: 'error' }))
  })

  it('reports a network death as NOT known, and re-arms the button', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    show()
    fireEvent.click(cancelButton())
    await waitFor(() => expect(snackbar).toHaveBeenCalledTimes(1))
    const [message] = snackbar.mock.calls[0]
    expect(message).toContain('NOT known whether the order was cancelled')
    expect(message).not.toContain('nothing changed')
    // `busy` must reset on this path too, or the merchant cannot retry the
    // retry-safe case.
    await waitFor(() =>
      expect((cancelButton() as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('treats a second click on an already-cancelled order as the success it is', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { ok: true, alreadyCancelled: true, released: 0, units: 0 }),
    )
    show()
    fireEvent.click(cancelButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Order was already cancelled',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('disables the button while the request is in flight', async () => {
    let release: (value: unknown) => void = () => undefined
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    show()
    fireEvent.click(cancelButton())
    await waitFor(() =>
      expect((cancelButton() as HTMLButtonElement).disabled).toBe(true),
    )
    release(answer(200, { ok: true, released: 0, units: 0 }))
    await waitFor(() =>
      expect((cancelButton() as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('does nothing when the confirmation is declined', async () => {
    confirm.mockImplementationOnce(() => Promise.reject(new Error('declined')))
    show()
    fireEvent.click(cancelButton())
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clientWrite).not.toHaveBeenCalled()
    expect(snackbar).not.toHaveBeenCalled()
  })

  it('renders the route-written timeline event with its stock detail unchanged', () => {
    // Part of AGL-1818's contract with AGL-1808: the route appends
    // `cancelled` with a `N units returned to stock` detail, and the dialog
    // already prints `event: detail` — this pins that no renderer change was
    // needed for the new detail to show.
    show({
      ...paidOrder,
      status: 'cancelled',
      timeline: [
        { event: 'paid', atMs: Date.UTC(2026, 7, 10, 12, 0) },
        {
          event: 'cancelled',
          atMs: Date.UTC(2026, 7, 11, 9, 30),
          detail: '3 units returned to stock',
        },
      ],
    })
    expect(
      screen.getByText(/cancelled: 3 units returned to stock/),
    ).toBeTruthy()
  })
})
