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
 * THE IDEMPOTENCY-CLAIMS LIST'S QUERY (AGL-3321).
 *
 * Read by BOTH the staff card and `/api/admin/idempotency-claims`, which
 * plans every clause onto one Firestore query over `apiIdempotency` —
 * always `status == 'pending'`, oldest claim first — and pages it by a
 * cursor in that order. Nothing is matched over rows a read already fetched.
 *
 * ## Age and State are ranges over the claim time
 *
 * A claim's age and whether it is stranded are both "how long ago was
 * `createdAtMs`", which only the moment of the read can answer. So the route
 * takes those two clauses off before planning (`splitClaimTimeClauses`) and
 * puts each on the query as a range over `createdAtMs` — the field the list
 * is ordered by, so any number of them stand together and need no index of
 * their own. Operation, Scope and Org are equalities, each merged with the
 * order through its own `(field, createdAtMs ASC)` composite, pinned by
 * `specs/idempotency-claims-list-query.spec.ts`.
 *
 * ## No search box
 *
 * Every value on a claim is an identifier, and no claim writer stamps a
 * search token (there are several writers, across the platform and its
 * plugins). The panel's exact filters on Operation, Scope and Org are what a
 * query can serve, so they are what the list offers.
 */

/** The collection the list reads. */
export const IDEMPOTENCY_CLAIMS_COLLECTION = 'apiIdempotency'

/**
 * How old a `pending` claim must be before it is called stranded.
 *
 * Comfortably longer than any checkout round trip, including a slow Stripe
 * call behind a cold start. Under this, "pending" means "working"; over it,
 * the process that made the claim is not coming back.
 */
export const STRANDED_AFTER_MS = 10 * 60 * 1000

/** Oldest claim first: the longest-stuck key is the one holding up a customer. */
export const CLAIM_LIST_SORT: ListQuerySort = {
  path: 'createdAtMs',
  direction: 'asc',
  label: 'Age',
}

/*
 * ## The header sorts (AGL-3680)
 *
 * Operation, Scope and Org order the query by the stored field, `alone`:
 * served with no Operation, Scope or Org filter on, each costing one
 * `(status, field)` composite per direction beside the pending base. Every
 * claim writer stores all three — `scopeId` on a commerce refund claim since
 * AGL-3680, and `tools/scripts/backfill-staff-list-sort-fields.mjs` stamps
 * the claims before it (and `createdAtMs` on untimed ones, from what each
 * carries), because an `orderBy` drops a document that lacks its field.
 *
 * Age and State are both "how long ago was `createdAtMs`", read the other
 * way round: the youngest claim has the smallest age. So their headers ask
 * the route for `ageMs` / `stranded` (`CLAIM_COLUMN_SORTS`), and the route
 * turns that into the claim-time order (`claimQuerySort`) before planning.
 * An Age or State filter is a range over the claim time, which leads the
 * order, so under one the list is ordered by age and says so.
 */
const CLAIM_NEWEST_FIRST: ListQuerySort = {
  path: 'createdAtMs',
  direction: 'desc',
  label: 'Age',
  alone: true,
}

const claimAlone = (path: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column: path, label, alone: true },
  { path, direction: 'desc', column: path, label, alone: true },
]

/** What the plan serves: equalities beneath the claim-time order. */
export const CLAIM_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'kind', kind: 'exact', path: 'kind', operators: ['equals', 'isAnyOf'] },
    { column: 'scopeId', kind: 'exact', path: 'scopeId', operators: ['equals'] },
    { column: 'orgId', kind: 'exact', path: 'orgId', operators: ['equals'] },
  ],
  sorts: [
    CLAIM_LIST_SORT,
    CLAIM_NEWEST_FIRST,
    ...claimAlone('kind', 'Operation'),
    ...claimAlone('scopeId', 'Scope'),
    ...claimAlone('orgId', 'Org'),
  ],
}

/** The Age header's default: oldest first, which is the query's own order. */
export const CLAIM_AGE_SORT: ListQuerySort = {
  path: 'ageMs',
  direction: 'desc',
  column: 'ageMs',
  label: 'Age',
}

/** Every header order the card offers, as it asks the route (`sort=path:dir`). */
export const CLAIM_COLUMN_SORTS: readonly ListQuerySort[] = [
  CLAIM_AGE_SORT,
  { path: 'ageMs', direction: 'asc', column: 'ageMs', label: 'Age' },
  // In flight sorts before stranded: the youngest claims first.
  { path: 'stranded', direction: 'asc', column: 'stranded', label: 'State' },
  { path: 'stranded', direction: 'desc', column: 'stranded', label: 'State' },
  ...CLAIM_LIST_QUERY.sorts.filter((sort) => sort.column),
]

/**
 * The claim-time order an Age or State header asks for: an older claim has
 * the larger age and is the stranded one, so each reads `createdAtMs` the
 * other way round. Any other order passes through for the plan to match.
 */
export function claimQuerySort(sort: ListQuerySort | null): ListQuerySort | null {
  if (!sort || (sort.path !== 'ageMs' && sort.path !== 'stranded')) return sort
  return sort.direction === 'asc' ? CLAIM_NEWEST_FIRST : CLAIM_LIST_SORT
}

/** The list's base: only claims that have not settled. */
export const CLAIM_PENDING_BASE: readonly ListQueryFilter[] = [
  { path: 'status', op: '==', value: 'pending' },
]

/** Age, in milliseconds — a range over `createdAtMs`, read at the moment of the query. */
export const CLAIM_AGE_FIELD: ListFilterField = {
  column: 'ageMs',
  kind: 'number',
  path: 'ageMs',
  operators: ['>', '>=', '<', '<='],
}

/** Stranded or in flight — a range over `createdAtMs` at `STRANDED_AFTER_MS`. */
export const CLAIM_STATE_FIELD: ListFilterField = {
  column: 'stranded',
  kind: 'exact',
  path: 'stranded',
  operators: ['equals'],
}

/** Everything the claims grid's Filters panel offers. */
export const CLAIM_FILTER_FIELDS: readonly ListFilterField[] = [
  ...CLAIM_LIST_QUERY.fields,
  CLAIM_AGE_FIELD,
  CLAIM_STATE_FIELD,
]

export const CLAIM_FILTER_HEADERS: Readonly<Record<string, string>> = {
  kind: 'Operation',
  scopeId: 'Scope',
  orgId: 'Org',
  ageMs: 'Age (ms)',
  stranded: 'State',
}

export const CLAIM_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  stranded: [
    { value: 'stranded', label: 'stranded' },
    { value: 'inFlight', label: 'in flight' },
  ],
}

/** The fields the panel shows as a select. */
export const CLAIM_SELECT_FIELDS: readonly string[] = Object.keys(CLAIM_FILTER_OPTIONS)

/** Age's comparison, as the range it puts on the claim time. */
const AGE_TO_CLAIM_TIME: Readonly<Record<string, '<' | '<=' | '>' | '>='>> = {
  // Older than `age` is claimed before `now - age`.
  '>': '<',
  '>=': '<=',
  '<': '>',
  '<=': '>=',
}

/**
 * The Age and State clauses off the rest, as ranges over `createdAtMs` read
 * at `now`, with a refusal for one asked some way it cannot be. The rest go
 * to the plan.
 */
export function splitClaimTimeClauses(
  clauses: readonly ListFilterRequest[],
  now: number,
): { base: ListQueryFilter[]; rest: ListFilterRequest[]; refused: ListQueryRefusal[] } {
  const base: ListQueryFilter[] = []
  const rest: ListFilterRequest[] = []
  const refused: ListQueryRefusal[] = []
  for (const clause of clauses) {
    const value = String(clause.value ?? '').trim()
    if (clause.field === CLAIM_STATE_FIELD.column) {
      if (clause.op !== 'equals' || (value !== 'stranded' && value !== 'inFlight')) {
        refused.push({ clause, reason: 'pick stranded or in flight' })
        continue
      }
      const cutoff = now - STRANDED_AFTER_MS
      base.push({
        path: CLAIM_LIST_SORT.path,
        op: value === 'stranded' ? '<=' : '>',
        value: cutoff,
      })
      continue
    }
    if (clause.field === CLAIM_AGE_FIELD.column) {
      const op = AGE_TO_CLAIM_TIME[clause.op]
      const age = Number(value)
      if (!op) {
        refused.push({ clause, reason: `${clause.op} is not something this list can ask of the age` })
        continue
      }
      if (!value || !Number.isFinite(age)) {
        refused.push({ clause, reason: 'type a number' })
        continue
      }
      base.push({ path: CLAIM_LIST_SORT.path, op, value: now - age })
      continue
    }
    rest.push(clause)
  }
  return { base, rest, refused }
}
