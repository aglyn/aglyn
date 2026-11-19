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

import {
  posHardwareArrivedNumbers,
  posHardwareBasket,
  posHardwareCheckoutState,
  posHardwareOrderItems,
  posHardwareReturnOffered,
  posHardwareReturnReasonReady,
  posHardwareWaitingItems,
  posHardwareWaitingNote,
  POS_HARDWARE_SHOP_TEXT,
} from './pos-hardware-shop'

describe('pos-hardware-shop (AGL-4038)', () => {
  it('offers a return once delivered or set up, or once a shipped order has shipped, and never twice', () => {
    expect(posHardwareReturnOffered({ status: 'delivered' })).toBe(true)
    expect(posHardwareReturnOffered({ status: 'registered', source: 'in_person' })).toBe(true)
    expect(posHardwareReturnOffered({ status: 'shipped' })).toBe(true)
    expect(posHardwareReturnOffered({ status: 'shipped', source: 'in_person' })).toBe(false)
    expect(posHardwareReturnOffered({ status: 'paid' })).toBe(false)
    expect(posHardwareReturnOffered({ status: 'delivered', returnRequest: { state: 'requested' } })).toBe(false)
  })

  it('names only arrived orders bought from the card', () => {
    expect(
      posHardwareArrivedNumbers([
        { number: 'HW-1', status: 'delivered' },
        { number: 'HW-2', status: 'delivered', source: 'in_person' },
        { number: 'HW-3', status: 'shipped' },
        { number: 'HW-4', status: 'registered', source: 'online' },
      ]),
    ).toEqual(['HW-1', 'HW-4'])
  })

  it('lists items both ways round', () => {
    const lines = [{ name: 'Pocket reader (M2)', quantity: 2 }, { name: 'Case', quantity: 1 }]
    expect(posHardwareOrderItems(lines)).toBe('Pocket reader (M2) × 2, Case × 1')
    expect(posHardwareWaitingItems(lines)).toBe('2 × Pocket reader (M2), 1 × Case')
  })

  it('says what a waiting reader still needs', () => {
    expect(posHardwareWaitingNote({ storeName: 'Shop', serialsTaken: 1, hasLocation: true })).toBe(
      'For Shop. Add it on the POS devices card with the code it shows, and it is set up: we know its serial number.',
    )
    expect(posHardwareWaitingNote({ storeName: 'Shop', serialsTaken: 0, hasLocation: false })).toBe(
      'For Shop. Add it on the POS devices card with the code it shows, then mark it set up. The first reader asks for the store’s address.',
    )
  })

  it('works out the basket in the catalog order', () => {
    const basket = posHardwareBasket({
      offers: [
        { sku: 'a', unitCents: 1000 },
        { sku: 'b', unitCents: 250 },
      ],
      quantities: { b: 2, a: 1, c: 4 },
      shippingCents: 1500,
      automaticTax: true,
    })
    expect(basket.lines).toEqual([
      { sku: 'a', quantity: 1 },
      { sku: 'b', quantity: 2 },
    ])
    expect(basket.itemsCents).toBe(1500)
    expect(basket.totalCents).toBe(3000)
    expect(basket.totalLabel).toBe(POS_HARDWARE_SHOP_TEXT.totalBeforeTax)
  })

  it('blocks Check out on the buy key first, then the boxes', () => {
    const all = { canBuy: true, termsAccepted: true, businessUse: true, hasLines: true, hasShipping: true }
    expect(posHardwareCheckoutState(all)).toEqual({ blockedReason: null, enabled: true })
    expect(posHardwareCheckoutState({ ...all, canBuy: false, termsAccepted: false }).blockedReason).toBe(
      POS_HARDWARE_SHOP_TEXT.buyKeyReason,
    )
    expect(posHardwareCheckoutState({ ...all, businessUse: false }).blockedReason).toBe(POS_HARDWARE_SHOP_TEXT.termsReason)
    expect(posHardwareCheckoutState({ ...all, hasLines: false })).toEqual({ blockedReason: null, enabled: false })
  })

  it('takes a reason of three characters or more', () => {
    expect(posHardwareReturnReasonReady('  ab ')).toBe(false)
    expect(posHardwareReturnReasonReady('abc')).toBe(true)
  })
})
