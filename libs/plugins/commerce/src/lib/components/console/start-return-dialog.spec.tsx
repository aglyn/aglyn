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
 * "START RETURN" OPENS ONE THROUGH THE ROUTE (AGL-3611).
 *
 * What the dialog offers is `returnableLines` with no store policy — a
 * merchant may take back any type — less what the order's other returns
 * already hold; what it sends is one line per order line, with the units and
 * the reason picked, as action `create`.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok-start') } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return { useSnackbar: () => ({ enqueueSnackbar }), __snackbar: enqueueSnackbar }
})

import StartReturnDialog from './start-return-dialog.component'

const snackbar = (jest.requireMock('@aglyn/shared-ui-snackstack') as { __snackbar: jest.Mock })
  .__snackbar
const fetchMock = jest.fn()

const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never

const order = {
  lineItems: [
    { productId: 'p1', name: 'Ceramic mug', quantity: 3, unitAmountCents: 1500, productType: 'physical' },
    { productId: 'p2', name: 'Field guide', quantity: 1, unitAmountCents: 900, productType: 'digital' },
    { productId: 'p3', name: 'Poster', quantity: 2, unitAmountCents: 1200, productType: 'physical' },
  ],
  fulfillments: [
    { id: 'f1', lines: [{ lineItemId: 0, quantity: 3 }], atMs: 1, status: 'active' },
  ],
}

/** An approved return already holding one mug. */
const existing = [{ status: 'approved', lines: [{ lineItemId: 0, quantity: 1, reason: 'damaged' }] }]

const show = (onCreated = jest.fn(), onClose = jest.fn()) => {
  render(
    <StartReturnDialog
      hostId="host-1"
      orderId="order-1"
      order={order as never}
      existing={existing as never}
      open
      onClose={onClose}
      onCreated={onCreated}
    />,
  )
  return { onCreated, onClose }
}

const pickReason = (index: number, label: string) => {
  fireEvent.mouseDown(screen.getAllByRole('combobox', { name: 'Reason' })[index])
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: label }))
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(global as { fetch: unknown }).fetch = fetchMock
  fetchMock.mockResolvedValue(answer(200, { ok: true, returnId: 'ret-9', status: 'approved' }))
})

describe('start a return from the order (AGL-3611)', () => {
  it('offers what can still come back, and says why a line cannot', () => {
    show()
    // Three shipped, one already in a return.
    expect(screen.getByLabelText('Quantity (of 2)')).toBeTruthy()
    // Digital is returnable for the merchant, whatever the store's policy.
    expect(screen.getByLabelText('Quantity (of 1)')).toBeTruthy()
    expect(screen.getByText('Poster (Not shipped yet)')).toBeTruthy()
    expect((screen.getByLabelText('Quantity (of 0)') as HTMLInputElement).disabled).toBe(true)
    // Nothing picked yet.
    expect(
      (screen.getByRole('button', { name: 'Start return' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('posts create with one line per order line, its units and reason', async () => {
    const { onCreated, onClose } = show()
    fireEvent.change(screen.getByLabelText('Quantity (of 2)'), { target: { value: '2' } })
    pickReason(0, 'Arrived damaged')
    fireEvent.change(screen.getByLabelText('Quantity (of 1)'), { target: { value: '1' } })
    pickReason(1, 'No longer needed')
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'Customer called in' },
    })
    fireEvent.click(screen.getByLabelText('Notify customer'))
    fireEvent.click(screen.getByRole('button', { name: 'Start return' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commerce/returns')
    expect(init.headers.Authorization).toBe('Bearer tok-start')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      action: 'create',
      orderId: 'order-1',
      lines: [
        { lineItemId: 0, quantity: 2, reason: 'damaged' },
        { lineItemId: 1, quantity: 1, reason: 'no_longer_needed' },
      ],
      note: 'Customer called in',
      notify: false,
    })
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ret-9'))
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses more units than can come back before asking the route', () => {
    show()
    fireEvent.change(screen.getByLabelText('Quantity (of 2)'), { target: { value: '3' } })
    expect(
      (screen.getByRole('button', { name: 'Start return' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('shows the route refusing in its own words and stays open', async () => {
    fetchMock.mockResolvedValue(answer(409, { error: 'Only 1 of one item can be returned.' }))
    const { onClose } = show()
    fireEvent.change(screen.getByLabelText('Quantity (of 2)'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start return' }))
    await waitFor(() =>
      expect(snackbar).toHaveBeenCalledWith('Only 1 of one item can be returned.', {
        variant: 'warning',
        allowDuplicate: true,
      }),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
