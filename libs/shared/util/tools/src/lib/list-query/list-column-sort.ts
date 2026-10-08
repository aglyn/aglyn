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

import type { ListQuerySort } from './list-query-plan'

/*
 * EVERY TABLE SORTS BY ITS COLUMN HEADERS (AGL-3680).
 *
 * A header sort on a paged list used to order only the page on screen, which
 * reads as the whole list's order, so the query-served tables switched header
 * sorting off (AGL-3352, AGL-3321). Every column sorts again, each by the one
 * strategy that is honest for it:
 *
 *   1  a stored field on EVERY document    the query's `orderBy`: a
 *                                          `ListQuerySort` with `column`,
 *                                          `alone: true` unless it is the
 *                                          default (see `ListQuerySort.alone`)
 *   2  a stored field missing on some      stamp it on every write (null is
 *                                          fine) + a backfill, then (1);
 *                                          until then (3) — an `orderBy`
 *                                          DROPS every doc that lacks it
 *   3  joined or computed, not on the doc  a PAGE sort: the loaded rows, by a
 *                                          `ListPageSort` value getter; the
 *                                          header says it sorts this page
 *   4  the list loads ALL its rows         plain client sort — the grid's own,
 *                                          exact; no `columnSort` needed
 *   5  Firebase Auth                       the route sorts the complete
 *                                          directory read when it fits the
 *                                          scan bound, the page otherwise
 *
 * Only the actions column is unsortable by design. The web hook is
 * `useListColumnSort` (`@aglyn/shared-ui-jsx/hooks/use-list-column-sort`),
 * handed to `ListTable` as `columnSort`. The pieces here are SDK-free so a
 * route and a native surface sort with the same comparison.
 */

/** A value a page sort compares: text, a number, a date, or nothing. */
export type ListSortValue = string | number | boolean | Date | null | undefined

/** How one column reads a row for a page sort (strategy 3). */
export type ListPageSort<Row> = (row: Row) => ListSortValue

const isEmpty = (value: ListSortValue): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  (value instanceof Date && Number.isNaN(value.getTime())) ||
  (typeof value === 'number' && Number.isNaN(value))

const comparable = (value: ListSortValue): string | number =>
  value instanceof Date
    ? value.getTime()
    : typeof value === 'boolean'
      ? Number(value)
      : (value as string | number)

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Two values in `direction`, EMPTY LAST either way — a reader sorting by
 * "Last sign-in" wants the accounts that have one, not a screen of blanks.
 * Text compares as a reader reads it: case-blind, digits as numbers.
 */
export function compareListSortValues(
  a: ListSortValue,
  b: ListSortValue,
  direction: ListQuerySort['direction'],
): number {
  const emptyA = isEmpty(a)
  const emptyB = isEmpty(b)
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1
  const left = comparable(a)
  const right = comparable(b)
  const order =
    typeof left === 'string' || typeof right === 'string'
      ? collator.compare(String(left), String(right))
      : left - right
  return direction === 'desc' ? -order : order
}

/** The rows, a copy, in `direction` by `value` — stable for equal values. */
export function sortListRows<Row>(
  rows: readonly Row[],
  value: ListPageSort<Row>,
  direction: ListQuerySort['direction'],
): Row[] {
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => compareListSortValues(a.value, b.value, direction) || a.index - b.index)
    .map((entry) => entry.row)
}

/** What a page-sorted header says, so it never reads as the whole list's order. */
export const LIST_PAGE_SORT_DESCRIPTION = 'Sorts the rows on this page'

/** The notice over a page-sorted list. */
export const listPageSortNotice = (label: string): string =>
  `Sorted by ${label} on this page only: it is not stored where the list's query can order by it.`
