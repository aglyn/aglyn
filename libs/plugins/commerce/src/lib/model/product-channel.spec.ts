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

import { productCopyPatch } from './commerce'
import { draftProductChannelFacts, normalizeGtin, normalizeProductChannelFacts } from './product-channel'

/**
 * What shopping channels ask of a product (AGL-3637), stored strictly and
 * staged as typed.
 */
describe('normalizeProductChannelFacts', () => {
  it('keeps what a channel can use and drops the rest', () => {
    expect(
      normalizeProductChannelFacts({
        brand: '  Candle   Co ',
        gtin: '0360-0029 1452',
        mpn: ' BW-1 ',
        condition: 'USED',
        googleProductCategory: ' 2271 ',
      }),
    ).toEqual({ brand: 'Candle Co', gtin: '036000291452', mpn: 'BW-1', condition: 'used', googleProductCategory: '2271' })
    expect(normalizeProductChannelFacts({ gtin: '123', condition: 'mint' })).toBeUndefined()
    expect(normalizeProductChannelFacts(null)).toBeUndefined()
    expect(normalizeGtin('12-34 5x67890123456')).toBe('12345678901234')
  })
})

describe('draftProductChannelFacts', () => {
  it('keeps a field as it is being typed', () => {
    expect(draftProductChannelFacts({ brand: 'Candle ', gtin: '036', mpn: 'BW-', condition: '' })).toEqual({
      brand: 'Candle ',
      gtin: '036',
      mpn: 'BW-',
    })
  })
})

describe('productCopyPatch', () => {
  const product = { options: [], variants: [], seo: {}, shipping: undefined, channel: { brand: 'Old' } } as never

  it('stages channel facts merged over the product’s, keystroke-safe', () => {
    expect(productCopyPatch(product, { channel: { gtin: '0' } })).toEqual({ channel: { brand: 'Old', gtin: '0' } })
    expect(productCopyPatch(product, { channel: { brand: '' } })).toEqual({ channel: {} })
  })
})
