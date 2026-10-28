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
  isPosHardwareSkuId,
  nextPosHardwareStatus,
  normalizePosHardwareSerial,
  parsePosHardwareConfig,
  parsePosHardwareInPersonConfig,
  posHardwareBuyerAddress,
  posHardwareBuyerErasedPatch,
  posHardwareOrderSource,
  posHardwareSaleBuyer,
  posHardwareSaleSetOptions,
  posHardwareShippingLabel,
  POS_HARDWARE_DEFAULT_MARKUP_BPS,
  POS_HARDWARE_ENV,
  POS_HARDWARE_MAX_PER_LINE,
  POS_HARDWARE_MAX_UNITS,
  POS_HARDWARE_ORDER_STATUSES,
  POS_HARDWARE_SKUS,
  POS_HARDWARE_SALE_RETENTION_YEARS,
  posHardwareOffers,
  posHardwareRefundable,
  posHardwareSaleExpiry,
  posHardwareSaleRecord,
  posHardwareUnitCents,
  pricePosHardwareCart,
  type PosHardwareConfig,
  type PosHardwareOrder,
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

describe('the catalog (AGL-4038)', () => {
  it('holds every reader and accessory the register sells, by Stripe’s own names', () => {
    expect(POS_HARDWARE_SKUS.map((sku) => [sku.id, sku.kind, sku.stripeProductName])).toEqual([
      ['stripe-reader-s710', 'reader', 'Stripe Reader S710'],
      ['stripe-reader-s700', 'reader', 'Stripe Reader S700'],
      ['stripe-reader-t600', 'reader', 'Stripe Reader T600'],
      ['bbpos-wisepos-e', 'reader', 'BBPOS WisePOS E'],
      ['stripe-reader-m2', 'reader', 'Stripe Reader M2'],
      ['stripe-reader-s700-dock', 'accessory', 'Stripe Reader S700/S710 Dock'],
      ['stripe-reader-hub', 'accessory', 'Stripe Reader Hub'],
      ['stripe-reader-s700-case', 'accessory', 'Stripe Reader S700/S710 Case'],
      ['stripe-reader-s700-cable', 'accessory', 'Stripe Reader S700/S710 Cable'],
      ['stripe-reader-charger', 'accessory', 'Stripe Reader Charger'],
      ['stripe-reader-m2-dock', 'accessory', 'Stripe Reader M2 Dock'],
      ['stripe-reader-m2-mount', 'accessory', 'Stripe Reader M2 Mount'],
      ['bbpos-wisepos-e-dock', 'accessory', 'BBPOS WisePOS E Dock'],
      ['bbpos-wisepos-e-power-cable', 'accessory', 'BBPOS WisePOS E 5ft Power Cable'],
    ])
  })

  it('lists readers before accessories, so the card offers readers first', () => {
    const kinds = POS_HARDWARE_SKUS.map((sku) => sku.kind)
    expect(kinds.lastIndexOf('reader')).toBeLessThan(kinds.indexOf('accessory'))
  })

  it('carries no price: every figure comes from the environment', () => {
    for (const sku of POS_HARDWARE_SKUS) {
      expect(Object.keys(sku).sort()).toEqual(
        ['displayName', 'id', 'kind', 'stripeProductName', 'use'].sort(),
      )
    }
  })

  it('offers the WisePOS E like any other reader, with no note about Stripe stopping its sale', () => {
    const config = parsePosHardwareConfig({
      ...ENV,
      [POS_HARDWARE_ENV.prices]: JSON.stringify({ 'bbpos-wisepos-e': 24_900, 'stripe-reader-t600': 32_900 }),
    }) as PosHardwareConfig
    const offers = posHardwareOffers(config)
    expect(offers.map((offer) => offer.sku)).toEqual(['stripe-reader-t600', 'bbpos-wisepos-e'])
    for (const offer of offers) expect(Object.keys(offer).sort()).toEqual(['kind', 'name', 'sku', 'unitCents', 'use'])
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

  it('fits Stripe’s 500-character metadata value with every item at the highest accepted price', () => {
    // The widest basket the cart allows: every item in the catalog, the spare
    // units on one line, each priced at the parser's ceiling with its
    // highest markup, so each unit price has the most digits it can have.
    const prices = Object.fromEntries(POS_HARDWARE_SKUS.map((sku) => [sku.id, 1_000_000]))
    const config = parsePosHardwareConfig({
      ...ENV,
      [POS_HARDWARE_ENV.prices]: JSON.stringify(prices),
      [POS_HARDWARE_ENV.markupBps]: '100000',
    }) as PosHardwareConfig
    const spare = Math.min(POS_HARDWARE_MAX_PER_LINE, POS_HARDWARE_MAX_UNITS - POS_HARDWARE_SKUS.length + 1)
    const priced = pricePosHardwareCart(
      config,
      POS_HARDWARE_SKUS.map((sku, index) => ({ sku: sku.id, quantity: index === 0 ? spare : 1 })),
    )
    if (!priced.ok) throw new Error('expected a priced basket')
    const encoded = encodePosHardwareLines(priced.lines)
    expect(encoded.length).toBeLessThanOrEqual(500)
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

describe('a sale record is kept seven years from the sale, then deleted (AGL-4038 retention)', () => {
  const at = (iso: string) => Date.parse(iso)

  it('expires seven calendar years after the sale was paid, to the instant', () => {
    expect(POS_HARDWARE_SALE_RETENTION_YEARS).toBe(7)
    expect(posHardwareSaleExpiry({ paidAtMs: at('2026-11-03T15:04:05.678Z'), createdAtMs: 1 })?.toISOString()).toBe(
      '2033-11-03T15:04:05.678Z',
    )
  })

  it('is not expired a moment before the seventh anniversary, and is at it', () => {
    const expires = posHardwareSaleExpiry({ paidAtMs: at('2026-12-31T23:59:59.999Z'), createdAtMs: 1 }) as Date
    // The TTL deletes once `expiresAt` is past: inside the period, it is not.
    expect(expires.getTime() > at('2033-12-31T23:59:59.998Z')).toBe(true)
    expect(expires.getTime() <= at('2033-12-31T23:59:59.999Z')).toBe(true)
  })

  it('keeps a 29 February sale a day longer rather than a day shorter', () => {
    expect(posHardwareSaleExpiry({ paidAtMs: at('2028-02-29T12:00:00.000Z'), createdAtMs: 1 })?.toISOString()).toBe(
      '2035-03-01T12:00:00.000Z',
    )
  })

  it('falls back to when the order was made, and keeps a record with no date at all', () => {
    expect(posHardwareSaleExpiry({ paidAtMs: undefined as never, createdAtMs: at('2026-10-27T00:00:00Z') })?.toISOString()).toBe(
      '2033-10-27T00:00:00.000Z',
    )
    // Never reaped at the epoch: no date, no expiry, and the TTL leaves it.
    expect(posHardwareSaleExpiry({ paidAtMs: undefined as never, createdAtMs: 0 })).toBeNull()
  })

  it('is stamped on the record every write makes, from the order', () => {
    const order = {
      orgId: 'org-1',
      lines: [],
      subtotalCents: 0,
      shipping: { method: 'standard', cents: 0, address: null },
      taxCents: 0,
      totalCents: 0,
      status: 'refunded',
      createdAtMs: at('2026-11-03T00:00:00Z'),
      paidAtMs: at('2026-11-03T00:00:01Z'),
      refundedAtMs: at('2027-01-05T00:00:00Z'),
    } as unknown as PosHardwareOrder
    // The sale, not the refund, starts the clock.
    expect(posHardwareSaleRecord('hw_1', order).expiresAt?.toISOString()).toBe('2033-11-03T00:00:01.000Z')
  })
})

describe('the in-person sale is off until it is turned on and its store is named (AGL-4038)', () => {
  const on = {
    [POS_HARDWARE_ENV.inPersonEnabled]: 'true',
    [POS_HARDWARE_ENV.sellerHostId]: 'host-seller',
    [POS_HARDWARE_ENV.sellerOrgId]: 'org-seller',
  }

  it('names the store and its workspace, and needs nothing of the online shop', () => {
    expect(parsePosHardwareInPersonConfig(on)).toEqual({ sellerHostId: 'host-seller', sellerOrgId: 'org-seller' })
    expect(parsePosHardwareInPersonConfig({ ...on, [POS_HARDWARE_ENV.inPersonEnabled]: ' TRUE ' })).not.toBeNull()
  })

  it('is off when not turned on, or when the store or its workspace is missing or not an id', () => {
    expect(parsePosHardwareInPersonConfig({})).toBeNull()
    expect(parsePosHardwareInPersonConfig({ ...on, [POS_HARDWARE_ENV.inPersonEnabled]: 'yes' })).toBeNull()
    expect(parsePosHardwareInPersonConfig({ ...on, [POS_HARDWARE_ENV.sellerHostId]: '' })).toBeNull()
    expect(parsePosHardwareInPersonConfig({ ...on, [POS_HARDWARE_ENV.sellerOrgId]: undefined })).toBeNull()
    expect(parsePosHardwareInPersonConfig({ ...on, [POS_HARDWARE_ENV.sellerHostId]: 'hosts/x' })).toBeNull()
  })
})

describe('in-person orders in the model (AGL-4038)', () => {
  it('reads an order with no source as online, and only `in_person` as in person', () => {
    expect(posHardwareOrderSource({})).toBe('online')
    expect(posHardwareOrderSource(null)).toBe('online')
    expect(posHardwareOrderSource({ source: 'online' })).toBe('online')
    expect(posHardwareOrderSource({ source: 'in_person' })).toBe('in_person')
    expect(posHardwareOrderSource({ source: 'kiosk' })).toBe('online')
  })

  it('names a catalog item by its id, and nothing else', () => {
    expect(isPosHardwareSkuId('stripe-reader-s710')).toBe(true)
    expect(isPosHardwareSkuId('Stripe Reader S710')).toBe(false)
    expect(isPosHardwareSkuId(undefined)).toBe(false)
  })

  it('compares serial numbers in one form', () => {
    expect(normalizePosHardwareSerial(' stre710-123 456 ')).toBe('STRE710-123456')
    expect(normalizePosHardwareSerial(null)).toBe('')
    expect(normalizePosHardwareSerial('x'.repeat(80))).toHaveLength(64)
  })

  it('labels the in-person method, which checkout never offers', () => {
    expect(posHardwareShippingLabel('in_person')).toBe('Handed over in person')
    expect(posHardwareShippingLabel('express')).toBe('Express shipping')
    expect(posHardwareShippingLabel(undefined)).toBe('Standard shipping')
  })

  const inPerson = {
    orgId: 'org-buyer',
    hostId: 'host-buyer',
    createdBy: 'uid-buyer',
    contactEmail: 'pat@example.com',
    lines: [{ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', quantity: 1, unitCents: 30_000, lineCents: 30_000 }],
    subtotalCents: 30_000,
    shipping: { method: 'in_person', label: 'Handed over in person', cents: 0, name: null, phone: null, address: null },
    taxCents: 2_475,
    totalCents: 32_475,
    currency: 'usd',
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeHardwareOrderId: null,
    tracking: null,
    status: 'delivered',
    livemode: true,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    paidAtMs: 1_000,
    deliveredAtMs: 1_000,
    source: 'in_person',
    posSale: {
      hostId: 'host-seller',
      orgId: 'org-seller',
      orderId: 'order-1',
      number: 12,
      registerId: 'register-1',
      kiosk: false,
      offline: false,
      paymentLinkSessionId: 'cs_link',
    },
    paidTo: {
      account: 'seller_store',
      hostId: 'host-seller',
      orgId: 'org-seller',
      tenders: ['cash'],
      stripeAccountId: 'acct_seller',
    },
    attachment: {
      state: 'attached',
      email: 'pat@example.com',
      uid: 'uid-buyer',
      orgId: 'org-buyer',
      hostId: 'host-buyer',
      attachedBy: 'uid-staff',
      attachedAtMs: 1_000,
    },
  } as unknown as PosHardwareOrder

  it("keeps where the sale was rung and where its money went on the retained record, and no buyer", () => {
    const record = posHardwareSaleRecord('hw_1', inPerson)
    expect(record).toMatchObject({
      source: 'in_person',
      posHostId: 'host-seller',
      posOrderId: 'order-1',
      shippingMethod: 'in_person',
      storefrontTaxRowId: 'cs_link',
      stripeCheckoutSessionId: null,
      paidTo: { account: 'seller_store', hostId: 'host-seller', orgId: 'org-seller', tenders: ['cash'], stripeAccountId: 'acct_seller' },
    })
    // The workspace that bought it, by id, as every sale record keeps it;
    // never the person, their store or who attached it.
    expect(record.orgId).toBe('org-buyer')
    const wire = JSON.stringify(record)
    for (const buyer of ['pat@example.com', 'uid-buyer', 'host-buyer', 'uid-staff']) {
      expect(wire).not.toContain(buyer)
    }
  })

  it('records an online order as paid to the platform, with no register sale', () => {
    const online = { ...inPerson, source: undefined, posSale: undefined, paidTo: undefined } as PosHardwareOrder
    expect(posHardwareSaleRecord('hw_2', online)).toMatchObject({
      source: 'online',
      posHostId: null,
      posOrderId: null,
      paidTo: { account: 'platform' },
      storefrontTaxRowId: null,
    })
  })

  it('takes the buyer off the attachment when their account is erased, keeping the workspace', () => {
    const patch = posHardwareBuyerErasedPatch(inPerson, 5_000)
    expect(patch['attachment']).toEqual({
      state: 'attached',
      email: null,
      uid: null,
      orgId: 'org-buyer',
      hostId: 'host-buyer',
      attachedBy: 'uid-staff',
      attachedAtMs: 1_000,
    })
    expect(patch['shipping']).toMatchObject({ method: 'in_person', label: 'Handed over in person' })
    // An online order has no attachment to rewrite.
    expect(posHardwareBuyerErasedPatch({ shipping: inPerson.shipping }, 5_000)).not.toHaveProperty('attachment')
  })
})

describe('the buyer the sale record keeps for the reseller’s records (AGL-4038)', () => {
  const address = { line1: '12 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' }
  const recorded = { line1: '12 Main St', line2: null, city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' }
  const online = {
    orgId: 'org-1',
    status: 'paid',
    lines: [],
    shipping: { method: 'standard', label: 'Standard', cents: 1_000, name: 'Jordan Lee', phone: '5555550100', address },
    contactEmail: 'buyer@example.com',
    createdAtMs: 1_000,
    paidAtMs: 1_000,
  } as unknown as PosHardwareOrder
  const inPerson = {
    ...online,
    source: 'in_person',
    shipping: { method: 'in_person', label: 'Handed over in person', cents: 0, name: null, phone: null, address: null, taxRegion: { country: 'US', state: 'TX', postalCode: null } },
    attachment: { state: 'attached', email: 'pat@example.com', uid: 'u', orgId: 'org-1', hostId: 'h', attachedBy: 's', attachedAtMs: 1, name: 'Pat Lee', address },
  } as unknown as PosHardwareOrder

  it('is the shipping name and address of an online order, and nothing else of the buyer', () => {
    const record = posHardwareSaleRecord('hw_1', online)
    expect(record.buyer).toEqual({ name: 'Jordan Lee', address: recorded })
    expect(JSON.stringify(record)).not.toMatch(/buyer@example|5555550100/)
  })

  it('is the attachment’s name and address of an in-person order, never its tax region', () => {
    const record = posHardwareSaleRecord('hw_2', inPerson)
    expect(record.buyer).toEqual({ name: 'Pat Lee', address: recorded })
    // Sold at the counter: still taxed where the selling store is.
    expect(record.shipTo).toEqual({ country: 'US', state: 'TX', postalCode: null })
    expect(JSON.stringify(record)).not.toContain('pat@example.com')
  })

  it('is null for a sale that names no one yet, so a detached buyer comes off the record', () => {
    const pending = { ...inPerson, attachment: { state: 'pending', email: null, uid: null, orgId: null, hostId: null, attachedBy: null, attachedAtMs: null } } as unknown as PosHardwareOrder
    expect(posHardwareSaleBuyer(pending)).toBeNull()
    expect(posHardwareSaleRecord('hw_3', pending).buyer).toBeNull()
    expect(posHardwareSaleSetOptions(pending).mergeFields).toContain('buyer')
  })

  it('is left out of the write once the buyer was erased, so the stored name and address stay', () => {
    for (const order of [online, inPerson]) {
      const erased = { ...order, ...posHardwareBuyerErasedPatch(order, 9_000) } as PosHardwareOrder
      expect(posHardwareSaleBuyer(erased)).toBeUndefined()
      const record = posHardwareSaleRecord('hw_4', erased)
      expect(record).not.toHaveProperty('buyer')
      const { mergeFields } = posHardwareSaleSetOptions(erased)
      // Every other field is still written whole, the tax region and the TTL included.
      expect(mergeFields).not.toContain('buyer')
      expect(mergeFields).toEqual(expect.arrayContaining(['shipTo', 'status', 'paidTo', 'expiresAt', 'lines']))
      expect(mergeFields.sort()).toEqual(Object.keys(record).sort())
    }
  })

  it('takes only a whole business address, trimmed and cut to length', () => {
    expect(posHardwareBuyerAddress({ ...address, line2: '  ', country: 'us' })).toEqual({ ...address, country: 'US' })
    expect(posHardwareBuyerAddress({ ...address, line1: '' })).toBeNull()
    expect(posHardwareBuyerAddress({ ...address, country: 'USA' })).toBeNull()
    expect(posHardwareBuyerAddress('12 Main St')).toBeNull()
    expect(posHardwareBuyerAddress({ ...address, line1: 'x'.repeat(500) })?.line1).toHaveLength(200)
  })
})
