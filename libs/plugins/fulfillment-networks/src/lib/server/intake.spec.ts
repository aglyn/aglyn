/**
 * @jest-environment node
 */
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

import { networkConnectionId, networkOrderId } from '../model/networks'
import { createMemoryNetworkStore } from '../testing/memory-store'
import { holdsFor, onOrderCancelled, onOrderPaid, onOrderRefunded, type OrderEnvelope } from './intake'
import { emptyConnection, type StoredRouting } from './store'

const HOST = 'host-1'

const envelope = (order: Partial<OrderEnvelope['payload']['order']> = {}, extra: Record<string, unknown> = {}): OrderEnvelope<any> => ({
  id: 'evt-1',
  hostId: HOST,
  orgId: 'org-1',
  occurredAtMs: 1,
  payload: {
    order: {
      id: 'order-1',
      number: 1042,
      status: 'paid',
      shippingAddress: { line1: '2 B St', country: 'US' },
      lineItems: [
        { name: 'Tee', variantLabel: 'S', sku: 'TEE-S', quantity: 2 },
        { name: 'E-book', quantity: 1 },
        { name: 'Mug', sku: 'MUG', quantity: 1 },
      ],
      ...order,
    },
    ...extra,
  },
})

async function setup(connection: Record<string, unknown> = {}) {
  const store = createMemoryNetworkStore()
  const deps = { store, now: () => 5_000 }
  await store.patchConnection(networkConnectionId(HOST, 'shipbob'), {
    ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'shipbob', sandbox: false, nowMs: 0 }),
    status: 'active',
    connectedAtMs: 1,
    ...connection,
  })
  return { store, deps, id: networkOrderId(HOST, 'order-1', 'shipbob') }
}

describe('a paid order (AGL-3634)', () => {
  it('is queued for a network that sends automatically, with the lines that carry a SKU as its first hold', async () => {
    const { store, deps, id } = await setup()
    await onOrderPaid(deps, envelope())
    const routing = store.routings.get(id) as StoredRouting
    expect(routing).toMatchObject({ status: 'queued', active: true, nextRunAtMs: 5_000, displayRef: '#1042', orgId: 'org-1' })
    expect(routing.lines).toEqual([
      { lineIndex: 0, sku: 'TEE-S', name: 'Tee — S', quantity: 2, shippedQuantity: 0 },
      { lineIndex: 2, sku: 'MUG', name: 'Mug', quantity: 1, shippedQuantity: 0 },
    ])
  })

  it('narrows the first hold to the SKUs a counted network holds', async () => {
    const { store, deps, id } = await setup({ stock: { MUG: 4 } })
    await onOrderPaid(deps, envelope())
    expect(store.routings.get(id)?.lines.map((line) => line.sku)).toEqual(['MUG'])
  })

  it('is queued once however often the event is delivered', async () => {
    const { store, deps, id } = await setup()
    await onOrderPaid(deps, envelope())
    await store.patchRouting(id, { status: 'accepted' })
    await onOrderPaid(deps, envelope())
    expect(store.routings.get(id)?.status).toBe('accepted')
  })

  it('is not queued without a shipping address, for a manual or paused network, or one never connected', async () => {
    for (const [connection, order] of [
      [{}, { shippingAddress: null }],
      [{ routing: 'manual' }, {}],
      [{ status: 'paused' }, {}],
      [{ connectedAtMs: null }, {}],
    ] as const) {
      const { store, deps } = await setup(connection as Record<string, unknown>)
      await onOrderPaid(deps, envelope(order as never))
      expect(store.routings.size).toBe(0)
    }
  })

  it('is still queued while the network needs connecting again, to go once it is', async () => {
    const { store, deps } = await setup({ status: 'reconnect' })
    await onOrderPaid(deps, envelope())
    expect(store.routings.size).toBe(1)
  })
})

describe('a canceled or refunded order (AGL-3634)', () => {
  async function held() {
    const ctx = await setup()
    await onOrderPaid(ctx.deps, envelope())
    await ctx.store.patchRouting(ctx.id, { status: 'accepted', active: true, nextRunAtMs: 99_999 })
    return ctx
  }

  it('flags what a network holds for cancellation, due now', async () => {
    const { store, deps, id } = await held()
    await onOrderCancelled(deps, envelope({ status: 'cancelled' }))
    expect(store.routings.get(id)).toMatchObject({ cancelRequested: true, active: true, nextRunAtMs: 5_000 })
  })

  it('cancels on a full refund, and only notes a partial one that covers held items', async () => {
    const partial = await held()
    await onOrderRefunded(partial.deps, envelope({}, { refund: { full: false, lineItemIds: [1] } }))
    expect(partial.store.routings.get(partial.id)).toMatchObject({ cancelRequested: false, note: null })
    await onOrderRefunded(partial.deps, envelope({}, { refund: { full: false, lineItemIds: [2] } }))
    expect(partial.store.routings.get(partial.id)).toMatchObject({ cancelRequested: false, note: expect.stringMatching(/may still ship/) })
    const full = await held()
    await onOrderRefunded(full.deps, envelope({}, { refund: { full: true, lineItemIds: [] } }))
    expect(full.store.routings.get(full.id)?.cancelRequested).toBe(true)
  })

  it('leaves a shipped hand-off alone', async () => {
    const { store, deps, id } = await held()
    await store.patchRouting(id, { status: 'shipped', active: false })
    await onOrderCancelled(deps, envelope())
    expect(store.routings.get(id)).toMatchObject({ cancelRequested: false, active: false })
  })
})

describe('what a network holds, for core (AGL-3634)', () => {
  it('answers the unshipped units, by line, with the network’s name and our reference', async () => {
    const { store, deps, id } = await setup()
    await onOrderPaid(deps, envelope())
    await store.patchRouting(id, {
      status: 'partially_shipped',
      reference: 'agabc',
      lines: [
        { lineIndex: 0, sku: 'TEE-S', name: 'Tee', quantity: 2, shippedQuantity: 1 },
        { lineIndex: 2, sku: 'MUG', name: 'Mug', quantity: 1, shippedQuantity: 1 },
      ],
    })
    await expect(holdsFor(store, 'shipbob', HOST, 'order-1')).resolves.toEqual([
      { providerId: 'shipbob', providerLabel: 'ShipBob', lineIndex: 0, quantity: 1, state: 'accepted', reference: 'agabc' },
    ])
    await expect(holdsFor(store, 'amazon-mcf', HOST, 'order-1')).resolves.toEqual([])
  })
})
