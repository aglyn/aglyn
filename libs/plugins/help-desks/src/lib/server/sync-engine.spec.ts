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

import type { PluginPersonChangesPage } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { OUTBOX_MAX_AGE_MS, OUTBOX_MAX_ATTEMPTS, SYNC_INTERVAL_MS, SYNC_MAX_CONSECUTIVE_FAILURES } from '../constants'
import type { HelpDeskProviderId } from '../model/connections'
import type { HelpDeskOrder } from '../model/orders'
import { ProviderError } from '../providers/http'
import type { HelpDeskProvider, HelpDeskTicket } from '../providers/provider'
import { createMemoryStore } from '../testing/memory-store'
import { emptyConnection, outboxItemId, type StoredConnection } from './store'
import { runConnectionSync, runSyncTick, type OrderHistoryEntry, type SyncRunDeps } from './sync-engine'

const HOST = 'host-1'
const ORG = 'org-1'
const NOW = Date.UTC(2026, 9, 15, 12)

const orderView = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  object: 'order',
  number: 1000 + Number(id.replace(/\D/g, '') || 0),
  status: 'paid',
  currency: 'usd',
  customerEmail: 'pat@example.com',
  customerName: 'Pat Lee',
  lineItems: [{ name: 'Mug', sku: 'MUG', quantity: 1, unitAmountCents: 1500, productId: 'p1' }],
  totals: { totalCents: 1500 },
  refundedCents: 0,
  livemode: true,
  created: new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
})

function fakeProvider(id: HelpDeskProviderId = 'gorgias') {
  const calls: string[] = []
  const pushed: Array<{ order: HelpDeskOrder; recent: readonly HelpDeskOrder[]; remoteId: string }> = []
  const tickets: HelpDeskTicket[] = []
  let failOrder: ((order: HelpDeskOrder) => Error | null) | null = null
  const provider: HelpDeskProvider = {
    id,
    verify: async () => ({ accountName: 'acme', targets: [] }),
    upsertCustomer: async (_credential, customer, known) => {
      calls.push(`upsert:${customer.email}:${customer.name ?? ''}:${known ?? ''}`)
      return { remoteId: known ?? `r-${customer.email}` }
    },
    pushOrder: async (_credential, input) => {
      const error = failOrder?.(input.order)
      if (error) throw error
      calls.push(`order:${input.order.id}`)
      pushed.push({ order: input.order, recent: input.recent, remoteId: input.remoteId })
    },
    createTicket: async (_credential, input) => {
      calls.push(`ticket:${input.ticket.id}:${input.targetId ?? ''}`)
      tickets.push(input.ticket)
    },
  }
  return { provider, calls, pushed, tickets, failOn: (fn: typeof failOrder) => void (failOrder = fn) }
}

function setup(
  options: {
    provider?: ReturnType<typeof fakeProvider>
    connection?: Partial<StoredConnection>
    people?: PluginPersonChangesPage[]
    history?: OrderHistoryEntry[][] | null
    entitled?: boolean
    enabled?: boolean
    locked?: boolean
  } = {},
) {
  const memory = createMemoryStore()
  const fake = options.provider ?? fakeProvider()
  const id = `${HOST}_${fake.provider.id}`
  let now = NOW
  memory.connections.set(id, {
    ...emptyConnection({ orgId: ORG, hostId: HOST, provider: fake.provider.id, nowMs: NOW }),
    sealedToken: 'sealed',
    connectedAtMs: NOW - 60_000,
    ...options.connection,
  })
  const people = [...(options.people ?? [{ people: [], next: null }])]
  const history = options.history === null ? null : [...(options.history ?? [[]])]
  const historyRequests: Array<{ fromMs: number; untilMs: number }> = []
  const deps: SyncRunDeps = {
    now: () => now,
    store: memory.store,
    provider: () => fake.provider,
    credential: async () => ({ account: 'acme', login: 'a@example.com', token: 't', appClientId: null, supportEmail: null }),
    isLocked: async () => options.locked === true,
    site: async () => ({
      orgId: ORG,
      entitled: options.entitled !== false,
      enabled: options.enabled !== false,
      orderUrl: (orderId) => `https://app.test/acme/hosts/shop/products/orders?order=${orderId}`,
    }),
    peopleChangedSince: async () => people.shift() ?? { people: [], next: null },
    orderHistory: async (request) => {
      historyRequests.push({ fromMs: request.fromMs, untilMs: request.untilMs })
      if (history === null) return null
      return history.shift() ?? []
    },
    source: 'Aglyn',
  }
  return { deps, memory, fake, id, historyRequests, advance: (ms: number) => void (now += ms) }
}

const person = (email: string, ordersCount: number, name = 'Pat Lee') => ({
  kind: 'contact',
  id: email,
  email,
  data: {},
  changedAtMs: NOW,
  profile: { name, phone: '+15551234567', tags: [], lifetimeValueCents: null, ordersCount },
})

const owedOrder = (memory: ReturnType<typeof createMemoryStore>, connectionId: string, key: string, order: HelpDeskOrder, createdAtMs = NOW) =>
  memory.store.enqueue(outboxItemId(connectionId, 'order', key), {
    orgId: ORG,
    connectionId,
    hostId: HOST,
    kind: 'order',
    email: 'pat@example.com',
    status: 'pending',
    attempts: 0,
    nextAttemptAtMs: createdAtMs,
    createdAtMs,
    lastError: null,
    buyer: { email: 'pat@example.com', name: 'Pat Lee' },
    order,
  })

const owedTicket = (memory: ReturnType<typeof createMemoryStore>, connectionId: string, id: string) =>
  memory.store.enqueue(outboxItemId(connectionId, 'ticket', id), {
    orgId: ORG,
    connectionId,
    hostId: HOST,
    kind: 'ticket',
    email: 'sam@example.com',
    status: 'pending',
    attempts: 0,
    nextAttemptAtMs: NOW,
    createdAtMs: NOW,
    lastError: null,
    ticket: { id, email: 'sam@example.com', name: 'Sam', subject: 'Hi', body: 'Hello', submittedAtMs: NOW },
  })

const anOrder = (id: string, createdAtMs: number, status = 'paid'): HelpDeskOrder => ({
  id,
  number: `#${id}`,
  createdAtMs,
  currency: 'USD',
  totalCents: 1000,
  refundedCents: 0,
  status,
  items: [],
  url: null,
})

describe('the first runs', () => {
  it('sends only the people who ordered, then the last 90 days of paid orders, each with a link', async () => {
    const { deps, memory, fake, id, historyRequests } = setup({
      people: [{ people: [person('pat@example.com', 2), person('lead@example.com', 0)], next: 'c1' }],
      history: [
        [
          { createdAtMs: NOW - 2000, paidAtMs: NOW - 2000, order: orderView('o1') },
          { createdAtMs: NOW - 1000, paidAtMs: null, order: orderView('o2') },
          { createdAtMs: NOW - 500, paidAtMs: NOW - 500, order: orderView('o3', { livemode: false }) },
        ],
      ],
    })
    const report = await runConnectionSync(deps, id)
    expect(report).toMatchObject({ outcome: 'ok', customersPushed: 1, ordersPushed: 1 })
    expect(fake.calls).toEqual(['upsert:pat@example.com:Pat Lee:', 'order:o1'])
    expect(fake.pushed[0].order.url).toBe('https://app.test/acme/hosts/shop/products/orders?order=o1')
    expect(historyRequests[0].untilMs).toBe(NOW - 60_000)
    expect(historyRequests[0].untilMs - historyRequests[0].fromMs).toBe(90 * 24 * 60 * 60 * 1000)
    const stored = memory.connections.get(id)!
    expect(stored.backfill).toEqual({ people: true, orders: true })
    expect(stored.cursors.people).toBe('c1')
    expect(stored.nextRunAtMs).toBe(NOW + SYNC_INTERVAL_MS)
    expect(stored.totals).toEqual({ customersPushed: 1, ordersPushed: 1, ticketsCreated: 0 })
    expect(memory.logs.get(id)?.[0].message).toBe('1 customer sent, 1 order sent')
  })

  it('reads on from where a page budget stopped it, without sending a buyer twice', async () => {
    const { deps, fake, id, memory } = setup({
      people: [
        { people: [person('pat@example.com', 1)], next: 'c1' },
        { people: [person('pat@example.com', 1)], next: 'c2' },
      ],
    })
    const first = await runConnectionSync(deps, id, { maxPages: 1 })
    expect(first.more).toBe(true)
    expect(memory.connections.get(id)?.nextRunAtMs).toBe(NOW)
    await runConnectionSync(deps, id, { maxPages: 1 })
    // The same name and a remembered id: nothing to tell the help desk.
    expect(fake.calls.filter((call) => call.startsWith('upsert'))).toHaveLength(1)
    expect(memory.connections.get(id)?.cursors.people).toBe('c2')
  })

  it('takes a deployment with no order history as nothing to copy', async () => {
    const { deps, id, memory } = setup({ history: null })
    await runConnectionSync(deps, id)
    expect(memory.connections.get(id)?.backfill.orders).toBe(true)
  })

  it('logs an order the help desk refuses during the copy and goes on', async () => {
    const fake = fakeProvider()
    fake.failOn((order) => (order.id === 'o1' ? new ProviderError('invalid', 'bad order') : null))
    const { deps, id, memory } = setup({
      provider: fake,
      history: [
        [
          { createdAtMs: NOW - 2000, paidAtMs: NOW - 2000, order: orderView('o1') },
          { createdAtMs: NOW - 1000, paidAtMs: NOW - 1000, order: orderView('o2') },
        ],
      ],
    })
    const report = await runConnectionSync(deps, id)
    expect(report.outcome).toBe('ok')
    expect(fake.calls).toContain('order:o2')
    expect(memory.logs.get(id)?.some((entry) => entry.kind === 'item-failed' && entry.message.includes('bad order'))).toBe(true)
  })
})

describe('what is owed', () => {
  const done = { connection: { backfill: { people: true, orders: true } } }

  it('carries the buyer’s recent orders, newest first, with a newer state replacing the older', async () => {
    const { deps, fake, id, memory } = setup(done)
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 3000))
    await owedOrder(memory, id, 'e2', anOrder('b', NOW - 1000))
    await runConnectionSync(deps, id)
    memory.connections.get(id)!.nextRunAtMs = NOW
    await owedOrder(memory, id, 'e3', anOrder('a', NOW - 3000, 'fulfilled'))
    await runConnectionSync(deps, id)
    const last = fake.pushed[fake.pushed.length - 1]
    expect(last.recent.map((order) => `${order.id}:${order.status}`)).toEqual(['b:paid', 'a:fulfilled'])
    expect(memory.outbox.size).toBe(0)
  })

  it('sends contact form messages only when switched on, and leaves them waiting for a menu pick', async () => {
    const off = setup(done)
    await owedTicket(off.memory, off.id, 's1')
    await runConnectionSync(off.deps, off.id)
    expect(off.fake.tickets).toHaveLength(0)
    expect(off.memory.outbox.size).toBe(0)

    const reamaze = fakeProvider('reamaze')
    const waiting = setup({ ...done, provider: reamaze, connection: { ...done.connection, sendTickets: true } })
    await owedTicket(waiting.memory, waiting.id, 's1')
    await runConnectionSync(waiting.deps, waiting.id)
    expect(reamaze.tickets).toHaveLength(0)
    expect(waiting.memory.outbox.size).toBe(1)
    expect(waiting.memory.connections.get(waiting.id)?.lastError).toContain('Choose the Re:amaze channel')

    waiting.memory.connections.get(waiting.id)!.targetId = 'support'
    waiting.memory.connections.get(waiting.id)!.nextRunAtMs = NOW
    await runConnectionSync(waiting.deps, waiting.id)
    expect(reamaze.calls).toEqual(['upsert:sam@example.com:Sam:', 'ticket:s1:support'])
    expect(waiting.memory.connections.get(waiting.id)?.lastError).toBeNull()
    expect(waiting.memory.connections.get(waiting.id)?.totals.ticketsCreated).toBe(1)
  })

  it('holds Kustomer orders until the custom object is chosen', async () => {
    const kustomer = fakeProvider('kustomer')
    const { deps, id, memory } = setup({ ...done, provider: kustomer })
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000))
    await runConnectionSync(deps, id)
    expect(kustomer.pushed).toHaveLength(0)
    expect(memory.outbox.size).toBe(1)
    expect(memory.connections.get(id)?.lastError).toContain('Choose the Kustomer custom object')
  })

  it('drops what is too old to matter', async () => {
    const { deps, fake, id, memory } = setup(done)
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000), NOW - OUTBOX_MAX_AGE_MS - 1)
    await runConnectionSync(deps, id)
    expect(fake.pushed).toHaveLength(0)
    expect(memory.outbox.size).toBe(0)
  })

  it('retries an item the help desk refuses, then logs it and drops it', async () => {
    const fake = fakeProvider()
    fake.failOn(() => new ProviderError('invalid', 'nope', { status: 422 }))
    const { deps, id, memory, advance } = setup({ ...done, provider: fake })
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000))
    for (let attempt = 0; attempt < OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      memory.connections.get(id)!.nextRunAtMs = 0
      await runConnectionSync(deps, id)
      advance(7 * 60 * 60 * 1000)
    }
    const [item] = [...memory.outbox.values()]
    expect(item.status).toBe('failed')
    expect(memory.logs.get(id)?.some((entry) => entry.kind === 'item-failed')).toBe(true)
    expect(memory.connections.get(id)?.status).toBe('active')
  })

  it('forgets a buyer the help desk says is gone, so the next attempt finds them again', async () => {
    const fake = fakeProvider()
    let gone = true
    fake.failOn(() => (gone ? new ProviderError('invalid', 'merged', { status: 410 }) : null))
    const { deps, id, memory, advance } = setup({ ...done, provider: fake })
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000))
    await runConnectionSync(deps, id)
    gone = false
    advance(2 * 60 * 1000)
    memory.connections.get(id)!.nextRunAtMs = 0
    await runConnectionSync(deps, id)
    expect(fake.calls.filter((call) => call.startsWith('upsert'))).toHaveLength(2)
    expect(fake.pushed).toHaveLength(1)
  })
})

describe('failure', () => {
  it('asks the merchant to connect again when the help desk refuses the credential', async () => {
    const fake = fakeProvider()
    fake.failOn(() => new ProviderError('auth', 'Gorgias refused the connection: bad key'))
    const { deps, id, memory } = setup({ provider: fake, connection: { backfill: { people: true, orders: true } } })
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000))
    const report = await runConnectionSync(deps, id)
    expect(report.outcome).toBe('failed')
    expect(memory.connections.get(id)).toMatchObject({ status: 'reconnect', lastError: 'Gorgias refused the connection: bad key' })
    expect(memory.outbox.size).toBe(1)
  })

  it('waits as long as a rate limit asks, without stepping up the backoff', async () => {
    const fake = fakeProvider()
    fake.failOn(() => new ProviderError('rate-limit', 'slow down', { status: 429, retryAfterMs: 120_000 }))
    const { deps, id, memory } = setup({ provider: fake, connection: { backfill: { people: true, orders: true } } })
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000))
    await runConnectionSync(deps, id)
    expect(memory.connections.get(id)).toMatchObject({ nextRunAtMs: NOW + 120_000, consecutiveFailures: 0, status: 'active' })
  })

  it('stops a connection after too many failures in a row', async () => {
    const { deps, id, memory } = setup({ connection: { consecutiveFailures: SYNC_MAX_CONSECUTIVE_FAILURES - 1 } })
    deps.peopleChangedSince = async () => {
      throw new Error('boom')
    }
    await runConnectionSync(deps, id)
    expect(memory.connections.get(id)?.status).toBe('error')
  })

  it('skips a locked site and an unentitled one without failing them', async () => {
    const locked = setup({ locked: true })
    expect((await runConnectionSync(locked.deps, locked.id)).outcome).toBe('skipped')
    const unentitled = setup({ entitled: false })
    expect((await runConnectionSync(unentitled.deps, unentitled.id)).outcome).toBe('skipped')
    expect(unentitled.memory.connections.get(unentitled.id)?.lastError).toContain('plan')
  })

  it('sends nothing for a site that switched the plugin off, and drops what was owed meanwhile', async () => {
    const off = setup({ enabled: false })
    await owedOrder(off.memory, off.id, 'e1', anOrder('a', NOW - 1000))
    expect((await runConnectionSync(off.deps, off.id)).outcome).toBe('skipped')
    expect(off.memory.outbox.size).toBe(0)
    expect(off.fake.pushed).toHaveLength(0)
    expect(off.memory.connections.get(off.id)?.lastError).toContain('switched off')
  })
})

describe('the tick', () => {
  it('runs every due connection and adds up what they did', async () => {
    const { deps, id, memory } = setup({ connection: { backfill: { people: true, orders: true } } })
    await owedOrder(memory, id, 'e1', anOrder('a', NOW - 1000))
    const tick = await runSyncTick(deps, { deadlineMs: NOW + 60_000 })
    expect(tick).toMatchObject({ connections: 1, ok: 1, ordersPushed: 1 })
    // Leased and finished: not due again until the interval.
    expect((await runSyncTick(deps, { deadlineMs: NOW + 60_000 })).connections).toBe(0)
  })
})
