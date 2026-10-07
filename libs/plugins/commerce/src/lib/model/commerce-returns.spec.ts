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

import type { HostOrder } from './commerce-orders'
import {
  canTransitionReturn,
  readReturnSettings,
  returnableLines,
  returnRefundCents,
  returnWholeLineIds,
  returnWindowEndsAtMs,
  RETURN_STATUSES,
} from './commerce-returns'

/** The return rules every door shares (AGL-3611). */

const order: HostOrder = {
  status: 'fulfilled',
  createdAtMs: 1_000,
  lineItems: [
    { productId: 'mug', name: 'Mug', quantity: 3, unitAmountCents: 1000, productType: 'physical' },
    { productId: 'ebook', name: 'E-book', quantity: 1, unitAmountCents: 1000, productType: 'digital' },
  ],
  totals: { itemsCents: 4000, shippingCents: 0, taxCents: 0, discountCents: 1000, totalCents: 3000, feeCents: 0 },
  fulfillments: [{ id: 'f', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], atMs: 5_000 }],
}

describe('the state machine', () => {
  it('moves forward only, and closed is the end', () => {
    expect(canTransitionReturn('requested', 'approved')).toBe(true)
    expect(canTransitionReturn('approved', 'refunded')).toBe(true)
    expect(canTransitionReturn('received', 'refunded')).toBe(true)
    expect(canTransitionReturn('declined', 'received')).toBe(false)
    expect(canTransitionReturn('refunded', 'approved')).toBe(false)
    for (const status of RETURN_STATUSES) expect(canTransitionReturn('closed', status)).toBe(false)
  })
})

describe('what can come back', () => {
  it('only shipped units of an eligible type, less what is already in a return', () => {
    const lines = returnableLines(order, [{ status: 'requested', lines: [{ lineItemId: 0, quantity: 1, reason: 'other' }] }], readReturnSettings({}))
    expect(lines[0]).toMatchObject({ returnable: 1, blocked: null })
    expect(lines[1]).toMatchObject({ returnable: 0, blocked: 'Not returnable' })
  })

  it('frees the units of a declined return, or one closed with no refund', () => {
    const lines = returnableLines(
      order,
      [
        { status: 'declined', lines: [{ lineItemId: 0, quantity: 2, reason: 'other' }] },
        { status: 'closed', lines: [{ lineItemId: 0, quantity: 2, reason: 'other' }] },
      ],
      null,
    )
    expect(lines[0].returnable).toBe(2)
  })

  it('takes nothing back on a line already refunded by name', () => {
    expect(returnableLines({ ...order, refundedLineItemIds: [0] }, [], null)[0]).toMatchObject({ returnable: 0, blocked: 'Already refunded' })
  })

  it('counts the window from the latest shipment, or the order when nothing shipped', () => {
    expect(returnWindowEndsAtMs(order, { windowDays: 1 })).toBe(5_000 + 86_400_000)
    expect(returnWindowEndsAtMs({ ...order, fulfillments: [] }, { windowDays: 1 })).toBe(1_000 + 86_400_000)
  })

  it('reads stored settings defensively', () => {
    expect(readReturnSettings({ windowDays: 9999, eligibleTypes: ['physical', 'bogus'], enabled: false })).toEqual({
      enabled: false,
      windowDays: 365,
      eligibleTypes: ['physical'],
    })
    expect(readReturnSettings(null)).toEqual({ enabled: true, windowDays: 30, eligibleTypes: ['physical'] })
  })
})

describe('what a return refund is worth', () => {
  it('pays the discounted share of the units, pro rata', () => {
    // $30 of mugs after a $10 order discount spread over $40 of list: $22.50
    // paid for the mugs, so two of three mugs is $15.00.
    expect(returnRefundCents(order, [{ lineItemId: 0, quantity: 2 }])).toBe(1500)
  })

  it('never pays more than is left on the order', () => {
    expect(returnRefundCents({ ...order, refundedCents: 2900 }, [{ lineItemId: 0, quantity: 3 }])).toBe(100)
  })

  it('names only lines it takes back in full', () => {
    expect(returnWholeLineIds(order, [{ lineItemId: 0, quantity: 2 }, { lineItemId: 1, quantity: 1 }])).toEqual([1])
  })
})
