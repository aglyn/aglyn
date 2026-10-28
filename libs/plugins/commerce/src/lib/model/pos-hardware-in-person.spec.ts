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
  inPersonPosHardwareOrder,
  posHardwareAttachmentOf,
  posHardwareRegisterShare,
  posHardwareUnits,
  type InPersonRegisterSale,
} from './pos-hardware-in-person'
import { posHardwareSaleRecord } from './pos-hardware'

/*
 * A register sale of card readers on the platform's own store becomes a
 * hardware order (AGL-4038): the hardware lines at the prices rung, the
 * sale's discount and tax falling on them in proportion, in integer cents,
 * and a sale of hardware alone taking all of both to the cent.
 */
describe('the hardware share of a register sale', () => {
  it('takes the whole discount and tax when the sale is hardware alone', () => {
    const share = posHardwareRegisterShare({
      lines: [{ sku: 'stripe-reader-s710', quantity: 2, unitAmountCents: 30_000 }],
      discountCents: 1_001,
      taxCents: 4_867,
    })
    expect(share).toEqual({
      lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 2, unitCents: 30_000, lineCents: 60_000 }],
      itemsCents: 60_000,
      discountCents: 1_001,
      taxableCents: 58_999,
      taxCents: 4_867,
      totalCents: 63_866,
    })
  })

  it('shares the discount by the items and the tax by what was taxed, rounded half up', () => {
    // A reader and a T-shirt; 10% off the sale, 8.25% on what is left.
    const share = posHardwareRegisterShare({
      lines: [
        { sku: 'stripe-reader-s710', quantity: 1, unitAmountCents: 30_000 },
        { sku: null, quantity: 1, unitAmountCents: 2_500 },
      ],
      discountCents: 3_250,
      taxCents: 2_413,
    })
    expect(share).toMatchObject({ itemsCents: 30_000, discountCents: 3_000, taxableCents: 27_000, taxCents: 2_227 })
    expect(share?.totalCents).toBe(29_227)
    expect(share?.lines).toHaveLength(1)
  })

  it('is nothing when no line is hardware, and ignores a line with no quantity or price', () => {
    expect(posHardwareRegisterShare({ lines: [{ sku: null, quantity: 1, unitAmountCents: 500 }], discountCents: 0, taxCents: 0 })).toBeNull()
    expect(posHardwareRegisterShare({ lines: [], discountCents: 0, taxCents: 0 })).toBeNull()
    expect(
      posHardwareRegisterShare({ lines: [{ sku: 'stripe-reader-m2', quantity: 0, unitAmountCents: 500 }], discountCents: 0, taxCents: 0 }),
    ).toBeNull()
  })

  it('never takes more discount than the sale had items', () => {
    const share = posHardwareRegisterShare({
      lines: [{ sku: 'stripe-reader-m2', quantity: 1, unitAmountCents: 7_700 }],
      discountCents: 99_999,
      taxCents: 0,
    })
    expect(share).toMatchObject({ discountCents: 7_700, taxableCents: 0, totalCents: 0 })
  })
})

describe('units and the attachment', () => {
  it('makes one unit per reader, none for an accessory, with the serials taken in order', () => {
    const units = posHardwareUnits(
      [
        { sku: 'stripe-reader-s710', name: 'S710', quantity: 2, unitCents: 1, lineCents: 2 },
        { sku: 'stripe-reader-s700-dock', name: 'Dock', quantity: 1, unitCents: 1, lineCents: 1 },
        { sku: 'stripe-reader-m2', name: 'M2', quantity: 1, unitCents: 1, lineCents: 1 },
      ],
      ['STRE-1'],
    )
    expect(units.map((unit) => [unit.sku, unit.serialNumber])).toEqual([
      ['stripe-reader-s710', 'STRE-1'],
      ['stripe-reader-s710', null],
      ['stripe-reader-m2', null],
    ])
  })

  it('attaches only an account with a workspace; anything less is pending', () => {
    const base = { attachedBy: 'cashier-1', attachedAtMs: 5 }
    expect(posHardwareAttachmentOf({ ...base, uid: 'u', orgId: 'o', hostId: 'h', email: 'Pat@Example.com' })).toEqual({
      state: 'attached', email: 'pat@example.com', uid: 'u', orgId: 'o', hostId: 'h', attachedBy: 'cashier-1', attachedAtMs: 5,
      name: null, address: null,
    })
    expect(posHardwareAttachmentOf({ ...base, uid: 'u', orgId: null, hostId: 'h', email: null })).toMatchObject({
      state: 'pending', uid: 'u', orgId: null, hostId: null, attachedAtMs: null,
    })
    expect(posHardwareAttachmentOf({ ...base, uid: null, orgId: null, hostId: null, email: 'new@example.com' })).toMatchObject({
      state: 'pending', email: 'new@example.com', uid: null,
    })
    expect(posHardwareAttachmentOf(undefined)).toMatchObject({ state: 'pending', email: null, uid: null, attachedBy: null })
  })
})

describe('the order a register sale becomes', () => {
  const sale: InPersonRegisterSale = {
    sellerHostId: 'host-seller',
    sellerOrgId: 'org-seller',
    registerOrderId: 'order-1',
    number: 41,
    registerId: 'register-1',
    kiosk: false,
    offline: false,
    share: posHardwareRegisterShare({
      lines: [{ sku: 'stripe-reader-s710', quantity: 1, unitAmountCents: 30_000 }],
      discountCents: 0,
      taxCents: 2_475,
    })!,
    paidAtMs: 1_000,
    tenders: ['cash', 'cash'],
    paymentLinkSessionId: null,
    receiptEmail: 'receipt@example.com',
    buyer: null,
    taxRegion: { country: 'US', state: 'TX', postalCode: null },
    ratePct: 8.25,
    stripeAccountId: 'acct_seller',
    livemode: true,
  }

  it('is handed over, taxed where the store is with its base stated, and paid to the store', () => {
    const order = inPersonPosHardwareOrder(sale)
    expect(order).toMatchObject({
      orgId: 'org-seller',
      hostId: '',
      createdBy: null,
      contactEmail: 'receipt@example.com',
      status: 'delivered',
      paidAtMs: 1_000,
      deliveredAtMs: 1_000,
      subtotalCents: 30_000,
      discountCents: 0,
      taxCents: 2_475,
      totalCents: 32_475,
      stripeCheckoutSessionId: null,
      source: 'in_person',
      shipping: { method: 'in_person', cents: 0, address: null, taxRegion: { country: 'US', state: 'TX', postalCode: null } },
      taxLines: [{ amountCents: 2_475, taxableAmountCents: 30_000, jurisdiction: 'TX', rateState: 'TX', percentage: 8.25 }],
      paidTo: { account: 'seller_store', hostId: 'host-seller', orgId: 'org-seller', tenders: ['cash'], stripeAccountId: 'acct_seller' },
      posSale: { hostId: 'host-seller', orderId: 'order-1', number: 41, kiosk: false, offline: false },
      attachment: { state: 'pending' },
      serialNumbers: [],
    })
    expect(order.units).toHaveLength(1)
    // Its retained record is sourced to the store's state, as the register taxed it.
    expect(posHardwareSaleRecord('hw_x', order)).toMatchObject({
      shipTo: { country: 'US', state: 'TX', postalCode: null },
      source: 'in_person',
      posOrderId: 'order-1',
      totalCents: 32_475,
    })
  })

  it("is the buyer's workspace's once attached, at their store or the workspace", () => {
    const buyer = { uid: 'uid-buyer', orgId: 'org-buyer', hostId: null, email: 'pat@example.com', attachedBy: 'cashier-1', attachedAtMs: 1_000 }
    const order = inPersonPosHardwareOrder({ ...sale, buyer, serials: ['STRE-9'] })
    expect(order).toMatchObject({ orgId: 'org-buyer', hostId: '', createdBy: 'uid-buyer', contactEmail: 'pat@example.com' })
    expect(order.serialNumbers).toEqual(['STRE-9'])
    expect(inPersonPosHardwareOrder({ ...sale, buyer: { ...buyer, hostId: 'host-buyer' } }).hostId).toBe('host-buyer')
  })

  it('states no tax line for an untaxed sale', () => {
    const untaxed = posHardwareRegisterShare({ lines: [{ sku: 'stripe-reader-m2', quantity: 1, unitAmountCents: 7_700 }], discountCents: 0, taxCents: 0 })!
    expect(inPersonPosHardwareOrder({ ...sale, share: untaxed }).taxLines).toEqual([])
  })
})
