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

import { createApiDouble } from '../testing/firestore-double'
import { cartAdd, cartSetDiscount, EMPTY_CART } from './cart'
import { fetchPosContext, openSale, readPaymentAnswer, readPosContext, salePayment } from './sale-api'

describe('the register routes (AGL-3618)', () => {
  it('reads the register context the payment route answers', async () => {
    const api = createApiDouble(() => ({
      settings: { tippingEnabled: true, tipPercentages: [15, 'x', 20], receiptDefault: 'print' },
      terminal: { available: true, testMode: true },
      readers: [{ id: 'tmr_1', label: 'Counter', status: 'online', livemode: false }, { label: 'no id' }],
      smsReceipts: true,
    }))
    const context = await fetchPosContext(api.client as never, 'h1')
    expect(api.calls[0]).toEqual({ path: '/api/commerce/pos-payment', init: { method: 'GET', query: { hostId: 'h1', action: 'context' } } })
    expect(context).toEqual({
      settings: { tippingEnabled: true, tipPercentages: [15, 20], receiptDefault: 'print' },
      terminalAvailable: true,
      testMode: true,
      readers: [{ id: 'tmr_1', label: 'Counter', registerId: null, status: 'online', livemode: false }],
      smsReceipts: true,
    })
    expect(readPosContext(null).terminalAvailable).toBe(false)
  })

  it('opens a sale with the basket picks, the register and the attempt key', async () => {
    const api = createApiDouble(() => ({ orderId: 'o1', totals: { totalCents: 1080, taxCents: 80 }, dueCents: 1080 }))
    const cart = cartSetDiscount(
      cartAdd(EMPTY_CART, { productId: 'p1', variantId: null, name: 'Bag', variantLabel: null, unitCents: 1000 }),
      10,
    )
    const opened = await openSale({
      api: api.client as never,
      hostId: 'h1',
      registerId: 'r1',
      locationId: 'loc1',
      cart: { ...cart, customerEmail: 'a@b.co' },
      attemptKey: 'key-1',
    })
    expect(opened).toEqual({ orderId: 'o1', totals: { totalCents: 1080, taxCents: 80 }, dueCents: 1080, stockWarnings: [] })
    expect(api.calls[0]).toEqual({
      path: '/api/commerce/pos-order',
      init: {
        method: 'POST',
        idempotencyKey: 'key-1',
        body: {
          hostId: 'h1',
          registerId: 'r1',
          locationId: 'loc1',
          payment: 'open',
          lines: [{ productId: 'p1', quantity: 1 }],
          discountPct: 10,
          customerEmail: 'a@b.co',
        },
      },
    })
  })

  it('refuses to start a payment without its attempt key', async () => {
    const api = createApiDouble()
    await expect(
      salePayment({ api: api.client as never, hostId: 'h1', orderId: 'o1', step: { action: 'cash', tenderedCents: 100, tipCents: 0 } }),
    ).rejects.toThrow(/attempt key/)
    expect(api.calls).toEqual([])
    await salePayment({ api: api.client as never, hostId: 'h1', orderId: 'o1', step: { action: 'sale' } })
    expect(api.calls[0].init.idempotencyKey).toBeUndefined()
  })

  it('reads a payment answer defensively', () => {
    expect(readPaymentAnswer({ sale: { orderId: 'o1', totalCents: '500', payments: [] }, completed: true })).toMatchObject({
      sale: { orderId: 'o1', totalCents: 500, dueCents: 0 },
      completed: true,
      clientSecret: null,
    })
  })
})
