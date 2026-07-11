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

import type { HostProduct } from './commerce'
import { parseProductsCsv, productsToCsv } from './commerce-io'

const SHOPIFY_SAMPLE = `Handle,Title,Body (HTML),Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Barcode,Variant Price,Variant Compare At Price,Variant Inventory Qty,Variant Grams,Image Src
brake-pads,Front Brake Pads,"Sintered, fits 04-09",physical,"brakes, wear-items",TRUE,Compound,Sintered,,,,,BP-S,123,39.99,49.99,12,220,https://cdn.example.com/pads.jpg
brake-pads,,,,,,,Organic,,,,,BP-O,,34.99,,5,210,
brake-pads,,,,,,,,,,,,,,,,,,https://cdn.example.com/pads-2.jpg
sticker,Sticker Pack,,physical,,FALSE,,,,,,,,,5,,,"",`

describe('parseProductsCsv', () => {
  it('groups variant rows by handle and builds options', () => {
    const { products, errors } = parseProductsCsv(SHOPIFY_SAMPLE)
    expect(errors).toEqual([])
    expect(products).toHaveLength(2)
    const pads = products.find((product) => product.slug === 'brake-pads')!
    expect(pads.variants).toHaveLength(2)
    expect(pads.options).toEqual([
      { name: 'Compound', values: ['Sintered', 'Organic'] },
    ])
    expect(pads.variants[0]).toMatchObject({
      sku: 'BP-S',
      priceUsd: 39.99,
      compareAtPriceUsd: 49.99,
      inventory: 12,
      weightGrams: 220,
      options: { Compound: 'Sintered' },
    })
    expect(pads.tags).toEqual(['brakes', 'wear-items'])
    expect(pads.mediaUrls).toEqual([
      'https://cdn.example.com/pads.jpg',
      'https://cdn.example.com/pads-2.jpg',
    ])
    const sticker = products.find((product) => product.slug === 'sticker')!
    expect(sticker.status).toBe('draft')
    expect(sticker.variants[0].inventory).toBeNull()
  })

  it('reports row-anchored errors without dropping valid products', () => {
    const csv =
      'Handle,Title,Variant Price\n' +
      'good,Good,10\n' +
      'bad,Bad,notaprice\n' +
      ',Orphan,5\n'
    const { products, errors } = parseProductsCsv(csv)
    expect(products.map((product) => product.slug)).toEqual(['good'])
    expect(errors.join(' ')).toMatch(/invalid Variant Price/)
    expect(errors.join(' ')).toMatch(/missing Handle/)
  })

  it('rejects files without the required columns', () => {
    expect(parseProductsCsv('A,B\n1,2').errors[0]).toMatch(/Handle, Title/)
  })
})

describe('productsToCsv round-trip', () => {
  it('re-imports its own export', () => {
    const product: HostProduct = {
      name: 'Levers, "Adjustable"',
      slug: 'levers',
      type: 'physical',
      status: 'active',
      tags: ['controls'],
      options: [{ name: 'Color', values: ['Black', 'Gold'] }],
      mediaUrls: ['https://cdn.example.com/levers.jpg'],
      variants: [
        {
          id: 'a',
          options: { Color: 'Black' },
          priceUsd: 59,
          inventory: 3,
          sku: 'LV-B',
        },
        {
          id: 'b',
          options: { Color: 'Gold' },
          priceUsd: 69,
          inventory: null,
        },
      ],
    }
    const csv = productsToCsv([product])
    const { products, errors } = parseProductsCsv(csv)
    expect(errors).toEqual([])
    expect(products).toHaveLength(1)
    expect(products[0].name).toBe('Levers, "Adjustable"')
    expect(products[0].options).toEqual(product.options)
    expect(products[0].variants).toHaveLength(2)
    expect(products[0].variants[1].inventory).toBeNull()
    expect(products[0].mediaUrls).toEqual(product.mediaUrls)
  })
})
