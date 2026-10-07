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
  resetPluginDomainEventsForTests,
  subscribePluginDomainEvent,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import {
  attemptPluginEvent,
  drainPluginEvents,
  PLUGIN_EVENT_MAX_ATTEMPTS,
  pluginEventBackoffMs,
  pluginEventId,
  raisePluginEvent,
  stagePluginEvent,
} from './plugin-event-outbox'

/**
 * The plugin event outbox (AGL-3611): raised once per key, delivered at
 * least once per subscriber, retried with backoff for the subscriber that
 * failed alone, and left as a dead letter after the last attempt.
 */

const docs = new Map<string, Record<string, any>>()

function ref(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    create: async (value: any) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    update: async (value: any) => {
      if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
      docs.set(path, { ...docs.get(path), ...value })
    },
    delete: async () => void docs.delete(path),
  }
}
function snapshot(path: string): any {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (k: string) => data?.[k] }
}
function query(collection: string, filters: Array<[string, string, any]> = [], max = Infinity): any {
  return {
    where: (field: string, op: string, value: any) => query(collection, [...filters, [field, op, value]], max),
    orderBy: () => query(collection, filters, max),
    limit: (n: number) => query(collection, filters, n),
    get: async () => {
      const matched = [...docs.keys()]
        .filter((key) => key.startsWith(`${collection}/`))
        .filter((key) =>
          filters.every(([field, op, value]) => {
            const actual = docs.get(key)?.[field]
            return op === '==' ? actual === value : actual <= value
          }),
        )
        .sort((a, b) => docs.get(a)!.nextAttemptAtMs - docs.get(b)!.nextAttemptAtMs)
        .slice(0, max)
        .map(snapshot)
      return { size: matched.length, docs: matched }
    },
  }
}
const firestore: any = {
  collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`), ...query(name) }),
  runTransaction: async (fn: (t: any) => Promise<any>) => {
    const writes: Array<() => Promise<void>> = []
    const result = await fn({
      get: (r: any) => r.get(),
      update: (r: any, v: any) => writes.push(() => r.update(v)),
      set: (r: any, v: any) => writes.push(async () => void docs.set(r.path, v)),
    })
    for (const write of writes) await write()
    return result
  },
}
const open = { isLocked: async () => false }

const raise = (key = 'o1:paid', now = 1_000) =>
  raisePluginEvent(firestore, { event: 'order.paid', pluginId: 'commerce', hostId: 'h1', key, payload: { order: { id: 'o1', note: undefined } } }, now)

beforeEach(() => {
  docs.clear()
  resetPluginDomainEventsForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('raising', () => {
  it('queues one event per key, as plain data', async () => {
    expect((await raise()).outcome).toBe('queued')
    expect((await raise()).outcome).toBe('exists')
    expect(docs.size).toBe(1)
    const [stored] = docs.values()
    expect(stored).toMatchObject({ status: 'pending', event: 'order.paid', pluginId: 'commerce', hostId: 'h1', attempts: 0, nextAttemptAtMs: 1_000 })
    expect('note' in stored.payload.order).toBe(false)
  })

  it('stages inside a writer under the same keyed id', () => {
    const writes: any[] = []
    const id = stagePluginEvent({ set: (r, data) => writes.push([r.path, data]) }, firestore, {
      event: 'order.fulfilled',
      pluginId: 'commerce',
      hostId: 'h1',
      key: 'o1:f-1',
      payload: { order: { id: 'o1' } },
    })
    expect(id).toBe(pluginEventId('h1', 'order.fulfilled', 'o1:f-1'))
    expect(writes[0][0]).toBe(`pluginEventOutbox/${id}`)
  })
})

describe('delivering', () => {
  it('hands the event to each subscriber and deletes it once all took it', async () => {
    const seen: any[] = []
    subscribePluginDomainEvent('order.paid', (e) => void seen.push(e), { pluginId: 'accounting' })
    const { id } = await raise()
    const result = await drainPluginEvents(open, firestore, 2_000)
    expect(result).toMatchObject({ scanned: 1, delivered: 1 })
    expect(seen[0]).toMatchObject({ id, event: 'order.paid', hostId: 'h1', attempt: 1, payload: { order: { id: 'o1' } } })
    expect(docs.size).toBe(0)
  })

  it('retries only the subscriber that failed, after the backoff', async () => {
    const calls: string[] = []
    subscribePluginDomainEvent('order.paid', () => void calls.push('a'), { pluginId: 'a' })
    let fail = true
    subscribePluginDomainEvent('order.paid', () => {
      calls.push('b')
      if (fail) throw new Error('down')
    }, { pluginId: 'b' })
    const { id } = await raise()

    expect(await attemptPluginEvent(firestore, id, 2_000)).toBe('retried')
    const stored = docs.get(`pluginEventOutbox/${id}`)!
    expect(stored).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAtMs: 2_000 + pluginEventBackoffMs(1), lastErrors: { b: 'down' } })
    expect(Object.keys(stored.delivered)).toEqual(['a'])

    // Not due yet: the drain leaves it alone.
    expect((await drainPluginEvents(open, firestore, 2_001)).scanned).toBe(0)

    fail = false
    expect(await attemptPluginEvent(firestore, id, 2_000 + pluginEventBackoffMs(1))).toBe('delivered')
    expect(calls).toEqual(['a', 'b', 'b'])
    expect(docs.size).toBe(0)
  })

  it('leaves a dead letter after the last attempt', async () => {
    subscribePluginDomainEvent('order.paid', () => {
      throw new Error('gone')
    }, { pluginId: 'b' })
    const { id } = await raise()
    let now = 2_000
    let outcome = ''
    for (let attempt = 1; attempt <= PLUGIN_EVENT_MAX_ATTEMPTS; attempt += 1) {
      outcome = await attemptPluginEvent(firestore, id, now)
      now = Number(docs.get(`pluginEventOutbox/${id}`)!.nextAttemptAtMs ?? now)
    }
    expect(outcome).toBe('dead-lettered')
    expect(docs.get(`pluginEventOutbox/${id}`)).toMatchObject({ status: 'failed', attempts: PLUGIN_EVENT_MAX_ATTEMPTS })
    expect((await drainPluginEvents(open, firestore, now + 1e9)).scanned).toBe(0)
  })

  it('does not deliver an event another pass holds the lease on', async () => {
    const seen: string[] = []
    subscribePluginDomainEvent('order.paid', () => void seen.push('x'), { pluginId: 'a' })
    const { id } = await raise()
    docs.set(`pluginEventOutbox/${id}`, { ...docs.get(`pluginEventOutbox/${id}`), leaseUntilMs: 50_000 })
    expect(await attemptPluginEvent(firestore, id, 2_000)).toBe('leased')
    expect(seen).toEqual([])
  })

  it("waits out a locked site's events untouched", async () => {
    subscribePluginDomainEvent('order.paid', () => undefined, { pluginId: 'a' })
    await raise()
    const result = await drainPluginEvents({ isLocked: async () => true }, firestore, 2_000)
    expect(result.skippedLocked).toBe(1)
    expect(docs.size).toBe(1)
  })

  it('deletes an event nobody subscribes to', async () => {
    await raise()
    await drainPluginEvents(open, firestore, 2_000)
    expect(docs.size).toBe(0)
  })
})
