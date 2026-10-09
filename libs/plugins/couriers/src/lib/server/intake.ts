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

import { courierStateIsFinal } from '../model/couriers'
import type { CourierStore } from './store'

/**
 * The seller's order events, as couriers hear them (AGL-3695). The event
 * outbox drains in the tenant, which holds no courier keys, so these only
 * MARK the run: the console job calls the courier off on its next tick.
 *
 * - `order.cancelled` — the goods are not going: call the courier off.
 * - `order.refunded` in full — the same. A refund of some lines leaves the
 *   rest to deliver, so it changes nothing.
 */

export interface OrderEnvelope<Extra = Record<string, never>> {
  id: string
  hostId: string
  orgId: string | null
  occurredAtMs: number
  payload: { order: { id: string } } & Extra
}

export interface IntakeDeps {
  store: CourierStore
  now(): number
}

/** Marks the order's open run for calling off, and drops any quote. Idempotent. */
export async function requestCourierCancel(
  deps: IntakeDeps,
  hostId: string,
  orderId: string,
  reason: string,
): Promise<'requested' | 'nothing'> {
  return deps.store.updateDelivery(hostId, orderId, (current) => {
    if (!current) return { result: 'nothing' as const }
    const run = current.run
    const open = run && !courierStateIsFinal(run.state)
    if (!open && !current.quote) return { result: 'nothing' as const }
    if (open && run.cancelRequested && !current.quote) return { result: 'requested' as const }
    return {
      next: {
        ...current,
        quote: null,
        ...(open
          ? {
              run: { ...run, cancelRequested: true, cancelReason: reason, updatedAtMs: deps.now() },
              open: true,
              // Due now: the job's next tick calls it off.
              nextCheckAtMs: 0,
            }
          : {}),
        updatedAtMs: deps.now(),
      },
      result: open ? ('requested' as const) : ('nothing' as const),
    }
  })
}

export async function onOrderCancelled(deps: IntakeDeps, envelope: OrderEnvelope): Promise<void> {
  const orderId = envelope.payload?.order?.id
  if (orderId && envelope.hostId) await requestCourierCancel(deps, envelope.hostId, String(orderId), 'The order was canceled')
}

export async function onOrderRefunded(
  deps: IntakeDeps,
  envelope: OrderEnvelope<{ refund?: { full?: boolean } }>,
): Promise<void> {
  const orderId = envelope.payload?.order?.id
  if (!orderId || !envelope.hostId || envelope.payload.refund?.full !== true) return
  await requestCourierCancel(deps, envelope.hostId, String(orderId), 'The order was refunded')
}
