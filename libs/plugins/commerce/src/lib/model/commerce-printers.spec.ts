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
  epsonPrinterState,
  normalizePrinterDeviceId,
  printerColumns,
  printerDisplayState,
  PRINTER_OFFLINE_AFTER_MS,
  starPrinterState,
} from './commerce-printers'
import {
  formatReceiptMoney,
  receiptDataFromOrder,
  receiptTendersFromOrder,
} from './commerce-receipt'

describe('printer identity and status (AGL-3619)', () => {
  it('stores a Star MAC in one spelling whatever the merchant types', () => {
    expect(normalizePrinterDeviceId('star', '00-11-62-AB-CD-EF')).toBe('00:11:62:ab:cd:ef')
    expect(normalizePrinterDeviceId('star', '001162abcdef')).toBe('00:11:62:ab:cd:ef')
    expect(normalizePrinterDeviceId('star', '00:11:62')).toBe('')
  })

  it('takes an Epson ID only in the characters Server Direct Print allows', () => {
    expect(normalizePrinterDeviceId('epson', 'counter-1')).toBe('counter-1')
    expect(normalizePrinterDeviceId('epson', 'has space')).toBe('')
    expect(normalizePrinterDeviceId('epson', 'x'.repeat(31))).toBe('')
  })

  it('reads Star status code families, URL-encoded or not', () => {
    expect(starPrinterState('200%20OK').state).toBe('online')
    expect(starPrinterState('211 Paper low').state).toBe('paper_low')
    expect(starPrinterState('410%20Out%20of%20paper')).toEqual({
      state: 'paper_out',
      detail: '410 Out of paper',
    })
    expect(starPrinterState('420 Cover open').state).toBe('cover_open')
    expect(starPrinterState('520 Timeout').state).toBe('error')
    expect(starPrinterState('1001').state).toBe('error')
    expect(starPrinterState('').state).toBe('unknown')
  })

  it('reads Epson result codes and ASB bits', () => {
    expect(epsonPrinterState({ success: true, code: '', status: 251854870 & ~0x000a0028 }).state).toBe(
      'online',
    )
    expect(epsonPrinterState({ success: false, code: 'EPTR_REC_EMPTY' }).state).toBe('paper_out')
    expect(epsonPrinterState({ success: false, code: 'EPTR_COVER_OPEN' }).state).toBe('cover_open')
    expect(epsonPrinterState({ success: true, status: 0x00020000 }).state).toBe('paper_low')
    expect(epsonPrinterState({ success: false, code: 'EX_TIMEOUT' }).state).toBe('error')
  })

  it('shows a printer that stopped polling as offline', () => {
    const atMs = 1_000_000
    expect(printerDisplayState(undefined, atMs)).toBe('unknown')
    expect(printerDisplayState({ state: 'online', atMs }, atMs + 1000)).toBe('online')
    expect(printerDisplayState({ state: 'online', atMs }, atMs + PRINTER_OFFLINE_AFTER_MS + 1)).toBe(
      'offline',
    )
  })

  it('sets columns by roll width', () => {
    expect(printerColumns(80)).toBe(48)
    expect(printerColumns(58)).toBe(32)
    expect(printerColumns(undefined)).toBe(48)
  })
})

describe('the shared receipt data (AGL-3619)', () => {
  const order: any = {
    number: 1042,
    status: 'paid',
    channel: 'pos',
    createdAtMs: 1_790_000_000_000,
    lineItems: [
      { productId: 'p1', name: 'Latte', variantLabel: 'Oat', quantity: 2, unitAmountCents: 450 },
    ],
    totals: { itemsCents: 900, shippingCents: 0, taxCents: 74, discountCents: 0, totalCents: 974, feeCents: 0 },
    changeCents: 26,
  }

  it('formats money in the store currency', () => {
    expect(formatReceiptMoney(974, 'usd')).toBe('$9.74')
    expect(formatReceiptMoney(974, 'EUR')).toBe('€9.74')
    expect(formatReceiptMoney(974, 'jpy')).toBe('¥974')
  })

  it('reads a legacy cash sale as one cash tender with change', () => {
    expect(receiptTendersFromOrder(order)).toEqual({
      tenders: [{ label: 'Cash', amountCents: 1000 }],
      changeCents: 26,
      tipCents: 0,
    })
  })

  it('reads the payment ledger when the order has one, settled tenders only', () => {
    const split = {
      ...order,
      payments: [
        { id: 'a', method: 'cash', amountCents: 500, cashTenderedCents: 600, changeCents: 100, status: 'succeeded' },
        { id: 'b', method: 'card_present', amountCents: 474, tipCents: 100, cardBrand: 'visa', last4: '4242', status: 'succeeded' },
        { id: 'c', method: 'card_present', amountCents: 474, status: 'failed' },
      ],
    }
    expect(receiptTendersFromOrder(split)).toEqual({
      tenders: [
        { label: 'Cash', amountCents: 600 },
        { label: 'visa **** 4242', amountCents: 574 },
      ],
      changeCents: 100,
      tipCents: 100,
    })
  })

  it('builds the receipt from the stored order with the order number as its barcode', () => {
    const receipt = receiptDataFromOrder('order1', order, { storeName: 'Corner Cafe', registerName: 'Front' })
    expect(receipt).toMatchObject({
      storeName: 'Corner Cafe',
      orderNumber: '1042',
      barcode: '1042',
      currency: 'usd',
      subtotalCents: 900,
      taxCents: 74,
      totalCents: 974,
      changeCents: 26,
      registerName: 'Front',
    })
    expect(receipt.lines).toEqual([
      { name: 'Latte', detail: 'Oat', quantity: 2, unitCents: 450, totalCents: 900 },
    ])
  })
})
