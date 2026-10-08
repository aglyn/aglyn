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
  posOfflineChangeCents,
  posOfflineFlagLabels,
  posOfflineSaleKeyIsValid,
  posOfflineSaleTotals,
  posOfflineSoldAt,
  posOfflineTotalsAddUp,
  POS_OFFLINE_CLOCK_SKEW_MS,
  POS_OFFLINE_DISABLED_TENDERS,
  POS_OFFLINE_FLAG_LABELS,
  POS_OFFLINE_MAX_AGE_MS,
  sanitizePosOfflineSale,
} from './commerce-pos-offline'

/**
 * The offline register's shared rules (AGL-3625): the totals a register rings
 * without the server, and how the server reads what it queued.
 */

const LINES = [
  { productId: 'p1', name: 'Mug', quantity: 2, unitAmountCents: 1200 },
  { productId: 'p2', name: 'Tee', quantity: 1, unitAmountCents: 2500 },
]

describe('posOfflineSaleTotals', () => {
  it('takes the cashier discount, then the in-person tax on what is left', () => {
    expect(posOfflineSaleTotals({ lines: LINES, discountPct: 10, tax: { pct: 8, pricesIncludeTax: false } })).toEqual({
      itemsCents: 4900,
      shippingCents: 0,
      discountCents: 490,
      taxCents: 353,
      feeCents: 0,
      totalCents: 4763,
    })
  })

  it('adds no tax where prices include it, or where the store collects none', () => {
    expect(posOfflineSaleTotals({ lines: LINES, discountPct: 0, tax: { pct: 8, pricesIncludeTax: true } }).totalCents).toBe(4900)
    expect(posOfflineSaleTotals({ lines: LINES, discountPct: 0, tax: { pct: null, pricesIncludeTax: false } }).taxCents).toBe(0)
  })

  it('bounds a discount to the goods and reads nonsense as none', () => {
    expect(posOfflineSaleTotals({ lines: LINES, discountPct: 100, tax: { pct: 8, pricesIncludeTax: false } }).totalCents).toBe(0)
    expect(posOfflineSaleTotals({ lines: LINES, discountPct: Number.NaN, tax: { pct: null, pricesIncludeTax: false } }).discountCents).toBe(0)
  })
})

describe('the sale record', () => {
  it('gives change and never a negative amount', () => {
    expect(posOfflineChangeCents(4763, 5000)).toBe(237)
    expect(posOfflineChangeCents(4763, 4000)).toBe(0)
  })

  it('takes a key the order can be named by, and nothing else', () => {
    expect(posOfflineSaleKeyIsValid('a1b2c3d4e5f6a7b8c9d0')).toBe(true)
    expect(posOfflineSaleKeyIsValid('short')).toBe(false)
    expect(posOfflineSaleKeyIsValid('../../orders/abcdefghijklmnop')).toBe(false)
    expect(posOfflineSaleKeyIsValid('__abcdefghijklmnop__')).toBe(false)
  })

  it('believes the device clock only within bounds', () => {
    const now = 1_800_000_000_000
    expect(posOfflineSoldAt(now - 1000, now)).toEqual({ atMs: now - 1000, adjusted: false })
    expect(posOfflineSoldAt(now + 1000, now)).toEqual({ atMs: now, adjusted: false })
    expect(posOfflineSoldAt(now + POS_OFFLINE_CLOCK_SKEW_MS + 1, now)).toEqual({ atMs: now, adjusted: true })
    expect(posOfflineSoldAt(now - POS_OFFLINE_MAX_AGE_MS - 1, now)).toEqual({ atMs: now, adjusted: true })
    expect(posOfflineSoldAt(Number.NaN, now)).toEqual({ atMs: now, adjusted: true })
  })

  it('reads a queued sale, bounded, and refuses one it cannot', () => {
    const totals = posOfflineSaleTotals({ lines: LINES, discountPct: 0, tax: { pct: null, pricesIncludeTax: false } })
    const read = sanitizePosOfflineSale({
      saleKey: 'a1b2c3d4e5f6a7b8c9d0',
      hostId: 'shop',
      orgId: 'org-1',
      signedInUid: 'u1',
      registerId: 'front',
      soldAtMs: 5,
      lines: [...LINES, { productId: 'p3', name: 'Cap', quantity: 1, unitAmountCents: 500, modifiers: [{ groupId: 'g', optionId: 'o' }, { bad: true }] }],
      discountPct: 0,
      totals,
      cashTenderedCents: 6000,
      customer: { email: ' Dana@Acme.com ', name: 'Dana', kind: 'none', id: 'x', phone: '555' },
    })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.sale.customer).toEqual({ email: 'dana@acme.com', name: 'Dana' })
    expect(read.sale.lines[2].modifiers).toEqual([{ groupId: 'g', optionId: 'o' }])
    expect(read.sale.shiftId).toBeNull()

    for (const bad of [
      null,
      { saleKey: 'a1b2c3d4e5f6a7b8c9d0', hostId: 'shop', signedInUid: 'u1', registerId: 'front', lines: [] },
      { saleKey: 'a1b2c3d4e5f6a7b8c9d0', hostId: 'shop', signedInUid: 'u1', registerId: 'front', lines: [{ productId: 'p', name: 'X', quantity: 0, unitAmountCents: 1 }] },
      { saleKey: 'a1b2c3d4e5f6a7b8c9d0', hostId: 'shop', signedInUid: 'u1', registerId: 'front', lines: LINES, discountPct: 150 },
    ]) {
      expect(sanitizePosOfflineSale(bad).ok).toBe(false)
    }
  })

  it('checks that the register’s totals are the arithmetic of its lines', () => {
    const totals = posOfflineSaleTotals({ lines: LINES, discountPct: 10, tax: { pct: 8, pricesIncludeTax: false } })
    expect(posOfflineTotalsAddUp({ lines: LINES, discountPct: 10, totals })).toBe(true)
    expect(posOfflineTotalsAddUp({ lines: LINES, discountPct: 10, totals: { ...totals, totalCents: 1 } })).toBe(false)
    expect(posOfflineTotalsAddUp({ lines: LINES, discountPct: 0, totals })).toBe(false)
  })
})

describe('what the register says', () => {
  it('labels every flag', () => {
    expect(posOfflineFlagLabels(['stock-short'])).toEqual([POS_OFFLINE_FLAG_LABELS['stock-short']])
  })

  it('turns every card tender and the gift card off offline', () => {
    expect(Object.keys(POS_OFFLINE_DISABLED_TENDERS).sort()).toEqual(
      ['card_keyed', 'card_link', 'card_present', 'folio', 'gift_card'].sort(),
    )
  })
})
