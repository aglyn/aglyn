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

import {
  deliverPluginDomainEvent,
  listPluginDomainEventSubscribers,
  resetPluginDomainEventsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerAccountingServerDeclarations } from '../declarations.server'
import { EMPTY_ACCOUNTING_MAPPING } from '../model/accounting.types'
import { asFirestore, memoryFirestore } from '../testing/memory-firestore'
import { feeItemId, feeRefundItemId, refundItemId, saleItemId } from './sync-store'
import {
  feeRefundedFor,
  merchantShareOfRefund,
  onOrderCancelled,
  onOrderPaid,
  onOrderRefunded,
  snapshotFromOrderEvent,
} from './sync-intake'

const NOW = Date.UTC(2026, 9, 6, 18)

/** Commerce's public order view, as `order.paid` carries it. */
const orderView = {
  id: 'order-1',
  object: 'order',
  number: 1042,
  status: 'paid',
  channel: 'online',
  currency: 'usd',
  customerEmail: 'ada@example.com',
  customerName: 'Ada',
  lineItems: [{ productId: 'p1', name: 'Mug', quantity: 2, unitAmountCents: 1250, sku: 'MUG' }],
  totals: { itemsCents: 2500, shippingCents: 500, taxCents: 240, discountCents: 0, totalCents: 3240, feeCents: 97 },
  refundedCents: 0,
}

function setup(connected = true) {
  const store = memoryFirestore()
  store.seed('hosts/host-1', { orgId: 'org-1' })
  if (connected) {
    store.seed('orgs/org-1/accountingConnections/xero', {
      provider: 'xero',
      orgId: 'org-1',
      connectedAtMs: NOW - 1000,
      mapping: { ...EMPTY_ACCOUNTING_MAPPING, accounts: { income: 'i', clearing: 'c', feeExpense: 'f', payoutBank: 'b' } },
    })
  }
  const deps = { firestore: () => asFirestore(store), now: () => NOW }
  const item = (id: string) => store.read(`orgs/org-1/accountingSyncItems/${id}`)
  return { store, deps, item }
}

const envelope = <Payload>(payload: Payload, id = 'evt-1') => ({
  id,
  hostId: 'host-1',
  orgId: null,
  occurredAtMs: NOW - 5000,
  payload,
})

describe('the event intake', () => {
  it('reads commerce’s order view into the sync’s snapshot', () => {
    expect(snapshotFromOrderEvent(orderView, { orgId: 'org-1', hostId: 'host-1', occurredAtMs: 7 })).toMatchObject({
      orderId: 'order-1',
      number: 1042,
      paidAtMs: 7,
      lines: [{ name: 'Mug', quantity: 2, unitAmountCents: 1250, sku: 'MUG' }],
      totals: { totalCents: 3240, feeCents: 97 },
      taxInclusive: false,
    })
  })

  it('queues an order.paid once, finding the org from the site, however often it is delivered', async () => {
    const { deps, item } = setup()
    expect(await onOrderPaid(deps, envelope({ order: orderView }))).toBe(2)
    expect(await onOrderPaid(deps, envelope({ order: orderView }))).toBe(0)
    expect(item(saleItemId({ hostId: 'host-1', orderId: 'order-1' }))).toMatchObject({ kind: 'sale', status: 'pending', amountCents: 3240 })
    expect(item(feeItemId({ hostId: 'host-1', orderId: 'order-1' }))).toMatchObject({ kind: 'fee', amountCents: 97 })
  })

  it('queues nothing for a workspace with no ledger connected', async () => {
    const { deps, store } = setup(false)
    expect(await onOrderPaid(deps, envelope({ order: orderView }))).toBe(0)
    expect([...store.documents.keys()].some((path) => path.includes('accountingSyncItems'))).toBe(false)
  })

  it('queues a refund with the platform fee Stripe gave back in proportion', async () => {
    const { deps, item } = setup()
    await onOrderPaid(deps, envelope({ order: orderView }))
    const refund = { id: 're_1', amountCents: 1620, lineItemIds: [], full: false }
    expect(await onOrderRefunded(deps, envelope({ order: { ...orderView, refundedCents: 1620 }, refund }, 'evt-2'))).toBe(2)
    const snapshot = { order: { hostId: 'host-1', orderId: 'order-1' }, refundId: 're_1' } as never
    expect(item(refundItemId(snapshot))).toMatchObject({ kind: 'refund', amountCents: 1620 })
    expect(item(feeRefundItemId(snapshot))).toMatchObject({ kind: 'fee-refund', amountCents: 49 })
    expect(feeRefundedFor(snapshotFromOrderEvent(orderView, { orgId: 'o', hostId: 'h', occurredAtMs: 0 }), 3240)).toBe(97)
  })

  it('posts a Stripe Tax sale without its tax, which Aglyn holds and remits as marketplace facilitator', async () => {
    const { deps, item } = setup()
    const taxed = { ...orderView, taxMode: 'stripe-automatic' }
    expect(snapshotFromOrderEvent(taxed, { orgId: 'org-1', hostId: 'host-1', occurredAtMs: 7 })).toMatchObject({
      totals: { itemsCents: 2500, shippingCents: 500, taxCents: 0, totalCents: 3000, feeCents: 97 },
      marketplaceTaxCents: 240,
    })
    // A manual-tax sale keeps its tax: it is the merchant's own liability.
    expect(snapshotFromOrderEvent({ ...orderView, taxMode: 'manual' }, { orgId: 'o', hostId: 'h', occurredAtMs: 0 })).toMatchObject({
      totals: { taxCents: 240, totalCents: 3240 },
    })
    await onOrderPaid(deps, envelope({ order: taxed }))
    expect(item(saleItemId({ hostId: 'host-1', orderId: 'order-1' }))).toMatchObject({ amountCents: 3000 })
    // The buyer gets 3240 back; 240 of it comes out of Aglyn's balance.
    const refund = { id: 're_tax', amountCents: 3240, lineItemIds: [], full: true }
    await onOrderRefunded(deps, envelope({ order: { ...taxed, refundedCents: 3240 }, refund }, 'evt-4'))
    const snapshot = { order: { hostId: 'host-1', orderId: 'order-1' }, refundId: 're_tax' } as never
    expect(item(refundItemId(snapshot))).toMatchObject({ amountCents: 3000 })
    expect(item(feeRefundItemId(snapshot))).toMatchObject({ amountCents: 97 })
  })

  it('scales a partial refund of a Stripe Tax sale to the merchant’s share, and leaves any other refund whole', () => {
    const taxed = snapshotFromOrderEvent({ ...orderView, taxMode: 'stripe-automatic' }, { orgId: 'o', hostId: 'h', occurredAtMs: 0 })
    // 1620 × 3000 ÷ 3240
    expect(merchantShareOfRefund(taxed, 1620)).toBe(1500)
    expect(merchantShareOfRefund(taxed, 99_999)).toBe(3000)
    const manual = snapshotFromOrderEvent(orderView, { orgId: 'o', hostId: 'h', occurredAtMs: 0 })
    expect(merchantShareOfRefund(manual, 1620)).toBe(1620)
  })

  it('names a refund with no Stripe id by its envelope, so a redelivery is the same refund', async () => {
    const { deps, item } = setup()
    await onOrderPaid(deps, envelope({ order: orderView }))
    const refund = { id: null, amountCents: 100 }
    await onOrderRefunded(deps, envelope({ order: orderView, refund }, 'evt-refund-9'))
    expect(await onOrderRefunded(deps, envelope({ order: orderView, refund }, 'evt-refund-9'))).toBe(0)
    expect(item(refundItemId({ order: { hostId: 'host-1', orderId: 'order-1' }, refundId: 'evt-refund-9' } as never))).toBeDefined()
  })

  it('skips a sale not yet posted when its order is cancelled', async () => {
    const { deps, item } = setup()
    await onOrderPaid(deps, envelope({ order: orderView }))
    expect(await onOrderCancelled(deps, envelope({ order: orderView }, 'evt-3'))).toBe(true)
    expect(item(saleItemId({ hostId: 'host-1', orderId: 'order-1' }))).toMatchObject({ status: 'skipped' })
  })

  it('subscribes to the three order events through the plugin event seam', async () => {
    resetPluginDomainEventsForTests()
    registerAccountingServerDeclarations()
    for (const event of ['order.paid', 'order.refunded', 'order.cancelled']) {
      expect(listPluginDomainEventSubscribers(event)).toEqual(['accounting'])
    }
    // A delivery reaches the handler, which imports the intake on first use.
    const result = await deliverPluginDomainEvent({
      id: 'evt-x',
      event: 'order.cancelled',
      hostId: 'host-none',
      orgId: 'org-none',
      occurredAtMs: NOW,
      payload: { order: { id: '' } },
    })
    expect(result.failed).toEqual([])
    resetPluginDomainEventsForTests()
  })
})
