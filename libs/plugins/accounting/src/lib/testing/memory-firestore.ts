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
 * An in-memory Firestore for the accounting specs (AGL-3614): documents by
 * full path, subcollections, `where` with `==`, `<`, `<=`, `>=`, `>`, `in`,
 * `orderBy`, `limit`, `count()`, `create` that refuses an existing document
 * with ALREADY_EXISTS, dotted-path `update`, batches, collection groups, and
 * a transaction whose writes land after its body. Enough of the API for the
 * code under test, and nothing it does not call.
 */

type Data = Record<string, any>

export interface MemoryFirestore {
  /** The store, by full document path. */
  readonly documents: Map<string, Data>
  /** Seeds or reads one document by path. */
  seed(path: string, data: Data): void
  read(path: string): Data | undefined
  collection(path: string): any
  collectionGroup(id: string): any
  batch(): any
  runTransaction<T>(body: (transaction: any) => Promise<T>): Promise<T>
}

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

function setPath(target: Data, dotted: string, value: unknown): void {
  const parts = dotted.split('.')
  let node = target
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {}
    node = node[part]
  }
  node[parts[parts.length - 1]] = value
}

function getPath(target: Data | undefined, dotted: string): any {
  return dotted.split('.').reduce<any>((node, part) => (node == null ? undefined : node[part]), target)
}

export function memoryFirestore(): MemoryFirestore {
  const documents = new Map<string, Data>()

  const snapshot = (path: string) => {
    const data = documents.get(path)
    const id = path.split('/').pop() as string
    return {
      id,
      ref: docRef(path),
      exists: data !== undefined,
      get: (field: string) => getPath(data, field),
      data: () => clone(data),
    }
  }

  function docRef(path: string): any {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => snapshot(path),
      set: async (data: Data, options?: { merge?: boolean }) => {
        documents.set(path, options?.merge ? { ...(documents.get(path) ?? {}), ...clone(data) } : clone(data))
      },
      create: async (data: Data) => {
        if (documents.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
        documents.set(path, clone(data))
      },
      update: async (data: Data) => {
        const current = documents.get(path)
        if (!current) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
        const next = clone(current)
        for (const [key, value] of Object.entries(data)) setPath(next, key, clone(value))
        documents.set(path, next)
      },
      delete: async () => {
        documents.delete(path)
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    }
  }

  type Filter = { field: string; op: string; value: any }

  function query(
    matches: (path: string) => boolean,
    filters: Filter[],
    order: { field: string; dir: 'asc' | 'desc' } | null,
    max: number | null,
  ): any {
    const run = () => {
      let paths = [...documents.keys()].filter(matches)
      paths = paths.filter((path) =>
        filters.every(({ field, op, value }) => {
          const actual = getPath(documents.get(path), field)
          switch (op) {
            case '==':
              return actual === value
            case '<':
              return actual < value
            case '<=':
              return actual <= value
            case '>':
              return actual > value
            case '>=':
              return actual >= value
            case 'in':
              return (value as any[]).includes(actual)
            default:
              throw new Error(`memory-firestore: unsupported operator ${op}`)
          }
        }),
      )
      if (order) {
        paths.sort((a, b) => {
          const left = getPath(documents.get(a), order.field)
          const right = getPath(documents.get(b), order.field)
          const result = left < right ? -1 : left > right ? 1 : a.localeCompare(b)
          return order.dir === 'desc' ? -result : result
        })
      }
      if (max !== null) paths = paths.slice(0, max)
      return paths
    }
    return {
      where: (field: string, op: string, value: any) => query(matches, [...filters, { field, op, value }], order, max),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => query(matches, filters, { field, dir }, max),
      limit: (n: number) => query(matches, filters, order, n),
      count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
      get: async () => {
        const docs = run().map(snapshot)
        return { docs, size: docs.length, empty: docs.length === 0 }
      },
    }
  }

  function collectionRef(path: string): any {
    const depth = path.split('/').length + 1
    const inCollection = (candidate: string) =>
      candidate.startsWith(`${path}/`) && candidate.split('/').length === depth
    return {
      ...query(inCollection, [], null, null),
      id: path.split('/').pop(),
      doc: (id: string) => docRef(`${path}/${id}`),
    }
  }

  return {
    documents,
    seed: (path, data) => void documents.set(path, clone(data)),
    read: (path) => clone(documents.get(path)),
    collection: collectionRef,
    collectionGroup: (id: string) =>
      query((candidate) => candidate.split('/').slice(-2, -1)[0] === id && candidate.split('/').length % 2 === 0, [], null, null),
    batch() {
      const writes: Array<() => Promise<void>> = []
      const batch = {
        create: (ref: any, data: Data) => (writes.push(() => ref.create(data)), batch),
        set: (ref: any, data: Data, options?: { merge?: boolean }) => (writes.push(() => ref.set(data, options)), batch),
        update: (ref: any, data: Data) => (writes.push(() => ref.update(data)), batch),
        delete: (ref: any) => (writes.push(() => ref.delete()), batch),
        commit: async () => {
          for (const write of writes) await write()
        },
      }
      return batch
    },
    async runTransaction<T>(body: (transaction: any) => Promise<T>): Promise<T> {
      const writes: Array<() => Promise<void>> = []
      const transaction = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Data, options?: { merge?: boolean }) => (writes.push(() => ref.set(data, options)), transaction),
        update: (ref: any, data: Data) => (writes.push(() => ref.update(data)), transaction),
        create: (ref: any, data: Data) => (writes.push(() => ref.create(data)), transaction),
        delete: (ref: any) => (writes.push(() => ref.delete()), transaction),
      }
      const result = await body(transaction)
      for (const write of writes) await write()
      return result
    },
  }
}

/** The Firestore type the code under test expects, from the memory store. */
export const asFirestore = (store: MemoryFirestore) => store as unknown as FirebaseFirestore.Firestore
