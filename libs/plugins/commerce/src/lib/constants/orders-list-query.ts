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
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  type OrderChannel,
  type OrderStatus,
} from '../model/commerce-orders'

/*
 * THE ORDERS LIST, ON ITS QUERY (AGL-3321).
 *
 * `hosts/{hostId}/orders`, newest first. Every filter the grid's panel offers
 * and the quick search's word is a predicate on the ONE Firestore query that
 * pages the list (`planListQuery` through `useListQuery`), over the fields
 * every writer stamps with `orderListFields` — so page two of a filtered list
 * is page two of the matches, not page two of the store narrowed afterwards.
 *
 * One order: `createdAtMs` descending, the field every writer stamps. Each
 * filterable field is then ONE `(field, createdAtMs DESC)` composite, and
 * index merging serves every combination of them; the date range is on that
 * same field, so it adds none. Eight composites in all, pinned by
 * `orders-list-query.spec.ts` against `cloud/firebase-firestore.indexes.json`.
 *
 * What one query cannot hold is refused by name above the grid
 * (`ListQueryNotices`, labelled by `listQueryRefusals` from these fields,
 * headers and options), never matched over the rows it returned: the search,
 * Customer `contains`, Order `contains` and Product each take the query's one
 * array clause, so two of them together keep the first and refuse the second.
 *
 * A second range (a total, say) would be a new `sorts` entry and one more
 * composite per filterable field beneath it — eight — plus the range field's
 * own order; nothing else here moves.
 */

/** The grid columns, each as the query reads it. */
export const ORDER_LIST_FIELDS: readonly ListFilterField[] = [
  {
    // The number as typed, `#1042` or `1042`, by word prefix.
    column: 'orderLabel',
    kind: 'text',
    path: 'number',
    tokensPath: 'orderLabelTokens',
    operators: ['contains'],
  },
  {
    // `is` a whole address; `contains` an address's piece or its domain.
    column: 'customerEmail',
    kind: 'text',
    path: 'customerEmail',
    lowerPath: 'customerEmailLower',
    tokensPath: 'customerEmailTokens',
    operators: ['contains', 'equals'],
  },
  {
    column: 'channelKey',
    kind: 'exact',
    path: 'channel',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'statusKey',
    kind: 'exact',
    path: 'status',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'createdAtMs',
    kind: 'date',
    path: 'createdAtMs',
    storedAs: 'millis',
    presence: 'always',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
  {
    // Every product in the order, matched whole — ids keep their case.
    column: 'productIds',
    kind: 'exact',
    path: 'productIds',
    tokensPath: 'productIds',
    verbatimTokens: true,
    operators: ['isAnyOf'],
  },
  {
    column: 'disputeKey',
    kind: 'exact',
    path: 'disputeKey',
    operators: ['equals', 'isAnyOf'],
  },
]

/** The list's query: its fields, its one order and its search. */
export const ORDER_LIST_QUERY: ListQueryDeclaration = {
  fields: ORDER_LIST_FIELDS,
  sorts: [{ path: 'createdAtMs', direction: 'desc', column: 'createdAtMs' }],
  search: { tokensPath: 'searchTokens' },
}

export const ORDER_LIST_HEADERS: Readonly<Record<string, string>> = {
  orderLabel: 'Order',
  customerEmail: 'Customer',
  channelKey: 'Channel',
  statusKey: 'Status',
  createdAtMs: 'Date',
  productIds: 'Product',
  disputeKey: 'Disputes',
}

/** The fields picked from choices, which the panel shows as a select. */
export const ORDER_LIST_SELECT_FIELDS: readonly string[] = [
  'channelKey',
  'statusKey',
  'productIds',
  'disputeKey',
]

export const ORDER_STATUS_OPTIONS: readonly ListFilterOption[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] }))

export const ORDER_CHANNEL_OPTIONS: readonly ListFilterOption[] = (
  Object.keys(ORDER_CHANNEL_LABELS) as OrderChannel[]
).map((channel) => ({ value: channel, label: ORDER_CHANNEL_LABELS[channel] }))

/*
 * The dispute badge's tones (`orderDisputeKey`), labelled as the badge
 * labels them. `lost` is the tone, not the raw dispute status: a dispute
 * that was WON also closes with money untouched, and listing it as charged
 * back would tell a merchant they lost a case they won.
 */
export const ORDER_DISPUTE_OPTIONS: readonly ListFilterOption[] = [
  { value: 'open', label: 'Open dispute' },
  { value: 'lost', label: 'Charged back' },
  { value: 'won', label: 'Dispute won' },
  { value: 'settled', label: 'Dispute closed' },
]

/** The clause the open-dispute banner's "Show them" sets. */
export const OPEN_DISPUTE_CLAUSE: ListFilterClause = {
  field: 'disputeKey',
  op: 'equals',
  value: 'open',
}

/**
 * The Customer clause the CRM's link seeds from `?email=` (AGL-2622).
 *
 * A whole address is `is`, served by the lower-cased key, so it finds that
 * buyer and no one whose address merely begins the same way. Anything else —
 * a domain, `@acme.com`, a name — is `contains`, a word prefix of the
 * address, so a domain finds every buyer at a company.
 */
export function ordersCustomerClause(raw: string): ListFilterClause | null {
  const value = raw.trim().replace(/^@+/, '')
  if (!value) return null
  const at = value.indexOf('@')
  return at > 0 && at < value.length - 1
    ? { field: 'customerEmail', op: 'equals', value }
    : { field: 'customerEmail', op: 'contains', value }
}
