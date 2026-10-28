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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildPosReceipt } from './commerce-pos-ops'
import { receiptDataFromOrder } from './commerce-receipt'
import { inPersonPosHardwareOrder, posHardwareRegisterShare } from './pos-hardware-in-person'
import {
  posHardwareReceiptNotice,
  posHardwareTermsAcceptance,
  posHardwareTermsAcceptanceOf,
  posHardwareTermsAddress,
  POS_HARDWARE_TERMS_SECTIONS,
  POS_HARDWARE_TERMS_VERSION,
  withPosHardwareReceiptNotice,
} from './pos-hardware-terms'

describe('the terms of sale notice on a receipt (AGL-4038, Terms 4.28)', () => {
  it('prints on a register sale of hardware, and on no other sale', () => {
    const notice = posHardwareReceiptNotice({ hardwareSalePending: true })
    expect(notice).toContain(`${posHardwareTermsAddress()}, Sections ${POS_HARDWARE_TERMS_SECTIONS}`)
    expect(notice).toContain('By paying for it you agree to those terms for this purchase.')
    expect(posHardwareTermsAddress()).toMatch(/^[a-z0-9.-]+\/legal\/terms$/)
    expect(posHardwareReceiptNotice({ hardwareOrderId: 'hw_1' })).toBe(notice)
    expect(posHardwareReceiptNotice({})).toBeNull()
    expect(withPosHardwareReceiptNotice('Thanks for coming', {})).toBe('Thanks for coming')
    expect(withPosHardwareReceiptNotice('Thanks for coming', { hardwareSalePending: true })).toBe(`Thanks for coming\n${notice}`)
    expect(withPosHardwareReceiptNotice(null, { hardwareSalePending: true })).toBe(notice)
  })

  it('is on the printed, cloud-printed and on-screen receipt of the sale', () => {
    const order = {
      number: 7,
      createdAtMs: 1,
      hardwareOrderId: 'hw_1',
      lineItems: [{ name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
      totals: { itemsCents: 30_000, totalCents: 30_000 },
    }
    const notice = posHardwareReceiptNotice(order) as string
    expect(receiptDataFromOrder('o1', order as never, { storeName: 'Booth', footer: 'Thanks' }).footer).toBe(`Thanks\n${notice}`)
    expect(buildPosReceipt({ orderId: 'o1', order: order as never, store: { name: 'Booth' } }).footer).toBe(notice)
    expect(buildPosReceipt({ orderId: 'o2', order: { ...order, hardwareOrderId: undefined } as never, store: { name: 'Booth' } }).footer).toBeUndefined()
  })
})

describe('an acceptance of the terms of sale (AGL-4038)', () => {
  it('names the version and sections, and a notice names no one and no device', () => {
    expect(posHardwareTermsAcceptance({ method: 'display', atMs: 5, staffUid: 'u', ip: '1.2.3.4', userAgent: 'x' })).toEqual({
      version: POS_HARDWARE_TERMS_VERSION,
      sections: POS_HARDWARE_TERMS_SECTIONS,
      method: 'display',
      atMs: 5,
      staffUid: 'u',
      ip: '1.2.3.4',
      userAgent: 'x',
    })
    expect(posHardwareTermsAcceptance({ method: 'notice', atMs: 5, staffUid: 'u', ip: '1.2.3.4', userAgent: 'x' })).toMatchObject({
      staffUid: null,
      ip: null,
      userAgent: null,
    })
    expect(posHardwareTermsAcceptanceOf({ method: 'shrug', atMs: 5 })).toBeNull()
    expect(posHardwareTermsAcceptanceOf({ method: 'tablet', atMs: 0 })).toBeNull()
  })

  it('rides onto the hardware order, or the order is recorded under the receipt-and-sign notice', () => {
    const sale = {
      sellerHostId: 'host-seller',
      sellerOrgId: 'org-seller',
      registerOrderId: 'sale-1',
      number: 1,
      registerId: null,
      kiosk: false,
      offline: false,
      share: posHardwareRegisterShare({ lines: [{ sku: 'stripe-reader-s710', quantity: 1, unitAmountCents: 30_000 }], discountCents: 0, taxCents: 0 })!,
      paidAtMs: 1_000,
      tenders: ['cash'],
      paymentLinkSessionId: null,
      receiptEmail: null,
      buyer: null,
      taxRegion: null,
      ratePct: null,
      stripeAccountId: null,
      livemode: false,
    }
    expect(inPersonPosHardwareOrder(sale).termsAcceptance).toEqual(
      posHardwareTermsAcceptance({ method: 'notice', atMs: 1_000 }),
    )
    const accepted = posHardwareTermsAcceptance({ method: 'tablet', atMs: 900, staffUid: 'cashier', ip: null, userAgent: null })
    expect(inPersonPosHardwareOrder({ ...sale, termsAcceptance: accepted }).termsAcceptance).toEqual(accepted)
  })
})

describe('the booth terms of sale name a published Terms version (AGL-4038)', () => {
  // The console holds the published version; read as text, as the erasure
  // coverage specs read their sources, so this library imports no app.
  const published = (() => {
    const source = readFileSync(join(__dirname, '../../../../../../apps/console/constants/legal-documents.ts'), 'utf8')
    return /export const LEGAL_DOCUMENT_VERSION = 'v(\d+)'/.exec(source)?.[1]
  })()
  const rank = (version: string) => Number(/^v(\d+)$/.exec(version)?.[1])

  it('is v20 or later, when hardware’s terms of sale were published, and never ahead of what is published', () => {
    expect(published).toBeDefined()
    expect(rank(POS_HARDWARE_TERMS_VERSION)).toBeGreaterThanOrEqual(20)
    expect(rank(POS_HARDWARE_TERMS_VERSION)).toBeLessThanOrEqual(Number(published))
  })
})
