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
  ListQueryRefusal,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE ERASURE QUEUE'S QUERY (AGL-3321).
 *
 * Read by BOTH the staff Pending erasures card and
 * `GET /api/admin/run-erasures`, which plans every clause and the search
 * word onto one Firestore query over `orgs` — oldest request first, which
 * is also the order the runner takes them in — and pages it by a cursor in
 * that order. Ordering by `erasureRequestedAt` is what makes the query the
 * queue: an organization with no request lacks the field and is not listed.
 *
 * ## State is a range over the request time
 *
 * Due or Holding is "was the request made more than the hold ago", which
 * only the moment of the read can answer. So the route takes that clause off
 * before planning (`splitErasureStateClauses`) and puts it on the query as a
 * range over `erasureRequestedAt` — the field the queue is ordered by, so it
 * needs no index of its own.
 *
 * ## The search is the organization's name
 *
 * `nameTokens`, the word-prefix tokens every writer of an organization's
 * name stamps beside it (`nameSearchTokens`), the same field the staff
 * Organizations list searches. The Organization filter's "contains" asks the
 * same tokens, so it is one array clause with the search: the two do not
 * combine, and the plan says so. One composite merges them with the order,
 * pinned by `specs/pending-erasures-list-query.spec.ts`.
 */

/** Oldest request first: the order the runner takes them in. */
export const ERASURE_LIST_SORT: ListQuerySort = {
  path: 'erasureRequestedAt',
  direction: 'asc',
  column: 'requestedAtMs',
  label: 'Requested',
}

/*
 * ## The header sorts (AGL-3680)
 *
 * Requested, Hold expires and State are all the request time read three
 * ways — the hold is one fixed length, and a request is due once it is that
 * old — so each orders the QUERY by `erasureRequestedAt`. Newest first is
 * `alone`: served with no search or Organization filter on, so it needs no
 * composite beside the name tokens' one; a State filter is a range over the
 * same field, which keeps either direction. Hold expires and State ask the
 * route by their own names (`ERASURE_COLUMN_SORTS`) so each header shows its
 * own arrow; `erasureQuerySort` turns them into the request-time order.
 * Organization is a name the queue holds a few of: it sorts the page.
 */
const ERASURE_NEWEST_FIRST: ListQuerySort = {
  path: 'erasureRequestedAt',
  direction: 'desc',
  column: 'requestedAtMs',
  label: 'Requested',
  alone: true,
}

/** What the plan serves: the organization's name, and the search over it. */
export const ERASURE_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'name', kind: 'text', path: 'name', tokensPath: 'nameTokens', operators: ['contains'] },
  ],
  sorts: [ERASURE_LIST_SORT, ERASURE_NEWEST_FIRST],
  search: { tokensPath: 'nameTokens' },
}

/** Every header order the card offers, as it asks the route (`sort=path:dir`). */
export const ERASURE_COLUMN_SORTS: readonly ListQuerySort[] = [
  ERASURE_LIST_SORT,
  ERASURE_NEWEST_FIRST,
  { path: 'holdExpiresAtMs', direction: 'asc', column: 'holdExpiresAtMs', label: 'Hold expires' },
  { path: 'holdExpiresAtMs', direction: 'desc', column: 'holdExpiresAtMs', label: 'Hold expires' },
  // Due sorts before Holding: the oldest requests first.
  { path: 'due', direction: 'asc', column: 'due', label: 'State' },
  { path: 'due', direction: 'desc', column: 'due', label: 'State' },
]

/**
 * The request-time order a Hold expires or State header asks for: both run
 * with the request time, so each is that order in the same direction. Any
 * other order passes through for the plan to match.
 */
export function erasureQuerySort(sort: ListQuerySort | null): ListQuerySort | null {
  if (!sort || (sort.path !== 'holdExpiresAtMs' && sort.path !== 'due')) return sort
  return sort.direction === 'asc' ? ERASURE_LIST_SORT : ERASURE_NEWEST_FIRST
}

/** Due or Holding — a range over `erasureRequestedAt` at the hold. */
export const ERASURE_STATE_FIELD: ListFilterField = {
  column: 'due',
  kind: 'exact',
  path: 'due',
  operators: ['equals'],
}

/** Everything the queue's Filters panel offers. */
export const ERASURE_FILTER_FIELDS: readonly ListFilterField[] = [
  ...ERASURE_LIST_QUERY.fields,
  ERASURE_STATE_FIELD,
]

export const ERASURE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Organization',
  due: 'State',
}

export const ERASURE_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  due: [
    { value: 'due', label: 'Due' },
    { value: 'holding', label: 'Holding' },
  ],
}

/** The fields the panel shows as a select. */
export const ERASURE_SELECT_FIELDS: readonly string[] = Object.keys(ERASURE_FILTER_OPTIONS)

/** What the search box finds, said beside it while a search is in force. */
export const ERASURE_SEARCH_HINT =
  'Search finds an organization by the start of any word of its name, ' +
  'across the whole queue.'

/**
 * The State clause off the rest, as a range over `erasureRequestedAt` read
 * at `now` against a hold of `holdMs`, with a refusal for one asked some
 * way it cannot be. The rest go to the plan.
 */
export function splitErasureStateClauses(
  clauses: readonly ListFilterRequest[],
  now: number,
  holdMs: number,
): { base: ListQueryFilter[]; rest: ListFilterRequest[]; refused: ListQueryRefusal[] } {
  const base: ListQueryFilter[] = []
  const rest: ListFilterRequest[] = []
  const refused: ListQueryRefusal[] = []
  for (const clause of clauses) {
    if (clause.field !== ERASURE_STATE_FIELD.column) {
      rest.push(clause)
      continue
    }
    const value = String(clause.value ?? '').trim()
    if (clause.op !== 'equals' || (value !== 'due' && value !== 'holding')) {
      refused.push({ clause, reason: 'pick Due or Holding' })
      continue
    }
    // Due once the request is at least the hold old.
    base.push({
      path: ERASURE_LIST_SORT.path,
      op: value === 'due' ? '<=' : '>',
      value: new Date(now - holdMs),
    })
  }
  return { base, rest, refused }
}
