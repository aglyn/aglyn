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
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQueryRequest,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*==========================================
 * WHAT THE FORMS LIST FILTERS AND SEARCHES BY — ALL OF IT ON THE QUERY
 * (AGL-3330, on the AGL-3321 list query plan).
 *
 * The list pages a site's catalog (`hosts/{hostId}/forms`), so a filter
 * matched over the rows already read would answer "no such form" for one on
 * a later page. Every clause and the search word go on ONE Firestore query
 * (`planListQuery`), paged by that query (`useListQuery`); what one query
 * cannot hold is refused by name, never matched in memory.
 *
 * Each field is one every form stores: the create paths write it
 * (`newFormListFields`), a rename rewrites the search keys
 * (`formListFields`), and `tools/scripts/backfill-form-list-fields.mjs`
 * stamps the forms made before.
 *
 *  - Display name: a word of it (`nameTokens`), the shared name-search
 *    prefixes every `displayName`-named document carries.
 *  - Slug: stored normalized (`normalizeFormSlug`), so it is its own key.
 *  - Submissions: the counter `/api/forms/submit` increments on the form, a
 *    number or a range. Leads: the same counter's equality — a count, or
 *    none. A form that counted nothing holds `null`, never zero, so "is
 *    empty" is an equality.
 *  - Last submission (epoch ms) and Updated: days, before or after.
 *  - Status: `retired`, the queryable mirror of `archivedAt`.
 *  - Lead routing: `routing.lead`, a boolean on every form.
 *  - Campaign: `campaignIds`, any of the picked campaigns, as stored.
 *
 * ## The index budget, and what it bought
 *
 * One query holds any number of equalities, one array clause and one range,
 * and a range leads the order. Unfiltered, and under equalities alone, the
 * list reads in document order, which Firestore serves by merging its
 * single-field indexes: no composite. A composite is needed only where an
 * equality or array field meets a RANGE, one per (field, range order) pair
 * (`listQueryIndexes`), so the count is (equality fields) × (range orders).
 *
 * Three ranges — Submissions, Last submission, Updated — are the visible
 * columns with no other honest operator. Leads is asked by equality (a
 * count, or none), Display name by a word, Slug exactly, so none of those
 * adds an order; a Leads range would be a fourth order and seven more
 * composites. Eight equality fields (the search tokens, the name tokens,
 * Slug, the two counters' equalities, `retired`, Lead routing, Campaign)
 * times three orders, less the Submissions equality against its own order,
 * is 23. `form-list-query.spec.ts` pins every one against the index file.
 *=========================================*/

/** Every filter the forms grid offers, in the `ListFilterField` grammar. */
export const FORM_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'displayName',
    kind: 'text',
    path: 'displayName',
    tokensPath: 'nameTokens',
    operators: ['contains'],
  },
  {
    column: 'slug',
    kind: 'text',
    path: 'slug',
    lowerPath: 'slug',
    operators: ['equals'],
  },
  { column: 'submissions', kind: 'number', path: 'stats.submissions', presence: 'nullable' },
  {
    column: 'leads',
    kind: 'number',
    path: 'stats.leads',
    presence: 'nullable',
    operators: ['=', 'isEmpty'],
  },
  {
    column: 'lastSubmission',
    kind: 'date',
    path: 'stats.lastSubmissionAtMs',
    storedAs: 'millis',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore', 'isNotEmpty'],
  },
  { column: 'updatedAt', kind: 'date', path: 'updatedAt', presence: 'always' },
  { column: 'status', kind: 'boolean', path: 'retired', operators: ['equals'] },
  { column: 'leadRouting', kind: 'boolean', path: 'routing.lead', operators: ['equals'] },
  {
    column: 'campaignIds',
    kind: 'exact',
    path: 'campaignIds',
    // The array itself: "any of" is one `array-contains-any`.
    tokensPath: 'campaignIds',
    operators: ['isAnyOf'],
  },
]

/** The forms list's query: its fields, its one order, and its search. */
export const FORM_LIST_QUERY: ListQueryDeclaration = {
  fields: FORM_LIST_FILTER_FIELDS,
  // Document order, as the list has always read, which needs no composite.
  sorts: [{ path: '__name__', direction: 'asc' }],
  search: { tokensPath: 'searchTokens' },
}

/** How each field reads on a chip and as a hidden column's header. */
export const FORM_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Display name',
  slug: 'Slug',
  submissions: 'Submissions',
  leads: 'Leads',
  lastSubmission: 'Last submission',
  updatedAt: 'Updated',
  status: 'Status',
  leadRouting: 'Lead routing',
  campaignIds: 'Campaign',
}

/** Status is the stored `retired`, picked by name. */
export const FORM_STATUS_OPTIONS = [
  { value: 'false', label: 'Active' },
  { value: 'true', label: 'Retired' },
]

/** Lead routing is the stored switch, picked by name. */
export const FORM_LEAD_ROUTING_OPTIONS = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
]

/** The fields picked from choices rather than typed. */
export const FORM_LIST_SELECT_FIELDS = ['status', 'leadRouting', 'campaignIds'] as const

/**
 * A retired form is a tombstone the list leaves out unless the reader asks
 * for Status (AGL-2671). On the query, so a page is a page of forms in use
 * rather than one with retired rows dropped from it.
 */
export const FORM_IN_USE: ListQueryFilter = { path: 'retired', op: '==', value: false }

/**
 * What the forms list asks this time: the clauses in force, the search
 * words, and the forms in use unless Status is one of the clauses.
 */
export function formListRequest(
  clauses: readonly ListFilterClause[],
  search: readonly string[],
): ListQueryRequest {
  const askedStatus = clauses.some((clause) => clause.field === 'status')
  return {
    clauses,
    search,
    ...(askedStatus ? {} : { base: [FORM_IN_USE] }),
  }
}
