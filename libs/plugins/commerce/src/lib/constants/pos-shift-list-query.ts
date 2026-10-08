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
 * One register's shift history (`hosts/{hostId}/registers/{registerId}/shifts`),
 * newest first, and every header it sorts by (AGL-3680).
 *
 * The history has no filters, so each header order is a single-field
 * `orderBy` on the subcollection: no composite at all. An `orderBy` drops
 * every shift that LACKS the field, so the shift writer (`server/pos-shift.ts`)
 * stamps each of them at open — `null` until the close fills it — and the
 * close flattens the Z report's net sales onto the shift as `netSalesCents`,
 * since a query cannot order by a field inside `report`.
 * `tools/scripts/backfill-pos-shift-list-fields.mjs` stamps the shifts
 * written before. "By" is a name picked from two fields, so it sorts the page
 * on screen.
 */

/** The history's header orders, newest first FIRST. */
export const POS_SHIFT_COLUMN_SORTS: readonly ListQuerySort[] = [
  { path: 'openedAtMs', direction: 'desc', column: 'openedAtMs', label: 'Opened' },
  { path: 'openedAtMs', direction: 'asc', column: 'openedAtMs', label: 'Opened' },
  { path: 'closedAtMs', direction: 'desc', column: 'closedAtMs', label: 'Closed' },
  { path: 'closedAtMs', direction: 'asc', column: 'closedAtMs', label: 'Closed' },
  { path: 'netSalesCents', direction: 'desc', column: 'netSales', label: 'Net sales' },
  { path: 'netSalesCents', direction: 'asc', column: 'netSales', label: 'Net sales' },
  { path: 'expectedCashCents', direction: 'desc', column: 'expectedCashCents', label: 'Expected' },
  { path: 'expectedCashCents', direction: 'asc', column: 'expectedCashCents', label: 'Expected' },
  { path: 'countedCashCents', direction: 'desc', column: 'countedCashCents', label: 'Counted' },
  { path: 'countedCashCents', direction: 'asc', column: 'countedCashCents', label: 'Counted' },
  { path: 'varianceCents', direction: 'desc', column: 'varianceCents', label: 'Variance' },
  { path: 'varianceCents', direction: 'asc', column: 'varianceCents', label: 'Variance' },
]

/** The fields a shift carries from the moment it opens, so every order reaches it. */
export const POS_SHIFT_SORTED_FIELDS = [
  'closedAtMs',
  'netSalesCents',
  'expectedCashCents',
  'countedCashCents',
  'varianceCents',
] as const

export const POS_SHIFT_LIST_QUERY: ListQueryDeclaration = {
  fields: [],
  sorts: POS_SHIFT_COLUMN_SORTS,
}
