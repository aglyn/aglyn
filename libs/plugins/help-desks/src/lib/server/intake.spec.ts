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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { HELP_DESKS_SUBSCRIBED_EVENTS } from '../declarations.server'
import { helpDeskOrderFromView, mergeRecentOrders, orderStatusLabel } from '../model/orders'
import { createMemoryStore } from '../testing/memory-store'
import { answerLabel, HELP_DESKS_ORDER_EVENTS, intakeFormSubmission, intakeOrderEvent, ticketFromSubmission } from './intake'
import { emptyConnection, type StoredConnection } from './store'

const HOST = 'host-1'
const NOW = Date.UTC(2026, 9, 15, 12)

const order = {
  id: 'ord-1',
  object: 'order',
  number: 1042,
  status: 'paid',
  currency: 'usd',
  customerEmail: 'Pat@Example.com',
  customerName: 'Pat Lee',
  lineItems: [
    { name: 'Mug', sku: 'MUG', quantity: 2, unitAmountCents: 1500, productId: 'p1' },
    { name: 'Gone', quantity: 0, unitAmountCents: 100 },
  ],
  totals: { totalCents: 3000 },
  refundedCents: 0,
  livemode: true,
  created: '2026-10-07T12:00:00.000Z',
}

const envelope = (event: string, payload: unknown, id = 'evt-1'): PluginDomainEventEnvelope<unknown> => ({
  id,
  event,
  hostId: HOST,
  orgId: 'org-1',
  occurredAtMs: NOW,
  attempt: 1,
  payload,
})

function setup(connections: Array<Partial<StoredConnection> & { provider: StoredConnection['provider'] }>) {
  const memory = createMemoryStore()
  for (const connection of connections) {
    memory.connections.set(`${HOST}_${connection.provider}`, {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: connection.provider, nowMs: NOW }),
      ...connection,
    })
  }
  return { memory, deps: { store: memory.store, orgOf: async () => 'org-1', now: () => NOW } }
}

describe('orders', () => {
  it('subscribes to the same order events the intake takes', () => {
    expect([...HELP_DESKS_SUBSCRIBED_EVENTS]).toEqual([...HELP_DESKS_ORDER_EVENTS])
  })

  it('reads the public order view, and leaves out test orders and orders with no buyer', () => {
    const read = helpDeskOrderFromView(order, NOW)
    expect(read).toEqual({
      buyer: { email: 'pat@example.com', name: 'Pat Lee' },
      order: {
        id: 'ord-1',
        number: '#1042',
        createdAtMs: Date.UTC(2026, 9, 7, 12),
        currency: 'USD',
        totalCents: 3000,
        refundedCents: 0,
        status: 'paid',
        items: [{ productId: 'p1', name: 'Mug', sku: 'MUG', quantity: 2, unitCents: 1500 }],
        url: null,
      },
    })
    expect(helpDeskOrderFromView({ ...order, livemode: false }, NOW)).toBeNull()
    expect(helpDeskOrderFromView({ ...order, customerEmail: null }, NOW)).toBeNull()
  })

  it('owes an order once to each connection that takes orders, and to no other', async () => {
    const { memory, deps } = setup([
      { provider: 'gorgias' },
      { provider: 'kustomer', syncCustomers: false },
      { provider: 'gladly', status: 'paused' },
    ])
    expect(await intakeOrderEvent(deps, envelope('order.paid', { order }))).toBe(1)
    expect(await intakeOrderEvent(deps, envelope('order.paid', { order }))).toBe(1)
    expect([...memory.outbox.keys()]).toEqual([`${HOST}_gorgias_order_evt-1`])
    expect(memory.outbox.get(`${HOST}_gorgias_order_evt-1`)).toMatchObject({ kind: 'order', email: 'pat@example.com', orgId: 'org-1' })
  })

  it('ignores an event it does not take', async () => {
    const { memory, deps } = setup([{ provider: 'gorgias' }])
    expect(await intakeOrderEvent(deps, envelope('checkout.started', { order }))).toBe(0)
    expect(memory.outbox.size).toBe(0)
  })

  it('folds a newer state of an order into the recent ones and labels it in American spelling', () => {
    const a = helpDeskOrderFromView(order, NOW)!.order
    const merged = mergeRecentOrders([a], { ...a, status: 'cancelled' }, 10)
    expect(merged).toHaveLength(1)
    expect(orderStatusLabel(merged[0].status)).toBe('Canceled')
  })
})

describe('contact form messages', () => {
  const payload = {
    formName: 'Contact us',
    path: '/contact',
    formId: 'f1',
    email: 'Sam@Example.com',
    firstName: 'Sam',
    lastName: 'Rivera',
    phoneNumber: '+15551234567',
    message: 'Where is my order?',
  }

  it('makes the message the ticket, with the other answers under it', () => {
    const ticket = ticketFromSubmission(payload, { recordId: 'sub-1' }, NOW)
    expect(ticket).toEqual({
      id: 'sub-1',
      email: 'sam@example.com',
      name: 'Sam Rivera',
      subject: 'Contact us: a message from Sam Rivera',
      body: 'Where is my order?\n\nEmail: Sam@Example.com\nFirst name: Sam\nLast name: Rivera\nPhone number: +15551234567\n\nSent with the form “Contact us” on /contact.',
      submittedAtMs: NOW,
    })
    expect(answerLabel('phoneNumber')).toBe('Phone number')
  })

  it('takes the sender from the visitor the door saw, and gives up on a message nobody can answer', () => {
    expect(ticketFromSubmission({ formName: 'F', message: 'hi' }, { actor: { email: 'a@example.com' } }, NOW)?.email).toBe('a@example.com')
    expect(ticketFromSubmission({ formName: 'F', message: 'hi' }, {}, NOW)).toBeNull()
  })

  it('is owed only where the merchant switched it on', async () => {
    const { memory, deps } = setup([{ provider: 'gorgias' }, { provider: 'reamaze', sendTickets: true }])
    expect(await intakeFormSubmission(deps, HOST, payload, { recordId: 'sub-1' })).toBe(1)
    expect([...memory.outbox.keys()]).toEqual([`${HOST}_reamaze_ticket_sub-1`])
    const off = setup([{ provider: 'gorgias' }])
    expect(await intakeFormSubmission(off.deps, HOST, payload, { recordId: 'sub-1' })).toBe(0)
  })
})
