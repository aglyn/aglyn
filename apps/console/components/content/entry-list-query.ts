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
import type { ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import { listFilterConstraints } from '@aglyn/tenant-feature-instance/hooks/list-filter-constraints'
import type { CollectionSort } from '@aglyn/tenant-feature-instance/hooks/sorted-collection-window'
import {
  collection,
  query,
  type Firestore,
  type Query,
} from 'firebase/firestore'
import { ENTRY_LIST_FILTER_FIELDS } from '../../utils/list-filters'

/**
 * How a collection's entries table can be sorted and filtered (AGL-2853), in
 * one module the provider that queries and the page that renders both read.
 *
 * The sorts are the table's four data columns. Each is walked by
 * `useSortedPagedCollection`, which is what lets a sort name a field some
 * entries do not carry: a draft has no `publishSortAt` (see
 * `entryListStoredSort`), an imported entry has no `createdAt`, and
 * `/api/hosts/resources` validates no field for presence, so an entry created through it can lack a
 * `title`. Those entries follow every entry that has the value, in both
 * directions, rather than dropping out of the list.
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

/** A filter's identity as a string, for a dependency list. */
export const entryListFilterKey = (filter: ListFilterRequest | null): string =>
  filter ? `${filter.field}\n${filter.op}\n${filter.value}` : ''

/**
 * The fields a filter pins by EQUALITY — see `sortFieldIsTotal`.
 *
 * Only a filter the declaration can serve pins anything, because only such a
 * filter reaches the query; `entryListBase` leaves every other one unapplied.
 */
export function entryListEqualityFields(
  filter: ListFilterRequest | null,
): string[] {
  if (!filter || filter.op !== 'equals' || !(filter.value ?? '').trim()) {
    return []
  }
  const declared = ENTRY_LIST_FILTER_FIELDS.find(
    (field) => field.column === filter.field,
  )
  return declared?.operators?.includes('equals') ? [declared.path] : []
}

/**
 * The entries a table view lists, before any ordering.
 *
 * A filter the declaration cannot serve is not applied rather than applied
 * as nothing: an unserved operator must not read as an empty collection.
 * `fixedOrderBy` keeps the translator from adding an `orderBy` of its own —
 * the walk owns the ordering.
 */
export function entryListBase(
  firestore: Firestore,
  hostId: string,
  collectionId: string,
  filter: ListFilterRequest | null,
  sort: CollectionSort,
): Query {
  const entries = collection(
    firestore,
    'hosts',
    hostId,
    'collections',
    collectionId,
    'entries',
  )
  const constraints = listFilterConstraints(ENTRY_LIST_FILTER_FIELDS, filter, {
    fixedOrderBy: entryListStoredSort(sort).field,
  })
  return constraints ? query(entries, ...constraints) : entries
}
