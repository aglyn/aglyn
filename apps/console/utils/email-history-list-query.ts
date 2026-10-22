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
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * ONE ACCOUNT'S EMAIL DELIVERY, ON ITS QUERY (AGL-3321).
 *
 * The staff account page's Email delivery table reads
 * `emailDeliveries/{addressKey}/messages` for every address the account
 * holds, newest first (`/api/admin/users/email-history`). Every clause and the
 * search word go onto each address's query, the same plan on each, and the
 * answers merge by date — nothing is matched over the rows a read fetched.
 *
 *   Message   contains a word, on the `searchTokens` every writer stamps
 *             (`emailDeliverySearchTokens`), as the search does — so the two
 *             cannot both apply, and the plan says so
 *   Sender    the send's tag, exactly (`invite`, `campaign`)
 *   Status    the furthest state the message reached
 *   Opens,    counts, compared for equality (`= 0` is "never opened"); a
 *   Clicks    range would reorder the list by the count
 *   Sent      the one range, over the order itself (`firstSeenAtMs`)
 *
 * Each equality and the tokens merge with the order through their own
 * `(field, firstSeenAtMs DESC)` composite, pinned by
 * `specs/email-history-list-query.spec.ts`.
 */

/** The default order the table keeps, and pages by. */
export const EMAIL_HISTORY_SORT: ListQuerySort = {
  path: 'firstSeenAtMs',
  direction: 'desc',
  column: 'sentAtMs',
  label: 'Sent',
}

/*
 * ## The header sorts (AGL-3680)
 *
 * Every header orders each address's query by the field it shows, and the
 * route merges the addresses' pages in that same order
 * (`readUserEmailHistoryPage`) — the per-address cursor is a document, so it
 * resumes in whichever order is on. Sent newest first is the default and
 * full; the rest are `alone` — served with no filter or search on — so on
 * this subcollection none costs a composite. Every message writer stamps
 * `subject` (null until known), `openCount` and `clickCount` (0) when it
 * creates the message, and `tools/scripts/backfill-staff-list-sort-fields.mjs`
 * stamps the ones before; `status` and `firstSeenAtMs` are on every message.
 * Sender (`context`) is set only by the event feed, so the same backfill
 * stamps it null where an imported message has none.
 */
const historyAlone = (path: string, column: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

export const EMAIL_HISTORY_COLUMN_SORTS: readonly ListQuerySort[] = [
  EMAIL_HISTORY_SORT,
  { path: 'firstSeenAtMs', direction: 'asc', column: 'sentAtMs', label: 'Sent', alone: true },
  ...historyAlone('subject', 'subject', 'Message'),
  ...historyAlone('context', 'context', 'Sender'),
  ...historyAlone('status', 'status', 'Status'),
  ...historyAlone('openCount', 'openCount', 'Opens'),
  ...historyAlone('clickCount', 'clickCount', 'Clicks'),
]

/** The field every delivery writer stamps (`EMAIL_DELIVERY_SEARCH_FIELD`). */
const TOKENS = 'searchTokens'

export const EMAIL_HISTORY_FIELDS: readonly ListFilterField[] = [
  { column: 'subject', kind: 'text', path: 'subject', tokensPath: TOKENS, operators: ['contains'] },
  { column: 'context', kind: 'exact', path: 'context', operators: ['equals'] },
  { column: 'status', kind: 'exact', path: 'status', operators: ['equals', 'isAnyOf'] },
  { column: 'openCount', kind: 'number', path: 'openCount', operators: ['='] },
  { column: 'clickCount', kind: 'number', path: 'clickCount', operators: ['='] },
  {
    column: 'sentAtMs',
    kind: 'date',
    path: 'firstSeenAtMs',
    storedAs: 'millis',
    operators: ['after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

export const EMAIL_HISTORY_HEADERS: Readonly<Record<string, string>> = {
  subject: 'Message',
  context: 'Sender',
  status: 'Status',
  openCount: 'Opens',
  clickCount: 'Clicks',
  sentAtMs: 'Sent',
}

export const EMAIL_HISTORY_SELECT_FIELDS: readonly string[] = ['status']

export const EMAIL_HISTORY_QUERY: ListQueryDeclaration = {
  fields: EMAIL_HISTORY_FIELDS,
  sorts: EMAIL_HISTORY_COLUMN_SORTS,
  search: { tokensPath: TOKENS },
}

/**
 * Where the next page starts in each address's messages: the address key to
 * the id of the last message shown from it. An address absent from the map
 * starts at its newest.
 */
export type EmailHistoryCursor = Record<string, string>
