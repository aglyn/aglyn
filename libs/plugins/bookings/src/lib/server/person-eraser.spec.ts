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

/**
 * BOOKINGS' SHARE OF A PERSON ERASURE (AGL-2623, AGL-3080), called the way
 * the erasure calls it. The whole erasure runs in
 * `apps/console/specs/person-erasure.spec.ts`.
 */

import { createBookingsPersonEraser } from './person-eraser'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
  },
}))

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
}

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

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshot(path),
    update: async (value: Record<string, any>) => {
      const existing = docs.get(path)
      if (existing === undefined) throw new Error(`NOT_FOUND ${path}`)
      docs.set(path, applyPatch(existing, value))
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>, max?: number): any => ({
    where: (field: string, _op: string, value: unknown) => make([...filters, [field, value]], max),
    limit: (n: number) => make(filters, n),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every(([field, value]) => snap.data()?.[field] === value))
        .slice(0, max ?? Number.POSITIVE_INFINITY)
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  return make([])
}

const store: any = {
  collection: (name: string) => collectionRef(name),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      delete: (ref: any) => void queued.push(() => ref.delete()),
      update: (ref: any, value: Record<string, any>) => void queued.push(() => ref.update(value)),
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
}

const ORG = 'org1'
const EMAIL = 'jane@example.com'
const REQUEST = { orgId: ORG, email: EMAIL, key: 'k', dryRun: false, atMs: 777, contactIds: [] }

const eraser = createBookingsPersonEraser({ firestore: () => store })

beforeEach(() => {
  docs.clear()
  docs.set('hosts/h1', { orgId: ORG })
  docs.set('hosts/h2', { orgId: ORG })
  docs.set('hosts/other', { orgId: 'org2' })
  docs.set('hosts/h2/bookings/b1', {
    email: EMAIL,
    name: 'Jane',
    phone: '+15125550107',
    // The job address an on-site service asked for (AGL-3493).
    address: '12 Oak St\nAustin, TX 78701',
    serviceId: 's1',
  })
  docs.set('hosts/h2/bookings/b2', { email: 'someone@else.com', name: 'Other', serviceId: 's1' })
  docs.set('hosts/other/bookings/b3', { email: EMAIL, name: 'Jane', serviceId: 's9' })
})

describe('bookings’ person eraser', () => {
  it('takes the person off every booking on the workspace’s sites, and keeps the booking', async () => {
    expect(await eraser(REQUEST)).toEqual({ bookings: 1 })
    const booking = docs.get('hosts/h2/bookings/b1')
    expect(booking).toMatchObject({ email: null, serviceId: 's1', customerErasedAtMs: 777 })
    expect(booking).not.toHaveProperty('name')
    expect(booking).not.toHaveProperty('phone')
    expect(booking).not.toHaveProperty('address')
    expect(docs.get('hosts/h2/bookings/b2')?.email).toBe('someone@else.com')
    expect(docs.get('hosts/other/bookings/b3')?.email).toBe(EMAIL)
  })

  it('counts on a dry run, and writes nothing', async () => {
    const before = new Map(docs)
    expect(await eraser({ ...REQUEST, dryRun: true })).toEqual({ bookings: 1 })
    expect(docs).toEqual(before)
  })
})
