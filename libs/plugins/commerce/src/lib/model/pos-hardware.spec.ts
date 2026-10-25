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
 * The POS hardware shop's model (AGL-4038): the shop stays hidden until every
 * figure it needs is configured, the merchant's price is Stripe's plus the
 * one markup value in integer cents, the basket is priced from config alone,
 * and an order only ever moves forward or is refunded before it ships.
 */

import {
  decodePosHardwareLines,
  encodePosHardwareLines,
  nextPosHardwareStatus,
  parsePosHardwareConfig,
  POS_HARDWARE_DEFAULT_MARKUP_BPS,
  POS_HARDWARE_ENV,
  POS_HARDWARE_ORDER_STATUSES,
  posHardwareOffers,
  posHardwareRefundable,
  posHardwareUnitCents,
  pricePosHardwareCart,
  type PosHardwareConfig,
} from './pos-hardware'

const ENV = {
  [POS_HARDWARE_ENV.enabled]: 'true',
  [POS_HARDWARE_ENV.prices]: JSON.stringify({
    'stripe-reader-s710': 10_000,
    'stripe-reader-m2': 5_900,
    'stripe-reader-s700-dock': 3_333,
  }),
  [POS_HARDWARE_ENV.markupBps]: '2500',
  [POS_HARDWARE_ENV.shipping]: JSON.stringify({ standard: 1_000, express: 2_500 }),
}

describe('parsePosHardwareConfig: hidden until every figure is there', () => {
  it('reads a complete configuration', () => {
    const config = parsePosHardwareConfig(ENV)
    expect(config).toEqual({
      costs: { 'stripe-reader-s710': 10_000, 'stripe-reader-m2': 5_900, 'stripe-reader-s700-dock': 3_333 },
      markupBps: 2500,
      shipping: [
        { method: 'standard', cents: 1_000 },
        { method: 'express', cents: 2_500 },
      ],
      automaticTax: false,
    })
  })

  it.each([
    ['nothing at all', {}],
    ['the shop not switched on', { ...ENV, [POS_HARDWARE_ENV.enabled]: '' }],
    ['the switch set to anything but true', { ...ENV, [POS_HARDWARE_ENV.enabled]: '1' }],
    ['no prices', { ...ENV, [POS_HARDWARE_ENV.prices]: '' }],
    ['prices that are not JSON', { ...ENV, [POS_HARDWARE_ENV.prices]: '{oops' }],
    ['prices as an array', { ...ENV, [POS_HARDWARE_ENV.prices]: '[1,2]' }],
    [
      'only accessories priced',
      { ...ENV, [POS_HARDWARE_ENV.prices]: JSON.stringify({ 'stripe-reader-s700-dock': 3_000 }) },
    ],
    ['a markup that is not a whole number', { ...ENV, [POS_HARDWARE_ENV.markupBps]: '25.5' }],
    ['a negative markup', { ...ENV, [POS_HARDWARE_ENV.markupBps]: '-100' }],
    ['an absurd markup', { ...ENV, [POS_HARDWARE_ENV.markupBps]: '100001' }],
    ['no shipping', { ...ENV, [POS_HARDWARE_ENV.shipping]: '' }],
    ['no known shipping speed', { ...ENV, [POS_HARDWARE_ENV.shipping]: JSON.stringify({ overnight: 900 }) }],
  ])('hides the shop with %s', (_label, env) => {
    expect(parsePosHardwareConfig(env as Record<string, string>)).toBeNull()
  })

  it('applies the default markup when none is set, and 3000 is that default', () => {
    expect(POS_HARDWARE_DEFAULT_MARKUP_BPS).toBe(3000)
    const { [POS_HARDWARE_ENV.markupBps]: _unset, ...withoutMarkup } = ENV
    expect(parsePosHardwareConfig(withoutMarkup)?.markupBps).toBe(POS_HARDWARE_DEFAULT_MARKUP_BPS)
  })

  it('takes an explicit 0 as selling at Stripe’s price', () => {
    expect(parsePosHardwareConfig({ ...ENV, [POS_HARDWARE_ENV.markupBps]: '0' })?.markupBps).toBe(0)
  })

  it('drops a malformed or unknown price and keeps the rest', () => {
    const config = parsePosHardwareConfig({
      ...ENV,
      [POS_HARDWARE_ENV.prices]: JSON.stringify({
        'stripe-reader-s710': 10_000,
        'stripe-reader-m2': 59.5,
        'stripe-reader-s700': '200',
        'stripe-reader-x1': 1_000,
        'bbpos-wisepos-e': 0,
      }),
    })
    expect(config?.costs).toEqual({ 'stripe-reader-s710': 10_000 })
  })

  it('turns automatic tax on only for exactly true', () => {
    expect(parsePosHardwareConfig({ ...ENV, [POS_HARDWARE_ENV.automaticTax]: 'true' })?.automaticTax).toBe(true)
    expect(parsePosHardwareConfig({ ...ENV, [POS_HARDWARE_ENV.automaticTax]: 'yes' })?.automaticTax).toBe(false)
  })
})

describe('posHardwareUnitCents: cost plus the markup, in integer cents', () => {
  it.each([
    [10_000, 3000, 13_000],
    [10_000, 0, 10_000],
    [5_900, 3000, 7_670],
    // 3333 × 0.30 = 999.9 → 1000
    [3_333, 3000, 4_333],
    // 1 × 0.5 = 0.5 → rounds half up to 1
    [1, 5000, 2],
    // 1 × 0.4999 rounds down
    [1, 4999, 1],
    [999, 10_000, 1_998],
  ])('%i cents at %i bps is %i', (cost, bps, expected) => {
    expect(posHardwareUnitCents(cost, bps)).toBe(expected)
    expect(Number.isInteger(posHardwareUnitCents(cost, bps))).toBe(true)
  })

  it('prices nothing for a non-positive or fractional cost', () => {
    expect(posHardwareUnitCents(0, 3000)).toBe(0)
    expect(posHardwareUnitCents(-5, 3000)).toBe(0)
    expect(posHardwareUnitCents(10.5, 3000)).toBe(0)
  })
})

describe('pricePosHardwareCart: the server prices the basket', () => {
  const config = parsePosHardwareConfig(ENV) as PosHardwareConfig

  it('offers only priced items, at the marked-up price', () => {
    expect(posHardwareOffers(config).map((offer) => [offer.sku, offer.unitCents])).toEqual([
      ['stripe-reader-s710', 12_500],
      ['stripe-reader-m2', 7_375],
      ['stripe-reader-s700-dock', 4_166],
    ])
  })

  it('prices a basket from config, folding a repeated item', () => {
    const priced = pricePosHardwareCart(config, [
      { sku: 'stripe-reader-s710', quantity: 1, unitCents: 1 },
      { sku: 'stripe-reader-s710', quantity: 1 },
      { sku: 'stripe-reader-s700-dock', quantity: 2 },
    ])
    expect(priced).toEqual({
      ok: true,
      lines: [
        { sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 2, unitCents: 12_500, lineCents: 25_000 },
        {
          sku: 'stripe-reader-s700-dock',
          name: 'Charging dock for the S700 and S710',
          quantity: 2,
          unitCents: 4_166,
          lineCents: 8_332,
        },
      ],
      subtotalCents: 33_332,
    })
  })

  it.each([
    ['an empty basket', []],
    ['not a list', { sku: 'stripe-reader-s710' }],
    ['an item not on offer', [{ sku: 'bbpos-wisepos-e', quantity: 1 }]],
    ['an unknown item', [{ sku: 'stripe-reader-x1', quantity: 1 }]],
    ['a zero quantity', [{ sku: 'stripe-reader-s710', quantity: 0 }]],
    ['a fractional quantity', [{ sku: 'stripe-reader-s710', quantity: 1.5 }]],
    ['more than ten of one item', [{ sku: 'stripe-reader-s710', quantity: 11 }]],
    [
      'more than twenty items',
      [
        { sku: 'stripe-reader-s710', quantity: 10 },
        { sku: 'stripe-reader-m2', quantity: 10 },
        { sku: 'stripe-reader-s700-dock', quantity: 1 },
      ],
    ],
  ])('refuses %s', (_label, lines) => {
    expect(pricePosHardwareCart(config, lines).ok).toBe(false)
  })
})

describe('the lines a Checkout Session carries', () => {
  it('round-trips through the metadata', () => {
    const config = parsePosHardwareConfig(ENV) as PosHardwareConfig
    const priced = pricePosHardwareCart(config, [
      { sku: 'stripe-reader-s710', quantity: 2 },
      { sku: 'stripe-reader-m2', quantity: 1 },
    ])
    if (!priced.ok) throw new Error('expected a priced basket')
    const encoded = encodePosHardwareLines(priced.lines)
    expect(encoded.length).toBeLessThan(500)
    expect(decodePosHardwareLines(encoded)).toEqual(priced.lines)
  })

  it.each([
    ['nothing', ''],
    ['an unknown item', 'stripe-reader-x1*1*100'],
    ['a zero quantity', 'stripe-reader-s710*0*100'],
    ['a fractional price', 'stripe-reader-s710*1*10.5'],
    ['a missing price', 'stripe-reader-s710*1'],
  ])('refuses %s', (_label, encoded) => {
    expect(decodePosHardwareLines(encoded)).toBeNull()
  })
})

describe('an order moves forward, and is refunded only before it ships', () => {
  it('steps paid → ordered → shipped → delivered → registered', () => {
    expect(nextPosHardwareStatus('paid')).toBe('ordered')
    expect(nextPosHardwareStatus('ordered')).toBe('shipped')
    expect(nextPosHardwareStatus('shipped')).toBe('delivered')
    expect(nextPosHardwareStatus('delivered')).toBe('registered')
    expect(nextPosHardwareStatus('registered')).toBeNull()
    expect(nextPosHardwareStatus('canceled')).toBeNull()
    expect(nextPosHardwareStatus('refunded')).toBeNull()
  })

  it('refunds only a paid or ordered order', () => {
    expect(POS_HARDWARE_ORDER_STATUSES.filter(posHardwareRefundable)).toEqual(['paid', 'ordered'])
  })
})
