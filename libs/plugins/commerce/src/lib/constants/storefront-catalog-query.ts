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

import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type {
  CollectionRule,
  HostCollection,
  ProductType,
} from '../model/commerce'

/*
 * THE STOREFRONT CATALOG, ON THE QUERY (AGL-3321).
 *
 * The Product grid a visitor browses — its search box, category and tag
 * chips, type chips, In stock chip, price slider and sort select — used to be
 * answered by reading `limit(500)` products in no particular order and
 * narrowing that in memory. A catalog past five hundred products listed an
 * arbitrary five hundred, and a search, a category or a price range answered
 * "no products match" for every product outside them: the one answer a
 * storefront must never give wrongly, to the one person trying to buy the
 * thing.
 *
 * Every predicate is on the Firestore query now, through the list query plan
 * (`planListQuery`), and pages come from the query's own cursor. The catalog
 * is read on the server with the Admin SDK (`server/catalog.ts`), under the
 * scope below, so an anonymous shopper never queries the collection itself.
 *
 * ## What one query can hold, as a shopper meets it
 *
 * One array clause: the search word (`nameTokens`), a category (`categoryIds`)
 * or a tag (`tags`). A grid pinned to a category that a visitor also searches
 * serves the search and says the category is not applied — the plan's rule,
 * shown by the grid rather than papered over by matching the page in memory.
 *
 * One range: the price slider. A range must lead the order, so while the
 * slider is set the grid is ordered by price — high to low when that is the
 * sort chosen, low to high otherwise — and the grid says that Name or Newest
 * waits until the slider is cleared.
 *
 * Search is WORD-PREFIX over the product's name — "cof" finds "Acme Coffee",
 * "offee" does not — which is the honest edge of searching without a search
 * service. Descriptions and tags are not searched: neither has a token array,
 * and a tag is a chip of its own.
 *
 * ## The keys, and who stamps them
 *
 * `nameLower` / `nameTokens` / `priceFromCents` (`productSearchFields`),
 * `soldOut` (`productStockFields`), `status`, `type`, `createdAtMs` and
 * `deletedAt: null` are written by every product writer, and
 * `tools/scripts/backfill-products-list-fields.mjs` stamps them onto the
 * products written before. A product lacking the field a query orders by is
 * not in that order at all.
 */

/** The product types a visitor can filter by, in the grid's own order. */
export const STOREFRONT_PRODUCT_TYPES: readonly ProductType[] = [
  'physical',
  'digital',
  'service',
]

/** The grid's sort values, each the one order it puts the catalog in. */
export const STOREFRONT_CATALOG_SORTS = {
  name: { path: 'nameLower', direction: 'asc' },
  'price-asc': { path: 'priceFromCents', direction: 'asc' },
  'price-desc': { path: 'priceFromCents', direction: 'desc' },
  newest: { path: 'createdAtMs', direction: 'desc' },
} as const satisfies Record<string, ListQuerySort>

export type StorefrontCatalogSort = keyof typeof STOREFRONT_CATALOG_SORTS

/** A grid's `sort` value as its order; anything unknown reads as Name. */
export function storefrontCatalogSort(sort: string | undefined): ListQuerySort {
  return (
    STOREFRONT_CATALOG_SORTS[sort as StorefrontCatalogSort] ??
    STOREFRONT_CATALOG_SORTS.name
  )
}

/**
 * What the storefront catalog can be narrowed by, and how it is ordered.
 *
 * Columns are the catalog's own controls, so a refusal names the control the
 * visitor touched. `category` and `tag` match whole members of their arrays,
 * byte for byte (`verbatimTokens`): a category id is an opaque id and a tag
 * is matched exactly as the merchant typed it, as the grid always matched it.
 * `stock` is the In stock chip, `soldOut == false`.
 *
 * The four sorts are the grid's sort select — every one a visitor or an author
 * can choose — with Name, the author default, first.
 */
export const STOREFRONT_CATALOG_DECLARATION: ListQueryDeclaration = {
  fields: [
    {
      column: 'category',
      kind: 'exact',
      path: 'categoryIds',
      tokensPath: 'categoryIds',
      verbatimTokens: true,
      operators: ['contains'],
    },
    {
      column: 'tag',
      kind: 'exact',
      path: 'tags',
      tokensPath: 'tags',
      verbatimTokens: true,
      operators: ['contains'],
    },
    {
      column: 'type',
      kind: 'exact',
      path: 'type',
      presence: 'always',
      operators: ['equals', 'isAnyOf'],
    },
    {
      column: 'price',
      kind: 'number',
      path: 'priceFromCents',
      presence: 'always',
      operators: ['>=', '<=', '<'],
    },
    { column: 'stock', kind: 'boolean', path: 'soldOut', operators: ['is'] },
  ],
  sorts: [
    STOREFRONT_CATALOG_SORTS.name,
    STOREFRONT_CATALOG_SORTS['price-asc'],
    STOREFRONT_CATALOG_SORTS['price-desc'],
    STOREFRONT_CATALOG_SORTS.newest,
  ],
  search: { tokensPath: 'nameTokens' },
}

/** Each control as a refusal names it to a visitor. */
export const STOREFRONT_CATALOG_HEADERS: Readonly<Record<string, string>> = {
  category: 'Category',
  tag: 'Tag',
  type: 'Type',
  price: 'Price',
  stock: 'Availability',
}

/** Picked values as a refusal names them; categories are added by the grid. */
export const STOREFRONT_CATALOG_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  type: [
    { value: 'physical', label: 'Physical' },
    { value: 'digital', label: 'Digital' },
    { value: 'service', label: 'Service' },
  ],
  stock: [{ value: 'false', label: 'In stock' }],
}

/**
 * The scope every storefront read carries: products a shopper can buy — live
 * (`deletedAt == null`; a delete stamps a timestamp and leaves `status`
 * alone) and active. Both are equalities, merged with every other predicate.
 */
export const STOREFRONT_CATALOG_BASE: readonly ListQueryFilter[] = [
  { path: 'deletedAt', op: '==', value: null },
  { path: 'status', op: '==', value: 'active' },
]

/** {@link STOREFRONT_CATALOG_BASE} as `listQueryIndexes` takes it. */
export const STOREFRONT_CATALOG_BASE_PATHS: readonly { path: string; array?: boolean }[] = [
  { path: 'deletedAt' },
  { path: 'status' },
]

/** The smart-collection rule predicates a query can hold, or why it cannot. */
export type SmartCollectionScope =
  | { filters: ListQueryFilter[] }
  | { unservable: string }

/**
 * A SMART collection's rules as query predicates (AGL-3321), or the reason
 * they cannot be one.
 *
 * Membership is `matchesCollection` in the model. What a query can ask of it:
 *
 *   tag / category  is        → `array-contains` (one array clause per query)
 *   type            is / not  → `==` / `in` the other types
 *   price           under     → `priceFromCents <`, the low end being what
 *                               `under` compares
 *
 * and what it cannot: a tag or category NOT held (no negated array query), a
 * price `over` or `equals` (they compare the HIGH end, which nothing stores),
 * a name rule (substring, which no index answers), and any-of rules (an OR the
 * visitor's own filters would multiply). Those collections are read the way
 * the catalog handler says, never answered from a window as though complete.
 */
export function smartCollectionScope(
  collection: Pick<HostCollection, 'rules' | 'matchAll'>,
): SmartCollectionScope {
  const rules = collection.rules ?? []
  if (!rules.length) return { filters: [] }
  if (collection.matchAll === false && rules.length > 1) {
    return { unservable: 'matches ANY of its rules' }
  }
  const filters: ListQueryFilter[] = []
  let arrays = 0
  for (const rule of rules) {
    const shape = ruleFilter(rule)
    if (typeof shape === 'string') return { unservable: shape }
    if (shape.op === 'array-contains') arrays += 1
    if (arrays > 1) return { unservable: 'names more than one tag or category' }
    filters.push(shape)
  }
  return { filters }
}

function ruleFilter(rule: CollectionRule): ListQueryFilter | string {
  const value = rule.value
  switch (rule.field) {
    case 'tag':
    case 'categoryId':
      if (rule.op !== 'eq') return `excludes a ${rule.field === 'tag' ? 'tag' : 'category'}`
      return {
        path: rule.field === 'tag' ? 'tags' : 'categoryIds',
        op: 'array-contains',
        value: String(value),
      }
    case 'type': {
      if (rule.op === 'eq') return { path: 'type', op: '==', value: String(value) }
      if (rule.op === 'neq') {
        return {
          path: 'type',
          op: 'in',
          value: STOREFRONT_PRODUCT_TYPES.filter((type) => type !== value),
        }
      }
      return `compares a type by ${rule.op}`
    }
    case 'priceUsd': {
      const dollars = Number(value)
      if (!Number.isFinite(dollars)) return 'compares a price that is not a number'
      if (rule.op === 'lt') {
        return { path: 'priceFromCents', op: '<', value: Math.round(dollars * 100) }
      }
      return `compares the price by ${rule.op}`
    }
    default:
      return `matches on ${rule.field}`
  }
}
