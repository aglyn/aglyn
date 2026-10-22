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
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE GATEWAY LEDGER TABLE ON STAFF → HEALTH (AGL-3328).
 *
 * The table reads the platform's `mailGatewayLedger` — one document per
 * sending domain × mail gateway, id `aglyn.com~barracuda` — through
 * `/api/admin/email-health/gateways?view=rows`. Every Filters clause lands on
 * that route's Firestore query (`runStaffListQuery`); nothing is matched over
 * rows already read.
 *
 * ## Ordered by the document id, so it needs no composite
 *
 * The id is `<sending domain>~<gateway>`, so its order groups a sending
 * domain's gateways together, which is how the table is read. An equality
 * on a field ordered by the id is served by that field's automatic index,
 * and several merge, so Gateway and Shared take no composite index at all.
 * The Sending domain filter is a prefix range on the id itself — the one
 * range, on the field that already leads the order.
 *
 * ## What is not a filter
 *
 * Held or clear is not stored: it is the last thirty days' refusals and
 * deliveries, read against today's date, so it changes with no write. The
 * route's summary read (`GET` without `view`) answers it instead — every
 * ledger with a refusal inside the window, which is the complete set any
 * hold can come from — and the page lists the held ones above the table.
 * The counts and the last refusal's date are figures to read, not to range
 * over: a range on either would displace the id order and need a composite
 * per equality beside it.
 */

/** The default order: by document id, which is by sending domain, then gateway. */
export const MAIL_GATEWAY_LEDGER_LIST_SORT: ListQuerySort = {
  path: LIST_QUERY_ID_PATH,
  direction: 'asc',
  column: 'sendingDomain',
  label: 'Sending domain',
}

/*
 * ## The header sorts (AGL-3680)
 *
 * Sending domain is the id order either way. Gateway, Shared sender, Last
 * refusal and Last diagnostic order the query by the stored field, `alone`
 * — served with no filter on — so on this top-level collection none costs a
 * composite. Each is on EVERY ledger, as an `orderBy` needs: the one writer,
 * `recordMailGatewayOutcome`, sets the whole of `applyMailGatewayOutcome`'s
 * shape every time — `lastBlockedAtMs` and `lastBlockedDetail` null until a
 * refusal, `shared` on every platform ledger — and has since the ledger was
 * introduced (AGL-3328), so no ledger predates a field. State, Refused and
 * Delivered are worked out from the last thirty days at read time, so they
 * sort the page on screen.
 */
const ledgerAlone = (path: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column: path, label, alone: true },
  { path, direction: 'desc', column: path, label, alone: true },
]

export const MAIL_GATEWAY_LEDGER_COLUMN_SORTS: readonly ListQuerySort[] = [
  MAIL_GATEWAY_LEDGER_LIST_SORT,
  {
    path: LIST_QUERY_ID_PATH,
    direction: 'desc',
    column: 'sendingDomain',
    label: 'Sending domain',
    alone: true,
  },
  ...ledgerAlone('gateway', 'Gateway'),
  ...ledgerAlone('shared', 'Shared sender'),
  ...ledgerAlone('lastBlockedAtMs', 'Last refusal'),
  ...ledgerAlone('lastBlockedDetail', 'Last diagnostic'),
]

/** What the ledger table filters by, every one on the query. */
export const MAIL_GATEWAY_LEDGER_FILTER_FIELDS: readonly ListFilterField[] = [
  // `aglyn.com` finds `aglyn.com~barracuda`, `aglyn.com~google`, …: the id
  // begins with the sending domain.
  { column: 'sendingDomain', kind: 'id', path: LIST_QUERY_ID_PATH, operators: ['startsWith'] },
  { column: 'gateway', kind: 'exact', path: 'gateway', presence: 'always', operators: ['equals', 'isAnyOf'] },
  // Written on every top-level ledger write, so `is false` is everyone else.
  { column: 'shared', kind: 'boolean', path: 'shared' },
]

export const MAIL_GATEWAY_LEDGER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  sendingDomain: 'Sending domain',
  gateway: 'Gateway',
  shared: 'Shared sender',
}

/** The ledger table's query. */
export const MAIL_GATEWAY_LEDGER_LIST_QUERY: ListQueryDeclaration = {
  fields: MAIL_GATEWAY_LEDGER_FILTER_FIELDS,
  sorts: MAIL_GATEWAY_LEDGER_COLUMN_SORTS,
}
