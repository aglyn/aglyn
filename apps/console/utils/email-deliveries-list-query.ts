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
  ListQueryDeclaration,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE STAFF EMAILS SENT TABLE'S ORDERS (AGL-3680).
 *
 * `/api/admin/email-deliveries` reads the `messages` collection group under
 * `emailDeliveries/{key}` for one site (`hostId ==`) or an organization's
 * sites (`hostId in`), newest first. Every header orders that query by the
 * field it shows — Sent (`firstSeenAtMs`) either way, To, Status, Subject,
 * and Opens · clicks by `openCount` — each with its own collection-group
 * `(hostId, field)` composite, pinned by
 * `specs/email-deliveries-list-query.spec.ts`. The list has no filters, so
 * nothing else narrows it and no other composite is needed.
 *
 * Every writer stamps them on the message it creates (`email-delivery-log.ts`:
 * `subject` null until an event brings one, `openCount`/`clickCount` 0), and
 * `tools/scripts/backfill-staff-list-sort-fields.mjs` stamps the messages
 * written before, since an `orderBy` drops a document that lacks its field.
 * The Site column on an organization's card is a site NAME, joined from the
 * organization, so it sorts the page.
 */

/** Newest first: the default order, and the one the cursor walk began with. */
export const EMAIL_DELIVERIES_SORT: ListQuerySort = {
  path: 'firstSeenAtMs',
  direction: 'desc',
  column: 'firstSeenAtMs',
  label: 'Sent',
}

const both = (path: string, column: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

export const EMAIL_DELIVERIES_COLUMN_SORTS: readonly ListQuerySort[] = [
  EMAIL_DELIVERIES_SORT,
  { path: 'firstSeenAtMs', direction: 'asc', column: 'firstSeenAtMs', label: 'Sent', alone: true },
  ...both('to', 'to', 'To'),
  ...both('status', 'status', 'Status'),
  ...both('subject', 'subject', 'Subject'),
  ...both('openCount', 'engagement', 'Opens'),
]

/** The table's query: no filters, every header order beneath the site scope. */
export const EMAIL_DELIVERIES_LIST_QUERY: ListQueryDeclaration = {
  fields: [],
  sorts: EMAIL_DELIVERIES_COLUMN_SORTS,
}

/** The order a request asks for, when the table offers it; the default otherwise. */
export function emailDeliveriesSort(asked: ListQuerySort | null): ListQuerySort {
  return (
    (asked &&
      EMAIL_DELIVERIES_COLUMN_SORTS.find(
        (sort) => sort.path === asked.path && sort.direction === asked.direction,
      )) ||
    EMAIL_DELIVERIES_SORT
  )
}
