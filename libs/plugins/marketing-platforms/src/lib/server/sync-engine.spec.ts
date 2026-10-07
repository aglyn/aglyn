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

import type { PluginPersonChange } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { SYNC_BACKOFF_BASE_MS, SYNC_INTERVAL_MS, SYNC_MAX_CONSECUTIVE_FAILURES } from '../constants'
import { ProviderError } from '../providers/http'
import type { MarketingEvent, MarketingProvider, ProviderConsentPage, ProviderContact } from '../providers/provider'
import { createMemoryStore } from '../testing/memory-store'
import { emptyConnection, type StoredConnection } from './store'
import { backoffMs, runConnectionSync, runSyncTick, viaFor, type SyncRunDeps } from './sync-engine'

const HOST = 'host-1'
const ID = `${HOST}_klaviyo`
const NOW = Date.UTC(2026, 9, 7, 12)

const person = (email: string, name = 'Pat Lee'): PluginPersonChange => ({
  kind: 'contact',
  id: email,
  email,
  data: {},
  changedAtMs: NOW,
  profile: { name, phone: null, tags: ['vip'], lifetimeValueCents: 500, ordersCount: 1 },
})

const event = (overrides: Partial<MarketingEvent> = {}): MarketingEvent => ({
  id: 'evt-1',
  name: 'order.paid',
  email: 'pat@example.com',
  occurredAtMs: NOW - 1000,
  currency: 'USD',
  valueCents: 4200,
  orderId: 'o1',
  orderNumber: '#1',
  checkoutUrl: null,
  items: [],
  tracking: null,
  ...overrides,
})

function setup(options: {
  connection?: Partial<StoredConnection>
  people?: PluginPersonChange[][]
  statuses?: Record<string, 'subscribed' | 'unsubscribed' | 'withheld'>
  consent?: ProviderConsentPage[]
  suppressions?: Array<{ rows: Array<{ email: string; reason: string; via: string | null }>; next: string | null }>
  provider?: Partial<MarketingProvider>
}) {
  const memory = createMemoryStore()
  let clock = NOW
  const connection: StoredConnection = {
    ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'klaviyo', nowMs: NOW }),
    listId: 'L1',
    sealedToken: 'sealed',
    ...options.connection,
  }
  memory.connections.set(ID, connection)
  const pushed: ProviderContact[][] = []
  const sent: MarketingEvent[] = []
  const peoplePages = [...(options.people ?? [])]
  const consentPages = [...(options.consent ?? [])]
  const suppressionPages = [...(options.suppressions ?? [])]
  const recorded: string[] = []
  const released: string[] = []
  const peopleCursors: Array<string | null> = []
  const provider: MarketingProvider = {
    id: 'klaviyo',
    verify: async () => ({ accountName: null, lists: [], apiBase: null }),
    pushContacts: async (_credential, _target, contacts) => {
      pushed.push([...contacts])
      return { pushed: contacts.length, skipped: [] }
    },
    pullConsent: async () => consentPages.shift() ?? { changes: [], cursor: 'c-end', more: false },
    sendEvent: async (_credential, sentEvent) => void sent.push(sentEvent),
    ...options.provider,
  }
  const statusOf = (email: string) => options.statuses?.[email] ?? 'subscribed'
  const deps: SyncRunDeps = {
    now: () => clock,
    store: memory.store,
    provider: () => provider,
    credential: async () => ({ kind: 'api-key', token: 'pk' }),
    isLocked: async () => false,
    org: async () => ({ orgId: 'org-1', org: {}, entitled: true }),
    peopleChangedSince: async (request) => {
      peopleCursors.push(request.after)
      const page = peoplePages.shift()
      return page ? { people: page, next: `p${peopleCursors.length}` } : { people: [], next: null }
    },
    readStatuses: async (input) => input.people.map((entry) => statusOf(entry.email)),
    currentStatuses: async (input) => new Map(input.emails.map((email) => [email, statusOf(email)])),
    suppressionChanges: async () => suppressionPages.shift() ?? { rows: [], next: null },
    recordUnsubscribes: async (input) => {
      recorded.push(...input.emails.map((email) => `${email}:${input.via}`))
      return input.emails.length
    },
    releaseUnsubscribes: async (input) => {
      released.push(...input.emails)
      return input.emails.length
    },
  }
  return {
    deps,
    memory,
    pushed,
    sent,
    recorded,
    released,
    peopleCursors,
    tick: (ms: number) => (clock += ms),
    stored: () => memory.connections.get(ID)!,
  }
}

describe('one run', () => {
  it('backfills every person the first time, with the status the site’s own sends would give them', async () => {
    const run = setup({
      people: [[person('pat@example.com'), person('gone@example.com'), person('nobasis@example.com')]],
      statuses: { 'gone@example.com': 'unsubscribed', 'nobasis@example.com': 'withheld' },
    })
    const report = await runConnectionSync(run.deps, ID)
    expect(report).toMatchObject({ outcome: 'ok', contactsPushed: 2, more: false })
    expect(run.pushed[0].map((contact) => [contact.email, contact.status])).toEqual([
      ['pat@example.com', 'subscribed'],
      ['gone@example.com', 'unsubscribed'],
    ])
    expect(run.pushed[0][0]).toMatchObject({ firstName: 'Pat', lastName: 'Lee', tags: ['vip'], lifetimeValueCents: 500 })
    expect(run.peopleCursors).toEqual([null, 'p1'])
    expect(run.stored()).toMatchObject({
      backfillDone: true,
      cursors: { contacts: 'p1', provider: 'c-end' },
      consecutiveFailures: 0,
      lastSuccessAtMs: NOW,
      nextRunAtMs: NOW + SYNC_INTERVAL_MS,
      totals: { contactsPushed: 2 },
    })
  })

  it('reads the provider’s unsubscribes back BEFORE it pushes, and files them marked as this connection’s', async () => {
    const order: string[] = []
    const run = setup({
      consent: [{ changes: [{ email: 'left@example.com', status: 'unsubscribed' }, { email: 'back@example.com', status: 'subscribed' }], cursor: 'c1', more: false }],
      people: [[person('pat@example.com')]],
      provider: {
        pullConsent: async () => {
          order.push('pull')
          return { changes: [{ email: 'left@example.com', status: 'unsubscribed' }, { email: 'back@example.com', status: 'subscribed' }], cursor: 'c1', more: false }
        },
        pushContacts: async (_c, _t, contacts) => {
          order.push('push')
          return { pushed: contacts.length, skipped: [] }
        },
      },
    })
    const report = await runConnectionSync(run.deps, ID)
    expect(order).toEqual(['pull', 'push'])
    expect(run.recorded).toEqual([`left@example.com:${viaFor('klaviyo')}`])
    expect(run.released).toEqual(['back@example.com'])
    expect(report.consentPulled).toBe(2)
    expect(run.stored().cursors.provider).toBe('c1')
  })

  it('does not file the echo of its own unsubscribe as the person’s choice', async () => {
    const run = setup({
      consent: [{ changes: [{ email: 'declined@example.com', status: 'unsubscribed' }], cursor: 'c1', more: false }],
      statuses: { 'declined@example.com': 'unsubscribed' },
    })
    await runConnectionSync(run.deps, ID)
    expect(run.recorded).toEqual([])
  })

  it('sends the site’s suppressions out, except the ones that came from this provider', async () => {
    const run = setup({
      suppressions: [
        {
          rows: [
            { email: 'own@example.com', reason: 'unsubscribe', via: null },
            { email: 'bounce@example.com', reason: 'bounce', via: null },
            { email: 'theirs@example.com', reason: 'unsubscribe', via: viaFor('klaviyo') },
            { email: 'other@example.com', reason: 'unsubscribe', via: viaFor('mailchimp') },
          ],
          next: 's1',
        },
      ],
    })
    await runConnectionSync(run.deps, ID)
    expect(run.pushed.flat().map((contact) => `${contact.email}:${contact.status}`)).toEqual([
      'own@example.com:unsubscribed',
      'bounce@example.com:unsubscribed',
      'other@example.com:unsubscribed',
    ])
    expect(run.stored().cursors.suppressions).toBe('s1')
  })

  it('stops at its page budget, saves where it stopped, and goes again on the next tick', async () => {
    const run = setup({ people: [[person('a@example.com')], [person('b@example.com')], [person('c@example.com')]] })
    const report = await runConnectionSync(run.deps, ID, { maxPages: 2 })
    expect(report.more).toBe(true)
    expect(run.stored()).toMatchObject({ backfillDone: false, cursors: { contacts: 'p1' }, nextRunAtMs: NOW })
  })

  it('refuses to run without the list contacts go into, and says so', async () => {
    const run = setup({ connection: { listId: null } })
    const report = await runConnectionSync(run.deps, ID)
    expect(report.outcome).toBe('failed')
    expect(run.stored().lastError).toBe('Choose the Klaviyo list contacts go into')
  })

  it('does not run inside another run’s lease, nor a paused connection', async () => {
    const run = setup({ connection: { leaseUntilMs: NOW + 1000 } })
    expect((await runConnectionSync(run.deps, ID)).outcome).toBe('skipped')
    const paused = setup({ connection: { status: 'paused' } })
    expect((await runConnectionSync(paused.deps, ID)).outcome).toBe('skipped')
  })

  it('waits, untouched, while the site is locked or no longer entitled', async () => {
    const locked = setup({})
    locked.deps.isLocked = async () => true
    expect((await runConnectionSync(locked.deps, ID)).outcome).toBe('skipped')
    expect(locked.pushed).toEqual([])
    const lapsed = setup({})
    lapsed.deps.org = async () => ({ orgId: 'org-1', org: {}, entitled: false })
    expect((await runConnectionSync(lapsed.deps, ID)).outcome).toBe('skipped')
    expect(lapsed.stored().lastError).toMatch(/plan no longer includes/)
  })
})

describe('failure', () => {
  it('stops a refused credential until the merchant connects again', async () => {
    const run = setup({
      provider: {
        pullConsent: async () => {
          throw new ProviderError('auth', 'Klaviyo refused the connection: bad key')
        },
      },
    })
    await runConnectionSync(run.deps, ID)
    expect(run.stored()).toMatchObject({ status: 'reconnect', lastError: 'Klaviyo refused the connection: bad key', leaseUntilMs: 0 })
    expect(run.memory.logs.get(ID)?.[0]).toMatchObject({ kind: 'error' })
  })

  it('comes back when a rate limit says to, without stepping up the backoff', async () => {
    const run = setup({
      provider: {
        pullConsent: async () => {
          throw new ProviderError('rate-limit', 'slow down', { retryAfterMs: 300_000 })
        },
      },
    })
    await runConnectionSync(run.deps, ID)
    expect(run.stored()).toMatchObject({ status: 'active', consecutiveFailures: 0, nextRunAtMs: NOW + 300_000 })
  })

  it('backs off a transient failure, doubling, and stops after too many in a row', async () => {
    expect(backoffMs(1)).toBe(SYNC_BACKOFF_BASE_MS)
    expect(backoffMs(2)).toBe(2 * SYNC_BACKOFF_BASE_MS)
    const run = setup({
      connection: { consecutiveFailures: SYNC_MAX_CONSECUTIVE_FAILURES - 1 },
      provider: {
        pullConsent: async () => {
          throw new ProviderError('transient', 'Klaviyo had a problem (503)')
        },
      },
    })
    await runConnectionSync(run.deps, ID)
    expect(run.stored()).toMatchObject({ status: 'error', consecutiveFailures: SYNC_MAX_CONSECUTIVE_FAILURES })
  })

  it('keeps the cursors a failed run had already saved', async () => {
    let calls = 0
    const run = setup({
      people: [[person('a@example.com')], [person('b@example.com')]],
      provider: {
        pushContacts: async (_c, _t, contacts) => {
          calls += 1
          if (calls === 2) throw new ProviderError('transient', 'down')
          return { pushed: contacts.length, skipped: [] }
        },
      },
    })
    await runConnectionSync(run.deps, ID)
    expect(run.stored().cursors.contacts).toBe('p1')
  })
})

describe('events', () => {
  it('delivers owed events only for people the site may market to, and drops stale ones', async () => {
    const run = setup({ statuses: { 'no@example.com': 'withheld' } })
    const owner = { orgId: 'org-1', hostId: HOST }
    await run.memory.store.enqueueEvent(ID, owner, event(), NOW)
    await run.memory.store.enqueueEvent(ID, owner, event({ id: 'evt-2', email: 'no@example.com' }), NOW)
    await run.memory.store.enqueueEvent(ID, owner, event({ id: 'evt-3', occurredAtMs: NOW - 8 * 24 * 3600_000 }), NOW)
    const report = await runConnectionSync(run.deps, ID)
    expect(run.sent.map((sent) => sent.id)).toEqual(['evt-1'])
    expect(report.eventsSent).toBe(1)
    expect(run.memory.events.size).toBe(0)
  })

  it('retries an event the provider refused, alone, and logs it once it gives up', async () => {
    const run = setup({
      provider: {
        sendEvent: async () => {
          throw new ProviderError('invalid', 'bad metric')
        },
      },
    })
    await run.memory.store.enqueueEvent(ID, { orgId: 'org-1', hostId: HOST }, event(), NOW)
    const report = await runConnectionSync(run.deps, ID)
    expect(report.outcome).toBe('ok')
    const [stored] = [...run.memory.events.values()]
    expect(stored).toMatchObject({ attempts: 1, status: 'pending', lastError: 'bad metric' })
    run.memory.events.forEach((value) => (value.attempts = 7))
    run.tick(24 * 3600_000)
    run.memory.events.forEach((value) => {
      value.nextAttemptAtMs = 0
      value.event.occurredAtMs = NOW + 24 * 3600_000
    })
    run.memory.connections.get(ID)!.nextRunAtMs = 0
    await runConnectionSync(run.deps, ID)
    expect([...run.memory.events.values()][0].status).toBe('failed')
    expect(run.memory.logs.get(ID)?.some((entry) => entry.kind === 'event-failed')).toBe(true)
  })
})

describe('a tick', () => {
  it('runs every due connection and adds up what they did', async () => {
    const run = setup({ people: [[person('pat@example.com')]] })
    const tick = await runSyncTick(run.deps, { deadlineMs: NOW + 60_000 })
    expect(tick).toMatchObject({ connections: 1, ok: 1, failed: 0, contactsPushed: 1 })
    // Not due again until the interval passes.
    expect((await runSyncTick(run.deps, { deadlineMs: NOW + 60_000 })).connections).toBe(0)
  })
})
