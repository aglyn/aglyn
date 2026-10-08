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

import { inventoryOrderId } from '../model/inventory-sync'
import { createMemoryInventoryStore } from '../testing/memory-store'
import { onOrderCancelled, onOrderPaid, onOrderRefunded, orderLines, systemAddress, type OrderEnvelope } from './intake'
import { emptyConnection, type StoredConnection } from './store'

const HOST = 'host-1'
const T0 = Date.UTC(2026, 9, 7, 12)

const envelope = (order: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): OrderEnvelope<any> => ({
  id: 'evt-1',
  hostId: HOST,
  orgId: 'org-1',
  occurredAtMs: T0,
  payload: {
    order: {
      id: 'order-1',
      number: 1042,
      currency: 'usd',
      customerName: 'Ada Buyer',
      customerEmail: 'ada@example.com',
      shippingAddress: { name: 'Ada', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us' },
      lineItems: [
        { name: 'Tee', variantLabel: 'M', sku: 'TEE-M', quantity: 2, unitAmountCents: 1999 },
        { name: 'Gift wrap', quantity: 1, unitAmountCents: 300 },
      ],
      totals: { itemsCents: 4298, shippingCents: 500, taxCents: 0, discountCents: 100, totalCents: 4698 },
      ...order,
    },
    ...extra,
  },
})

function setup(patch: Partial<StoredConnection> | null = {}) {
  const store = createMemoryInventoryStore()
  if (patch) {
    store.connections.set(HOST, {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'cin7-core', nowMs: T0 }),
      status: 'active',
      connectedAtMs: T0,
      sendOrders: true,
      ...patch,
    })
  }
  return { store, deps: { store, now: () => T0 } }
}

const ID = inventoryOrderId(HOST, 'order-1')

describe('the order-event intake (AGL-3642)', () => {
  it('queues a paid order with its SKU lines, snapshot and reference', async () => {
    const { store, deps } = setup()
    await onOrderPaid(deps, envelope())
    const queued = store.orders.get(ID)
    expect(queued).toMatchObject({
      status: 'queued',
      active: true,
      displayRef: '#1042',
      lines: [{ lineIndex: 0, sku: 'TEE-M', name: 'Tee — M', quantity: 2, unitAmountCents: 1999 }],
      skippedLines: ['Gift wrap'],
      snapshot: { currency: 'USD', shippingCents: 500, discountCents: 100, totalCents: 4698, shippingAddress: { country: 'US', line1: '1 Main St' } },
    })
    expect(queued?.reference).toMatch(/^AG1042-[0-9a-f]{8}$/)
    expect(queued?.note).toContain('Gift wrap')
  })

  it('is idempotent: a redelivered event finds the hand-off already there', async () => {
    const { store, deps } = setup()
    await onOrderPaid(deps, envelope())
    store.orders.get(ID)!.status = 'sent'
    await onOrderPaid(deps, envelope())
    expect(store.orders.get(ID)?.status).toBe('sent')
  })

  it('records, without queuing, an order with no SKU to match', async () => {
    const { store, deps } = setup()
    await onOrderPaid(deps, envelope({ lineItems: [{ name: 'Gift card', quantity: 1, unitAmountCents: 5000 }] }))
    expect(store.orders.get(ID)).toMatchObject({ status: 'skipped', active: false })
  })

  it('queues nothing for a site that is not connected, sends no orders, or is paused', async () => {
    for (const patch of [null, { sendOrders: false }, { status: 'paused' as const }, { connectedAtMs: null }]) {
      const { store, deps } = setup(patch)
      await onOrderPaid(deps, envelope())
      expect(store.orders.size).toBe(0)
    }
  })

  it('still queues while the connection waits to be connected again', async () => {
    const { store, deps } = setup({ status: 'reconnect' })
    await onOrderPaid(deps, envelope())
    expect(store.orders.get(ID)?.status).toBe('queued')
  })

  it('flags a canceled order for the job, sent or not', async () => {
    const { store, deps } = setup()
    await onOrderPaid(deps, envelope())
    await onOrderCancelled(deps, envelope())
    expect(store.orders.get(ID)).toMatchObject({ cancelRequested: true, active: true, note: 'The order was canceled.' })
  })

  it('cancels on a full refund, and only notes a partial one after sending', async () => {
    const { store, deps } = setup()
    await onOrderPaid(deps, envelope())
    store.orders.get(ID)!.status = 'sent'
    store.orders.get(ID)!.active = false
    await onOrderRefunded(deps, envelope({}, { refund: { full: false, lineItemIds: [0] } }))
    expect(store.orders.get(ID)).toMatchObject({ cancelRequested: false })
    expect(store.orders.get(ID)?.note).toMatch(/partial refund/)
    await onOrderRefunded(deps, envelope({}, { refund: { full: true } }))
    expect(store.orders.get(ID)).toMatchObject({ cancelRequested: true, active: true })
  })

  it('reads lines and addresses defensively', () => {
    expect(orderLines({ id: 'o', number: null, lineItems: 'nonsense' })).toEqual({ lines: [], skipped: [] })
    expect(systemAddress({ name: 'Only a name' })).toBeNull()
    expect(systemAddress(null)).toBeNull()
  })
})
