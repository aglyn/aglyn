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

import { emailSearchTokens } from '@aglyn/aglyn/app-utils/email-search'
import {
  nameSearchKey,
  nameSearchTokens,
} from '@aglyn/aglyn/app-utils/name-search'
import { describeOrderDispute, type OrderDisputeTone } from './commerce-dispute'
import { orderSyncFields } from './order-shipping-export'
import {
  formatOrderNumber,
  type HostOrder,
  type OrderChannel,
  type OrderDispute,
  type OrderStatus,
} from './commerce-orders'

/*
 * WHAT THE ORDERS LIST ASKS ITS QUERY, WRITTEN ON THE ORDER (AGL-3321).
 *
 * The orders list puts every filter and its search on the Firestore query,
 * and a query can only ask about a field a document stores. The list used to
 * derive five of its columns in the browser — a legacy order's status and
 * channel, the products in a cart, the dispute badge, the order number — and
 * match them over the two hundred rows it had read, which answered "none"
 * for an order on the next page.
 *
 * So every writer of `hosts/{hostId}/orders` spreads `orderListFields` over
 * the document it writes, computed from the whole document as it will stand:
 * the creators (cart, buy-now, subscription renewal, POS, draft) and every
 * write that moves an input — the dispute record, the address a paid draft
 * learns. A write that moves none of them (a status flip, a fulfillment, a
 * refund, a timeline note) moves none of these either: `status` is its own
 * field and is what the Status filter reads.
 *
 * `tools/scripts/backfill-orders-list-fields.mjs` restates this for the
 * orders written before it; the two answer the same worked examples,
 * `tools/scripts/lib/order-list-fields.fixtures.json`.
 */

/** Tokens past this many are dropped from the quick search's array. */
export const ORDER_SEARCH_TOKEN_LIMIT = 200

/** The fields the orders list's query reads, as every writer stamps them. */
export interface OrderListFields {
  /**
   * Always present. A Commerce Starter order (AGL-90) carried none and was
   * read as `paid` (`liftLegacyOrder`); the lift is written down so the
   * Status filter finds it.
   */
  status: OrderStatus
  /** Always present; absent was always read as `online`. */
  channel: OrderChannel
  /**
   * Every product the order holds, line items first and the legacy flat
   * `productId` after — the Product filter's `array-contains-any`.
   */
  productIds: string[]
  /**
   * The dispute badge's tone (`describeOrderDispute`), or null with no
   * dispute. `open` is a case with a deadline; `lost` a chargeback; `won` and
   * `settled` closed with no money reversed. What the Disputes filter and the
   * open-dispute banner ask.
   */
  disputeKey: OrderDisputeTone | null
  /**
   * The order number, or null on an order that has none (POS, draft and
   * channel orders are unnumbered) — the Order header's sort (AGL-3680),
   * which an absent field would drop the order from.
   */
  number: number | null
  /**
   * The buyer's address, lower-cased — the Customer filter's `equals` and the
   * Customer header's sort; null with no address, never absent.
   */
  customerEmailLower: string | null
  /** The address's search prefixes (`emailSearchTokens`) — its `contains`. */
  customerEmailTokens: string[]
  /** The order number's prefixes, with and without its `#` — Order `contains`. */
  orderLabelTokens: string[]
  /**
   * The quick search: the order number's, the buyer's address's and every
   * line item name's word prefixes, capped at {@link ORDER_SEARCH_TOKEN_LIMIT}
   * with the item names cut first.
   */
  searchTokens: string[]
}

/** The dispute badge's tone, stored — see {@link OrderListFields.disputeKey}. */
export function orderDisputeKey(
  dispute: OrderDispute | null | undefined,
): OrderDisputeTone | null {
  if (!dispute || typeof dispute !== 'object') return null
  return describeOrderDispute({ dispute })?.tone ?? null
}

/**
 * The order number's prefixes, as `#1042` and as `1042`, so a reader who
 * types either finds it. An order with no number is labelled by its document
 * id (`formatOrderNumber`), and is found by that label the same way.
 */
export function orderLabelTokens(
  order: Pick<Partial<HostOrder>, 'number'>,
  docId: string,
): string[] {
  const label = nameSearchKey(formatOrderNumber({ number: order.number }, docId))
  const bare = label.replace(/^#+/, '')
  return nameSearchTokens(bare && bare !== label ? `${label} ${bare}` : label)
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/**
 * The fields the orders list's query reads, from an order as it will be
 * stored — see {@link OrderListFields}. Pure: the same answer on the server,
 * in a spec and (restated) in the backfill.
 *
 * `legacyProductName` names the product of a Commerce Starter order, which
 * stored an id and no line items; only the backfill has it to give.
 */
export function orderListFields(
  order: object,
  docId: string,
  options: { legacyProductName?: string } = {},
): OrderListFields {
  const source = order as Partial<HostOrder> & Record<string, unknown>
  const lineItems = Array.isArray(source.lineItems) ? source.lineItems : []
  const productIds = [
    ...new Set(
      [...lineItems.map((line) => line?.productId), source.productId].filter(
        (id): id is string => typeof id === 'string' && id !== '',
      ),
    ),
  ]
  const email = text(source.customerEmail)
  const emailTokens = emailSearchTokens(email)
  const labelTokens = orderLabelTokens(source, docId)
  const names = lineItems.map((line) => text(line?.name)).filter(Boolean)
  if (!names.length && options.legacyProductName) {
    names.push(options.legacyProductName)
  }
  const searchTokens = [
    ...new Set([
      ...labelTokens,
      ...emailTokens,
      ...names.flatMap((name) => nameSearchTokens(name)),
    ]),
  ].slice(0, ORDER_SEARCH_TOKEN_LIMIT)
  return {
    status: (text(source.status) || 'paid') as OrderStatus,
    channel: (text(source.channel) || 'online') as OrderChannel,
    productIds,
    disputeKey: orderDisputeKey(source.dispute),
    number:
      typeof source.number === 'number' && Number.isFinite(source.number)
        ? source.number
        : null,
    customerEmailLower: nameSearchKey(email) || null,
    customerEmailTokens: emailTokens,
    orderLabelTokens: labelTokens,
    searchTokens,
  }
}

/**
 * An order document with its list fields spread over it — what a creator
 * writes. The document's own `status` and `channel` win where it names them,
 * which every creator does; the rest is derived from it.
 *
 * A creator also stamps whether the order ships and when it last changed
 * (`orderSyncFields`, AGL-3613): the query the shipping export and the
 * ShipStation feed ask. Those stay OFF `orderListFields`, which the orders
 * backfill restates field for field — they are not list columns.
 */
export function withOrderListFields<T extends object>(
  docId: string,
  doc: T,
): T & OrderListFields & { requiresShipping: boolean; updatedAtMs?: number } {
  return { ...doc, ...orderListFields(doc, docId), ...orderSyncFields(doc) }
}
