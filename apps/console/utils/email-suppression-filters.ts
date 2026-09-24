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
  ListFilterClause,
  ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/*
 * What the staff platform-suppression list filters and searches by, read by
 * BOTH the card that renders the panel and `/api/admin/emails/suppressions`,
 * which serves every clause on its query (AGL-3321).
 *
 * The list is `suppressedAt` DESC with a cursor into that order, so the
 * order is not the filter's to change. Beneath it Firestore answers
 * equalities, one `array-contains`, and a range over `suppressedAt` itself —
 * which is every shape declared here. Each composite those need is in
 * `cloud/firebase-firestore.indexes.json`, pinned by
 * `email-suppression-filters.spec.ts`.
 *
 * How many stand at once:
 *
 *   - Status and Last reported stand beside anything.
 *   - Reason, Learned from and Site ID are one at a time: a clause on one
 *     replaces a clause on another. Every pair would need an index of its
 *     own, and a pair nobody indexed fails the read rather than narrowing it.
 *   - The search stands beside Last reported only. With a search in force
 *     the card sets the other clauses aside and says so, and the route
 *     refuses a request that carries both.
 *
 * Status reads `released`, the boolean the writers stamp beside
 * `releasedAt`: "released" read from the timestamp would be `!= null`, an
 * inequality Firestore makes the first sort.
 */
export const SUPPRESSION_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'status',
    kind: 'boolean',
    path: 'released',
    // Offered as a select of two named states rather than MUI's tri-state
    // boolean; the route reads `'true'`/`'false'` either way.
    operators: ['equals'],
  },
  { column: 'reason', kind: 'exact', path: 'reason', operators: ['equals', 'isAnyOf'] },
  { column: 'context', kind: 'exact', path: 'context', operators: ['equals'] },
  { column: 'hostId', kind: 'exact', path: 'hostId', operators: ['equals'] },
  {
    // The sort field, so a range over it needs no index of its own. `is` (a
    // day) is absent: it would bound the query with `startAt`/`endAt`, which
    // the page cursor replaces.
    column: 'suppressedAt',
    kind: 'date',
    path: 'suppressedAt',
    operators: ['after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/**
 * The toolbar's search, as the field the route matches it through: a word
 * prefix of the address, held in `emailTokens` (`emailSearchTokens`).
 */
export const SUPPRESSION_SEARCH_FIELD: ListFilterField = {
  column: 'email',
  kind: 'text',
  path: 'email',
  tokensPath: 'emailTokens',
  operators: ['contains'],
}

/** Fields whose clauses stand beside any other. */
export const SUPPRESSION_ALONGSIDE_FIELDS: readonly string[] = ['status', 'suppressedAt']

/** Fields of which one clause at a time is served. */
export const SUPPRESSION_SINGLE_FIELDS: readonly string[] = ['reason', 'context', 'hostId']

export const SUPPRESSION_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  reason: 'Reason',
  context: 'Learned from',
  hostId: 'Site ID',
  suppressedAt: 'Last reported',
}

/**
 * What each stored reason reads as. The keys are the platform reasons
 * `suppressEmail` accepts (`PLATFORM_SUPPRESSION_REASONS`); the spec holds the
 * two lists together.
 */
export const SUPPRESSION_REASON_LABELS: Readonly<
  Record<string, { label: string; color: 'default' | 'warning' | 'error' }>
> = {
  bounce: { label: 'Bounced', color: 'warning' },
  complaint: { label: 'Marked as spam', color: 'error' },
  staff: { label: 'Recorded by staff', color: 'default' },
}

export const SUPPRESSION_FILTER_OPTIONS: Readonly<
  Record<string, readonly ListFilterOption[]>
> = {
  status: [
    { value: 'false', label: 'Active' },
    { value: 'true', label: 'Released' },
  ],
  reason: Object.entries(SUPPRESSION_REASON_LABELS).map(([value, { label }]) => ({
    value,
    label,
  })),
}

/** The fields the panel shows as a select. */
export const SUPPRESSION_SELECT_FIELDS: readonly string[] = Object.keys(
  SUPPRESSION_FILTER_OPTIONS,
)

/** Whether a clause stands beside the one-at-a-time clause in force. */
export const suppressionClauseStandsAlongside = (clause: ListFilterClause): boolean =>
  SUPPRESSION_ALONGSIDE_FIELDS.includes(clause.field)
