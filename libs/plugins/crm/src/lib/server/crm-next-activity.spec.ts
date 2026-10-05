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
 * The `nextTaskAtMs` writer (AGL-2661), over an in-memory Firestore.
 *
 * What has to hold: a recompute reads the record's tasks through ONE
 * equality on the link field and stores the earliest OPEN due time — or
 * `null` — on the record and nothing else; a record the task outlived is
 * skipped, never created; the org sweep writes each named record once and
 * clears the ones that carry a stale time.
 */

import {
  recomputeCrmNextTaskAt,
  sweepCrmNextTaskAt,
} from './crm-next-activity'

type Doc = Record<string, unknown>
let store: Record<string, Doc> = {}
let updates: Array<{ path: string; data: Doc }> = []

const NOT_FOUND = Object.assign(new Error('NOT_FOUND'), { code: 5 })

function docRef(path: string) {
  return {
    id: path.slice(path.lastIndexOf('/') + 1),
    update: async (data: Doc) => {
      if (!(path in store)) throw NOT_FOUND
      updates.push({ path, data })
      store[path] = { ...store[path], ...data }
    },
  }
}

function snapshotsUnder(prefix: string, test: (doc: Doc) => boolean) {
  return Object.entries(store)
    .filter(([path, doc]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/') && test(doc))
    .map(([path, doc]) => ({
      id: path.slice(path.lastIndexOf('/') + 1),
      get: (field: string) => doc[field],
      ref: docRef(path),
    }))
}

function collectionRef(path: string) {
  const build = (test: (doc: Doc) => boolean, cap: number) => ({
    where: (field: string, op: string, value: unknown) =>
      build(
        (doc) =>
          test(doc) && (op === '==' ? doc[field] === value : typeof doc[field] === 'number' && (doc[field] as number) > (value as number)),
        cap,
      ),
    limit: (n: number) => build(test, n),
    get: async () => ({ docs: snapshotsUnder(path, test).slice(0, cap) }),
  })
  return { ...build(() => true, Infinity), doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({ collection: (sub: string) => collectionRef(`${name}/${id}/${sub}`) }),
  }),
} as unknown as FirebaseFirestore.Firestore

beforeEach(() => {
  store = {
    'orgs/o1/contacts/c1': { name: 'Ada' },
    'orgs/o1/companies/k1': { name: 'Acme' },
    'orgs/o1/deals/d1': { status: 'open' },
    'orgs/o1/deals/d-stale': { status: 'open', nextTaskAtMs: 999 },
    'orgs/o1/crmTasks/t1': { status: 'open', dueAtMs: 500, contactId: 'c1', dealId: 'd1' },
    'orgs/o1/crmTasks/t2': { status: 'open', dueAtMs: 300, contactId: 'c1' },
    'orgs/o1/crmTasks/t3': { status: 'done', dueAtMs: 100, contactId: 'c1', companyId: 'k1' },
    'orgs/o1/crmTasks/t4': { status: 'open', dueAtMs: null, companyId: 'k1' },
  }
  updates = []
})

describe('recomputeCrmNextTaskAt (AGL-2661)', () => {
  it('stores the earliest open due time per named record, and null where nothing is scheduled', async () => {
    const result = await recomputeCrmNextTaskAt(firestore, 'o1', [
      { contactId: 'c1', dealId: 'd1' },
      { companyId: 'k1' },
    ])
    expect(result).toEqual({ records: 3, missing: 0 })
    expect(store['orgs/o1/contacts/c1'].nextTaskAtMs).toBe(300)
    expect(store['orgs/o1/deals/d1'].nextTaskAtMs).toBe(500)
    expect(store['orgs/o1/companies/k1'].nextTaskAtMs).toBeNull()
    // The one field, and nothing else — `updatedAt` is the person's edit.
    expect(updates.every((entry) => Object.keys(entry.data).join() === 'nextTaskAtMs')).toBe(true)
  })

  it('skips a record the task outlived rather than creating it', async () => {
    const result = await recomputeCrmNextTaskAt(firestore, 'o1', [{ dealId: 'gone' }])
    expect(result).toEqual({ records: 0, missing: 1 })
    expect(store['orgs/o1/deals/gone']).toBeUndefined()
  })
})

describe('sweepCrmNextTaskAt', () => {
  it('writes every record an open task names once and clears the stale ones', async () => {
    const sweep = await sweepCrmNextTaskAt(firestore, 'o1')
    expect(sweep).toEqual({ tasks: 3, scheduled: 3, cleared: 1, truncated: false })
    expect(store['orgs/o1/contacts/c1'].nextTaskAtMs).toBe(300)
    expect(store['orgs/o1/deals/d1'].nextTaskAtMs).toBe(500)
    expect(store['orgs/o1/companies/k1'].nextTaskAtMs).toBeNull()
    expect(store['orgs/o1/deals/d-stale'].nextTaskAtMs).toBeNull()
    expect(updates.filter((entry) => entry.path === 'orgs/o1/contacts/c1')).toHaveLength(1)
  })

  /*
   * "Nothing schedules this record" is a claim about every open task, so a
   * partial read may not make it: past the cap the sweep writes what it saw
   * and clears nothing, leaving a stale time stale rather than blanking a
   * record whose task it never read.
   */
  it('says so when the org holds more open tasks than it reads, and clears nothing', async () => {
    const sweep = await sweepCrmNextTaskAt(firestore, 'o1', { max: 2 })
    expect(sweep.truncated).toBe(true)
    expect(sweep.tasks).toBe(2)
    expect(sweep.cleared).toBe(0)
    expect(store['orgs/o1/deals/d-stale'].nextTaskAtMs).toBe(999)
  })
})
