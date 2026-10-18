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

import type { PluginSearchSource } from '@aglyn/aglyn/plugin-manager/plugin-search-sources'
import { ORDER_LIST_QUERY } from '../constants/orders-list-query'
import { formatOrderNumber } from './commerce-orders'
import { orderRecordHref } from './commerce-record-routes'
import { COMMERCE_SEARCH_SOURCES } from './commerce-search-sources'

/**
 * What the native apps' one box finds in a store (AGL-3943): the products
 * the console's palette finds, and the site's ORDERS, which the palette does
 * not search.
 *
 * An order is found the way the Orders list finds it: the typed word on the
 * list's own query (`ORDER_LIST_QUERY.search`, the `searchTokens` every
 * writer stamps), newest first, on the composite the list already uses. Only
 * a member who may read the site's orders (admin or editor, the rules'
 * `canReadHostSensitive`) is offered the group, and each row opens that
 * order's dialog over the Orders list.
 */
export const COMMERCE_SERVER_SEARCH_SOURCES: readonly PluginSearchSource[] = [
  ...COMMERCE_SEARCH_SOURCES,
  {
    id: 'orders',
    group: 'Orders',
    noun: 'orders',
    scope: 'host',
    collection: 'orders',
    nameField: 'number',
    fallbackNameField: 'customerEmail',
    extraFields: ['customerEmail'],
    featureFlag: 'commerce',
    hostAccess: 'sensitive',
    listQuery: ORDER_LIST_QUERY,
    // Beside the people (40s): an order is looked up as often as a contact.
    order: 50,
    label: (row) =>
      formatOrderNumber(
        { number: typeof row['number'] === 'number' ? row['number'] : undefined } as never,
        typeof row['$id'] === 'string' ? row['$id'] : undefined,
      ),
    detail: (row) =>
      typeof row['customerEmail'] === 'string' && row['customerEmail'] ? row['customerEmail'] : null,
    href: (row, context) =>
      orderRecordHref(context, typeof row['$id'] === 'string' ? row['$id'] : ''),
  },
]
