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
 * THE PLATFORM'S PART OF A PERSON ERASURE (AGL-2623, AGL-3080): the door, the
 * order, the log and the audit. What each plugin keeps is erased by that
 * plugin through `plugin-person-erasure`, stood in here; the real shares run
 * together in `apps/console/specs/person-erasure.spec.ts`.
 */

import {
  registerPluginPersonEraser,
  registerPluginPersonRecordsEraser,
  resetPluginPersonErasersForTests,
  standInRequiredPersonErasersForTests,
  type PluginPersonErasureRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { createHash } from 'node:crypto'
import { erasePerson } from './erase-person'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
    increment: (operand: number) => ({ __increment: operand }),
  },
  Timestamp: class {},
}))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
  firebaseAdmin: { app: () => ({ firestore: () => { throw new Error('use the injected store') } }) },
}))

const mockEraseDeliveries = jest.fn(async (_addresses: unknown, _db: unknown) => ({
  removed: 3,
  addresses: ['jane@example.com'],
  contestedAddresses: [],
}))

jest.mock('./email-delivery-log', () => ({
  eraseEmailDeliveriesForAddresses: (addresses: unknown, db: unknown) =>
    mockEraseDeliveries(addresses, db),
}))

/*==========================================
 * A path-keyed store: every document is `docs.get('a/b/c/d')`. Queries
 * filter the direct children of a collection path on `==`. Enough to watch
 * what the platform's part touches.
 *=========================================*/
const docs = new Map<string, Record<string, any>>()
const audit: Record<string, any>[] = []
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
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
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : { ...value })
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  const make = (filters: Array<[string, unknown]>): any => ({
    where: (field: string, _op: string, value: unknown) => make([...filters, [field, value]]),
    limit: () => make(filters),
    get: async () => {
      const hits = childPaths(path)
        .map(snapshot)
        .filter((snap) => filters.every(([field, value]) => snap.data()?.[field] === value))
      return { empty: hits.length === 0, size: hits.length, docs: hits }
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    add: async (data: Record<string, any>) => {
      if (path === 'adminAudit') audit.push(data)
      const ref = docRef(`${path}/auto-${++autoId}`)
      await ref.set(data)
      return ref
    },
  })
  return make([])
}

const store = { collection: (name: string) => collectionRef(name) }

const ORG = 'org1'
const EMAIL = 'jane@example.com'
const KEY = createHash('sha256').update(EMAIL).digest('hex')

/** What each stand-in share was handed, and whether the door was closed by then. */
let handed: Array<{ pluginId: string; request: PluginPersonErasureRequest; doorClosed: boolean }> = []

const doorClosed = () =>
  docs.get(`hosts/h1/suppressions/${KEY}`)?.reason === 'erasure' &&
  docs.get(`hosts/h2/suppressions/${KEY}`)?.reason === 'erasure'

/** The record system and one other share, stood in, and every other required share as a no-op. */
function standInShares() {
  registerPluginPersonRecordsEraser(
    {
      locate: async () => ['c1'],
      erase: async (request) => {
        handed.push({ pluginId: 'crm', request, doorClosed: doorClosed() })
        return { contacts: request.contactIds.length }
      },
    },
    { pluginId: 'crm' },
  )
  registerPluginPersonEraser(
    async (request) => {
      handed.push({ pluginId: 'mail', request, doorClosed: doorClosed() })
      return { enrollments: 2 }
    },
    { pluginId: 'mail' },
  )
  standInRequiredPersonErasersForTests()
}

function seedWorkspace() {
  docs.set('hosts/h1', { orgId: ORG })
  docs.set('hosts/h2', { orgId: ORG })
  docs.set('hosts/other', { orgId: 'org2' })
}

beforeEach(() => {
  docs.clear()
  audit.length = 0
  autoId = 0
  handed = []
  mockEraseDeliveries.mockClear()
  resetPluginPersonErasersForTests()
  seedWorkspace()
})

describe('erasePerson', () => {
  it('refuses an address it cannot key, touching nothing', async () => {
    standInShares()
    const before = docs.size
    expect(await erasePerson({ orgId: ORG, email: 'nope', firestore: store })).toEqual({
      ok: false,
      skippedReason: 'invalid-email',
    })
    expect(docs.size).toBe(before)
    expect(handed).toEqual([])
  })

  it('refuses before writing anything while a promised share cannot run here (AGL-3080)', async () => {
    // No record system, no shop, no calendar, no audience: a boot that
    // registered none of them must not produce an erased request.
    const before = new Map(docs)
    await expect(erasePerson({ orgId: ORG, email: EMAIL, firestore: store })).rejects.toThrow(
      /refused: .*crm.*required person eraser/,
    )
    expect(docs).toEqual(before)
    expect(mockEraseDeliveries).not.toHaveBeenCalled()
  })

  it('closes every site’s door with an address-free row BEFORE any share erases', async () => {
    standInShares()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(handed.map((entry) => entry.doorClosed)).toEqual([true, true])
    expect(docs.get(`hosts/h1/suppressions/${KEY}`)?.email).toBeNull()
    expect(docs.has(`hosts/other/suppressions/${KEY}`)).toBe(false)
    expect(result).toMatchObject({ hosts: 2, hostsSuppressed: 2 })
  })

  it('hands every share the person and the records the record system named, and runs the record system last', async () => {
    standInShares()
    const result = await erasePerson({ orgId: ORG, email: ' Jane@Example.com ', firestore: store, now: 777 })
    expect(handed.map((entry) => entry.pluginId)).toEqual(['mail', 'crm'])
    for (const { request } of handed) {
      expect(request).toEqual({
        orgId: ORG,
        email: EMAIL,
        key: KEY,
        dryRun: false,
        atMs: 777,
        contactIds: ['c1'],
      })
    }
    expect(result).toMatchObject({
      ok: true,
      records: 1,
      plugins: { mail: { enrollments: 2 }, crm: { contacts: 1 } },
    })
  })

  it('sweeps the delivery log under the address and reports its count', async () => {
    standInShares()
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(mockEraseDeliveries).toHaveBeenCalledWith([{ address: EMAIL }], store)
    expect(result).toMatchObject({ emailDeliveries: 3 })
  })

  it('records counts and the hash on the audit row, never the address', async () => {
    standInShares()
    await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'person.erased',
      target: `orgs/${ORG}/people/${KEY}`,
      after: { records: 1, plugins: { mail: { enrollments: 2 }, crm: { contacts: 1 } } },
    })
    expect(JSON.stringify(audit[0])).not.toContain(EMAIL)
  })

  it('records a share it was not promised that failed as null, and still erases the person', async () => {
    standInShares()
    registerPluginPersonEraser(
      async () => {
        throw new Error('plugin store down')
      },
      { pluginId: 'mail' },
    )
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    spy.mockRestore()
    expect(result).toMatchObject({ ok: true, plugins: { mail: null, crm: { contacts: 1 } } })
  })

  it('fails, for the job to retry, when a promised share failed — after the rest ran', async () => {
    standInShares()
    registerPluginPersonEraser(
      async () => {
        throw new Error('orders unavailable')
      },
      { pluginId: 'commerce' },
    )
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(erasePerson({ orgId: ORG, email: EMAIL, firestore: store })).rejects.toThrow(
      /required eraser of commerce failed/,
    )
    spy.mockRestore()
    expect(handed.map((entry) => entry.pluginId)).toEqual(['mail', 'crm'])
  })

  it('finishes, with counts, when the delivery log sweep fails', async () => {
    standInShares()
    mockEraseDeliveries.mockRejectedValueOnce(new Error('log unavailable'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await erasePerson({ orgId: ORG, email: EMAIL, firestore: store })
    spy.mockRestore()
    expect(result).toMatchObject({ ok: true, records: 1, emailDeliveries: 0 })
  })
})
