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

/*
 * A stand-in for the `firebase/firestore` functions the mobile data layer
 * calls, recording each query as plain data so a spec can read exactly what
 * would have been asked of Firestore. Install with
 * `jest.mock('firebase/firestore', () => firestoreDouble.module)`.
 */

type Doc = { id: string; data: Record<string, unknown> }

export interface RecordedQuery {
  path: string
  constraints: unknown[]
}

export function createFirestoreDouble() {
  const collections = new Map<string, Doc[]>()
  const docs = new Map<string, Record<string, unknown>>()
  const queries: RecordedQuery[] = []
  const writes: Array<{ kind: string; path: string; data?: unknown }> = []
  let autoIds = 0
  let failNextCommit: unknown = null
  const docSnapshot = (ref: { path: string; id: string }) => {
    const data = docs.get(ref.path)
    return { id: ref.id, exists: () => data !== undefined, data: () => data, get: (key: string) => data?.[key] }
  }
  const snapshotOf = (doc: Doc) => ({ id: doc.id, data: () => doc.data, exists: () => true })
  const sdk = {
    collection: (_db: unknown, ...segments: string[]) => ({ kind: 'collection', path: segments.join('/') }),
    doc: (parent: { kind?: string; path?: string }, ...segments: string[]) => {
      // `doc(collectionRef)` mints an id, as the SDK does without a round trip.
      const path =
        parent?.kind === 'collection'
          ? [parent.path, ...(segments.length ? segments : [`auto${(autoIds += 1)}`])].join('/')
          : segments.join('/')
      return { kind: 'doc', path, id: path.split('/').pop() }
    },
    documentId: () => '__name__',
    where: (path: unknown, op: string, value: unknown) => ({ type: 'where', path, op, value }),
    orderBy: (path: unknown, direction = 'asc') => ({ type: 'orderBy', path, direction }),
    limit: (count: number) => ({ type: 'limit', count }),
    startAfter: (cursor: { id: string }) => ({ type: 'startAfter', id: cursor.id }),
    Timestamp: { fromDate: (date: Date) => ({ ms: date.getTime() }), fromMillis: (ms: number) => ({ ms }) },
    query: (ref: { path: string }, ...constraints: unknown[]) => ({ path: ref.path, constraints }),
    getDocs: async (q: { path: string; constraints: Array<{ type: string; count?: number; id?: string }> }) => {
      queries.push({ path: q.path, constraints: q.constraints })
      let rows = collections.get(q.path) ?? []
      const after = q.constraints.find((c) => c.type === 'startAfter')
      if (after) rows = rows.slice(rows.findIndex((row) => row.id === after.id) + 1)
      const cap = q.constraints.find((c) => c.type === 'limit')?.count
      return { docs: (cap == null ? rows : rows.slice(0, cap)).map(snapshotOf) }
    },
    getDoc: async (ref: { path: string; id: string }) => docSnapshot(ref),
    deleteField: () => ({ deleteField: true }),
    deleteDoc: async (ref: { path: string }) => {
      writes.push({ kind: 'delete', path: ref.path })
    },
    runTransaction: async (_db: unknown, run: (transaction: unknown) => Promise<unknown>) => {
      const staged: Array<{ kind: string; path: string; data?: unknown }> = []
      const result = await run({
        get: async (ref: { path: string; id: string }) => docSnapshot(ref),
        update: (ref: { path: string }, data: unknown) => staged.push({ kind: 'update', path: ref.path, data }),
        set: (ref: { path: string }, data: unknown) => staged.push({ kind: 'set', path: ref.path, data }),
      })
      if (failNextCommit) {
        const error = failNextCommit
        failNextCommit = null
        throw error
      }
      writes.push(...staged)
      return result
    },
    serverTimestamp: () => ({ serverTimestamp: true }),
    increment: (by: number) => ({ increment: by }),
    updateDoc: async (ref: { path: string }, data: unknown) => {
      writes.push({ kind: 'update', path: ref.path, data })
    },
    getCountFromServer: async (q: { path: string; constraints: unknown[] }) => {
      queries.push({ path: q.path, constraints: q.constraints })
      return { data: () => ({ count: (collections.get(q.path) ?? []).length }) }
    },
  }
  return {
    module: sdk,
    /** Refuses the next transaction's commit with this error. */
    failNextCommit: (error: unknown) => {
      failNextCommit = error
    },
    reset: () => {
      queries.length = 0
      writes.length = 0
      collections.clear()
      docs.clear()
    },
    queries,
    writes,
    setCollection: (path: string, rows: Doc[]) => collections.set(path, rows),
    setDoc: (path: string, data: Record<string, unknown>) => docs.set(path, data),
    db: {} as never,
  }
}

/** An API client that records each call and answers from `respond`. */
export function createApiDouble(respond: (path: string, init: unknown) => unknown = () => ({ ok: true })) {
  const calls: Array<{ path: string; init: any }> = []
  return {
    calls,
    client: {
      request: async <T,>(path: string, init: unknown): Promise<T> => {
        calls.push({ path, init })
        return (await respond(path, init)) as T
      },
    },
  }
}

/**
 * The one double a spec file shares with its `jest.mock` factory, which is
 * hoisted above the spec's own bindings and so must reach it by `require`:
 * `jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)`.
 */
export const firestoreDouble = createFirestoreDouble()
