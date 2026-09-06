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
  countPendingPersonErasures,
  PERSON_ERASURES_COUNTED,
  PERSON_ERASURES_PER_RUN,
  runPersonErasures,
} from './run-person-erasures'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => { throw new Error('inject the store') } }) },
  erasePerson: async () => {
    throw new Error('inject the sweep')
  },
}))

/*
 * The queue as a map of request documents. `orderBy('pendingSinceMs')`
 * lists only the documents that carry the field, ascending — the property
 * the runner leans on to see exactly the waiting ones.
 */
const requests = new Map<string, Record<string, any>>()

function applyPatch(existing: Record<string, any>, patch: Record<string, any>) {
  const next = { ...existing }
  for (const [field, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__delete' in value) delete next[field]
    else if (value && typeof value === 'object' && '__increment' in value) {
      next[field] = Number(next[field] ?? 0) + Number(value.__increment)
    } else next[field] = value
  }
  return next
}

const store = {
  collection: (name: string) => {
    if (name !== 'personErasures') throw new Error(`unexpected collection ${name}`)
    return {
      orderBy: (field: string, direction: string) => ({
        limit: (max: number) => ({
          get: async () => {
            const docs = [...requests.entries()]
              .filter(([, data]) => typeof data[field] === 'number')
              .sort(([, a], [, b]) => (direction === 'asc' ? a[field] - b[field] : b[field] - a[field]))
              .slice(0, max)
              .map(([id, data]) => ({
                id,
                get: (key: string) => data[key],
                data: () => data,
                ref: {
                  update: async (patch: Record<string, any>) => {
                    requests.set(id, applyPatch(requests.get(id) ?? {}, patch))
                  },
                },
              }))
            return { size: docs.length, docs }
          },
        }),
      }),
    }
  },
}

const pending = (id: string, pendingSinceMs: number, over: Record<string, any> = {}) =>
  requests.set(id, {
    orgId: 'org1',
    personKey: id,
    status: 'pending',
    email: `${id}@example.com`,
    requestedAtMs: pendingSinceMs,
    pendingSinceMs,
    ...over,
  })

const okSweep = async () => ({
  ok: true as const,
  hosts: 1,
  hostsSuppressed: 1,
  contacts: 1,
  companyLinks: 0,
  deals: 0,
  tasks: 0,
  activities: 0,
  leads: 1,
  listMemberships: 0,
  orders: 0,
  bookings: 0,
  emailDeliveries: 2,
})

beforeEach(() => {
  requests.clear()
})

describe('runPersonErasures', () => {
  it('drains the oldest requests first, up to the batch', async () => {
    pending('c', 3)
    pending('a', 1)
    pending('b', 2)
    const erase = jest.fn((_options: { email: string }) => okSweep())
    const result = await runPersonErasures({ firestore: store, erase, limit: 2, now: 100 })
    expect(erase.mock.calls.map(([options]) => options.email)).toEqual(['a@example.com', 'b@example.com'])
    expect(result).toEqual({ erased: ['a', 'b'], failed: [], scanned: 2 })
    // The third is still exactly where it was, for tomorrow.
    expect(requests.get('c')).toMatchObject({ status: 'pending', pendingSinceMs: 3 })
  })

  it('marks a completed request erased, keeps its counts, and drops the address', async () => {
    pending('a', 1)
    await runPersonErasures({ firestore: store, erase: okSweep, now: 100 })
    const done = requests.get('a')
    expect(done).toMatchObject({
      status: 'erased',
      erasedAtMs: 100,
      result: { contacts: 1, leads: 1, emailDeliveries: 2 },
    })
    expect(done).not.toHaveProperty('email')
    expect(done).not.toHaveProperty('pendingSinceMs')
    // A completed request is no longer listed as waiting.
    expect((await countPendingPersonErasures(store)).pending).toBe(0)
  })

  it('hands the sweep the workspace, the address and the same store', async () => {
    pending('a', 1, { orgId: 'org9' })
    const erase = jest.fn(okSweep)
    await runPersonErasures({ firestore: store, erase, now: 100 })
    expect(erase).toHaveBeenCalledWith({ orgId: 'org9', email: 'a@example.com', firestore: store, now: 100 })
  })

  it('a throw on one request still erases the rest, and sends the failed one to the back', async () => {
    pending('a', 1)
    pending('b', 2)
    pending('c', 3)
    const erase = jest.fn(async (options: { email: string }) => {
      if (options.email === 'a@example.com') throw new Error('recursiveDelete exploded')
      return okSweep()
    })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runPersonErasures({ firestore: store, erase, now: 100 })
    spy.mockRestore()
    expect(result.erased).toEqual(['b', 'c'])
    expect(result.failed).toEqual([{ requestId: 'a', reason: 'recursiveDelete exploded' }])
    expect(requests.get('a')).toMatchObject({
      status: 'failed',
      failedAtMs: 100,
      failureCount: 1,
      lastError: 'recursiveDelete exploded',
      // Still waiting — but behind everything filed before now.
      pendingSinceMs: 100,
      email: 'a@example.com',
    })
  })

  it('treats a refused sweep as a failure rather than a completion', async () => {
    pending('a', 1)
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runPersonErasures({
      firestore: store,
      erase: async () => ({ ok: false as const, skippedReason: 'invalid-email' as const }),
      now: 100,
    })
    spy.mockRestore()
    expect(result.failed).toEqual([{ requestId: 'a', reason: 'invalid-email' }])
    expect(requests.get('a')?.status).toBe('failed')
  })

  it('fails a request that lost its address without calling the sweep', async () => {
    pending('a', 1, { email: undefined })
    const erase = jest.fn(okSweep)
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runPersonErasures({ firestore: store, erase, now: 100 })
    spy.mockRestore()
    expect(erase).not.toHaveBeenCalled()
    expect(result.failed).toHaveLength(1)
  })

  it('defaults to the batch size', async () => {
    for (let index = 0; index < PERSON_ERASURES_PER_RUN + 3; index += 1) pending(`r${index}`, index)
    const result = await runPersonErasures({ firestore: store, erase: okSweep, now: 100 })
    expect(result.scanned).toBe(PERSON_ERASURES_PER_RUN)
  })
})

describe('countPendingPersonErasures', () => {
  it('counts what is waiting and says when the count is a floor', async () => {
    pending('a', 1)
    pending('b', 2)
    requests.set('done', { status: 'erased', erasedAtMs: 5 })
    expect(await countPendingPersonErasures(store)).toEqual({
      pending: 2,
      truncated: false,
      maxPerRun: PERSON_ERASURES_PER_RUN,
    })
    for (let index = 0; index < PERSON_ERASURES_COUNTED + 1; index += 1) pending(`r${index}`, 10 + index)
    const many = await countPendingPersonErasures(store)
    expect(many.pending).toBe(PERSON_ERASURES_COUNTED)
    expect(many.truncated).toBe(true)
  })
})
