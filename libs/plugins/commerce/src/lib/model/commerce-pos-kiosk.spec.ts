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
  POS_KIOSK_IDLE_SECONDS_DEFAULT,
  posKioskEstimateCents,
  posKioskIdleSeconds,
  posKioskTipCents,
  sanitizePosKioskLines,
  type PosKioskProduct,
} from './commerce-pos-kiosk'

/** The kiosk's pure checks (AGL-3623): what the cart may say, and the tip the server will charge. */
describe('sanitizePosKioskLines', () => {
  it('keeps ids, counts and choices and drops anything priced', () => {
    expect(
      sanitizePosKioskLines([
        { productId: 'p1', variantId: 'v1', quantity: 2, unitAmountCents: 1, modifiers: [{ groupId: 'g', optionId: 'o', priceCents: 0 }] },
      ]),
    ).toEqual({ ok: true, lines: [{ productId: 'p1', variantId: 'v1', quantity: 2, modifiers: [{ groupId: 'g', optionId: 'o' }] }] })
  })

  it.each([
    ['an empty cart', []],
    ['not a list', 'p1'],
    ['a fractional count', [{ productId: 'p1', quantity: 1.5 }]],
    ['a zero count', [{ productId: 'p1', quantity: 0 }]],
    ['too many of one', [{ productId: 'p1', quantity: 21 }]],
    ['a path for an id', [{ productId: 'a/b', quantity: 1 }]],
    ['a bad choice id', [{ productId: 'p1', quantity: 1, modifiers: [{ groupId: '', optionId: 'o' }] }]],
    ['too many lines', Array.from({ length: 41 }, () => ({ productId: 'p1', quantity: 1 }))],
  ])('refuses %s', (_label, raw) => {
    expect(sanitizePosKioskLines(raw).ok).toBe(false)
  })
})

describe('posKioskTipCents', () => {
  const base = { baseCents: 1000, enabled: true, percentages: [15, 20] }
  it('recomputes a preset from the base and bounds a custom amount', () => {
    expect(posKioskTipCents('percent', { ...base, percent: 20 })).toBe(200)
    expect(posKioskTipCents('percent', { ...base, percent: 50 })).toBeNull()
    expect(posKioskTipCents('custom', { ...base, cents: 300 })).toBe(300)
    expect(posKioskTipCents('custom', { ...base, cents: 1001 })).toBeNull()
    expect(posKioskTipCents('custom', { ...base, cents: -1 })).toBeNull()
    expect(posKioskTipCents('none', base)).toBe(0)
  })

  it('takes no tip at a store that does not ask for one', () => {
    expect(posKioskTipCents('percent', { ...base, enabled: false, percent: 20 })).toBeNull()
    expect(posKioskTipCents('none', { ...base, enabled: false })).toBe(0)
  })
})

describe('posKioskIdleSeconds', () => {
  it('defaults and bounds the merchant setting', () => {
    expect(posKioskIdleSeconds(undefined)).toBe(POS_KIOSK_IDLE_SECONDS_DEFAULT)
    expect(posKioskIdleSeconds(5)).toBe(30)
    expect(posKioskIdleSeconds(10_000)).toBe(600)
    expect(posKioskIdleSeconds('120')).toBe(120)
  })
})

describe('posKioskEstimateCents', () => {
  it('adds modifiers to the variant price, per unit', () => {
    const product: PosKioskProduct = {
      id: 'p1',
      name: 'Latte',
      categoryIds: [],
      options: [],
      variants: [{ id: 'default', options: {}, priceCents: 400, soldOut: false }],
      modifierGroups: [{ id: 'g', name: 'Milk', min: 0, max: 1, options: [{ id: 'o', name: 'Oat', priceCents: 50 }] }],
    }
    expect(
      posKioskEstimateCents([{ productId: 'p1', quantity: 2, modifiers: [{ groupId: 'g', optionId: 'o' }] }], [product]),
    ).toBe(900)
  })
})
