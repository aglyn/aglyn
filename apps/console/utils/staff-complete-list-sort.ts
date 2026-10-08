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

import type { ListPageSort } from '@aglyn/shared-util-tools/list-query/list-column-sort'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * A COMPLETE-READ STAFF LIST'S HEADER SORTS (AGL-3680, strategy 4s).
 *
 * The lists `answerStaffCompleteList` answers — Stripe's coupons, the media
 * deny list, a tax period's findings — read their WHOLE source on the route
 * and page it there. So a header sort is answered the same way a filter is:
 * the route orders every row it read, then pages the order. Nothing about it
 * is "this page only".
 *
 * One declaration serves both sides: the page hands
 * `staffCompleteListSorts(columns)` to `useListColumnSort` (each column asks
 * `sort=<column>:<dir>`), and the route hands the same `columns` to
 * `answerStaffCompleteList`, which reads each row's value with the column's
 * getter and compares it with `compareListSortValues` — empty last, text as
 * a reader reads it. A column the declaration does not name is not a header
 * sort, and a `sort` naming one is ignored with a notice.
 */

/** One column's sort: how it reads in a notice, and the value it compares. */
export interface StaffCompleteListColumn<Row> {
  label: string
  value: ListPageSort<Row>
}

/** Every sortable column of a complete-read list, by grid field. */
export type StaffCompleteListColumns<Row> = Readonly<Record<string, StaffCompleteListColumn<Row>>>

/**
 * The header orders of a complete-read list: both directions of every
 * column, each asked of the route by its field. None is `alone` — the route
 * sorts after it filters, so every order holds under every clause.
 */
export function staffCompleteListSorts<Row>(columns: StaffCompleteListColumns<Row>): ListQuerySort[] {
  return Object.entries(columns).flatMap(([column, { label }]) =>
    (['asc', 'desc'] as const).map((direction) => ({ path: column, direction, column, label })),
  )
}
