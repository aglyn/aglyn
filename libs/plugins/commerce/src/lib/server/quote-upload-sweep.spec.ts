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
 * @jest-environment node
 */

import { QUOTE_UPLOAD_KEY_TTL_MS, quoteUploadKeyFiles } from './quote-upload-keys'
import { sweepQuoteUploads } from './quote-upload-sweep'

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ firebaseAdmin: {} }))

/**
 * The sweep of a customer's unsent quote files (AGL-4096), over an in-memory
 * Firestore: the files of a record whose day has passed are deleted unless an
 * answer holds them, the record goes, and nothing else is touched.
 */

const docs = new Map<string, Record<string, any>>()

const field = (data: Record<string, any> | undefined, path: string) =>
  path.split('.').reduce<any>((value, key) => value?.[key], data)

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    ref: docRef(path),
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    get: (name: string) => field(data, name),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    get: async () => {
      const children = [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      return { docs: children.map(snapshotOf) }
    },
  }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  collectionGroup: (name: string) => {
    let bound = Infinity
    let max = Infinity
    const query: any = {
      where: (_field: string, _op: '<=', value: number) => {
        bound = value
        return query
      },
      orderBy: () => query,
      limit: (count: number) => {
        max = count
        return query
      },
      get: async () => {
        const matches = [...docs.keys()]
          .filter((path) => path.split('/').slice(-2, -1)[0] === name && Number(docs.get(path)?.['sweepAtMs']) <= bound)
          .sort((a, b) => Number(docs.get(a)?.['sweepAtMs']) - Number(docs.get(b)?.['sweepAtMs']))
          .slice(0, max)
        return { empty: matches.length === 0, size: matches.length, docs: matches.map(snapshotOf) }
      },
    }
    return query
  },
  runTransaction: async <T,>(body: (transaction: any) => Promise<T>): Promise<T> => {
    const writes: Array<() => void> = []
    const answer = await body({
      get: async (ref: any) => snapshotOf(ref.path),
      set: (ref: any, data: Record<string, any>) => writes.push(() => docs.set(ref.path, JSON.parse(JSON.stringify(data)))),
      delete: (ref: any) => writes.push(() => docs.delete(ref.path)),
    })
    writes.forEach((write) => write())
    return answer
  },
}

const NOW = 100 * QUOTE_UPLOAD_KEY_TTL_MS
const ARTWORK = 'hosts/site1/private/uploads/quote-artwork'
let removed: string[] = []
let onRemove: (path: string) => void = () => undefined

const deps = {
  firestore: () => firestore,
  uploads: async () => ({
    remove: async (path: string) => {
      onRemove(path)
      removed.push(path)
    },
  }),
}

const sweep = () => sweepQuoteUploads(deps, { nowMs: NOW, deadlineMs: Date.now() + 60_000 })

const answer = (files: string[]) => ({
  action: 'changes',
  revision: 1,
  atMs: 1,
  comment: 'x',
  files: files.map((id) => ({ id, name: `${id}.ai`, contentType: 'application/illustrator', size: 9, path: `${ARTWORK}/q-1/${id}` })),
})

beforeEach(() => {
  docs.clear()
  removed = []
  onRemove = () => undefined
})

describe('the sweep of a customer’s unsent quote files', () => {
  it('deletes the files no answer holds once their day has passed, keeps the ones an answer holds, and drops the record', async () => {
    docs.set('hosts/site1/orders/q-1', { channel: 'quote', quote: { revision: 2, responses: [{ ...answer(['b2']), revision: 2 }] } })
    docs.set('hosts/site1/orders/q-1/revisions/1', { revision: 1, responses: [answer(['c3'])] })
    docs.set('hosts/site1/orders/q-1/quoteUploadKeys/q-1', {
      hostId: 'site1',
      quoteId: 'q-1',
      files: { a1: 1, b2: 2, c3: 3 },
      sweepAtMs: NOW - 1,
    })
    docs.set('hosts/site1/orders/q-2/quoteUploadKeys/q-2', { hostId: 'site1', quoteId: 'q-2', files: { d4: NOW }, sweepAtMs: NOW + 1 })

    expect(await sweep()).toEqual({ due: 1, swept: 1, kept: 2, failed: 0 })
    expect(removed).toEqual([`${ARTWORK}/q-1/a1`])
    expect(docs.has('hosts/site1/orders/q-1/quoteUploadKeys/q-1')).toBe(false)
    // Not due yet: untouched.
    expect(docs.get('hosts/site1/orders/q-2/quoteUploadKeys/q-2')).toEqual({
      hostId: 'site1',
      quoteId: 'q-2',
      files: { d4: NOW },
      sweepAtMs: NOW + 1,
    })
  })

  it('keeps a file recorded while it ran, with the sweep time that file set', async () => {
    docs.set('hosts/site1/orders/q-1', { channel: 'quote', quote: { revision: 1 } })
    const path = 'hosts/site1/orders/q-1/quoteUploadKeys/q-1'
    docs.set(path, { hostId: 'site1', quoteId: 'q-1', files: { a1: 1 }, sweepAtMs: NOW - 1 })
    onRemove = () => {
      const record = docs.get(path) as Record<string, any>
      docs.set(path, { ...record, files: { ...record['files'], e5: NOW }, sweepAtMs: NOW + QUOTE_UPLOAD_KEY_TTL_MS })
    }
    expect(await sweep()).toEqual({ due: 1, swept: 1, kept: 0, failed: 0 })
    expect(docs.get(path)).toEqual({ hostId: 'site1', quoteId: 'q-1', files: { e5: NOW }, sweepAtMs: NOW + QUOTE_UPLOAD_KEY_TTL_MS })
  })

  it('sweeps the files of a quote that is gone, and leaves a record whose file could not be deleted for the next tick', async () => {
    docs.set('hosts/site1/orders/gone/quoteUploadKeys/gone', { hostId: 'site1', quoteId: 'gone', files: { a1: 1 }, sweepAtMs: NOW - 2 })
    expect(await sweep()).toEqual({ due: 1, swept: 1, kept: 0, failed: 0 })
    expect(removed).toEqual([`${ARTWORK}/gone/a1`])
    expect(docs.size).toBe(0)

    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    docs.set('hosts/site1/orders/q-1/quoteUploadKeys/q-1', { hostId: 'site1', quoteId: 'q-1', files: { a1: 1 }, sweepAtMs: NOW - 1 })
    onRemove = () => {
      throw new Error('storage unavailable')
    }
    expect(await sweep()).toEqual({ due: 1, swept: 0, kept: 0, failed: 1 })
    expect(docs.has('hosts/site1/orders/q-1/quoteUploadKeys/q-1')).toBe(true)
    errors.mockRestore()
  })

  it('reads a record’s files defensively', () => {
    expect(quoteUploadKeyFiles({ files: { a1: 5, 'bad/id': 6, b2: 'x' } })).toEqual({ a1: 5, b2: 0 })
    expect(quoteUploadKeyFiles(undefined)).toEqual({})
  })
})
