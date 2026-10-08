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
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  type StaffCompleteListColumns,
  staffCompleteListSorts,
} from './staff-complete-list-sort'

/*
 * THE CSP VIOLATIONS TABLE ON STAFF → HEALTH (AGL-3321).
 *
 * The table reads `cspViolationDaily`, one counter per (day × app ×
 * directive × disposition × blocked origin), through
 * `/api/admin/csp-reports?view=rows`. Every Filters clause and the search
 * word land on that route's Firestore query (`runStaffListQuery`), beneath
 * the Window the page picks — nothing is matched over rows already read.
 *
 * ## The window is the one range
 *
 * The Window picker is `day >= since`, a range on `day`, and a query holds
 * one range field which must lead its order. So the table is ordered by day,
 * newest first, and the only other range it can take is on `day` itself: the
 * Day filter is a `startsWith` (`2026-09-17` is that day, `2026-09` that
 * month). A range on the count cannot stand beside the window, so Count is
 * not a filter; a second range here would need the window dropped, and a
 * composite per equality field for `count` besides.
 *
 * ## Merged indexes
 *
 * Each equality — App, Directive, Blocked or measured, Blocked origin — and
 * the search token merge with the window through their own `(field, day
 * DESC)` composite (`listQueryIndexes`), pinned by
 * `specs/csp-report-list-query.spec.ts`.
 *
 * ## The search
 *
 * `searchTokens`, which every write stamps (`cspSearchTokens` in
 * `@aglyn/tenant-data-admin`) and `tools/scripts/backfill-csp-search-tokens.mjs`
 * stamps on the counters that predate it: the start of the blocked origin,
 * of the directive or of the app, whole or any part of it. Not the sampled
 * site and path, which change with every report.
 *
 * The directive chips, totals and blocked alert above the table are a
 * rollup of the WHOLE window, not a filtered list: the route's summary read
 * (`GET` without `view`) reads the window complete, up to its stated cap.
 */

/** The written field the search reads; `CSP_SEARCH_TOKENS_PATH` on the writer. */
export const CSP_SEARCH_TOKENS_PATH = 'searchTokens'

/** Newest day first — the one order, because the window is a range on `day`. */
export const CSP_LIST_SORT: ListQuerySort = {
  path: 'day',
  direction: 'desc',
  column: 'day',
  label: 'Day',
}

const PICKED = ['equals', 'isAnyOf'] as const

/** What the violations table filters by, every one on the query. */
export const CSP_FILTER_FIELDS: readonly ListFilterField[] = [
  // The stored day is `YYYY-MM-DD`, so its own value is its lower-case key.
  { column: 'day', kind: 'text', path: 'day', lowerPath: 'day', operators: ['startsWith'] },
  { column: 'app', kind: 'exact', path: 'app', operators: PICKED },
  { column: 'directive', kind: 'exact', path: 'directive', operators: PICKED },
  { column: 'disposition', kind: 'exact', path: 'disposition', operators: PICKED },
  // Stored sanitized to lower case, so it is its own key too.
  { column: 'origin', kind: 'text', path: 'origin', lowerPath: 'origin', operators: PICKED },
]

export const CSP_FILTER_HEADERS: Readonly<Record<string, string>> = {
  day: 'Day',
  app: 'App',
  directive: 'Directive',
  disposition: 'Blocked or measured',
  origin: 'Blocked origin',
}

/** The violations table's query. */
export const CSP_LIST_QUERY: ListQueryDeclaration = {
  fields: CSP_FILTER_FIELDS,
  sorts: [CSP_LIST_SORT],
  search: { tokensPath: CSP_SEARCH_TOKENS_PATH },
}

/*
 * ## The header sorts (AGL-3680)
 *
 * Day newest first is the query's own order — the window's range leads it.
 * Every other order (Day oldest first, App, Directive, Blocked or measured,
 * Blocked origin, Count) is strategy 4s: the route reads EVERY counter the
 * window and the clauses select, up to its `READ_LIMIT` backstop, sorts them
 * and pages the order (`answerStaffCompleteList`). No composite is spent: a
 * second order beside the window's range would need one per equality field.
 * A window past the backstop is not sorted — an order over part of it would
 * put first rows that are not — and the route says so.
 */
export const CSP_SORT_COLUMNS: StaffCompleteListColumns<CspListRow> = {
  day: { label: 'Day', value: (row) => row.day ?? null },
  app: { label: 'App', value: (row) => row.app ?? null },
  directive: { label: 'Directive', value: (row) => row.directive ?? null },
  disposition: { label: 'Blocked or measured', value: (row) => row.disposition ?? null },
  origin: { label: 'Blocked origin', value: (row) => row.origin ?? null },
  count: { label: 'Count', value: (row) => Number(row.count ?? 0) },
}

/** The fields of a counter the sorts read. */
export interface CspListRow {
  day?: string | null
  app?: string | null
  directive?: string | null
  disposition?: string | null
  origin?: string | null
  count?: number | null
}

/**
 * The header orders: Day newest first on the query, every other one sorted
 * by the route over the complete window.
 */
export const CSP_COLUMN_SORTS: readonly ListQuerySort[] = [
  CSP_LIST_SORT,
  ...staffCompleteListSorts(CSP_SORT_COLUMNS).filter(
    (sort) => !(sort.path === CSP_LIST_SORT.path && sort.direction === CSP_LIST_SORT.direction),
  ),
]

/** Whether an asked order is the query's own, rather than a route sort. */
export const isCspQuerySort = (sort: ListQuerySort | null | undefined): boolean =>
  !sort || (sort.path === CSP_LIST_SORT.path && sort.direction === CSP_LIST_SORT.direction)

/** The Window: every counter from `since` (a `YYYY-MM-DD` day) to today. */
export const cspWindowBase = (since: string): ListQueryFilter[] => [
  { path: 'day', op: '>=', value: since },
]

/**
 * What the table's search box finds, said beside it while a search is in
 * force — the promise `cspSearchTokens` keeps.
 */
export const CSP_SEARCH_HINT =
  'Search finds counters by the start of the blocked origin, the directive or ' +
  'the app — whole, or any part between dots and dashes — across the whole window.'
