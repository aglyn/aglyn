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
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { InventoryAdjustmentReason } from '../model/commerce'

/*
 * What the stock movements ledger filters by, and how its query serves it
 * (AGL-3321).
 *
 * Every field is one every writer of `hosts/{hostId}/inventoryAdjustments`
 * already stores — the "Adjust stock" dialog, the sale path
 * (`decrementVariantStock`) and the cancellation restock — so nothing new is
 * written and nothing needs a backfill. Each is an EQUALITY beneath the
 * ledger's one order, `atMs` newest first, which is one `(field, atMs DESC)`
 * composite per field under index merging; the date filter is a range on
 * `atMs` itself, the order the ledger is already in, so it costs nothing.
 *
 * Order and location are typed or picked ids, matched whole. A sparse field
 * answers `equals` exactly — a row with no order is simply not that order —
 * and offers no "is set", which would be an inequality on a second field.
 *
 * No quick search. The ledger's rows name a product by id; the name a reader
 * would type lives on the product, so a search could only ever match the
 * names of the rows already loaded. Product is a picked filter instead, and
 * the ids the old search read (order, location) are filters of their own.
 */
export const STOCK_MOVEMENT_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'productId', kind: 'exact', path: 'productId', operators: ['equals', 'isAnyOf'] },
  { column: 'reason', kind: 'exact', path: 'reason', operators: ['equals', 'isAnyOf'] },
  { column: 'atMs', kind: 'date', path: 'atMs', storedAs: 'millis', presence: 'always' },
  { column: 'orderId', kind: 'exact', path: 'orderId', operators: ['equals'] },
  { column: 'locationId', kind: 'exact', path: 'locationId', operators: ['equals'] },
]

/** The ledger's one order: newest first, the order every writer stamps. */
export const STOCK_MOVEMENT_QUERY: ListQueryDeclaration = {
  fields: STOCK_MOVEMENT_FILTER_FIELDS,
  sorts: [{ path: 'atMs', direction: 'desc', column: 'atMs' }],
}

export const STOCK_MOVEMENT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  productId: 'Product',
  reason: 'Reason',
  atMs: 'When',
  orderId: 'Order',
  locationId: 'Location',
}

/** The fields picked from choices rather than typed. */
export const STOCK_MOVEMENT_SELECT_FIELDS: readonly string[] = ['productId', 'reason', 'locationId']

/** The stored key is a closed set; these are what a merchant reads. */
export const STOCK_MOVEMENT_REASON_LABEL: Readonly<Record<InventoryAdjustmentReason, string>> = {
  sale: 'Sale',
  refund: 'Refund return',
  restock: 'Restock',
  correction: 'Correction',
  damage: 'Damaged',
  cancellation: 'Order canceled',
  sync: 'Count synced',
}
