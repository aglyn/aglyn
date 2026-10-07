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

import { draftProductShippingFacts, normalizeProductShippingFacts, productCopyPatch } from './commerce'

/**
 * A product's shipping facts as the product editor stages them, keystroke by
 * keystroke (AGL-3647): a country of origin is typed one letter at a time.
 */
describe('draftProductShippingFacts', () => {
  const product = { options: [], variants: [], seo: {}, shipping: undefined } as never

  it('keeps the first letter of a country being typed', () => {
    expect(productCopyPatch(product, { shipping: { originCountry: 'u' } })).toEqual({ shipping: { originCountry: 'U' } })
    expect(productCopyPatch(product, { shipping: { originCountry: 'us' } })).toEqual({ shipping: { originCountry: 'US' } })
    expect(draftProductShippingFacts({ originCountry: 'U', lengthCm: 5 })).toEqual({ lengthCm: 5, originCountry: 'U' })
  })

  it('stages nothing for an empty field, and stores only a whole country', () => {
    expect(draftProductShippingFacts({ originCountry: '' })).toBeUndefined()
    expect(normalizeProductShippingFacts({ originCountry: 'U' })).toBeUndefined()
  })
})
