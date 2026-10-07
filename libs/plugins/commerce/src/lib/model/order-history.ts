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

import { definePluginServiceContract } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { OrderEventOrder } from './order-events'

/**
 * A site's order HISTORY, for another plugin (AGL-3614).
 *
 * The order events (`order-events.ts`) bring every order from the moment a
 * subscriber listens. A plugin that must also read the orders BEFORE that —
 * accounting, posting a merchant's earlier sales from a start date — reads
 * them through this service, in the same public shape the events carry, and
 * never through commerce's storage. Commerce registers the one
 * implementation from its console server declarations; a reader in another
 * plugin restates this contract under the same id, as an event subscriber
 * restates an event.
 */

/** One stored order, as the history hands it out. */
export interface OrderHistoryEntry {
  id: string
  createdAtMs: number
  /** When it was paid; `null` for one never paid. */
  paidAtMs: number | null
  /** The newest refund on its timeline, or `null`. */
  lastRefundAtMs: number | null
  /** Whether its prices include the tax. */
  taxInclusive: boolean
  /** The tax rate it was charged under, when one was named. */
  taxRateId: string | null
  /** The order in the public API's shape. */
  order: OrderEventOrder
}

export interface OrderHistoryPageRequest {
  hostId: string
  /** Orders created at or after this… */
  fromMs: number
  /** …and before this. */
  untilMs: number
  /** At most this many, oldest first; capped at 200. */
  limit: number
}

export interface OrderHistoryReader {
  listOrders(request: OrderHistoryPageRequest): Promise<OrderHistoryEntry[]>
}

export const ORDER_HISTORY_CONTRACT_ID = 'commerce.orderHistory'

export const ORDER_HISTORY_CONTRACT = definePluginServiceContract<OrderHistoryReader>(ORDER_HISTORY_CONTRACT_ID, {
  multiple: false,
})
