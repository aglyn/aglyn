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

import type { ListFilterField } from '@aglyn/shared-util-tools/list-query/list-filter'
import type { ListFilterOption } from '@aglyn/shared-util-tools/list-query/list-filter-codecs'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQuerySort,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'

/*
 * WHAT THE SITE ARTIFACT LISTS ASK FIRESTORE (AGL-3321).
 *
 * The layouts page, the components card and the templates library put every
 * clause their Filters panel accepts, and the quick-search word, on the query
 * — composed by `planListQuery` — and page what it answers. Nothing is matched
 * over the rows a page happened to read. The template gallery's shelves ask
 * the same keys (`template-gallery-dialog.component.tsx`), and so does the
 * email plugin's templates list, from its own declaration.
 *
 * ## The keys are WRITTEN
 *
 * A query finds a document by a stored value, so each list reads keys every
 * writer stamps (`artifactCreateListKeys`/`artifactRenameListKeys` in
 * `@aglyn/aglyn/app-utils/artifact-list-keys`) and
 * `tools/scripts/backfill-artifacts-list-keys.mjs` stamps on the documents
 * written before them:
 *
 *   nameTokens   the name's word prefixes — the search box and `contains`;
 *   nameLower    the normalized name — `equals`;
 *   kind         a component's `site`/`email`, a template's page/component/
 *                layout, stored even where a reader used to infer it;
 *   source.type  a template's provenance, `authored` where there was none;
 *   libraryRow   a template that is its own library row (below).
 *
 * ## The order is the document NAME, and that is what keeps it cheap
 *
 * `hostArtifactQuery` explains why these lists walk the document id: it is
 * the one order no writer can omit, so the walk is total. It is also the
 * order index merging serves with Firestore's automatic single-field
 * indexes: any mix of the equalities and the one array clause above, ordered
 * by `__name__`, needs no composite at all. The composites below exist only
 * for the one range each list offers — `Updated` — which must lead the order
 * it ranges over, so it pairs with each equality once.
 *
 * ## What is not offered, and why
 *
 *   - `startsWith`/`endsWith` on the name: a prefix range must lead the order,
 *     and these lists are not sorted by name.
 *   - `description` (a filter and a search target before): no token field,
 *     and a second token array could not share the query's one array clause
 *     with the search anyway.
 *   - `Created` ranges: a second range order would double the composites for
 *     a question `Updated` answers nearly as well; one range per list.
 *
 * ## The header sorts (AGL-3680)
 *
 * Every column sorts on the QUERY, by a stored value every writer stamps:
 *
 *   Display name  `nameLower` (above; a starter page's is its starter's
 *                 name, which is the name its library row shows);
 *   ID            the walk itself, either way;
 *   Updated,      `updatedAt` / `createdAt` — stamped by every create, and by
 *   Created       `backfill-artifacts-list-keys.mjs` on a document that
 *                 predates either;
 *   Used in, Kind the stored `kind`; Source the stored `source.type`;
 *   Description   a layout's or component's `description`, stored as `null`
 *                 when it has none (`artifactCreateListKeys` + the backfill),
 *                 because an `orderBy` DROPS a document that lacks the field.
 *                 A template row's description is its starter's when it
 *                 leads one, which is no stored field: it sorts the page.
 *
 * Each is `alone` — served only while no filter or search is on, falling
 * back to the list's default header order with a notice — so on the layouts
 * and components subcollections it costs no composite. Updated newest-first
 * is not `alone`: it is the order
 * the Updated range already imposes, so it pairs with every equality and
 * its composites are the ones the range needed anyway. The templates
 * library's `libraryRow` scope is an equality every order pairs with, so
 * each of its orders has one `(libraryRow, order)` composite.
 */

/** The walk every artifact list keeps: the document name, ascending. */
export const ARTIFACT_LIST_ORDER: ListQuerySort = {
  path: LIST_QUERY_ID_PATH,
  direction: 'asc',
}

/** The name, by word prefix (`contains`) or whole (`equals`). */
const NAME_FIELD: ListFilterField = {
  column: 'displayName',
  kind: 'text',
  path: 'displayName',
  lowerPath: 'nameLower',
  tokensPath: 'nameTokens',
  operators: ['contains', 'equals'],
}

/** The document id, which the walk already orders by. */
const ID_FIELD: ListFilterField = {
  column: '$id',
  kind: 'id',
  path: LIST_QUERY_ID_PATH,
}

/** The one range: `updatedAt`, which every writer stamps. */
const UPDATED_FIELD: ListFilterField = {
  column: 'updatedAt',
  kind: 'date',
  path: 'updatedAt',
  operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
}

/** The quick search every artifact list and gallery shelf offers: the name's word prefixes. */
export const ARTIFACT_NAME_SEARCH = { tokensPath: 'nameTokens' }

/** One header's two orders, `alone` (see "The header sorts"). */
const headerSorts = (column: string, path: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

/**
 * The ID header: the walk ascending — the list's default, served under every
 * filter — and descending, `alone`.
 */
const ID_SORTS: readonly ListQuerySort[] = [
  { path: LIST_QUERY_ID_PATH, direction: 'asc', column: '$id', label: 'ID' },
  { path: LIST_QUERY_ID_PATH, direction: 'desc', column: '$id', label: 'ID', alone: true },
]

/**
 * Updated newest first FIRST: it is the order the Updated range imposes
 * (`planListQuery` takes the first declared order on the range's field), so
 * it is not `alone` — the range's composites already serve it.
 */
const TIME_SORTS: readonly ListQuerySort[] = [
  { path: 'updatedAt', direction: 'desc', column: 'updatedAt', label: 'Updated' },
  { path: 'updatedAt', direction: 'asc', column: 'updatedAt', label: 'Updated', alone: true },
  ...headerSorts('createdAt', 'createdAt', 'Created'),
]

const NAME_SORTS = headerSorts('displayName', 'nameLower', 'Display name')
const DESCRIPTION_SORTS = headerSorts('description', 'description', 'Description')

/** The layouts page's header sorts; the ID ascending one is the default. */
export const LAYOUT_LIST_SORTS: readonly ListQuerySort[] = [
  ...ID_SORTS,
  ...NAME_SORTS,
  ...DESCRIPTION_SORTS,
  ...TIME_SORTS,
]

/** `hosts/{hostId}/layouts`. */
export const LAYOUT_LIST_QUERY: ListQueryDeclaration = {
  fields: [NAME_FIELD, ID_FIELD, UPDATED_FIELD],
  sorts: [ARTIFACT_LIST_ORDER, ...LAYOUT_LIST_SORTS],
  search: ARTIFACT_NAME_SEARCH,
}

export const LAYOUT_LIST_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Display name',
  $id: 'ID',
  updatedAt: 'Updated',
}

/** The components card's header sorts; the ID ascending one is the default. */
export const COMPONENT_LIST_SORTS: readonly ListQuerySort[] = [
  ...ID_SORTS,
  ...NAME_SORTS,
  ...headerSorts('kind', 'kind', 'Used in'),
  ...DESCRIPTION_SORTS,
  ...TIME_SORTS,
]

/** `hosts/{hostId}/components`. */
export const COMPONENT_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    NAME_FIELD,
    { column: 'kind', kind: 'exact', path: 'kind', operators: ['equals', 'isAnyOf'] },
    ID_FIELD,
    UPDATED_FIELD,
  ],
  sorts: [ARTIFACT_LIST_ORDER, ...COMPONENT_LIST_SORTS],
  search: ARTIFACT_NAME_SEARCH,
}

export const COMPONENT_LIST_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Display name',
  kind: 'Used in',
  $id: 'ID',
  updatedAt: 'Updated',
}

/*
 * `hosts/{hostId}/templates`, as the library lists it: one row per template,
 * except that a multi-page STARTER is one row (AGL-696) — its first live page
 * carries `libraryRow: true` and the rest `false`, and a deleted template
 * `false`, so the base clause below is both "one row per starter" and "no
 * tombstones" without a single row being dropped after the read. Every page
 * of a starter carries the starter's name keys, so a search for it finds the
 * row whichever page leads it.
 */
export const TEMPLATE_LIST_BASE: readonly ListQueryFilter[] = [
  { path: 'libraryRow', op: '==', value: true },
]

/**
 * The templates library's header sorts. It shows no ID column, so the walk
 * stays the unlabelled default; Description sorts the page (see "The header
 * sorts").
 */
export const TEMPLATE_LIST_SORTS: readonly ListQuerySort[] = [
  ...NAME_SORTS,
  ...headerSorts('kind', 'kind', 'Kind'),
  ...headerSorts('source', 'source.type', 'Source'),
  ...TIME_SORTS,
]

export const TEMPLATE_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    NAME_FIELD,
    { column: 'kind', kind: 'exact', path: 'kind', operators: ['equals', 'isAnyOf'] },
    {
      column: 'source',
      kind: 'exact',
      path: 'source.type',
      operators: ['equals', 'isAnyOf'],
    },
    UPDATED_FIELD,
  ],
  sorts: [ARTIFACT_LIST_ORDER, ...TEMPLATE_LIST_SORTS],
  search: ARTIFACT_NAME_SEARCH,
}

export const TEMPLATE_LIST_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Display name',
  kind: 'Kind',
  source: 'Source',
  updatedAt: 'Updated',
}

/** The template kinds, by the stored `kind`. */
export const TEMPLATE_KIND_OPTIONS: readonly ListFilterOption[] = [
  { value: 'page', label: 'Page' },
  { value: 'component', label: 'Component' },
  { value: 'layout', label: 'Layout' },
]
