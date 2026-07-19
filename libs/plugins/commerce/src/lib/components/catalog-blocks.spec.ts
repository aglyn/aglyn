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

import { MUI_BUNDLE_ID } from '@aglyn/aglyn'
import { BUNDLE_ID } from '../constants/bundle-common'
import * as Cart from './cart'
import * as ProductDetail from './product-detail'
import * as ProductGrid from './product-grid'
import * as ProductReviews from './product-reviews'
import * as RelatedProducts from './related-products'

type PresetNode = {
  componentId?: string
  pluginId?: string
  props?: Record<string, unknown>
  nodes?: PresetNode[]
}

const walk = (node: PresetNode, visit: (node: PresetNode) => void) => {
  visit(node)
  for (const child of node.nodes ?? []) walk(child, visit)
}

/** Storefront catalog UX blocks (AGL-561). */
describe('commerce catalog blocks', () => {
  it('exposes the catalog control attributes on the product grid', () => {
    const attributeNames = ProductGrid.schema.attributes?.map(
      (attribute) => attribute.name,
    )
    for (const expected of [
      'showSearch',
      'showCategories',
      'showSort',
      'showTypeFilter',
      'pageSize',
    ]) {
      expect(attributeNames).toContain(expected)
    }
  })

  it('ships a Shop catalog preset with every catalog control on', () => {
    const shop = ProductGrid.presets.find(
      (preset) => preset.displayName === 'Shop catalog',
    )
    expect(shop).toBeDefined()
    expect((shop?.data as PresetNode).props).toMatchObject({
      showSearch: true,
      showCategories: true,
      showSort: true,
      pageSize: 12,
    })
  })

  it('keeps preset ids unique per catalog block', () => {
    for (const presets of [ProductGrid.presets, ProductDetail.presets]) {
      const ids = presets.map((preset) => preset.$id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('composes the Product page preset from persisted component ids only', () => {
    const page = ProductDetail.presets.find(
      (preset) => preset.displayName === 'Product page',
    )
    expect(page).toBeDefined()
    const commerceIds = new Set([
      ProductDetail.ID,
      RelatedProducts.ID,
      ProductReviews.ID,
    ])
    const muiIds = new Set(['muiStack', 'muiScreenLink', 'muiTypography'])
    const seen: string[] = []
    walk(page?.data as PresetNode, (node) => {
      expect(node.componentId).toBeDefined()
      seen.push(String(node.componentId))
      if (muiIds.has(String(node.componentId))) {
        expect(node.pluginId).toBe(MUI_BUNDLE_ID)
      } else {
        expect(commerceIds.has(String(node.componentId))).toBe(true)
        expect(node.pluginId).toBe(BUNDLE_ID)
      }
    })
    // The commerce-standard PDP order: breadcrumb, detail, related,
    // reviews (AGL-561).
    expect(seen).toContain(ProductDetail.ID)
    expect(seen).toContain(RelatedProducts.ID)
    expect(seen).toContain(ProductReviews.ID)
    expect(
      seen.indexOf(ProductDetail.ID) < seen.indexOf(RelatedProducts.ID),
    ).toBe(true)
    expect(
      seen.indexOf(RelatedProducts.ID) < seen.indexOf(ProductReviews.ID),
    ).toBe(true)
  })

  it('breadcrumbs through the product name token', () => {
    const page = ProductDetail.presets.find(
      (preset) => preset.displayName === 'Product page',
    )
    let breadcrumb = ''
    walk(page?.data as PresetNode, (node) => {
      const children = String(node.props?.children ?? '')
      if (children.includes('{{product.name}}')) breadcrumb = children
    })
    expect(breadcrumb).toContain('{{product.name}}')
  })

  it('keeps the badge-bearing cart button preset (AGL-561 verifies)', () => {
    const button = Cart.presets.find(
      (preset) => preset.displayName === 'Cart button',
    )
    expect((button?.data as PresetNode).props).toMatchObject({
      variant: 'button',
    })
  })
})
