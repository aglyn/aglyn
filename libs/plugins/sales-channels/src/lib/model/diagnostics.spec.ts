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
import { SALES_CHANNELS } from './channels'
import { diagnoseCatalog, DIAGNOSTICS_MAX_PRODUCTS, storeProblems } from './diagnostics'
import { normalizeSalesChannelSettings } from './settings'

/** What each feed leaves out, and why (AGL-3637). */

describe('diagnoseCatalog', () => {
  it('counts listed, left out and warned offers per channel, from the same rules the feed uses', () => {
    const offers = [
      makeOffer({ gtin: '036000291452' }),
      makeOffer({ id: 'p2', productId: 'p2', productName: 'No Photo', imageUrl: undefined }),
      makeOffer({ id: 'p3', productId: 'p3', productName: 'Bad Barcode', gtin: '036000291453' }),
    ]
    const result = diagnoseCatalog({ store: makeStore(), settings: makeSettings(), offers, partial: false })
    expect(result.offers).toBe(3)
    expect(result.channels.map((channel) => channel.channel)).toEqual(SALES_CHANNELS.map((channel) => channel.id))
    const google = result.channels.find((channel) => channel.channel === 'google')!
    expect(google).toMatchObject({ listed: 2, excluded: 1 })
    // Left-out products first.
    expect(google.products[0]).toMatchObject({ productName: 'No Photo', excludedOffers: 1 })
    expect(google.products.map((product) => product.productName)).toContain('Bad Barcode')
  })

  it('groups a product’s variants and lists each issue once', () => {
    const offers = [1, 2, 3].map((n) =>
      makeOffer({ id: `p_${n}`, productId: 'p', hasVariants: true, imageUrl: n === 3 ? undefined : 'https://cdn/x.jpg' }),
    )
    const meta = diagnoseCatalog({ store: makeStore(), settings: makeSettings(), offers, partial: false }).channels.find(
      (channel) => channel.channel === 'meta',
    )!
    expect(meta.products).toHaveLength(1)
    expect(meta.products[0]).toMatchObject({ offers: 3, excludedOffers: 1 })
    expect(meta.products[0].issues.filter((issue) => issue.field === 'image_link')).toHaveLength(1)
  })

  it('reports a store-wide problem once, not on every product', () => {
    const result = diagnoseCatalog({
      store: makeStore({ productPagesServed: false }),
      settings: makeSettings(),
      offers: [makeOffer(), makeOffer({ id: 'p2', productId: 'p2' })],
      partial: false,
    })
    expect(result.store).toHaveLength(1)
    const google = result.channels.find((channel) => channel.channel === 'google')!
    expect(google.excluded).toBe(2)
    for (const product of google.products) {
      expect(product.issues.some((issue) => issue.field === 'link')).toBe(false)
    }
  })

  it('names carrier-priced countries as a store-wide note without hiding link problems', () => {
    const problems = storeProblems(makeStore({ carrierPricedCountries: ['US', 'CA'] }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('US, CA')
    const result = diagnoseCatalog({
      store: makeStore({ carrierPricedCountries: ['US'] }),
      settings: makeSettings(),
      offers: [makeOffer()],
      partial: true,
    })
    expect(result.partial).toBe(true)
  })

  it('names at most a bounded number of products, keeping exact counts', () => {
    const offers = Array.from({ length: DIAGNOSTICS_MAX_PRODUCTS + 5 }, (_, n) =>
      makeOffer({ id: `p${n}`, productId: `p${n}`, imageUrl: undefined }),
    )
    const google = diagnoseCatalog({ store: makeStore(), settings: makeSettings(), offers, partial: false }).channels[0]
    expect(google.excluded).toBe(DIAGNOSTICS_MAX_PRODUCTS + 5)
    expect(google.products).toHaveLength(DIAGNOSTICS_MAX_PRODUCTS)
    expect(google.truncated).toBe(true)
  })
})

describe('normalizeSalesChannelSettings', () => {
  it('keeps what is valid and defaults the rest', () => {
    expect(normalizeSalesChannelSettings(null)).toEqual({
      defaultBrand: '',
      defaultCondition: 'new',
      defaultGoogleCategory: '',
    })
    expect(
      normalizeSalesChannelSettings({
        defaultBrand: '  Wick   &  Co ',
        defaultCondition: 'USED',
        defaultGoogleCategory: 'x'.repeat(900),
      }),
    ).toEqual({ defaultBrand: 'Wick & Co', defaultCondition: 'used', defaultGoogleCategory: 'x'.repeat(750) })
    expect(normalizeSalesChannelSettings({ defaultCondition: 'mint' }).defaultCondition).toBe('new')
  })
})
