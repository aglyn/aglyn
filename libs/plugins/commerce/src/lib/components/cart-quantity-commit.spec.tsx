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
 * The cart line-quantity field commits on settle, not per keystroke
 * (AGL-1772). It used to POST /api/commerce/cart — a Firestore write on the
 * merchant's cart document — on every `onChange`: typing "100" was three
 * writes, and clearing the field to retype passed through `""` → `Number('')`
 * = 0, which is the REMOVE path, so a select-all-and-retype deleted the line
 * mid-edit while the response replacing `cart` state fought the input. Those
 * bursts are also what forced the AGL-1770 visitor-write rate limit to be
 * sized generously.
 *
 * The convention matched here is the repo's own: the PDP's Qty field
 * (product-detail.tsx) is local state sent only on the buy click, and
 * besigner attributes commit on blur. Keystrokes edit a local draft; blur or
 * Enter commits ONE write; an empty or unparsable draft is a pending state
 * that reverts, never a 0-as-remove.
 *
 * Both remove directions stay pinned: the ✕ button still posts
 * `action: 'remove'`, and a genuinely typed 0, settled on blur, still posts
 * `quantity: 0`.
 *
 * NO STRIPE PATH IS EXERCISED: everything below stops at the mocked cart
 * endpoint; checkout is never clicked. No production writes are made.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSiteFetch = jest.fn()
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

import Cart from './cart'

interface Line {
  productId: string
  variantId?: string
  quantity: number
  name: string
  unitAmountCents: number
}

/** The server's cart, mutated by the POST mock so the follow-up GET the
 * CART_UPDATED_EVENT triggers agrees with the write instead of reverting
 * the UI to the pre-edit fixture. */
let serverLines: Line[] = []

const cartView = () => ({
  lines: serverLines,
  count: serverLines.reduce((sum, line) => sum + line.quantity, 0),
  subtotalCents: serverLines.reduce(
    (sum, line) => sum + line.quantity * line.unitAmountCents,
    0,
  ),
})

/** Every POST body the component has sent, in order. */
const posts = (): Array<Record<string, unknown>> =>
  mockSiteFetch.mock.calls.map((call) => JSON.parse(call[1].body))

beforeEach(() => {
  serverLines = [
    {
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 3,
      name: 'Widget',
      unitAmountCents: 1500,
    },
  ]
  mockSiteFetch.mockReset()
  mockSiteFetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (body.action === 'remove' || (body.action === 'set' && !body.quantity)) {
      serverLines = serverLines.filter(
        (line) => line.productId !== body.productId,
      )
    } else if (body.action === 'set') {
      serverLines = serverLines.map((line) =>
        line.productId === body.productId
          ? { ...line, quantity: body.quantity }
          : line,
      )
    }
    return { ok: true, json: async () => cartView() }
  })
  ;(global as any).fetch = jest
    .fn()
    .mockImplementation(async () => ({ ok: true, json: async () => cartView() }))
})

const renderCart = async () => {
  render(<Cart variant="inline" />)
  // The quantity field renders the fetched line — value 3, no label.
  return await screen.findByDisplayValue('3')
}

describe('the cart quantity field commits on settle (AGL-1772)', () => {
  it('keystrokes edit the field locally and write NOTHING', async () => {
    const input = await renderCart()

    // Typing "12" is two keystrokes, the first of which reads "1" — before
    // the fix each one was a POST, and the intermediate "1" was a real
    // write the last keystroke immediately superseded.
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '12' } })

    expect(screen.getByDisplayValue('12')).toBeTruthy()
    expect(mockSiteFetch).not.toHaveBeenCalled()
  })

  it('blur commits exactly one write, with the settled quantity', async () => {
    const input = await renderCart()

    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)

    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(1))
    expect(posts()[0]).toMatchObject({
      action: 'set',
      productId: 'prod-1',
      variantId: 'var-1',
      quantity: 12,
    })
    // The response replaces the cart; the field shows the committed value.
    await screen.findByDisplayValue('12')
  })

  it('Enter commits the draft too', async () => {
    const input = await renderCart()

    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(1))
    expect(posts()[0]).toMatchObject({ action: 'set', quantity: 7 })
  })

  it('a cleared field is a pending edit, never the remove path', async () => {
    const input = await renderCart()

    // Select-all-and-retype starts here: the field reads "" for a moment.
    // Before the fix this instant was `quantity: 0` — the remove path — so
    // the line could be deleted underneath the shopper mid-edit.
    fireEvent.change(input, { target: { value: '' } })
    expect(mockSiteFetch).not.toHaveBeenCalled()

    // Abandoning the empty field writes nothing and reverts to the server's
    // quantity: an empty box is "no answer", not "zero".
    fireEvent.blur(input)
    expect(mockSiteFetch).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('3')).toBeTruthy()
  })

  it('clear-then-retype settles as ONE write that never passed through 0', async () => {
    const input = await renderCart()

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)

    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(1))
    // Before the fix this sequence was writes of 0 (remove), 1, and 12.
    expect(posts()).toEqual([expect.objectContaining({ quantity: 12 })])
    expect(posts().some((body) => body.quantity === 0)).toBe(false)
    await screen.findByDisplayValue('12')
  })

  it('a settled value equal to the server quantity is not an edit', async () => {
    const input = await renderCart()

    // Away and back: a same-value `change` alone never reaches React (the
    // value tracker dedupes it), so this walks through a real draft that
    // ends where it started — the `quantity === line.quantity` branch.
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)

    expect(mockSiteFetch).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('3')).toBeTruthy()
  })

  it('a genuinely typed 0, settled, still removes the line', async () => {
    const input = await renderCart()

    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)

    // A deliberate 0 is an answer, not a pending state: the remove
    // semantics of quantity 0 are kept for the shopper who means it.
    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(1))
    expect(posts()[0]).toMatchObject({ action: 'set', quantity: 0 })
    await waitFor(() =>
      expect(screen.queryByDisplayValue('0')).toBeNull(),
    )
    expect(screen.queryByText('Widget')).toBeNull()
  })

  it('the ✕ button still posts the remove action', async () => {
    await renderCart()

    fireEvent.click(screen.getByText('✕'))

    await waitFor(() => expect(mockSiteFetch).toHaveBeenCalledTimes(1))
    expect(posts()[0]).toMatchObject({
      action: 'remove',
      productId: 'prod-1',
      variantId: 'var-1',
    })
    await waitFor(() => expect(screen.queryByText('Widget')).toBeNull())
  })
})
