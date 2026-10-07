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

import { makeOffer, makeSettings, makeStore } from '../testing/catalog-fixtures'
import { SALES_CHANNELS, salesChannel, type SalesChannelId } from './channels'
import {
  clip,
  currencyExponent,
  FEED_COLUMNS,
  firstLevels,
  formatFeedPrice,
  offerLink,
  resolveOffer,
} from './feed-columns'
import { isValidGtin } from './gtin'

/**
 * One offer as each channel's feed states it (AGL-3637): the values each
 * channel's own specification spells, which offers are left out, and the
 * suggestions diagnostics shows for the rest.
 */

const resolve = (id: SalesChannelId, offer = makeOffer(), store = makeStore(), settings = makeSettings()) =>
  resolveOffer(offer, { channel: salesChannel(id)!, store, settings })

describe('isValidGtin', () => {
  it.each([
    ['036000291452', true], // UPC-A
    ['4006381333931', true], // EAN-13
    ['96385074', true], // EAN-8
    ['10012345678902', true], // GTIN-14
    ['036000291453', false], // wrong check digit
    ['0000000000000', false], // all zeros
    ['12345', false], // wrong length
    ['03600029145a', false],
    ['', false],
  ])('%s → %s', (value, valid) => {
    expect(isValidGtin(value)).toBe(valid)
  })
})

describe('money and text', () => {
  it('writes amounts in the store currency with its own exponent', () => {
    expect(formatFeedPrice(1800, 'USD')).toBe('18.00 USD')
    expect(formatFeedPrice(1800, 'JPY')).toBe('1800 JPY')
    expect(formatFeedPrice(12345, 'KWD')).toBe('12.345 KWD')
    expect(currencyExponent('NOT-A-CURRENCY')).toBe(2)
  })

  it('never writes a negative amount', () => {
    expect(formatFeedPrice(-5, 'USD')).toBe('0.00 USD')
  })

  it('clips at a word boundary', () => {
    expect(clip('short', 10)).toBe('short')
    expect(clip('a candle that burns for days', 16)).toBe('a candle that…')
  })

  it('cuts a category path to its first levels', () => {
    expect(firstLevels('Home > Decor > Candles > Pillar', 3)).toBe('Home > Decor > Candles')
    expect(firstLevels('2271', 3)).toBe('2271')
  })

  it('links on the store origin, encoding the path', () => {
    expect(offerLink(makeOffer({ path: '/products/café' }), makeStore())).toBe(
      'https://candles.example.com/products/caf%C3%A9',
    )
    expect(offerLink(makeOffer(), makeStore({ origin: null }))).toBeUndefined()
  })
})

describe('resolveOffer', () => {
  it('every channel has a column for each value it is handed', () => {
    for (const channel of SALES_CHANNELS) {
      const { row } = resolve(channel.id, makeOffer({ quantity: 3 }))
      for (const key of Object.keys(row)) {
        if (channel.id === 'snapchat' && key.startsWith('shipping')) continue
        if (row[key] === '' || (Array.isArray(row[key]) && !(row[key] as unknown[]).length)) continue
        expect({ channel: channel.id, columns: FEED_COLUMNS[channel.id] }).toEqual({
          channel: channel.id,
          columns: expect.arrayContaining([key]),
        })
      }
    }
  })

  it('names the id column as each channel does', () => {
    expect(resolve('tiktok').row['sku_id']).toBe('prod-1')
    expect(resolve('tiktok').row['id']).toBeUndefined()
    for (const id of ['google', 'meta', 'pinterest', 'snapchat', 'microsoft'] as const) {
      expect(resolve(id).row['id']).toBe('prod-1')
    }
  })

  it('spells availability in each channel’s words', () => {
    const backorder = makeOffer({ availability: 'backorder', quantity: 0 })
    const out = makeOffer({ availability: 'out_of_stock', quantity: 0 })
    expect(resolve('google').row['availability']).toBe('in_stock')
    expect(resolve('google', out).row['availability']).toBe('out_of_stock')
    expect(resolve('google', backorder).row['availability']).toBe('backorder')
    expect(resolve('meta', backorder).row['availability']).toBe('in stock')
    expect(resolve('meta', out).row['availability']).toBe('out of stock')
    expect(resolve('tiktok', backorder).row['availability']).toBe('available for order')
    expect(resolve('microsoft', backorder).row['availability']).toBe('backorder')
    expect(resolve('pinterest', backorder).row['availability']).toBe('in stock')
  })

  it('states a sale as the regular price and the sale price', () => {
    const sale = makeOffer({ priceMinor: 2400, salePriceMinor: 1800 })
    expect(resolve('google', sale).row).toMatchObject({ price: '24.00 USD', sale_price: '18.00 USD' })
    // Microsoft's sale price is a bare number.
    expect(resolve('microsoft', sale).row).toMatchObject({ price: '24.00 USD', sale_price: '18.00' })
    expect(resolve('google').row['sale_price']).toBe('')
  })

  it('uses the store currency, never USD by default', () => {
    const store = makeStore({ currency: 'EUR' })
    expect(resolve('meta', makeOffer(), store).row['price']).toBe('18.00 EUR')
  })

  it('falls back to the store defaults, then the store name, for brand and condition', () => {
    expect(resolve('google').row).toMatchObject({ brand: 'Candle Co', condition: 'new' })
    const settings = makeSettings({ defaultBrand: 'Wick & Co', defaultCondition: 'used', defaultGoogleCategory: '2271' })
    expect(resolve('google', makeOffer(), makeStore(), settings).row).toMatchObject({
      brand: 'Wick & Co',
      condition: 'used',
      google_product_category: '2271',
    })
    expect(
      resolve('google', makeOffer({ brand: 'Own', condition: 'refurbished' }), makeStore(), settings).row,
    ).toMatchObject({ brand: 'Own', condition: 'refurbished' })
  })

  it('says identifier_exists no only for a product with no identifiers, per channel', () => {
    expect(resolve('google').row['identifier_exists']).toBe('no')
    expect(resolve('microsoft').row['identifier_exists']).toBe('FALSE')
    expect(resolve('meta').row['identifier_exists']).toBeUndefined()
    const identified = makeOffer({ gtin: '036000291452' })
    expect(resolve('google', identified).row).toMatchObject({ gtin: '036000291452', identifier_exists: '' })
    const partNumber = makeOffer({ mpn: 'BW-1', brand: 'Candle Co' })
    expect(resolve('google', partNumber).row['identifier_exists']).toBe('')
  })

  it('drops a GTIN with a wrong check digit and says so', () => {
    const resolved = resolve('google', makeOffer({ gtin: '036000291453' }))
    expect(resolved.row['gtin']).toBe('')
    expect(resolved.included).toBe(true)
    expect(resolved.issues).toContainEqual(expect.objectContaining({ field: 'gtin', severity: 'warning' }))
    expect(isValidGtin('036000291453')).toBe(false)
  })

  it('groups variants under the product and passes color and size', () => {
    const variant = makeOffer({
      id: 'prod-1_v2',
      hasVariants: true,
      color: 'Red',
      size: 'M',
      options: { Color: 'Red', Size: 'M' },
    })
    expect(resolve('google', variant).row).toMatchObject({ item_group_id: 'prod-1', color: 'Red', size: 'M' })
    expect(resolve('google').row['item_group_id']).toBe('')
  })

  it('sends at most each channel’s number of additional photos', () => {
    const many = makeOffer({ additionalImageUrls: Array.from({ length: 25 }, (_, n) => `https://cdn/x${n}.jpg`) })
    expect(resolve('google', many).row['additional_image_link']).toHaveLength(10)
    expect(resolve('meta', many).row['additional_image_link']).toHaveLength(20)
  })

  it('cuts TikTok’s categories to three levels', () => {
    const offer = makeOffer({ productType: 'Home > Decor > Candles > Pillar', googleProductCategory: 'A > B > C > D' })
    expect(resolve('tiktok', offer).row).toMatchObject({
      product_type: 'Home > Decor > Candles',
      google_product_category: 'A > B > C',
    })
    expect(resolve('google', offer).row['product_type']).toBe('Home > Decor > Candles > Pillar')
    expect(resolve('microsoft', offer).row['product_category']).toBe('A > B > C > D')
  })

  it('tells Meta the stock it may sell when stock is tracked', () => {
    expect(resolve('meta', makeOffer({ quantity: 7 })).row['quantity_to_sell_on_facebook']).toBe('7')
    expect(resolve('meta', makeOffer({ quantity: null })).row['quantity_to_sell_on_facebook']).toBeUndefined()
  })

  it('states the parcel’s weight and size for Google', () => {
    const offer = makeOffer({ dimensionsCm: { length: 20, width: 10, height: 8 } })
    expect(resolve('google', offer).row).toMatchObject({
      shipping_weight: '400 g',
      shipping_length: '20 cm',
      shipping_width: '10 cm',
      shipping_height: '8 cm',
    })
    expect(resolve('meta', offer).row['shipping_length']).toBeUndefined()
  })

  it('leaves out shipping to countries the checkout prices by carrier quote', () => {
    const offer = makeOffer({
      shipping: [
        { country: 'US', service: 'Standard', priceMinor: 495 },
        { country: 'CA', service: 'Standard', priceMinor: 1500 },
      ],
    })
    const store = makeStore({ carrierPricedCountries: ['US'] })
    expect(resolve('google', offer, store).row['shipping']).toEqual([
      { country: 'CA', service: 'Standard', priceMinor: 1500 },
    ])
    const noSize = resolve('google', makeOffer(), store)
    expect(noSize.issues).toContainEqual(expect.objectContaining({ field: 'shipping_length' }))
    const noWeight = resolve('google', makeOffer({ weightGrams: undefined }), store)
    expect(noWeight.issues).toContainEqual(expect.objectContaining({ field: 'shipping_weight' }))
  })

  it('warns when no shipping price reaches a named country', () => {
    const resolved = resolve('google', makeOffer({ shipping: [] }))
    expect(resolved.issues).toContainEqual(expect.objectContaining({ field: 'shipping', severity: 'warning' }))
    expect(resolve('pinterest', makeOffer({ shipping: [] })).issues).toEqual([])
  })

  it.each([
    ['no photo', makeOffer({ imageUrl: undefined }), makeStore(), 'image_link'],
    ['no price', makeOffer({ priceMinor: 0 }), makeStore(), 'price'],
    ['a service', makeOffer({ kind: 'service' }), makeStore(), 'product_type'],
    ['subscription only', makeOffer({ subscriptionOnly: true }), makeStore(), 'price'],
    ['no address', makeOffer(), makeStore({ origin: null }), 'link'],
    ['no product pages', makeOffer(), makeStore({ productPagesServed: false }), 'link'],
  ])('leaves out an offer with %s', (_label, offer, store, field) => {
    for (const channel of SALES_CHANNELS) {
      const resolved = resolve(channel.id, offer, store)
      expect(resolved.included).toBe(false)
      expect(resolved.issues).toContainEqual(expect.objectContaining({ field, severity: 'error' }))
    }
  })

  it('sends the name when there is no description, and shortens a long name', () => {
    const resolved = resolve('google', makeOffer({ description: '', title: 'x'.repeat(200) }))
    expect(resolved.row['description']).toBe('Beeswax Candle')
    expect(String(resolved.row['title']).length).toBeLessThanOrEqual(150)
    expect(resolved.issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(['title', 'description']))
  })

  it('asks clothing for a color and size', () => {
    const shirt = makeOffer({ hasVariants: true, googleProductCategory: '1604', size: 'M' })
    expect(resolve('google', shirt).issues).toContainEqual(expect.objectContaining({ field: 'size' }))
  })
})
