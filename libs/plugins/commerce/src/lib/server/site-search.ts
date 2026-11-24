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

import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import type {
  PluginSiteSearchItem,
  PluginSiteSearchSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-search'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import * as CommerceModel from '../model'
import { productCard } from './product-card'
import { plainDescription } from './product-catalog'

/**
 * THE STORE'S PRODUCTS IN THE SITE'S OWN SEARCH: core's `core.site-search`
 * contract, answered from this plugin's products.
 *
 * What a visitor may find is what the storefront lists: live, active and
 * sold online (`productListedOnline`), and never a guided start's sample.
 * The search page matches the typed words; this only hands it candidates.
 *
 * Two bounded reads, merged:
 *
 *  - the storefront's own scope (`deletedAt == null`, `status == 'active'`),
 *    capped at {@link SCAN_LIMIT} products, which the search page's fuzzy
 *    matcher forgives a typo over;
 *  - the products whose name has a word starting with the query's first word
 *    (`nameTokens`, the storefront grid's search key), so a catalog larger
 *    than the scan still finds a product by its name.
 *
 * Category names are read only when a candidate names a category.
 */

/** Products the scope read reaches; a store's whole catalog, for most. */
export const SCAN_LIMIT = 250
/** Products the name-token read reaches beyond the scan. */
export const TOKEN_LIMIT = 50
/** Categories read for their names. */
const CATEGORY_LIMIT = 200

const SNIPPET_LENGTH = 160

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const isDocumentId = (value: string) =>
  Boolean(value) &&
  value.length <= 200 &&
  !value.includes('/') &&
  !/^__.*__$/.test(value)

/** One listed product as the search page matches and shows it, or `null`. */
export function productSiteSearchItem(
  productId: string,
  data: Record<string, any>,
  categoryNames: ReadonlyMap<string, string> = new Map(),
): PluginSiteSearchItem | null {
  if (!CommerceModel.productListedOnline(data)) return null
  if (CommerceModel.productIsSample(data)) return null
  const card = productCard(productId, data)
  // A product with no slug has no page, so there is nothing to link to.
  if (!card.path) return null
  const product = CommerceModel.liftLegacyProduct(
    data as CommerceModel.HostProduct,
  )
  const [minPrice, maxPrice] = CommerceModel.productPriceRange(product)
  const description = plainDescription(data['description'])
  const words = (values: unknown) =>
    Array.isArray(values) ? values.map(str).filter(Boolean) : []
  const terms = [
    description,
    str(data['slug']),
    ...(product.variants ?? [])
      .map((variant) => str(variant.sku))
      .filter(Boolean),
    ...words(data['tags']),
    ...words(data['categoryIds'])
      .map((id) => categoryNames.get(id) ?? '')
      .filter(Boolean),
  ].filter(Boolean)
  return {
    title: card.title,
    terms,
    url: card.path,
    snippet: description.replace(/\s+/g, ' ').slice(0, SNIPPET_LENGTH),
    ...(card.imageUrl ? { imageUrl: String(card.imageUrl) } : {}),
    caption: CommerceModel.productPriceText(product, minPrice, maxPrice),
  }
}

export const commerceSiteSearch: PluginSiteSearchSource = {
  key: 'products',
  label: 'Products',
  async items({ hostId, query, limit }) {
    if (!isDocumentId(hostId)) return []
    const products = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('products')
    const token = nameSearchToken(query)
    const [scoped, named] = await Promise.all([
      products
        .where('deletedAt', '==', null)
        .where('status', '==', 'active')
        .limit(SCAN_LIMIT)
        .get(),
      token
        ? products
            .where('nameTokens', 'array-contains', token)
            .limit(TOKEN_LIMIT)
            .get()
        : Promise.resolve(null),
    ])
    const byId = new Map<string, Record<string, any>>()
    for (const doc of [...(named?.docs ?? []), ...scoped.docs]) {
      if (!byId.has(doc.id)) byId.set(doc.id, doc.data() as Record<string, any>)
    }
    const wantsCategories = [...byId.values()].some(
      (data) =>
        Array.isArray(data['categoryIds']) && data['categoryIds'].length > 0,
    )
    const categoryNames = new Map<string, string>()
    if (wantsCategories) {
      try {
        const categories = await firebaseAdmin
          .app()
          .firestore()
          .collection('hosts')
          .doc(hostId)
          .collection('productCategories')
          .limit(CATEGORY_LIMIT)
          .get()
        for (const doc of categories.docs) {
          const name = str(doc.get('name')).trim()
          if (name) categoryNames.set(doc.id, name)
        }
      } catch (error) {
        // A category read that fails costs the search its category names,
        // not its products.
        console.error(error)
      }
    }
    const items: PluginSiteSearchItem[] = []
    for (const [id, data] of byId) {
      const item = productSiteSearchItem(id, data, categoryNames)
      if (item) items.push(item)
      if (items.length >= limit) break
    }
    return items
  },
}
