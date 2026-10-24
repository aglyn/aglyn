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
 * THE SITE'S OWN DATASETS GO WITH IT (AGL-4003).
 *
 * Datasets belong to the organization and name no site, so a deleted site
 * left behind every list made for it: 53 of them outlived their AI test sites
 * in one workspace. The sharing says whose a dataset is. Shared with this
 * site alone, it is erased with its records; shared with this site and
 * others, it stays and loses this site; shared with every site, it does not
 * name the site and is left as it is.
 *
 * Firestore is faked with a REAL `array-contains` filter: a `where` that
 * ignored its arguments would make the bystander cases pass whether or not
 * the sweep was bounded.
 */

type Doc = Record<string, unknown>

const store = new Map<string, Doc>()
const REMOVE = Symbol('arrayRemove')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { arrayRemove: (...values: unknown[]) => ({ [REMOVE]: values }) },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => {
      throw new Error('the spec hands in its own Firestore')
    },
  },
}))

function docRef(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    async update(value: Doc) {
      const previous = store.get(path)
      if (!previous) throw new Error('NOT_FOUND')
      const next: Doc = { ...previous }
      for (const [key, entry] of Object.entries(value)) {
        const removed = (entry as { [REMOVE]?: unknown[] })?.[REMOVE]
        next[key] = removed
          ? ((previous[key] as unknown[]) ?? []).filter((held) => !removed.includes(held))
          : entry
      }
      store.set(path, next)
    },
  }
}

function children(path: string): string[] {
  return [...store.keys()].filter(
    (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
  )
}

function collectionRef(path: string) {
  const query = (rows: string[]) => ({
    where: (field: string, op: string, value: unknown) =>
      query(
        rows.filter((key) => {
          const held = store.get(key)?.[field]
          return op === 'array-contains' ? Array.isArray(held) && held.includes(value) : held === value
        }),
      ),
    count: () => ({ get: async () => ({ data: () => ({ count: rows.length }) }) }),
    async get() {
      const docs = rows.map((key) => ({
        id: key.split('/').pop(),
        ref: docRef(key),
        get: (field: string) => store.get(key)?.[field],
      }))
      return { docs, size: docs.length }
    },
  })
  return { doc: (id: string) => docRef(`${path}/${id}`), ...query(children(path)) }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  async recursiveDelete(ref: { path: string }) {
    for (const key of [...store.keys()]) {
      if (key === ref.path || key.startsWith(`${ref.path}/`)) store.delete(key)
    }
  },
}

import { datasetIsSiteOnly, eraseSiteDatasets, previewSiteDatasets } from './dataset-site-erasure'

const deps = { firestore: () => firestore as never }
const REQUEST = { orgId: 'org-1', hostId: 'host-1' }
const ONLY = 'orgs/org-1/datasets/only'
const SECOND = 'orgs/org-1/datasets/second'
const SHARED = 'orgs/org-1/datasets/shared'
const EVERY = 'orgs/org-1/datasets/every'
const OTHER = 'orgs/org-1/datasets/other'
const ELSEWHERE = 'orgs/org-2/datasets/only'

beforeEach(() => {
  store.clear()
  store.set(ONLY, { displayName: 'Photography packages', visibleTo: ['host:host-1'] })
  store.set(`${ONLY}/records/r1`, { values: { name: 'Elopement' } })
  store.set(`${ONLY}/records/r2`, { values: { name: 'Wedding day' } })
  store.set(SECOND, { displayName: 'Gallery collections', visibleTo: ['host:host-1'] })
  store.set(SHARED, { displayName: 'Team', visibleTo: ['host:host-1', 'host:host-2'] })
  store.set(`${SHARED}/records/r1`, { values: { name: 'Ana' } })
  store.set(EVERY, { displayName: 'Leads', visibleTo: ['org'] })
  store.set(`${EVERY}/records/r1`, { values: { name: 'A lead' } })
  store.set(OTHER, { displayName: 'Menu', visibleTo: ['host:host-2'] })
  store.set(ELSEWHERE, { displayName: 'Same id elsewhere', visibleTo: ['host:host-1'] })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a deleted site’s own datasets (AGL-4003)', () => {
  it('reads a dataset as the site’s only when its sharing names that site alone', () => {
    expect(datasetIsSiteOnly(['host:host-1'], 'host-1')).toBe(true)
    expect(datasetIsSiteOnly(['host:host-1', 'host:host-1'], 'host-1')).toBe(true)
    expect(datasetIsSiteOnly(['host:host-1', 'host:host-2'], 'host-1')).toBe(false)
    expect(datasetIsSiteOnly(['org'], 'host-1')).toBe(false)
    expect(datasetIsSiteOnly([], 'host-1')).toBe(false)
    expect(datasetIsSiteOnly(undefined, 'host-1')).toBe(false)
  })

  it('erases the datasets shared with the site alone, with their records', async () => {
    expect(await eraseSiteDatasets(REQUEST, deps)).toBe(2)

    expect(store.has(ONLY)).toBe(false)
    expect(store.has(`${ONLY}/records/r1`)).toBe(false)
    expect(store.has(`${ONLY}/records/r2`)).toBe(false)
    expect(store.has(SECOND)).toBe(false)
  })

  it('keeps a dataset the site shares with others, without the site', async () => {
    await eraseSiteDatasets(REQUEST, deps)

    expect(store.get(SHARED)?.['visibleTo']).toEqual(['host:host-2'])
    expect(store.has(`${SHARED}/records/r1`)).toBe(true)
  })

  it('leaves All-sites datasets, other sites’ own, and other workspaces as they are', async () => {
    await eraseSiteDatasets(REQUEST, deps)

    expect(store.get(EVERY)).toEqual({ displayName: 'Leads', visibleTo: ['org'] })
    expect(store.has(`${EVERY}/records/r1`)).toBe(true)
    expect(store.get(OTHER)).toEqual({ displayName: 'Menu', visibleTo: ['host:host-2'] })
    expect(store.has(ELSEWHERE)).toBe(true)
  })

  it('previews exactly what the erase does, by name with record counts, and changes nothing', async () => {
    const before = new Map(store)

    expect(await previewSiteDatasets(REQUEST, deps)).toEqual({
      noun: ['dataset', 'datasets'],
      itemNoun: ['record', 'records'],
      going: [
        { id: 'second', name: 'Gallery collections', items: 0 },
        { id: 'only', name: 'Photography packages', items: 2 },
      ],
      staying: 1,
    })
    expect(new Map(store)).toEqual(before)
  })
})
