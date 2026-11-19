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

import { FieldValue } from 'firebase-admin/firestore'

/**
 * An in-memory Firestore for the specs of the site settings and page writers
 * (AGL-4235): documents by path, a transaction and a batch whose `update`
 * reads dotted keys as paths and honors `FieldValue.delete()`, and the
 * ordered, paged collection reads `paginate` makes. Every write is recorded, in order, so a
 * spec can say exactly what a save stored and what it announced.
 *
 * Only what those writers and their handlers use. A spec double, never
 * shipped behaviour.
 */

export interface RecordedWrite {
  op: 'update' | 'set' | 'delete'
  path: string
  data?: Record<string, unknown>
}

const DELETE = FieldValue.delete()
const SERVER_TIME = FieldValue.serverTimestamp()

const isSentinel = (value: unknown, sentinel: FieldValue): boolean =>
  Boolean(value) && typeof (value as { isEqual?: unknown }).isEqual === 'function' && sentinel.isEqual(value as FieldValue)

/** What a stored server timestamp reads back as here. */
export const SERVER_TIMESTAMP = 'serverTimestamp'

function resolveValue(value: unknown): unknown {
  return isSentinel(value, SERVER_TIME) ? SERVER_TIMESTAMP : value
}

function applyUpdate(target: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    const keys = key.split('.')
    const leaf = keys.pop() as string
    let node = target
    for (const part of keys) {
      const child = node[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
    if (isSentinel(value, DELETE)) delete node[leaf]
    else node[leaf] = resolveValue(value)
  }
}

export function settingsFirestoreDouble(seed: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(
    Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
  )
  const writes: RecordedWrite[] = []
  let ids = 0

  const snapshotOf = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : structuredClone(data)),
      get: (field: string) =>
        field.split('.').reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), data),
    }
  }

  const doc = (path: string): Record<string, unknown> => ({
    path,
    id: path.slice(path.lastIndexOf('/') + 1),
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    delete: async () => {
      writes.push({ op: 'delete', path })
      docs.delete(path)
    },
    // A reference's own writes, outside a transaction or batch: what an
    // idempotency claim makes (`create`, then a merge-`set` or a `delete`).
    create: async (data: Record<string, unknown>) => {
      if (docs.has(path)) throw Object.assign(new Error(`document exists at ${path}`), { code: 6 })
      const next: Record<string, unknown> = {}
      applyUpdate(next, data)
      docs.set(path, next)
      writes.push({ op: 'set', path, data })
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const next: Record<string, unknown> = options?.merge ? (docs.get(path) ?? {}) : {}
      applyUpdate(next, data)
      docs.set(path, next)
      writes.push({ op: 'set', path, data })
    },
  })

  const collection = (path: string, state: { limit?: number; after?: string } = {}): Record<string, unknown> => ({
    path,
    doc: (id?: string) => doc(`${path}/${id ?? `auto-${++ids}`}`),
    // A projection reads the same documents here; what it keeps off the wire
    // is no concern of a double.
    select: () => collection(path, state),
    orderBy: () => collection(path, state),
    where: () => collection(path, state),
    limit: (limit: number) => collection(path, { ...state, limit }),
    startAfter: (after: string) => collection(path, { ...state, after }),
    get: async () => {
      const prefix = `${path}/`
      const all = [...docs.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .sort()
        .map((key) => snapshotOf(key))
        .filter((snapshot) => (state.after ? snapshot.id > state.after : true))
      const page = state.limit === undefined ? all : all.slice(0, state.limit)
      return { docs: page, empty: page.length === 0, size: page.length }
    },
  })

  /**
   * The writes a transaction or a batch stages, applied in order at commit.
   * A merge-set merges its top-level keys into what is stored; a `create`
   * over a document that exists fails as Firestore does, with code 6.
   */
  const writer = (staged: Array<() => void>) => ({
    update: (ref: { path: string }, data: Record<string, unknown>) => {
      staged.push(() => {
        const current = docs.get(ref.path)
        if (!current) throw new Error(`no document to update at ${ref.path}`)
        applyUpdate(current, data)
        writes.push({ op: 'update', path: ref.path, data })
      })
    },
    set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      staged.push(() => {
        const next: Record<string, unknown> = options?.merge ? (docs.get(ref.path) ?? {}) : {}
        applyUpdate(next, data)
        docs.set(ref.path, next)
        writes.push({ op: 'set', path: ref.path, data })
      })
    },
    // A staged delete (AGL-4235: a published draft), recorded like the rest.
    delete: (ref: { path: string }) => {
      staged.push(() => {
        docs.delete(ref.path)
        writes.push({ op: 'delete', path: ref.path })
      })
    },
    create: (ref: { path: string }, data: Record<string, unknown>) => {
      staged.push(() => {
        if (docs.has(ref.path)) throw Object.assign(new Error(`document exists at ${ref.path}`), { code: 6 })
        const next: Record<string, unknown> = {}
        applyUpdate(next, data)
        docs.set(ref.path, next)
        writes.push({ op: 'set', path: ref.path, data })
      })
    },
  })

  /** Applies staged writes all or none: a failing one restores what was stored. */
  const commitAll = (staged: Array<() => void>) => {
    const before = new Map([...docs.entries()].map(([path, data]) => [path, structuredClone(data)]))
    const recorded = writes.length
    try {
      for (const commit of staged) commit()
    } catch (error) {
      docs.clear()
      for (const [path, data] of before) docs.set(path, data)
      writes.length = recorded
      throw error
    }
  }

  const runTransaction = async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
    const staged: Array<() => void> = []
    const tx = {
      // A document by its path, or a query (a collection, narrowed or not) by its documents.
      get: async (ref: { path: string; doc?: unknown; get?: () => Promise<unknown> }) =>
        typeof ref.doc === 'function' && ref.get ? ref.get() : snapshotOf(ref.path),
      ...writer(staged),
    }
    const result = await run(tx)
    commitAll(staged)
    return result
  }

  const batch = () => {
    const staged: Array<() => void> = []
    return { ...writer(staged), commit: async () => commitAll(staged) }
  }

  const firestore = { collection: (name: string) => collection(name), runTransaction, batch } as unknown as FirebaseFirestore.Firestore
  return {
    firestore,
    docs,
    writes,
    /** The stored document at `path`, as data. */
    read: (path: string) => docs.get(path),
    /** The outbox entries written, by path. */
    outbox: () => [...docs.entries()].filter(([path]) => path.startsWith('publishOutbox/')),
  }
}
