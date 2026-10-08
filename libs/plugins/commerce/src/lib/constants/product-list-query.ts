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

import type {
  ListFilterField,
  ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * The products hub's catalog table (`hosts/{hostId}/products`): what its
 * Filters panel and quick search may ask, and the ONE Firestore query that
 * answers all of it (AGL-3321).
 *
 * Every clause and the search word go on the query and the pages come from
 * it, so a product on page forty is found exactly as one on page one is. The
 * card matches nothing over the rows it holds.
 *
 * ## The order, and why every product carries its key
 *
 * `nameLower` ascending, the one order the list offers. Ordering by a field
 * drops every document that lacks it, so every writer stamps it through
 * `productSearchFields` — the editor, Duplicate, the CSV importer and the AI
 * drafts, all of which create through `/api/hosts/resources` — and
 * `tools/scripts/backfill-products-list-fields.mjs` stamps it onto the
 * products written before any of them did.
 *
 * ## Soft-deleted products are excluded BY THE QUERY
 *
 * `deletedAt` is `null` on a live product and a timestamp on a deleted one.
 * Firestore cannot ask for a document that LACKS a field, so the list's scope
 * is `deletedAt == null`, and the create route stamps the explicit `null` on
 * every product it makes (the backfill stamps the rest). Dropping deleted
 * rows after the read would leave a page short by however many it dropped.
 *
 * ## What is offered, and what is not
 *
 *   - Name: `contains` (word prefix, over `nameTokens`), `equals` and
 *     `startsWith` (over `nameLower`, the field the list is ordered by, so a
 *     prefix range keeps the order it already has).
 *   - Status and Type: picked, `is` / `is any of`.
 *   - Slug: `is`. Slugs are lower-case by construction, so the stored value
 *     is its own key.
 *   - SKU and Barcode: WHOLE values, `contains` / `is any of`, over the
 *     flattened `skus` / `barcodes` arrays — a code is copied or scanned, not
 *     half-remembered. Stored lower-cased; see `productListRequestClauses`.
 *
 * Not offered, and why: price and the created/updated dates are ranges, and a
 * range must lead the order, so each would add a whole second order's worth
 * of composites for every field above (and `priceUsd` is the first
 * variant's price, which describes a multi-variant product wrongly). A
 * name `endsWith` needs the reversed key as its order for the same reason.
 * Tags are stored as typed, so a whole-member match would be case-sensitive
 * where the reader expects it not to be.
 *
 * ## Every header sorts (AGL-3680)
 *
 * `PRODUCT_LIST_COLUMN_SORTS`: Product either way, Status, Type and Price —
 * each a field every product carries. `status` and `type` every writer sets
 * (and the products backfill stamped on the legacy rows that had none);
 * `priceFromCents` `productSearchFields` derives at every write that carries
 * the variants, which every create and save does, and the products backfill
 * stamped on the rest — it is the storefront's price order too. Every order
 * but the default is `alone`: served with no filter or search on, under the
 * `deletedAt` scope only, so each costs one `(deletedAt, field)` composite per
 * direction rather than one per filterable field. Stock and Variants are
 * read from inside `variants`, which no query can order by, so they sort the
 * page on screen.
 *
 * ## The indexes
 *
 * One `(field, nameLower ASC)` composite per filterable field and for the
 * scope, merged by Firestore for any combination, and the scope's composite
 * per header order:
 * `listQueryIndexes(PRODUCT_LIST_QUERY, PRODUCT_LIST_INDEX_BASE)`, held to
 * `cloud/firebase-firestore.indexes.json` by `product-list-query.spec.ts`.
 */

/** The list's scope: live products only. */
export const PRODUCT_LIST_BASE: readonly ListQueryFilter[] = [
  { path: 'deletedAt', op: '==', value: null },
]

/** The scope, as `listQueryIndexes` enumerates it. */
export const PRODUCT_LIST_INDEX_BASE: readonly { path: string; array?: boolean }[] = [
  { path: 'deletedAt' },
]

export const PRODUCT_LIST_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    operators: ['contains', 'equals', 'startsWith'],
  },
  { column: 'status', kind: 'exact', path: 'status', operators: ['equals', 'isAnyOf'] },
  { column: 'type', kind: 'exact', path: 'type', operators: ['equals', 'isAnyOf'] },
  { column: 'slug', kind: 'text', path: 'slug', lowerPath: 'slug', operators: ['equals'] },
  {
    column: 'skus',
    kind: 'exact',
    path: 'skus',
    tokensPath: 'skus',
    operators: ['contains', 'isAnyOf'],
  },
  {
    column: 'barcodes',
    kind: 'exact',
    path: 'barcodes',
    tokensPath: 'barcodes',
    operators: ['contains', 'isAnyOf'],
  },
]

/**
 * The orders the grid's headers ask for, A to Z FIRST — see "Every header
 * sorts" above.
 */
export const PRODUCT_LIST_COLUMN_SORTS: readonly ListQuerySort[] = [
  { path: 'nameLower', direction: 'asc', column: 'name', label: 'Product' },
  { path: 'nameLower', direction: 'desc', column: 'name', label: 'Product', alone: true },
  { path: 'status', direction: 'asc', column: 'status', label: 'Status', alone: true },
  { path: 'status', direction: 'desc', column: 'status', label: 'Status', alone: true },
  { path: 'type', direction: 'asc', column: 'type', label: 'Type', alone: true },
  { path: 'type', direction: 'desc', column: 'type', label: 'Type', alone: true },
  { path: 'priceFromCents', direction: 'asc', column: 'priceUsd', label: 'Price', alone: true },
  { path: 'priceFromCents', direction: 'desc', column: 'priceUsd', label: 'Price', alone: true },
]

export const PRODUCT_LIST_QUERY: ListQueryDeclaration = {
  fields: PRODUCT_LIST_FIELDS,
  sorts: PRODUCT_LIST_COLUMN_SORTS,
  search: { tokensPath: 'nameTokens' },
}

export const PRODUCT_LIST_HEADERS: Readonly<Record<string, string>> = {
  name: 'Product',
  status: 'Status',
  type: 'Type',
  slug: 'Slug',
  skus: 'SKU',
  barcodes: 'Barcode',
}

export const PRODUCT_LIST_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  status: [
    { value: 'active', label: 'Active' },
    { value: 'draft', label: 'Draft' },
    { value: 'archived', label: 'Archived' },
  ],
  type: [
    { value: 'physical', label: 'Physical' },
    { value: 'digital', label: 'Digital' },
    { value: 'service', label: 'Service' },
  ],
}

/** The fields whose values are picked, which the panel shows as a select. */
export const PRODUCT_LIST_SELECT_FIELDS: readonly string[] = Object.keys(PRODUCT_LIST_OPTIONS)

/** The columns folded to lower case before they reach the query. */
const FOLDED = new Set(['skus', 'barcodes'])

/**
 * The clauses as the query must ask them.
 *
 * `productSearchFields` stores every SKU and barcode trimmed and lower-cased,
 * and an array field is matched by whole member, byte for byte — so a SKU
 * typed `ABC-123` would ask for a member nobody stored. The typed value is
 * folded the way the writer folded it; `is any of` folds each of its values.
 * Every other clause passes through as the panel wrote it.
 */
export function productListRequestClauses<Clause extends ListFilterRequest>(
  clauses: readonly Clause[],
): Clause[] {
  const fold = (value: string) => value.trim().toLowerCase()
  return clauses.map((clause) => {
    if (!FOLDED.has(clause.field)) return clause
    const value =
      clause.op === 'isAnyOf'
        ? clause.value.split(',').map(fold).filter(Boolean).join(',')
        : fold(clause.value)
    return { ...clause, value }
  })
}
