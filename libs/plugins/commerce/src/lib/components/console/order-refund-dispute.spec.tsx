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
 * AGL-1820: the Refund button agrees with the refund route's open-dispute
 * refusal (b03397f66 / AGL-1809).
 *
 * The predicate is `orderDisputeBlocksRefund`, and NOT the badge's
 * `orderHasOpenDispute` — the difference is the whole decision. A formal open
 * dispute (`needs_response`, `under_review`) blocks: the bank already pulled
 * the funds and a refund on top pays the shopper twice. An open INQUIRY
 * (`warning_needs_response`, `warning_under_review`) shows the AGL-1796
 * badge but MUST keep a live Refund button, because Stripe names a full
 * refund as the way to resolve an inquiry before it escalates. Two cases
 * here pin that split so a future "simplification" onto the badge predicate
 * goes red.
 *
 * And when the route's 409 still fires — a dispute webhook racing the click,
 * or a dispute the order document does not know about — its body is the
 * explanation, so it reaches the admin verbatim as the refusal it is
 * (warning), not a generic "Refund failed" error.
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
      getIdToken: jest.fn(async () => 'tok-refund-1820'),
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

const paidOrder = {
  $id: 'order-abc',
  number: 1042,
  status: 'paid',
  customerEmail: 'buyer@example.com',
  lineItems: [
    { productId: 'p1', name: 'Ceramic mug', quantity: 2, unitAmountCents: 3100 },
  ],
  totals: {
    itemsCents: 6200,
    shippingCents: 0,
    taxCents: 0,
    discountCents: 0,
    feeCents: 0,
    totalCents: 6200,
  },
  timeline: [],
}

/** A FORMAL open dispute — the state the route refuses with a 409. */
const blockingDispute = {
  id: 'dp_1TESTopen',
  status: 'needs_response',
  reason: 'product_not_received',
  amountCents: 6200,
  openedAtMs: Date.UTC(2026, 9, 2, 14, 30),
  evidenceDueByMs: Date.UTC(2026, 9, 16, 23, 59),
}

/** An open INQUIRY — badge-worthy, but refunding is the documented exit. */
const inquiryDispute = {
  ...blockingDispute,
  id: 'dp_1TESTinquiry',
  status: 'warning_needs_response',
}

const show = (order: Record<string, unknown> = paidOrder) =>
  render(
    <OrderDetailDialog
      hostId="host-1"
      order={order as never}
      onClose={jest.fn()}
    />,
  )

const refundButton = () => screen.getByRole('button', { name: 'Refund' })

const answer = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  ;(global as { fetch: unknown }).fetch = fetchMock
})

describe('the Refund button reflects the open-dispute refusal (AGL-1820)', () => {
  it('disables Refund while a chargeback is formally open, and says why on hover', async () => {
    show({ ...paidOrder, dispute: blockingDispute })
    expect((refundButton() as HTMLButtonElement).disabled).toBe(true)
    // The tooltip is driven by hovering the real control (its wrapper — a
    // disabled button swallows pointer events), not read off an attribute.
    fireEvent.mouseOver(refundButton().parentElement as HTMLElement)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('chargeback is open')
    expect(tip.textContent).toContain('pay the shopper twice')
    expect(tip.textContent).toContain('Stripe dashboard')
    // Clicking a disabled button reaches nothing.
    fireEvent.click(refundButton())
    expect(confirm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps Refund LIVE during an open inquiry — the badge predicate must not creep in', async () => {
    // `orderHasOpenDispute` is true here (the AGL-1796 badge shows), and
    // `orderDisputeBlocksRefund` is false. Disabling on the former forbids
    // the exit Stripe documents for an inquiry.
    fetchMock.mockResolvedValue(answer(200, { ok: true }))
    show({ ...paidOrder, dispute: inquiryDispute })
    expect(screen.getByText('Chargeback open')).toBeTruthy()
    expect((refundButton() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(refundButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/commerce/refund')
    // …and the confirmation names the inquiry resolution, so the admin knows
    // the refund is the documented exit rather than a risk.
    const [options] = confirm.mock.calls[0]
    expect(options.description).toContain('inquiry is open')
    expect(options.description).toContain('full refund resolves it')
  })

  it('leaves the ordinary refund path alone when no dispute exists', async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: true }))
    show()
    expect((refundButton() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(refundButton())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [options] = confirm.mock.calls[0]
    expect(options.description).not.toContain('inquiry')
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Refund issued',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it("surfaces the route's 409 verbatim, as the refusal it is", async () => {
    // The race the disabled button cannot close: the dispute webhook landed
    // after this dialog rendered, or Stripe knows a dispute the order
    // document does not (the route's second 409). The body IS the
    // explanation, and a refusal is a warning, not a failure of the refund
    // machinery.
    const refusal =
      'A chargeback is open on this order, so it was not refunded. ' +
      'Refunding would not withdraw the dispute — the bank has already ' +
      'taken the disputed amount, and a refund on top of it would pay ' +
      'the shopper twice. Respond to the dispute or accept it in the ' +
      'Stripe dashboard; refund any remainder once it settles.'
    fetchMock.mockResolvedValue(answer(409, { error: refusal }))
    show()
    fireEvent.click(refundButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        refusal,
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(snackbar).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variant: 'error' }),
    )
    expect(clientWrite).not.toHaveBeenCalled()
  })

  it('still reports a non-409 failure as the error it is', async () => {
    fetchMock.mockResolvedValue(answer(502, { error: 'Refund failed' }))
    show()
    fireEvent.click(refundButton())
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith(
        'Refund failed',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
  })
})
