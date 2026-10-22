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

import { ACTIVITY_SEARCH_TOKENS_PATH } from '@aglyn/aglyn/app-utils/activity-search'
import type {
  ListFilterField,
  ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQueryRefusal,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { ACTIVITY_LIST_FILTER_FIELDS } from './list-filters'

/*
 * EVERY ACTIVITY LOG'S QUERY (AGL-3321).
 *
 * Six lists read the `activity` collections, and every one of them plans its
 * query from a declaration here through `planListQuery` — every clause the
 * Filters panel holds and the search word land on the Firestore query, and
 * nothing is matched over rows a read already fetched:
 *
 *   list                          reads                                 base
 *   a site's log (Setup page)     hosts/{hostId}/activity (browser)     —
 *   the organization's own feed   orgs/{orgId}/activity (route)         —
 *   changes to one member         orgs/{orgId}/activity (route)         target.id ==
 *   the org-wide log              each of the org's subjects (route)    —
 *   one member, in this org       each of the org's subjects (route)    actorId ==
 *   one account, everywhere       the `activity` group (staff route)    actorId ==
 *
 * The two fan-outs apply the SAME plan to every subject's query and merge
 * the answers by date, so a subject contributes only rows that match.
 *
 * ## One order, merged indexes
 *
 * `createdAt` DESC is the only order — every feed's cursor is a position in
 * it — so the only range is over `createdAt` itself. Each equality and the
 * search token merge with it through their own `(field, createdAt DESC)`
 * composite (`listQueryIndexes`), pinned per list by
 * `specs/activity-list-query-indexes.spec.ts`: COLLECTION scope for the
 * per-subject queries, COLLECTION_GROUP for the staff feed.
 *
 * ## The search
 *
 * `searchTokens`, which every writer stamps (`activitySearchTokens` in
 * `@aglyn/aglyn/app-utils/activity-search`) and
 * `tools/scripts/backfill-activity-search-tokens.mjs` stamps on the entries
 * that predate it: the start of a word of the actor's address, of an API
 * key's name, or of the name of what changed. One array clause per query,
 * so a list whose base is itself an array clause could not search — none of
 * these is.
 *
 * ## Where, and why no entry carries its org
 *
 * An entry is filed UNDER its subject, so "which site" is where it lives,
 * not a field on it. The org-wide log serves Where by choosing which
 * subjects it reads — a query-level choice, not a match over rows read —
 * and one member's activity in one organization is that member's equality
 * on each of the organization's subjects, so it reads nothing from any
 * other organization and discards nothing.
 *
 * Stamping `orgId` on every entry would let those two be one collection-
 * group query instead of a fan-out, but the site log is written from the
 * browser under a rule that validates no keys, so the stamp would be a
 * claim any editor of any site could make about any organization — an
 * entry planted in another organization's audit log. The subject a document
 * lives under cannot be forged that way, which is why the scope stays there.
 */

/** The one order every activity feed keeps, and pages by. */
export const ACTIVITY_LIST_SORT: ListQuerySort = {
  path: 'createdAt',
  direction: 'desc',
  column: 'createdAt',
  label: 'When',
}

/*
 * THE HEADER ORDERS OF ONE SUBJECT'S LOG (AGL-3680).
 *
 * A site's log and the organization's own feed each read ONE collection with
 * no base, so an `alone` order there is a single-field index Firestore keeps
 * anyway — oldest first, and Action either way, cost no composite. Every
 * writer stamps `action` (it is the entry's sentence or its catalog code), so
 * an `orderBy` on it drops nothing. Alone, because pairing them with every
 * filter would cost a composite per (equality × order); with a filter or the
 * search on, the plan falls back to newest first and says so.
 *
 * The person-scoped feeds (one account everywhere, one member in an
 * organization, the changes to one member) and the org-wide merge keep
 * `createdAt` DESC alone: a base would make each of these a composite, and
 * the merge pages by the clock. Their other headers sort the page.
 */
export const SUBJECT_ACTIVITY_SORTS: readonly ListQuerySort[] = [
  ACTIVITY_LIST_SORT,
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: 'When, oldest first', alone: true },
  { path: 'action', direction: 'asc', column: 'action', label: 'Action', alone: true },
  { path: 'action', direction: 'desc', column: 'action', label: 'Action', alone: true },
]

/** Action, When and the search: the query every activity list starts from. */
export const ACTIVITY_LIST_QUERY: ListQueryDeclaration = {
  fields: ACTIVITY_LIST_FILTER_FIELDS,
  sorts: [ACTIVITY_LIST_SORT],
  search: { tokensPath: ACTIVITY_SEARCH_TOKENS_PATH },
}

/**
 * One subject's log with its header orders: a site's log, and the
 * organization's own feed with no target.
 */
export const SUBJECT_ACTIVITY_QUERY: ListQueryDeclaration = {
  ...ACTIVITY_LIST_QUERY,
  sorts: SUBJECT_ACTIVITY_SORTS,
}

/** Who: one of the organization's members, an equality on every subject. */
export const ORG_ACTIVITY_WHO_FIELD: ListFilterField = {
  column: 'actorId',
  kind: 'exact',
  path: 'actorId',
  operators: ['equals'],
}

/** The org-wide log's query: Action, Who, When and the search. */
export const ORG_ACTIVITY_QUERY: ListQueryDeclaration = {
  ...ACTIVITY_LIST_QUERY,
  fields: [...ACTIVITY_LIST_FILTER_FIELDS, ORG_ACTIVITY_WHO_FIELD],
}

/**
 * Where: the organization itself or one of its sites. Served by choosing
 * which subjects the fan-out reads, never as a predicate — so it is a panel
 * field and not a field of `ORG_ACTIVITY_QUERY`, and the route takes its
 * clause off before planning (`splitWhereClause`).
 */
export const ORG_ACTIVITY_WHERE_FIELD: ListFilterField = {
  column: 'scopeId',
  kind: 'exact',
  path: 'scopeId',
  operators: ['equals'],
}

/** Everything the org-wide log's Filters panel offers. */
export const ORG_ACTIVITY_FILTER_FIELDS: readonly ListFilterField[] = [
  ...ORG_ACTIVITY_QUERY.fields,
  ORG_ACTIVITY_WHERE_FIELD,
]

/** Fields whose values are picked from a list rather than typed. */
export const ORG_ACTIVITY_SELECT_FIELDS: readonly string[] = ['action', 'actorId', 'scopeId']

/** One person's entries: the base of the member feed and the staff feed. */
export const activityActorBase = (actorId: string): ListQueryFilter[] => [
  { path: 'actorId', op: '==', value: actorId },
]

/** Changes made to one member, host or screen: the org feed's target base. */
export const activityTargetBase = (targetId: string): ListQueryFilter[] => [
  { path: 'target.id', op: '==', value: targetId },
]

/**
 * The Where clause off the rest: the site it names (or `null`), the clauses
 * the plan takes, and a refusal for a Where asked some way it cannot be.
 */
export function splitWhereClause(clauses: readonly ListFilterRequest[]): {
  where: string | null
  rest: ListFilterRequest[]
  refused: ListQueryRefusal[]
} {
  const rest: ListFilterRequest[] = []
  const refused: ListQueryRefusal[] = []
  let where: string | null = null
  for (const clause of clauses) {
    if (clause.field !== ORG_ACTIVITY_WHERE_FIELD.column) {
      rest.push(clause)
      continue
    }
    const value = (clause.value ?? '').trim()
    if (clause.op !== 'equals' || !value) {
      refused.push({ clause, reason: 'pick the organization or one of its sites' })
    } else if (where !== null) {
      refused.push({ clause, reason: 'the log reads one place at a time' })
    } else {
      where = value
    }
  }
  return { where, rest, refused }
}

/**
 * What an activity log's search box finds, said beside it while a search is
 * in force — the promise `activitySearchTokens` keeps.
 */
export const ACTIVITY_SEARCH_HINT =
  'Search finds entries by the start of a word in the address of whoever ' +
  'made the change (or the API key’s name) and in the name of what changed, ' +
  'across the whole log.'
