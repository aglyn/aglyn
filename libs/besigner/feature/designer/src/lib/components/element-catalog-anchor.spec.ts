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
 * "Learn more" under an element lands on its category's section of the
 * element catalog, read off the page's own headings (AGL-2486, AGL-3080).
 *
 * The drawer's categories include ones a plugin's elements carry, and the
 * designer names no plugin: the docs page has a section per category, and the
 * link is the category's heading slug.
 */

import { elementCatalogAnchor } from './element-detail.component'

jest.mock('./element-preview.component', () => ({
  __esModule: true,
  default: () => null,
}))

describe('elementCatalogAnchor', () => {
  it.each([
    ['Layout', '#layout'],
    ['Surface', '#surface'],
    ['Navigation', '#navigation'],
    ['Text', '#text'],
    ['Data Display', '#data-display'],
    ['Media', '#media'],
    ['Forms', '#forms'],
    ['Input', '#input'],
    ['Commerce', '#commerce'],
    ['Members', '#members'],
  ])('sends %s to its own section', (category, anchor) => {
    expect(elementCatalogAnchor(category)).toBe(anchor)
  })

  it('lands a category the page has no section for on the page itself', () => {
    expect(elementCatalogAnchor('Your components')).toBeUndefined()
    expect(elementCatalogAnchor('')).toBeUndefined()
    expect(elementCatalogAnchor(undefined)).toBeUndefined()
  })
})
