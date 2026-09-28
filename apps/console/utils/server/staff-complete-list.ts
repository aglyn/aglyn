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

import {
  type ListFilterField,
  listFilterOperators,
  matchListFilter,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { listRowMatchesSearch } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQueryRefusal } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { StaffListQueryPage, StaffListQueryRequest } from './staff-list-query'

/*
 * A STAFF LIST WHOSE ROWS ARE NOT FIRESTORE DOCUMENTS, ANSWERED OVER ITS
 * COMPLETE SOURCE (AGL-3321).
 *
 * Most staff lists put every clause on a Firestore query
 * (`runStaffListQuery`). A few have no query to put them on: Stripe's
 * coupons, which Stripe lists but cannot filter or search by any field the
 * panel names, and the media deny list, which is the entries of ONE document.
 * Their routes read the WHOLE source — every Stripe page to the end, the
 * whole document — and refuse, by status, rather than answer from part of it
 * past a stated bound. So a clause matched here is matched against every row
 * the source holds, never a window of it, and the answer is the same answer a
 * query would give.
 *
 * The request and the answer are the staff wire (`readStaffListQuery`,
 * `useStaffListQuery`), so the page is written exactly as a query-served one:
 *
 *   GET ?filters=<JSON [{field, op, value}]>&search=<words>&cursor=<row id>&pageSize=<n>
 *   →  { rows, nextCursor, hasMore, refused, notices, total }
 *
 * A clause whose field the list does not declare, or whose operator the field
 * does not offer, is refused by name — the same answer the query plan gives —
 * rather than read as "no filter".
 */

export interface StaffCompleteListPage<Row> extends StaffListQueryPage<Row> {
  /** How many rows answer the request across the whole source. */
  total: number
}

/**
 * One page of a complete source, filtered by every clause and the search.
 *
 * `rows` is the whole source, already in the list's one order. The cursor is
 * the id of the last row of the previous page (`cursorOf`); one that names a
 * row no longer in the answer starts the list over, as a deleted cursor
 * document does for `runStaffListQuery`.
 */
export function answerStaffCompleteList<Row extends object>(options: {
  rows: readonly Row[]
  fields: readonly ListFilterField[]
  searchPaths: readonly string[]
  request: StaffListQueryRequest
  cursorOf: (row: Row) => string
}): StaffCompleteListPage<Row> {
  const { rows, fields, searchPaths, request, cursorOf } = options
  const refused: ListQueryRefusal[] = []
  const served = request.clauses.filter((clause) => {
    const field = fields.find((entry) => entry.column === clause.field)
    if (!field) {
      refused.push({ clause, reason: 'this list does not filter by that' })
      return false
    }
    if (!listFilterOperators(field).includes(clause.op)) {
      refused.push({
        clause,
        reason: `${clause.op} is not something this list can ask of ${field.column}`,
      })
      return false
    }
    return true
  })
  const matched = rows.filter(
    (row) =>
      served.every((clause) => matchListFilter(row, fields, clause)) &&
      listRowMatchesSearch(row, searchPaths, request.search),
  )
  const after = request.cursor
    ? matched.findIndex((row) => cursorOf(row) === request.cursor)
    : -1
  const start = after === -1 ? 0 : after + 1
  const page = matched.slice(start, start + request.pageSize)
  const hasMore = start + request.pageSize < matched.length
  return {
    rows: page,
    nextCursor: hasMore && page.length ? cursorOf(page[page.length - 1]) : null,
    hasMore,
    refused,
    notices: [],
    total: matched.length,
  }
}
