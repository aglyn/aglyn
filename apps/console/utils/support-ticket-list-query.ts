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
 * THE STAFF SUPPORT QUEUE'S QUERY (AGL-3321).
 *
 * Read by BOTH `/admin/support` and `/api/support/tickets` (its staff
 * `view=queue` branch), which plans the Status clause onto one Firestore
 * query over `supportTickets` — newest update first — and pages it by a
 * cursor in that order. The page never narrows the tickets it is handed.
 *
 * Status is an equality merged with the order through the
 * `(status, updatedAt DESC)` composite, pinned by
 * `specs/support-ticket-list-query.spec.ts`. The open count in the card's
 * header is its own count query, so it is the whole queue's.
 *
 * No search box: a ticket's subject is the customer's text and no writer
 * stamps a search token for it, so the queue offers none rather than one
 * that matched the page on screen.
 */

/** The collection the queue reads. */
export const SUPPORT_TICKETS_COLLECTION = 'supportTickets'

/** Newest update first: the ticket a customer just answered leads. */
export const SUPPORT_TICKET_LIST_SORT: ListQuerySort = {
  path: 'updatedAt',
  direction: 'desc',
}

export const SUPPORT_TICKET_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'status',
    kind: 'exact',
    path: 'status',
    presence: 'always',
    operators: ['equals'],
  },
]

export const SUPPORT_TICKET_LIST_QUERY: ListQueryDeclaration = {
  fields: SUPPORT_TICKET_FILTER_FIELDS,
  sorts: [SUPPORT_TICKET_LIST_SORT],
}

export const SUPPORT_TICKET_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
}

export const SUPPORT_TICKET_FILTER_OPTIONS: Readonly<
  Record<string, readonly ListFilterOption[]>
> = {
  status: [
    { value: 'open', label: 'open' },
    { value: 'closed', label: 'closed' },
  ],
}
