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
  declarePluginDomainEvents,
  definePluginDomainEvent,
  deliverPluginDomainEvent,
  listPluginDomainEvents,
  listPluginDomainEventSubscribers,
  pluginDomainEventDeclaration,
  resetPluginDomainEventsForTests,
  subscribePluginDomainEvent,
} from './plugin-domain-events'

/** Plugin-raised events: declaration, subscription and one delivery pass (AGL-3611). */

const PAID = definePluginDomainEvent<{ order: { id: string } }>('order.paid')
const envelope = { id: 'evt-1', event: 'order.paid', hostId: 'h1', orgId: null as string | null, occurredAtMs: 1, payload: { order: { id: 'o1' } } }

beforeEach(() => resetPluginDomainEventsForTests())

it('refuses a name that is not dotted lower-case words', () => {
  expect(() => definePluginDomainEvent('OrderPaid')).toThrow(/dotted/)
  expect(() => definePluginDomainEvent('order')).toThrow(/dotted/)
  expect(definePluginDomainEvent('return.requested').id).toBe('return.requested')
})

it('lets one plugin own a name, and refuses a second declaring it', () => {
  declarePluginDomainEvents([{ event: PAID, label: 'Order paid', description: 'Paid.' }], { pluginId: 'commerce' })
  expect(pluginDomainEventDeclaration('order.paid')).toMatchObject({ pluginId: 'commerce', label: 'Order paid' })
  expect(() =>
    declarePluginDomainEvents([{ event: 'order.paid', label: 'x', description: 'x' }], { pluginId: 'other' }),
  ).toThrow(/already declared by "commerce"/)
  // The owner declaring again replaces its entry.
  declarePluginDomainEvents([{ event: PAID, label: 'Paid', description: 'Paid.' }], { pluginId: 'commerce' })
  expect(listPluginDomainEvents()).toHaveLength(1)
})

it('refuses a subscription with no owner', () => {
  expect(() => subscribePluginDomainEvent(PAID, () => undefined)).toThrow(/no owner/)
})

it('replaces a subscriber subscribing again, and keeps named subscribers apart', () => {
  subscribePluginDomainEvent(PAID, () => undefined, { pluginId: 'accounting' })
  subscribePluginDomainEvent(PAID, () => undefined, { pluginId: 'accounting' })
  subscribePluginDomainEvent(PAID, () => undefined, { pluginId: 'commerce', name: 'webhooks' })
  subscribePluginDomainEvent(PAID, () => undefined, { pluginId: 'commerce', name: 'workflow-triggers' })
  expect(listPluginDomainEventSubscribers('order.paid')).toEqual([
    'accounting',
    'commerce:webhooks',
    'commerce:workflow-triggers',
  ])
})

it('delivers to each subscriber, isolates a throw, and skips the ones already served', async () => {
  const seen: string[] = []
  subscribePluginDomainEvent(PAID, (e) => void seen.push(`a:${e.payload.order.id}:${e.attempt}`), { pluginId: 'a' })
  subscribePluginDomainEvent(PAID, () => {
    throw new Error('ledger down')
  }, { pluginId: 'b' })
  subscribePluginDomainEvent(PAID, () => void seen.push('c'), { pluginId: 'c' })
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

  const first = await deliverPluginDomainEvent(envelope)
  expect(first.delivered).toEqual(['a', 'c'])
  expect(first.failed).toEqual([{ pluginId: 'b', error: 'ledger down' }])

  // The retry calls only the subscriber still owed it, with its attempt count.
  seen.length = 0
  const handled: number[] = []
  subscribePluginDomainEvent(PAID, (e) => void handled.push(e.attempt), { pluginId: 'b' })
  const retry = await deliverPluginDomainEvent(envelope, { skip: new Set(['a', 'c']), attempts: { b: 1 } })
  expect(seen).toEqual([])
  expect(retry.delivered).toEqual(['b'])
  expect(handled).toEqual([2])
  error.mockRestore()
})

it('keeps one registry per process, on globalThis', () => {
  subscribePluginDomainEvent(PAID, () => undefined, { pluginId: 'a' })
  const registry = (globalThis as Record<symbol, any>)[Symbol.for('@aglyn/aglyn:plugin-domain-events')]
  expect(registry.subscriptions.get('order.paid')).toHaveLength(1)
})
