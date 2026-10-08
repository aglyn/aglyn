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
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE STAFF PLATFORM-SUPPRESSION LIST'S QUERY (AGL-3321).
 *
 * Read by BOTH the card that renders the Filters panel and
 * `/api/admin/emails/suppressions`, which plans every clause and the search
 * word onto one Firestore query (`runStaffListQuery`) and pages it by a
 * cursor in that query's own order. Nothing is matched over rows a read
 * already fetched.
 *
 * ## One order, merged indexes
 *
 * `suppressedAt` DESC — newest failure first — is the default order, and
 * the only range is over `suppressedAt` itself (Last reported). Each equality
 * (Status, Reason, Learned from, Site ID) and the search token merge with it
 * through their own `(field, suppressedAt DESC)` composite, so any
 * combination of them is one query with no index of its own; the spec pins
 * the five (`specs/email-suppression-list-query.spec.ts`).
 *
 * What one query cannot hold is refused by name and not applied: more than
 * thirty values at once. Reason "is any of" is an `in` on `reason`, not an
 * array clause, so it stands beside the search's `array-contains` on
 * `emailTokens` rather than competing with it.
 *
 * ## Status and the search are written fields
 *
 * Status reads `released`, the boolean every writer stamps beside
 * `releasedAt`: "released" read from the timestamp would be `!= null`, an
 * inequality that would have to lead the order. The search reads
 * `emailTokens` (`emailSearchTokens`), which `suppressEmail` stamps on every
 * write. `tools/scripts/backfill-email-suppression-filters.mjs` stamps both
 * on the records that predate them.
 */

/** The default order the list keeps, and pages by. */
export const SUPPRESSION_LIST_SORT: ListQuerySort = {
  path: 'suppressedAt',
  direction: 'desc',
  label: 'Last reported',
}

export const SUPPRESSION_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'status',
    kind: 'boolean',
    path: 'released',
    // Offered as a select of two named states rather than MUI's tri-state
    // boolean; the plan reads `'true'`/`'false'` either way.
    operators: ['equals'],
  },
  { column: 'reason', kind: 'exact', path: 'reason', operators: ['equals', 'isAnyOf'] },
  { column: 'context', kind: 'exact', path: 'context', operators: ['equals'] },
  { column: 'hostId', kind: 'exact', path: 'hostId', operators: ['equals'] },
  {
    // The sort field, so a range over it needs no index of its own.
    column: 'suppressedAt',
    kind: 'date',
    path: 'suppressedAt',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/*
 * ## The header sorts (AGL-3680)
 *
 * Last reported newest first stays the default and full order. Every header
 * orders the query by the field it shows, `alone` — served with no filter or
 * search on — so on this top-level collection none costs a composite:
 * Address (`email`), Reason, Learned from (`context`), Status (`released`)
 * and Since (`createdAt`, which `suppressEmail` stamps when it creates a
 * record). `tools/scripts/backfill-staff-list-sort-fields.mjs` stamps the
 * older records — `createdAt` from `suppressedAt`, the date the Since column
 * already falls back to, and `email`/`context` null where none was kept —
 * because an `orderBy` drops a document that lacks its field.
 */
const suppressionAlone = (path: string, column: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

export const SUPPRESSION_COLUMN_SORTS: readonly ListQuerySort[] = [
  SUPPRESSION_LIST_SORT,
  ...suppressionAlone('email', 'email', 'Address'),
  ...suppressionAlone('reason', 'reason', 'Reason'),
  ...suppressionAlone('context', 'context', 'Learned from'),
  ...suppressionAlone('released', 'status', 'Status'),
  ...suppressionAlone('createdAt', 'createdAt', 'Since'),
]

/** The list's query: every field above and a word prefix of the address. */
export const SUPPRESSION_LIST_QUERY: ListQueryDeclaration = {
  fields: SUPPRESSION_FILTER_FIELDS,
  sorts: SUPPRESSION_COLUMN_SORTS,
  search: { tokensPath: 'emailTokens' },
}

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
  no_mail_server: { label: 'No mail server', color: 'warning' },
  account_ban: { label: 'Banned account', color: 'error' },
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

/**
 * What the search box finds, said beside it while a search is in force —
 * the promise `emailSearchTokens` keeps.
 */
export const SUPPRESSION_SEARCH_HINT =
  'Search finds an address by the start of any part of it — the whole ' +
  'address, a word of the name before the @, or the domain — across the ' +
  'whole list.'
