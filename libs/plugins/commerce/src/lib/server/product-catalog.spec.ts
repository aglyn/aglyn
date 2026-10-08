/**
 * @jest-environment node
 */
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

import type { ShippingSettings } from '../model'
import {
  carrierPricedCountries,
  offerId,
  offerShipping,
  plainDescription,
  productCatalog,
  productOffers,
  storeOrigin,
} from './product-catalog'

/**
 * THE STORE'S CATALOG AS OTHER PLUGINS READ IT (AGL-3637): what counts as
 * listed, how variants become offers, sale prices, stock, photos,
 * identifiers, shipping per country, and the walk in pages that a feed of
 * any size reads.
 */

const DOCUMENT_ID = Symbol('documentId')

/** Documents by path, and the one query shape the catalog runs. */
const docs = new Map<string, Record<string, unknown>>()

const snapshot = (path: string) => ({
  id: path.split('/').pop() as string,
  exists: docs.has(path),
  data: () => docs.get(path),
  get: (field: string) => docs.get(path)?.[field],
})

function collection(path: string): any {
  const run = (after: string | null, max: number) => {
    const prefix = `${path}/`
    const ids = [...docs.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => key.slice(prefix.length))
      .sort()
      .filter((id) => after === null || id > after)
      .slice(0, max)
    const rows = ids.map((id) => snapshot(`${prefix}${id}`))
    return { docs: rows, size: rows.length }
  }
  const query = (after: string | null, max: number): any => ({
    startAfter: (id: string) => query(id, max),
    limit: (count: number) => query(after, count),
    get: async () => run(after, max),
  })
  return {
    doc: (id: string) => ({
      get: async () => snapshot(`${path}/${id}`),
      collection: (name: string) => collection(`${path}/${id}/${name}`),
    }),
    orderBy: (field: unknown) => {
      if (field !== DOCUMENT_ID) throw new Error('only document id order')
      return query(null, Number.MAX_SAFE_INTEGER)
    },
    limit: (count: number) => query(null, count),
  }
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const firestore = Object.assign(() => undefined, { FieldPath: { documentId: () => DOCUMENT_ID } })
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => ({ collection }) }),
      firestore,
    },
  }
})

jest.mock('@aglyn/aglyn/app-utils/tenant-apex', () => ({ TENANT_APEX: 'aglyn.app' }))

const HOST = 'host-candles'

const SHIPPING: ShippingSettings = {
  zones: [
    { id: 'z-us', name: 'US', countries: ['US'] },
    { id: 'z-ca', name: 'Canada', countries: [' ca '] },
    { id: 'z-world', name: 'World', countries: ['*'] },
  ],
  rates: [
    { id: 'r-us', zoneId: 'z-us', name: 'Standard', kind: 'flat', amountCents: 495 },
    { id: 'r-us-fast', zoneId: 'z-us', name: 'Express', kind: 'flat', amountCents: 1500 },
    { id: 'r-ca', zoneId: 'z-ca', name: 'Canada Post', kind: 'weight_tiers', tiers: [{ upTo: 1000, amountCents: 1200 }] },
    { id: 'r-world', zoneId: 'z-world', name: 'International', kind: 'flat', amountCents: 2500 },
  ],
  localPickup: true,
} as never

const context = {
  origin: 'https://candles.example.com',
  categories: new Map([
    ['c-home', { name: 'Home', parentId: null }],
    ['c-candles', { name: 'Candles', parentId: 'c-home' }],
  ]) as never,
  shipping: SHIPPING,
  countries: ['US', 'CA'],
}

const product = (overrides: Record<string, unknown> = {}) => ({
  name: 'Beeswax Candle',
  slug: 'beeswax-candle',
  description: '<p>Hand <b>poured</b> &amp; slow burning.</p><p>Second line</p>',
  type: 'physical',
  status: 'active',
  mediaUrls: ['https://cdn.example.com/a.jpg', '/media/b.jpg'],
  categoryIds: ['c-candles'],
  options: [],
  variants: [{ id: 'default', options: {}, priceUsd: 18, weightGrams: 400, inventory: 12, barcode: '036000291452' }],
  channel: { brand: ' Candle Co ', mpn: 'BW-1', condition: 'new', googleProductCategory: '2271' },
  shipping: { lengthCm: 20, widthCm: 10, heightCm: 8 },
  ...overrides,
})

beforeEach(() => docs.clear())

describe('productOffers', () => {
  it('offers a single-configuration product under its own id with every channel fact', () => {
    const [offer] = productOffers('prod-1', product(), context)
    expect(offer).toMatchObject({
      id: 'prod-1',
      groupId: 'prod-1',
      hasVariants: false,
      title: 'Beeswax Candle',
      description: 'Hand poured & slow burning.\nSecond line',
      path: '/products/beeswax-candle',
      imageUrl: 'https://cdn.example.com/a.jpg',
      additionalImageUrls: ['https://candles.example.com/media/b.jpg'],
      priceMinor: 1800,
      availability: 'in_stock',
      quantity: 12,
      brand: 'Candle Co',
      gtin: '036000291452',
      mpn: 'BW-1',
      condition: 'new',
      googleProductCategory: '2271',
      productType: 'Home > Candles',
      weightGrams: 400,
      dimensionsCm: { length: 20, width: 10, height: 8 },
    })
    expect(offer.salePriceMinor).toBeUndefined()
  })

  it('offers one row per variant, grouped, with each variant’s own photo, barcode, color and size', () => {
    const offers = productOffers(
      'prod-1',
      product({
        options: [
          { name: 'Color', values: ['Red', 'Blue'] },
          { name: 'Size', values: ['M'] },
        ],
        variants: [
          { id: 'v1', options: { Color: 'Red', Size: 'M' }, priceUsd: 20, inventory: 0, imageUrl: 'https://cdn/red.jpg', barcode: '4006381333931' },
          { id: 'v2', options: { Color: 'Blue', Size: 'M' }, priceUsd: 20, inventory: null },
        ],
      }),
      context,
    )
    expect(offers.map((offer) => offer.id)).toEqual(['prod-1_v1', 'prod-1_v2'])
    expect(offers[0]).toMatchObject({
      groupId: 'prod-1',
      hasVariants: true,
      title: 'Beeswax Candle - Red / M',
      color: 'Red',
      size: 'M',
      imageUrl: 'https://cdn/red.jpg',
      gtin: '4006381333931',
      availability: 'out_of_stock',
      quantity: 0,
    })
    // The product-level barcode is not copied onto a variant.
    expect(offers[1].gtin).toBeUndefined()
    expect(offers[1]).toMatchObject({ availability: 'in_stock', quantity: null })
  })

  it('carries each configuration’s own SKU, which a marketplace matches its listing by (AGL-3638)', () => {
    const offers = productOffers(
      'prod-1',
      product({
        options: [{ name: 'Color', values: ['Red', 'Blue'] }],
        variants: [
          { id: 'v1', options: { Color: 'Red' }, priceUsd: 20, sku: ' CANDLE-RED ' },
          { id: 'v2', options: { Color: 'Blue' }, priceUsd: 20 },
        ],
      }),
      context,
    )
    expect(offers[0].sku).toBe('CANDLE-RED')
    expect(offers[1].sku).toBeUndefined()
  })

  it('states a sale as the compare-at price with its own as the sale price', () => {
    const [offer] = productOffers(
      'prod-1',
      product({ variants: [{ id: 'default', priceUsd: 12.5, compareAtPriceUsd: 20 }] }),
      context,
    )
    expect(offer).toMatchObject({ priceMinor: 2000, salePriceMinor: 1250 })
  })

  it('says backorder when the store takes orders for what it has run out of', () => {
    const [offer] = productOffers(
      'prod-1',
      product({ oversellPolicy: 'backorder', variants: [{ id: 'default', priceUsd: 18, inventory: 0 }] }),
      context,
    )
    expect(offer.availability).toBe('backorder')
  })

  it.each([
    ['a draft', { status: 'draft' }],
    ['an archived product', { status: 'archived' }],
    ['a deleted product', { deletedAt: 123 }],
    ['a product with no slug', { slug: '' }],
    ['a product with no name', { name: '  ' }],
  ])('offers nothing for %s', (_label, overrides) => {
    expect(productOffers('prod-1', product(overrides), context)).toEqual([])
  })

  it('prices shipping per named country from the table checkout uses, cheapest first, never pickup', () => {
    const [offer] = productOffers('prod-1', product(), context)
    expect(offer.shipping).toEqual([
      { country: 'US', service: 'Standard', priceMinor: 495 },
      { country: 'CA', service: 'Canada Post', priceMinor: 1200 },
    ])
  })

  it('ships nothing for a digital product and states no parcel for it', () => {
    const [offer] = productOffers('prod-1', product({ type: 'digital' }), context)
    expect(offer.shipping).toEqual([])
    expect(offer.dimensionsCm).toBeUndefined()
    expect(offer.kind).toBe('digital')
  })

  it('marks a subscription-only product', () => {
    expect(productOffers('prod-1', product({ subscription: { interval: 'month' } }), context)[0].subscriptionOnly).toBe(true)
    expect(
      productOffers('prod-1', product({ subscription: { interval: 'month' }, subscriptionOptional: true }), context)[0]
        .subscriptionOnly,
    ).toBe(false)
  })

  it('lifts a legacy one-price product', () => {
    const [offer] = productOffers('legacy', { name: 'Old', slug: 'old', priceUsd: 9, imageUrl: 'https://cdn/o.jpg' }, context)
    expect(offer).toMatchObject({ id: 'legacy', priceMinor: 900, imageUrl: 'https://cdn/o.jpg' })
  })
})

describe('helpers', () => {
  it('keeps an offer id within 50 characters, the same on every read', () => {
    const long = 'p'.repeat(30)
    const id = offerId(long, 'v'.repeat(30), true)
    expect(id.length).toBeLessThanOrEqual(50)
    expect(offerId(long, 'v'.repeat(30), true)).toBe(id)
    expect(offerId(long, 'w'.repeat(30), true)).not.toBe(id)
  })

  it('reads plain text out of markup', () => {
    expect(plainDescription('<ul><li>One</li><li>Two</li></ul>')).toBe('One\nTwo')
    expect(plainDescription(undefined)).toBe('')
  })

  it('serves on the live custom domain, else the subdomain', () => {
    expect(storeOrigin({ subdomain: 'candles' })).toBe('https://candles.aglyn.app')
    expect(storeOrigin({})).toBeNull()
  })

  it('names the countries priced by carrier quote', () => {
    const carrier = {
      ...SHIPPING,
      rates: [...SHIPPING.rates, { id: 'r-carrier', zoneId: 'z-us', name: 'Carrier', kind: 'carrier' }],
    } as never
    expect(carrierPricedCountries(carrier, ['US', 'CA'])).toEqual(['US'])
    expect(carrierPricedCountries(SHIPPING, ['US', 'CA'])).toEqual([])
    expect(offerShipping(undefined, ['US'], { priceMinor: 100 })).toEqual([])
  })
})

describe('productCatalog', () => {
  const seed = (count: number, overrides: (n: number) => Record<string, unknown> = () => ({})) => {
    docs.set(`hosts/${HOST}`, { displayName: 'Candle Co', subdomain: 'candles' })
    docs.set(`hosts/${HOST}/settings/store`, { currency: 'eur', pdpScreenId: 'screen-pdp', shipping: SHIPPING })
    for (let n = 0; n < count; n += 1) {
      const id = `p${String(n).padStart(4, '0')}`
      docs.set(`hosts/${HOST}/products/${id}`, product({ slug: `candle-${n}`, ...overrides(n) }))
    }
  }

  it('describes the store in its own currency', async () => {
    seed(0)
    expect(await productCatalog.store(HOST)).toEqual({
      hostId: HOST,
      name: 'Candle Co',
      origin: 'https://candles.aglyn.app',
      currency: 'EUR',
      productPagesServed: true,
      carrierPricedCountries: [],
    })
    expect(await productCatalog.store('missing')).toBeNull()
    expect(await productCatalog.store('a/b')).toBeNull()
  })

  it('walks a catalog of any size in pages, past the old 500-product cap, each product once', async () => {
    seed(1203, (n) => (n % 10 === 0 ? { status: 'draft' } : {}))
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: Awaited<ReturnType<typeof productCatalog.page>> = await productCatalog.page({ hostId: HOST, cursor, limit: 500 })
      seen.push(...page.offers.map((offer) => offer.id))
      cursor = page.nextCursor
      pages += 1
    } while (cursor && pages < 10)
    expect(cursor).toBeNull()
    expect(seen).toHaveLength(1203 - 121)
    expect(new Set(seen).size).toBe(seen.length)
    expect(pages).toBe(3)
  })

  it('never splits a product’s variants across pages', async () => {
    seed(3, () => ({
      options: [{ name: 'Size', values: ['S', 'M', 'L'] }],
      variants: ['S', 'M', 'L'].map((size) => ({ id: size, options: { Size: size }, priceUsd: 10 })),
    }))
    const first = await productCatalog.page({ hostId: HOST, limit: 4 })
    expect(first.offers).toHaveLength(6)
    expect(first.nextCursor).toBe('p0001')
    const second = await productCatalog.page({ hostId: HOST, cursor: first.nextCursor, limit: 4 })
    expect(second.offers.map((offer) => offer.productId)).toEqual(['p0002', 'p0002', 'p0002'])
    expect(second.nextCursor).toBeNull()
  })

  it('answers an empty last page for an unknown site or a bad cursor', async () => {
    expect(await productCatalog.page({ hostId: 'missing', limit: 10 })).toEqual({ offers: [], nextCursor: null })
    seed(2)
    const page = await productCatalog.page({ hostId: HOST, cursor: 'a/b', limit: 10 })
    expect(page.offers).toHaveLength(2)
  })
})
