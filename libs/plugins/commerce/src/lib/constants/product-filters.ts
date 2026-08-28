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

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'

/**
 * Products (`hosts/{hostId}/products`).
 *
 * The card's listener is `limit(500)` and stays that way — a 25,000-product
 * catalog does not belong in a table, and the head-count has been a server
 * aggregate since AGL-1716. What that cap must NOT decide is what a search can
 * find, and it did: the search compared the rows already fetched, so a product
 * past the window answered "no products match".
 *
 * ⛔ A SKU is matched WHOLE, not as a substring. It lived inside `variants`, an
 * array of objects, and Firestore cannot look inside one — so the write path
 * flattens them into `skus` and this is an `array-contains`. A SKU is a value
 * somebody copies rather than half-remembers, which is why that trade is the
 * right way round.
 */
export const PRODUCT_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    reversedPath: 'nameReversed',
  },
  {
    // Slugs are lower-case by construction (`commerceSlug`), so the stored
    // value is its own normalized key.
    column: 'slug',
    kind: 'text',
    path: 'slug',
    lowerPath: 'slug',
  },
  {
    column: 'skus',
    kind: 'text',
    path: 'skus',
    tokensPath: 'skus',
    // Ordered by the field the card already sorts on rather than by the array
    // an `array-contains` is matching.
    containsOrderBy: 'name',
    operators: ['contains', 'isNotEmpty'],
  },
  { column: 'status', kind: 'exact', path: 'status' },
  { column: 'type', kind: 'exact', path: 'type' },
  { column: 'priceUsd', kind: 'number', path: 'priceUsd' },
  { column: 'createdAt', kind: 'date', path: 'createdAt' },
  { column: 'updatedAt', kind: 'date', path: 'updatedAt' },
]

/** Headers for product fields that are filterable without being columns. */
export const PRODUCT_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  slug: 'Slug',
  skus: 'SKU',
  type: 'Type',
  priceUsd: 'Price (USD)',
  createdAt: 'Created',
  updatedAt: 'Updated',
}
