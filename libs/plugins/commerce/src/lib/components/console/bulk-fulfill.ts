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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/**
 * Mark several orders fulfilled at once, from the orders list (AGL-3611).
 *
 * One request per order through the same `fulfill-order` route the dialog
 * uses, one after another, so each order gets its own transition check and
 * its own answer: a refunded order in the selection is refused on its own and
 * the rest still ship. Each carries a key derived from this batch and the
 * order, so running the same batch again after a lost response writes
 * nothing twice.
 */

export interface BulkFulfillResult {
  fulfilled: number
  already: number
  refused: Array<{ orderId: string; error: string }>
  /** Orders whose answer never came back: it is not known whether they shipped. */
  unknown: string[]
}

/** The statuses a fulfil can move; the rest are skipped without a request. */
export const BULK_FULFILLABLE_STATUSES: readonly string[] = ['paid', 'partially_fulfilled']

export async function bulkFulfillOrders(
  user: unknown,
  hostId: string,
  orders: ReadonlyArray<{ $id: string; status?: string }>,
  batchKey: string,
): Promise<BulkFulfillResult> {
  const result: BulkFulfillResult = { fulfilled: 0, already: 0, refused: [], unknown: [] }
  for (const order of orders) {
    if (!BULK_FULFILLABLE_STATUSES.includes(String(order.status ?? ''))) {
      result.refused.push({
        orderId: order.$id,
        error: `Orders in "${order.status ?? 'unknown'}" cannot be fulfilled`,
      })
      continue
    }
    let response: Response
    try {
      response = await authorizedFetch(user as never, '/api/commerce/fulfill-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${batchKey}:${order.$id}`,
        },
        body: JSON.stringify({ hostId, orderId: order.$id, to: 'fulfilled' }),
      })
    } catch {
      result.unknown.push(order.$id)
      continue
    }
    const payload: { already?: boolean; error?: string } = await response.json().catch(() => ({}))
    if (response.ok) {
      if (payload.already) result.already += 1
      else result.fulfilled += 1
    } else if (response.status < 500 && payload.error) {
      result.refused.push({ orderId: order.$id, error: payload.error })
    } else {
      result.unknown.push(order.$id)
    }
  }
  return result
}

/** One line for the snackbar: what happened, then what did not. */
export function describeBulkFulfill(result: BulkFulfillResult): string {
  const parts: string[] = []
  const done = result.fulfilled + result.already
  if (done) parts.push(`${done} ${done === 1 ? 'order' : 'orders'} fulfilled`)
  if (result.refused.length) {
    parts.push(`${result.refused.length} skipped (${result.refused[0].error.toLowerCase()}${result.refused.length > 1 ? ', …' : ''})`)
  }
  if (result.unknown.length) {
    parts.push(
      `${result.unknown.length} not confirmed — reopen ${result.unknown.length === 1 ? 'it' : 'them'} to check; running it again is safe`,
    )
  }
  return parts.join('; ') || 'Nothing to fulfill'
}
