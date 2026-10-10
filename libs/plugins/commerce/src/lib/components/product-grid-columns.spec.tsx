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
 * A storefront grid keeps equal columns on a phone (AGL-3676): a bare `1fr`
 * track is `minmax(auto, 1fr)`, so a long no-wrap product name or an image's
 * intrinsic width stretched one column past its neighbour.
 */

import { render } from '@testing-library/react'
import ProductGrid from './product-grid'
import RelatedProducts from './related-products'

const css = () =>
  [
    ...Array.from(document.querySelectorAll('style')).map((tag) => tag.textContent ?? ''),
    ...Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules).map((rule) => rule.cssText),
    ),
  ].join('\n')

describe('storefront grid columns', () => {
  it('product grid tracks are minmax(0, 1fr), never a bare 1fr', () => {
    render(<ProductGrid />)
    const text = css()
    expect(text).toContain('minmax(0, 1fr)')
    expect(text).not.toMatch(/repeat\(\d, 1fr\)/)
  })

  it('related products photo grid tracks are minmax(0, 1fr)', () => {
    render(<RelatedProducts layout="grid" />)
    expect(css()).not.toMatch(/repeat\(\d, 1fr\)/)
  })
})
