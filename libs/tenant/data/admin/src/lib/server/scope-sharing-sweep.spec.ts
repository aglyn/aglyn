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
  registerPluginScopeSharingPatch,
  resetScopeSharingPatchesForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-scope-sharing'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import {
  MAX_SWEEP_ATTEMPTS,
  orgHostIdsFromDoc,
  resumeScopeSweeps,
  runScopeSharingSweep,
  scopeSharingDriftForOrg,
  sweepScopeSharingAfterSiteChange,
} from './scope-sharing-sweep'

type Doc = Record<string, unknown>

/**
 * The little of Firestore the sweep uses, counting what it costs. The real
 * query shape and transaction are pinned in the emulator spec beside this.
 */
function fakeFirestore(seed: Record<string, Doc>) {
  const store = new Map(Object.entries(seed).map(([path, doc]) => [path, { ...doc }]))
  const cost = { queries: 0, docReads: 0, writes: 0, failWrites: new Set<string>() }
  const snap = (path: string) => ({
    id: path.split('/').pop() as string,
    exists: store.has(path),
    ref: docRef(path),
    data: () => store.get(path),
    get: (field: string) => store.get(path)?.[field],
  })
  const applyUpdate = (path: string, data: Doc) => {
    if (cost.failWrites.has(path)) throw new Error('write refused')
    cost.writes += 1
    const next = { ...(store.get(path) ?? {}) }
    for (const [key, value] of Object.entries(data)) {
      if (FieldValue.delete().isEqual(value as never)) delete next[key]
      else next[key] = value
    }
    store.set(path, next)
  }
  function docRef(path: string): any {
    const segments = path.split('/')
    return {
      id: segments[segments.length - 1],
      path,
      get parent() {
        const collectionPath = segments.slice(0, -1).join('/')
        return { parent: segments.length > 2 ? docRef(segments.slice(0, -2).join('/')) : null, path: collectionPath }
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
      get: async () => {
        cost.docReads += 1
        return snap(path)
      },
      set: async (data: Doc) => {
        cost.writes += 1
        store.set(path, { ...data })
      },
      update: async (data: Doc) => applyUpdate(path, data),
      delete: async () => {
        cost.writes += 1
        store.delete(path)
      },
    }
  }
  const direct = (prefix: string) =>
    [...store.keys()]
      .filter((key) => key.startsWith(`${prefix}/`) && !key.slice(prefix.length + 1).includes('/'))
      .sort()
  function queryOver(prefix: string, filter?: [string, unknown], after?: string, max = 10_000): any {
    return {
      where: (field: string, _op: string, value: unknown) => queryOver(prefix, [field, value], after, max),
      orderBy: () => queryOver(prefix, filter, after, max),
      startAfter: (id: string) => queryOver(prefix, filter, id, max),
      limit: (count: number) => queryOver(prefix, filter, after, count),
      get: async () => {
        cost.queries += 1
        const docs = direct(prefix)
          .filter((path) => !filter || store.get(path)?.[filter[0]] === filter[1])
          .filter((path) => !after || (path.split('/').pop() as string) > after)
          .slice(0, max)
          .map(snap)
        cost.docReads += docs.length
        return { docs }
      },
    }
  }
  let autoId = 0
  function collectionRef(path: string): any {
    return {
      ...queryOver(path),
      doc: (id?: string) => {
        autoId += 1
        return docRef(`${path}/${id ?? `auto-${autoId}`}`)
      },
    }
  }
  const db = {
    collection: (name: string) => collectionRef(name),
    collectionGroup: (name: string) => ({
      limit: (count: number) => ({
        get: async () => {
          cost.queries += 1
          const docs = [...store.keys()]
            .filter((key) => key.split('/').slice(-2, -1)[0] === name)
            .sort()
            .slice(0, count)
            .map(snap)
          cost.docReads += docs.length
          return { docs }
        },
      }),
    }),
    runTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        getAll: async (...refs: Array<{ path: string }>) => {
          cost.docReads += refs.length
          return refs.map((ref) => snap(ref.path))
        },
        update: (ref: { path: string }, data: Doc) => applyUpdate(ref.path, data),
      }),
  }
  return { db: db as unknown as Firestore, store, cost }
}

const marked = (visibleTo: string[], except: string[], extra: Doc = {}): Doc => ({
  visibleTo,
  scopeMode: 'allExcept',
  scopeExcept: except,
  ...extra,
})
const ORG = { 'orgs/o1': { hosts: { a: true, b: true, c: true } } }
/** One query per declared collection: what the design says nothing costs. */
const DECLARED_COLLECTIONS = 11

describe('orgHostIdsFromDoc', () => {
  it('reads the sites the org map names', () => {
    expect(orgHostIdsFromDoc({ hosts: { a: true, b: true, off: false } })).toEqual(['a', 'b'])
    expect(orgHostIdsFromDoc({})).toEqual([])
    expect(orgHostIdsFromDoc(undefined)).toEqual([])
    expect(orgHostIdsFromDoc({ hosts: ['a'] })).toEqual([])
  })
})

describe('a sweep when nothing is marked, which is every workspace today', () => {
  it('costs one query per collection and no write, however much unmarked data there is', async () => {
    const { db, store, cost } = fakeFirestore({
      ...ORG,
      'orgs/o1/datasets/d1': { visibleTo: ['org'] },
      'orgs/o1/datasets/d2': { visibleTo: ['host:a'] },
      'orgs/o1/contacts/c1': { visibleTo: ['org'], scopedSearchTokens: ['org#x'] },
      'orgs/o1/media/m1': { visibleTo: ['host:gone'] },
    })
    const before = JSON.stringify([...store])
    await sweepScopeSharingAfterSiteChange({ orgId: 'o1', reason: 'site-added', hostId: 'c', firestore: db })
    expect(cost.queries).toBe(DECLARED_COLLECTIONS)
    expect(cost.docReads).toBe(0)
    expect(cost.writes).toBe(0)
    expect(JSON.stringify([...store])).toBe(before)
  })

  it('leaves no sweep document, so the job has nothing to read', async () => {
    const { db, cost } = fakeFirestore(ORG)
    await sweepScopeSharingAfterSiteChange({ orgId: 'o1', reason: 'site-removed', firestore: db })
    cost.queries = 0
    expect(await resumeScopeSweeps({ firestore: db })).toEqual({ resumed: 0, finished: 0, droppedAfterFailing: 0 })
    expect(cost.queries).toBe(1)
    expect(cost.docReads).toBe(0)
  })
})

describe('runScopeSharingSweep', () => {
  it('brings a marked document level and removes nothing else', async () => {
    const { db, store } = fakeFirestore({
      ...ORG,
      'orgs/o1/datasets/d1': marked(['host:b'], ['host:a'], { displayName: 'Menu', updatedAt: 1 }),
      'orgs/o1/datasets/d2': { visibleTo: ['host:a'], displayName: 'Own' },
    })
    const result = await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    expect(result).toMatchObject({ marked: 1, changed: 1, failed: 0, complete: true })
    expect(store.get('orgs/o1/datasets/d1')).toEqual(
      marked(['host:b', 'host:c'], ['host:a'], { displayName: 'Menu', updatedAt: 1 }),
    )
    expect(store.get('orgs/o1/datasets/d2')).toEqual({ visibleTo: ['host:a'], displayName: 'Own' })
  })

  it('NEGATIVE CONTROL: an unmarked document naming a gone site is not touched', async () => {
    const { db, store } = fakeFirestore({ ...ORG, 'orgs/o1/media/m1': { visibleTo: ['host:gone'] } })
    await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    expect(store.get('orgs/o1/media/m1')).toEqual({ visibleTo: ['host:gone'] })
  })

  it('writes nothing to a document already level', async () => {
    const { db, cost } = fakeFirestore({ ...ORG, 'orgs/o1/media/m1': marked(['host:b', 'host:c'], ['host:a']) })
    const result = await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    expect(result).toMatchObject({ marked: 1, changed: 0 })
    expect(cost.writes).toBe(0)
  })

  it('is idempotent: a second run writes nothing', async () => {
    const { db, cost } = fakeFirestore({ ...ORG, 'orgs/o1/media/m1': marked(['host:gone'], ['host:a']) })
    await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    cost.writes = 0
    expect((await runScopeSharingSweep({ orgId: 'o1', firestore: db })).changed).toBe(0)
    expect(cost.writes).toBe(0)
  })

  it('deletes the marker when the last exclusion is gone, rather than storing nulls', async () => {
    const { db, store } = fakeFirestore({
      'orgs/o1': { hosts: { b: true } },
      'orgs/o1/automations/a1': marked(['host:b'], ['host:gone']),
    })
    await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    expect(store.get('orgs/o1/automations/a1')).toEqual({ visibleTo: ['org'] })
  })

  it('keeps the document when only excluded sites remain', async () => {
    const { db, store } = fakeFirestore({
      'orgs/o1': { hosts: { a: true } },
      'orgs/o1/datasets/d1': marked(['host:b'], ['host:a']),
    })
    await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    expect(store.get('orgs/o1/datasets/d1')).toEqual(marked([], ['host:a']))
  })

  it('walks every declared collection, past a full page', async () => {
    const seed: Record<string, Doc> = { ...ORG }
    for (let at = 0; at < 250; at += 1) {
      seed[`orgs/o1/media/m${String(at).padStart(3, '0')}`] = marked(['host:b'], ['host:a'])
    }
    seed['orgs/o1/emailCampaigns/e1'] = marked(['host:b'], ['host:a'])
    seed['orgs/o1/mediaFolders/f1'] = marked(['host:b'], ['host:a'])
    const { db, store } = fakeFirestore(seed)
    const result = await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    expect(result).toMatchObject({ marked: 252, changed: 252, complete: true })
    expect(store.get('orgs/o1/media/m249')?.['visibleTo']).toEqual(['host:b', 'host:c'])
    expect(store.get('orgs/o1/emailCampaigns/e1')?.['visibleTo']).toEqual(['host:b', 'host:c'])
  })

  it('stops at its budget and resumes where it stopped, missing nothing', async () => {
    const seed: Record<string, Doc> = { ...ORG }
    for (let at = 0; at < 250; at += 1) {
      seed[`orgs/o1/media/m${String(at).padStart(3, '0')}`] = marked(['host:b'], ['host:a'])
    }
    seed['orgs/o1/datasets/d1'] = marked(['host:b'], ['host:a'])
    const { db, store } = fakeFirestore(seed)
    const stopped = await runScopeSharingSweep({ orgId: 'o1', firestore: db, budgetMs: 0 })
    expect(stopped.complete).toBe(false)
    expect(stopped.cursor).toEqual({ collection: 'media', afterId: null })
    expect(stopped.changed).toBe(0)
    const finished = await runScopeSharingSweep({ orgId: 'o1', firestore: db, from: stopped.cursor })
    expect(finished.complete).toBe(true)
    expect(finished.changed).toBe(251)
    expect(store.get('orgs/o1/datasets/d1')?.['visibleTo']).toEqual(['host:b', 'host:c'])
  })

  it('resumes after the cursor in its collection', async () => {
    const { db, store } = fakeFirestore({
      ...ORG,
      'orgs/o1/media/m1': marked(['host:b'], ['host:a']),
      'orgs/o1/media/m2': marked(['host:b'], ['host:a']),
    })
    const result = await runScopeSharingSweep({
      orgId: 'o1',
      firestore: db,
      from: { collection: 'media', afterId: 'm1' },
    })
    expect(result.changed).toBe(1)
    expect(store.get('orgs/o1/media/m1')?.['visibleTo']).toEqual(['host:b'])
    expect(store.get('orgs/o1/media/m2')?.['visibleTo']).toEqual(['host:b', 'host:c'])
  })

  it('counts a damaged marker and leaves the document as it is', async () => {
    const damaged = { visibleTo: ['host:b'], scopeMode: 'allExcept', scopeExcept: 'host:a' }
    const { db, store } = fakeFirestore({ ...ORG, 'orgs/o1/datasets/d1': damaged })
    expect((await runScopeSharingSweep({ orgId: 'o1', firestore: db })).invalid).toBe(1)
    expect(store.get('orgs/o1/datasets/d1')).toEqual(damaged)
  })

  it('goes on past a document that fails, and says so', async () => {
    const { db, store, cost } = fakeFirestore({
      ...ORG,
      'orgs/o1/media/m1': marked(['host:b'], ['host:a']),
      'orgs/o1/media/m2': marked(['host:b'], ['host:a']),
    })
    cost.failWrites.add('orgs/o1/media/m1')
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await runScopeSharingSweep({ orgId: 'o1', firestore: db })
    error.mockRestore()
    expect(result).toMatchObject({ failed: 1, changed: 1, complete: true })
    expect(store.get('orgs/o1/media/m2')?.['visibleTo']).toEqual(['host:b', 'host:c'])
  })

  describe('a collection whose stored fields follow its sites', () => {
    afterEach(() => resetScopeSharingPatchesForTests())

    it('stamps them in the same write, from the document as it will read', async () => {
      const patch = jest.fn((_collection: string, next: Doc) => ({
        scopedSearchTokens: (next['visibleTo'] as string[]).map((token) => `${token}#word`),
      }))
      registerPluginScopeSharingPatch(['contacts'], patch, { pluginId: 'crm' })
      const { db, store } = fakeFirestore({ ...ORG, 'orgs/o1/contacts/c1': marked(['host:b'], ['host:a'], { email: 'x@example.com' }) })
      await runScopeSharingSweep({ orgId: 'o1', firestore: db })
      expect(patch).toHaveBeenCalledWith('contacts', expect.objectContaining({ visibleTo: ['host:b', 'host:c'], email: 'x@example.com' }))
      expect(store.get('orgs/o1/contacts/c1')?.['scopedSearchTokens']).toEqual(['host:b#word', 'host:c#word'])
    })

    it('refuses to write without the patch, rather than leave its list wrong', async () => {
      const { db, store } = fakeFirestore({ ...ORG, 'orgs/o1/contacts/c1': marked(['host:b'], ['host:a']) })
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      const result = await runScopeSharingSweep({ orgId: 'o1', firestore: db })
      error.mockRestore()
      expect(result.failed).toBe(1)
      expect(store.get('orgs/o1/contacts/c1')?.['visibleTo']).toEqual(['host:b'])
    })

    it('holds to the limit, and keeps the site that captured the person', async () => {
      registerPluginScopeSharingPatch(['leads'], () => ({}), { pluginId: 'crm' })
      const hosts = Object.fromEntries(Array.from({ length: 40 }, (_, at) => [`h${at}`, true]))
      const { db, store } = fakeFirestore({
        'orgs/o1': { hosts },
        'orgs/o1/leads/l1': marked(['host:h1'], ['host:h0']),
        'orgs/o1/crmActivities/x1': marked(['host:h1'], ['host:h0']),
      })
      const result = await runScopeSharingSweep({ orgId: 'o1', firestore: db })
      expect(result.capped).toBe(2)
      expect(store.get('orgs/o1/leads/l1')?.['visibleTo']).toEqual(['host:h1'])
    })

    it('keeps a capturing site on a record though it is excluded', async () => {
      registerPluginScopeSharingPatch(['contacts'], () => ({}), { pluginId: 'crm' })
      const { db, store } = fakeFirestore({
        ...ORG,
        'orgs/o1/contacts/c1': marked(['host:b', 'host:c'], ['host:a'], { capturedByHostIds: ['a'] }),
        'orgs/o1/datasets/d1': marked(['host:b', 'host:c'], ['host:a'], { capturedByHostIds: ['a'], hostId: 'a' }),
      })
      await runScopeSharingSweep({ orgId: 'o1', firestore: db })
      expect(store.get('orgs/o1/contacts/c1')?.['visibleTo']).toEqual(['host:a', 'host:b', 'host:c'])
      // Only where the collection declares it: a dataset's excluded site stays out.
      expect(store.get('orgs/o1/datasets/d1')?.['visibleTo']).toEqual(['host:b', 'host:c'])
    })
  })
})

describe('sweepScopeSharingAfterSiteChange', () => {
  const sweepDocs = (store: Map<string, Doc>) =>
    [...store.keys()].filter((key) => key.includes('/scopeSweeps/'))

  it('finishes inline and leaves no sweep document', async () => {
    const { db, store } = fakeFirestore({ ...ORG, 'orgs/o1/media/m1': marked(['host:b'], ['host:a']) })
    await sweepScopeSharingAfterSiteChange({ orgId: 'o1', reason: 'site-added', hostId: 'c', firestore: db })
    expect(store.get('orgs/o1/media/m1')?.['visibleTo']).toEqual(['host:b', 'host:c'])
    expect(sweepDocs(store)).toEqual([])
  })

  it('never throws, and leaves the work for the job when a query fails', async () => {
    const { db, store } = fakeFirestore(ORG)
    const real = db.collection.bind(db)
    let failing = true
    ;(db as unknown as { collection: (name: string) => unknown }).collection = (name: string) => {
      const collection = real(name) as any
      return {
        ...collection,
        doc: (id?: string) => {
          const doc = collection.doc(id)
          return {
            ...doc,
            collection: (sub: string) => {
              if (failing && sub !== 'scopeSweeps') {
                return { where: () => { throw new Error('unavailable') } }
              }
              return doc.collection(sub)
            },
          }
        },
      }
    }
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      sweepScopeSharingAfterSiteChange({ orgId: 'o1', reason: 'site-added', hostId: 'c', firestore: db }),
    ).resolves.toBeUndefined()
    error.mockRestore()
    failing = false
    const left = sweepDocs(store)
    expect(left).toHaveLength(1)
    expect(store.get(left[0])).toMatchObject({ reason: 'site-added', hostId: 'c', attempts: 1, cursor: null })
  })

  it('leaves a failing document for the job to retry', async () => {
    const { db, store, cost } = fakeFirestore({ ...ORG, 'orgs/o1/media/m1': marked(['host:b'], ['host:a']) })
    cost.failWrites.add('orgs/o1/media/m1')
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await sweepScopeSharingAfterSiteChange({ orgId: 'o1', reason: 'site-removed', firestore: db })
    error.mockRestore()
    expect(sweepDocs(store)).toHaveLength(1)
    cost.failWrites.clear()
    expect(await resumeScopeSweeps({ firestore: db })).toEqual({ resumed: 1, finished: 1, droppedAfterFailing: 0 })
    expect(store.get('orgs/o1/media/m1')?.['visibleTo']).toEqual(['host:b', 'host:c'])
    expect(sweepDocs(store)).toEqual([])
  })
})

describe('resumeScopeSweeps', () => {
  it('carries a sweep on from its cursor, and deletes it when done', async () => {
    const { db, store } = fakeFirestore({
      ...ORG,
      'orgs/o1/scopeSweeps/s1': { cursor: { collection: 'media', afterId: 'm1' }, attempts: 0 },
      'orgs/o1/media/m1': marked(['host:b'], ['host:a']),
      'orgs/o1/media/m2': marked(['host:b'], ['host:a']),
    })
    expect(await resumeScopeSweeps({ firestore: db })).toEqual({ resumed: 1, finished: 1, droppedAfterFailing: 0 })
    expect(store.get('orgs/o1/media/m1')?.['visibleTo']).toEqual(['host:b'])
    expect(store.get('orgs/o1/media/m2')?.['visibleTo']).toEqual(['host:b', 'host:c'])
    expect(store.has('orgs/o1/scopeSweeps/s1')).toBe(false)
  })

  it('drops a sweep whose workspace was erased', async () => {
    const { db, store } = fakeFirestore({ 'orgs/gone/scopeSweeps/s1': { cursor: null, attempts: 0 } })
    expect((await resumeScopeSweeps({ firestore: db })).finished).toBe(1)
    expect(store.has('orgs/gone/scopeSweeps/s1')).toBe(false)
  })

  it('counts an attempt on failure, and gives up rather than hold a place forever', async () => {
    const { db, store, cost } = fakeFirestore({
      ...ORG,
      'orgs/o1/scopeSweeps/s1': { cursor: null, attempts: 0 },
      'orgs/o1/media/m1': marked(['host:b'], ['host:a']),
    })
    cost.failWrites.add('orgs/o1/media/m1')
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await resumeScopeSweeps({ firestore: db })
    expect(store.get('orgs/o1/scopeSweeps/s1')?.['attempts']).toBe(1)
    store.set('orgs/o1/scopeSweeps/s1', { cursor: null, attempts: MAX_SWEEP_ATTEMPTS - 1 })
    expect((await resumeScopeSweeps({ firestore: db })).droppedAfterFailing).toBe(1)
    error.mockRestore()
    expect(store.has('orgs/o1/scopeSweeps/s1')).toBe(false)
    // What it left is still there for the drift report to count.
    expect(store.get('orgs/o1/media/m1')?.['visibleTo']).toEqual(['host:b'])
  })
})

describe('scopeSharingDriftForOrg', () => {
  it('costs one query per collection when nothing is marked', async () => {
    const { db, cost } = fakeFirestore({ ...ORG, 'orgs/o1/media/m1': { visibleTo: ['org'] } })
    const drift = await scopeSharingDriftForOrg(db.collection('orgs').doc('o1'), ORG['orgs/o1'])
    expect(drift).toEqual({ marked: 0, stale: 0, capped: 0, invalid: 0 })
    expect(cost.queries).toBe(DECLARED_COLLECTIONS)
    expect(cost.docReads).toBe(0)
  })

  it('counts what a sweep would write, and writes nothing', async () => {
    const hosts = Object.fromEntries(Array.from({ length: 40 }, (_, at) => [`h${at}`, true]))
    const { db, cost } = fakeFirestore({
      'orgs/o1': { hosts },
      'orgs/o1/media/m1': marked(['host:h1'], ['host:h0']),
      'orgs/o1/media/m2': { visibleTo: ['host:h1'], scopeMode: 'allExcept', scopeExcept: 'bad' },
      'orgs/o1/leads/l1': marked(['host:h1'], ['host:h0']),
      'orgs/o1/leads/l2': marked(['host:h1', 'host:gone'], ['host:h0']),
    })
    const drift = await scopeSharingDriftForOrg(db.collection('orgs').doc('o1'), { hosts })
    expect(drift).toEqual({ marked: 4, stale: 2, capped: 2, invalid: 1 })
    expect(cost.writes).toBe(0)
  })
})
