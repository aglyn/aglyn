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

import { ENTRY_PUBLISH_SORT_FIELD } from '@aglyn/aglyn/app-utils/collection-entry-date'
import { ENTRY_TITLE_TOKENS_FIELD } from '@aglyn/aglyn/app-utils/content-query-fields'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type ListQueryDeclaration,
  type ListQueryFilter,
  type ListQueryPlan,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { CollectionSort } from '@aglyn/tenant-feature-instance/hooks/sorted-collection-window'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  collection,
  limit,
  query,
  type CollectionReference,
  type Firestore,
  type Query,
} from 'firebase/firestore'
import { ENTRY_LIST_FILTER_FIELDS } from '../../utils/list-filters'

/**
 * How a collection's entries table is sorted, filtered and searched
 * (AGL-2853, AGL-3321), in one module the provider that queries and the page
 * that renders both read.
 *
 * ## Every clause is on the query
 *
 * The Filters panel's clauses and the quick search's word are planned into
 * ONE Firestore query by `planListQuery` (`ENTRY_LIST_QUERY`); the rows a page
 * shows are a page of that query's matches, and nothing is matched over them
 * afterwards. A clause the plan cannot serve beside the others — a second
 * range, a Title filter beside a search — is refused by name, not applied to
 * the rows that happen to be loaded.
 *
 * ## The sorted walk still drops nothing
 *
 * The plan's predicates are the BASE that `useSortedPagedCollection` orders,
 * which is what lets a sort name a field some entries do not carry: a draft
 * has no `publishSortAt` (see `entryListStoredSort`), a seeded entry may have
 * no `updatedAt`, and `/api/hosts/resources` validates no field for presence,
 * so an entry created through it can lack a `title`. Those entries follow
 * every entry that has the value, in both directions, rather than dropping
 * out of the list — filtered or not.
 *
 * The one exception is a RANGE, which must lead the query's order and which
 * only entries carrying the ranged field can match. There is nothing for the
 * second segment to find, so a ranged view is read with one ordered query.
 *
 * ## Which orders, and what each costs
 *
 * An unfiltered list takes any of the four columns in either direction, served
 * by Firestore's automatic single-field indexes at no composite cost. A
 * FILTERED or searched list needs a composite per `(predicate field, order)`,
 * so it takes only the orders `ENTRY_LIST_QUERY.sorts` declares — the list's
 * default and two more — and the columns offer only those while it is
 * narrowed. Four predicate fields times three orders is twelve composites.
 */

/** The fields the entries table sorts by — its four data columns. */
export const ENTRY_LIST_SORT_FIELDS = [
  'title',
  'status',
  'updatedAt',
  'publishedAt',
] as const

export type EntryListSortField = (typeof ENTRY_LIST_SORT_FIELDS)[number]

/**
 * Published date, newest first: a collection opens on what it most recently
 * put out, which is the question a changelog or a blog is read to answer.
 */
export const ENTRY_LIST_DEFAULT_SORT: CollectionSort = {
  field: 'publishedAt',
  direction: 'desc',
}

/** How each sortable column reads in a sentence about the order. */
const COLUMN_LABELS: Readonly<Record<EntryListSortField, string>> = {
  title: 'Title',
  status: 'Status',
  updatedAt: 'Updated',
  publishedAt: 'Published',
}

/** The directions each column offers on an unfiltered list, first click first. */
const UNFILTERED_SORTING_ORDERS: Readonly<
  Record<EntryListSortField, ReadonlyArray<'asc' | 'desc'>>
> = {
  title: ['asc', 'desc'],
  status: ['asc', 'desc'],
  updatedAt: ['desc', 'asc'],
  publishedAt: ['desc', 'asc'],
}

/**
 * Everything a FILTERED or searched entries list can ask of Firestore
 * (AGL-3321): the clauses (`ENTRY_LIST_FILTER_FIELDS`), the quick search's
 * token array, and the orders those predicates may be combined with.
 *
 * Three orders, each justified by the four composites it costs (one per
 * predicate field — status, category, author, title tokens):
 *
 *   Published, newest first   the list's default; mandatory.
 *   Published, oldest first   the same column reversed — the first posts in
 *                             a category, the earliest of an author's.
 *   Updated, newest first     what was just edited, which is the question an
 *                             editor brings to a filtered list.
 *
 * Title and Status, and Updated oldest first, would cost four more each and
 * are offered on the UNFILTERED list only, where they cost none.
 */
export const ENTRY_LIST_QUERY: ListQueryDeclaration = {
  fields: ENTRY_LIST_FILTER_FIELDS,
  sorts: [
    { path: ENTRY_PUBLISH_SORT_FIELD, direction: 'desc', column: 'publishedAt' },
    { path: ENTRY_PUBLISH_SORT_FIELD, direction: 'asc', column: 'publishedAt' },
    { path: 'updatedAt', direction: 'desc', column: 'updatedAt' },
  ],
  search: { tokensPath: ENTRY_TITLE_TOKENS_FIELD },
}

/** The stored statuses the Status filter offers, in the order it lists them. */
export const ENTRY_STATUS_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'scheduled', label: 'Scheduled' },
]

const isSortField = (field: unknown): field is EntryListSortField =>
  (ENTRY_LIST_SORT_FIELDS as readonly unknown[]).includes(field)

/**
 * The sort a grid's sort model asks for, or the default when it asks for
 * none — the table is always sorted by something, so clearing a column's
 * sort returns it to the order it opened in.
 */
export function entryListSortFromModel(
  model: ReadonlyArray<{ field?: unknown; sort?: unknown }> | undefined,
): CollectionSort {
  const first = model?.[0]
  if (!first || !isSortField(first.field)) return ENTRY_LIST_DEFAULT_SORT
  if (first.sort !== 'asc' && first.sort !== 'desc') {
    return ENTRY_LIST_DEFAULT_SORT
  }
  return { field: first.field, direction: first.sort }
}

/**
 * The stored field a table sort walks (AGL-3323).
 *
 * The Published column is named `publishedAt` in the grid's sort model, but
 * the walk orders on `publishSortAt`: the date the cell shows, stored.
 * Ordering on `publishedAt` itself cannot place a scheduled entry, which has
 * no `publishedAt` until it goes live — it fell into the unkeyed segment and
 * sat on the last page in both directions. On `publishSortAt` it is keyed by
 * its `publishAt`, so newest-first opens on the furthest-future schedule and
 * oldest-first ends on it.
 *
 * A draft carries neither date and so no `publishSortAt`: it follows every
 * dated entry in BOTH directions, which is where the grid itself puts an
 * empty value and where an author looks for what has not gone out.
 */
export function entryListStoredSort(sort: CollectionSort): CollectionSort {
  return sort.field === 'publishedAt'
    ? { field: ENTRY_PUBLISH_SORT_FIELD, direction: sort.direction }
    : sort
}

/** The inverse of {@link entryListStoredSort}: the column a stored order sorts. */
export function entryListColumnSort(sort: CollectionSort): CollectionSort {
  return sort.field === ENTRY_PUBLISH_SORT_FIELD
    ? { field: 'publishedAt', direction: sort.direction }
    : sort
}

/** What the entries table asks for this time. */
export interface EntryListRequest {
  /** The Filters panel's clauses, every one of them. */
  clauses: readonly ListFilterRequest[]
  /** The quick search's words. */
  search: readonly string[]
  /** The column sort the grid asked for, in the grid's own names. */
  sort: CollectionSort
}

/** How the entries table will be read, and what it tells the reader. */
export interface EntryListView {
  /** What the query holds, and what it refused and why. */
  plan: ListQueryPlan
  /** Every predicate on the query — the base the walk orders. */
  filters: ListQueryFilter[]
  /** The STORED order the rows come in (`publishSortAt`, not `publishedAt`). */
  order: CollectionSort
  /** The same order as the grid's sort model names it. */
  columnSort: CollectionSort
  /**
   * A range is on the query. Every entry it can match carries the ranged
   * field, which leads the order, so one ordered query reads the list and the
   * walk's second segment would have nothing to find.
   */
  ranged: boolean
  /** Fields the query pins by `==` — see `sortFieldIsTotal`. */
  equalityFields: string[]
  /**
   * The directions each column may be sorted in NOW, first click first; an
   * empty list is a column that cannot be sorted while the list is narrowed.
   */
  sortingOrders: Record<EntryListSortField, Array<'asc' | 'desc'>>
  /** Said above the table: what the plan says, and an order that moved. */
  notices: string[]
  /** The query's identity, for a dependency list. */
  key: string
}

const RANGE_OPS = new Set(['<', '<=', '>', '>=', '!='])

const sameSort = (a: CollectionSort, b: CollectionSort) =>
  a.field === b.field && a.direction === b.direction

/** The orders `ENTRY_LIST_QUERY` declares, as stored sorts. */
const DECLARED: CollectionSort[] = ENTRY_LIST_QUERY.sorts.map((sort) => ({
  field: sort.path,
  direction: sort.direction,
}))

const describeOrder = (sort: CollectionSort): string => {
  const column = entryListColumnSort(sort)
  const label = isSortField(column.field) ? COLUMN_LABELS[column.field] : column.field
  const newest = column.field === 'updatedAt' || column.field === 'publishedAt'
  const way = newest
    ? column.direction === 'desc'
      ? 'newest first'
      : 'oldest first'
    : column.direction === 'asc'
      ? 'A to Z'
      : 'Z to A'
  return `${label}, ${way}`
}

/**
 * The entries table's query for one request (AGL-3321): the plan's
 * predicates, the order they are read in, and what the reader is told.
 *
 * Unfiltered, the order is whichever column the grid asked for. Narrowed by a
 * clause or a search word, it is the asked order when `ENTRY_LIST_QUERY`
 * declares it and the list's default when it does not — and a range leads the
 * order with the field it ranges over, keeping the direction asked for when
 * that is one of the ranged column's declared ones. Whenever the order is not
 * the one asked for, a notice says which it is and why.
 */
export function planEntryList(request: EntryListRequest): EntryListView {
  const asked = entryListStoredSort(request.sort)
  const plan = planListQuery(
    ENTRY_LIST_QUERY,
    {
      clauses: request.clauses,
      search: request.search,
      sort: { path: asked.field, direction: asked.direction },
    },
    nameSearchNormalizers,
  )
  const filters = plan.filters
  const narrowed = filters.length > 0
  const ranged = filters.some((filter) => RANGE_OPS.has(filter.op))
  const planned: CollectionSort = {
    field: plan.orderBy.path,
    direction: plan.orderBy.direction,
  }
  const declared = (sort: CollectionSort) =>
    DECLARED.some((entry) => sameSort(entry, sort))
  const order: CollectionSort = !narrowed
    ? asked
    : ranged && asked.field === planned.field && declared(asked)
      ? asked
      : planned

  const notices = [...plan.notices]
  if (!sameSort(order, asked)) {
    notices.push(
      ranged
        ? `Sorted by ${describeOrder(order)}: a date filter orders the list by the date it filters.`
        : `Sorted by ${describeOrder(order)}: a filtered or searched list sorts by Published or Updated.`,
    )
  }

  const sortingOrders = {} as Record<EntryListSortField, Array<'asc' | 'desc'>>
  for (const column of ENTRY_LIST_SORT_FIELDS) {
    const stored = entryListStoredSort({ field: column, direction: 'asc' }).field
    sortingOrders[column] = !narrowed
      ? [...UNFILTERED_SORTING_ORDERS[column]]
      : ranged && stored !== order.field
        ? []
        : UNFILTERED_SORTING_ORDERS[column].filter((direction) =>
            declared({ field: stored, direction }),
          )
  }

  return {
    plan,
    filters,
    order,
    columnSort: entryListColumnSort(order),
    ranged,
    equalityFields: filters
      .filter((filter) => filter.op === '==')
      .map((filter) => filter.path),
    sortingOrders,
    notices,
    key: JSON.stringify({ filters, order }),
  }
}

/** A collection's entries. */
export function entryListCollection(
  firestore: Firestore,
  hostId: string,
  collectionId: string,
): CollectionReference {
  return collection(
    firestore,
    'hosts',
    hostId,
    'collections',
    collectionId,
    'entries',
  )
}

/**
 * The entries a table view lists, before any ordering: the collection and
 * every predicate the plan put on the query. The walk owns the ordering.
 */
export function entryListBase(
  firestore: Firestore,
  hostId: string,
  collectionId: string,
  view: EntryListView,
): Query {
  const entries = entryListCollection(firestore, hostId, collectionId)
  if (!view.filters.length) return entries
  // `listQueryConstraints` is the plan's predicates, then its one order; the
  // walk adds its own order, so only the predicates are taken.
  return query(
    entries,
    ...listQueryConstraints(view.plan).slice(0, view.filters.length),
  )
}

/**
 * A RANGED view as one ordered query (see {@link EntryListView.ranged}): every
 * predicate, the view's order, and the window's limit.
 */
export function entryListRangedQuery(
  firestore: Firestore,
  hostId: string,
  collectionId: string,
  view: EntryListView,
  pageLimit: number,
): Query {
  return query(
    entryListCollection(firestore, hostId, collectionId),
    ...listQueryConstraints({
      ...view.plan,
      orderBy: { path: view.order.field, direction: view.order.direction },
    }),
    limit(pageLimit),
  )
}
