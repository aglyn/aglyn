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

/*==========================================
 * AN IN-MEMORY ADMIN FIRESTORE, for the register operations' specs
 * (AGL-3609) — the CRM's transfer double (AGL-3527), kept beside the
 * commerce specs because one plugin's testing helpers are not another's
 * to import.
 *
 * Documents by path; the operators the CRM's transfer hooks and the job
 * engine issue — `where` (equality, ranges, `in`, the array operators),
 * `orderBy` (a field or the document id), `limit`, `startAfter`, `count`,
 * `getAll`, batches and read-then-write transactions — and the write
 * sentinels (`delete`, `serverTimestamp`, `arrayUnion`, `arrayRemove`,
 * `increment`) applied along dotted paths, as Firestore applies them.
 *
 * A spec mocks `firebase-admin/firestore` with {@link memoryFirestoreModule}
 * so the code under test builds its sentinels from the same table.
 *=========================================*/

type Data = Record<string, unknown>

interface Sentinel {
  __sentinel: 'delete' | 'serverTimestamp' | 'arrayUnion' | 'arrayRemove' | 'increment'
  values?: unknown[]
  by?: number
}

const DOCUMENT_ID = { __documentId: true }

/** What a spec hands `jest.mock('firebase-admin/firestore', …)`. */
export const memoryFirestoreModule = {
  __esModule: true,
  FieldValue: {
    delete: (): Sentinel => ({ __sentinel: 'delete' }),
    serverTimestamp: (): Sentinel => ({ __sentinel: 'serverTimestamp' }),
    arrayUnion: (...values: unknown[]): Sentinel => ({ __sentinel: 'arrayUnion', values }),
    arrayRemove: (...values: unknown[]): Sentinel => ({ __sentinel: 'arrayRemove', values }),
    increment: (by: number): Sentinel => ({ __sentinel: 'increment', by }),
  },
  FieldPath: { documentId: () => DOCUMENT_ID },
  Timestamp: { fromDate: (date: Date) => date.getTime() },
}

const isSentinel = (value: unknown): value is Sentinel =>
  Boolean(value && typeof value === 'object' && '__sentinel' in (value as object))

const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))

function readPath(data: Data | undefined, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Data | undefined)?.[key], data)
}

export interface MemoryFirestore {
  /** Every document, by full path. */
  docs: Map<string, Data>
  /** The clock `serverTimestamp` writes. */
  now: () => number
  firestore: FirebaseFirestore.Firestore
  /** Seeds one document at its full path. */
  seed: (path: string, data: Data) => void
  /** A document's data, or `undefined`. */
  read: (path: string) => Data | undefined
}

/** A fresh in-memory Firestore. */
export function memoryFirestore(clock: () => number = () => 1_800_000_000_000): MemoryFirestore {
  const docs = new Map<string, Data>()
  /** A write counter per path, for the transaction's concurrency check. */
  const versions = new Map<string, number>()
  const bump = (path: string) => versions.set(path, (versions.get(path) ?? 0) + 1)

  const resolve = (value: unknown, current: unknown): unknown => {
    if (!isSentinel(value)) return Array.isArray(value) || (value && typeof value === 'object') ? copy(value) : value
    switch (value.__sentinel) {
      case 'serverTimestamp':
        return clock()
      case 'arrayUnion':
        return [...new Set([...(Array.isArray(current) ? current : []), ...(value.values ?? [])])]
      case 'arrayRemove':
        return (Array.isArray(current) ? current : []).filter((entry) => !(value.values ?? []).includes(entry))
      case 'increment':
        return Number(current ?? 0) + Number(value.by ?? 0)
      default:
        return undefined
    }
  }

  /** Writes `value` at a dotted path, a `delete` sentinel removing the leaf. */
  const writePath = (target: Data, path: string, value: unknown): void => {
    const keys = path.split('.')
    let node = target
    for (const key of keys.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== 'object') node[key] = {}
      node = node[key] as Data
    }
    const leaf = keys[keys.length - 1] as string
    if (isSentinel(value) && value.__sentinel === 'delete') delete node[leaf]
    else node[leaf] = resolve(value, node[leaf])
  }

  /** Every top-level key of `data` with sentinels resolved (a `set`). */
  const settle = (data: Data, base: Data = {}): Data => {
    const next = copy(base)
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      if (isSentinel(value)) writePath(next, key, value)
      else if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
        next[key] = settle(value as Data, base[key] as Data)
      } else next[key] = resolve(value, next[key])
    }
    return next
  }

  const snapshot = (path: string): any => {
    const data = docs.get(path)
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      ref: docRef(path),
      exists: data !== undefined,
      data: () => copy(data),
      get: (field: string) => copy(readPath(data, field)),
    }
  }

  const docRef = (path: string): any => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get firestore() {
      return firestore
    },
    get parent() {
      return collectionRef(path.slice(0, path.lastIndexOf('/')))
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshot(path),
    set: async (data: Data, options?: { merge?: boolean }) => {
      docs.set(path, settle(data, options?.merge ? (docs.get(path) ?? {}) : {}))
      bump(path)
    },
    create: async (data: Data) => {
      if (docs.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS: ${path}`), { code: 6 })
      docs.set(path, settle(data))
      bump(path)
    },
    update: async (...args: unknown[]) => {
      const current = docs.get(path)
      if (!current) throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
      const patch: Data =
        typeof args[0] === 'string'
          ? Object.fromEntries(
              Array.from({ length: args.length / 2 }, (_unused, at) => [String(args[at * 2]), args[at * 2 + 1]]),
            )
          : (args[0] as Data)
      const next = copy(current)
      for (const [key, value] of Object.entries(patch)) writePath(next, key, value)
      docs.set(path, next)
      bump(path)
    },
    delete: async () => {
      docs.delete(path)
      bump(path)
    },
  })

  interface QueryState {
    path: string
    filters: Array<{ field: string | typeof DOCUMENT_ID; op: string; value: unknown }>
    order: Array<{ field: string | typeof DOCUMENT_ID; direction: 'asc' | 'desc' }>
    limit?: number
    after?: any
  }

  const fieldOf = (data: Data | undefined, id: string, field: string | typeof DOCUMENT_ID) =>
    field === DOCUMENT_ID ? id : readPath(data, field as string)

  const compare = (a: unknown, b: unknown): number => {
    if (a === b) return 0
    if (a === undefined || a === null) return -1
    if (b === undefined || b === null) return 1
    return (a as number) < (b as number) ? -1 : 1
  }

  const matches = (data: Data, id: string, filter: QueryState['filters'][number]): boolean => {
    const value = fieldOf(data, id, filter.field)
    const wanted = filter.value
    switch (filter.op) {
      case '==':
        return JSON.stringify(value) === JSON.stringify(wanted)
      case '!=':
        return value !== undefined && JSON.stringify(value) !== JSON.stringify(wanted)
      case 'in':
        return (wanted as unknown[]).some((entry) => JSON.stringify(entry) === JSON.stringify(value))
      case 'not-in':
        return value !== undefined && !(wanted as unknown[]).some((entry) => JSON.stringify(entry) === JSON.stringify(value))
      case 'array-contains':
        return Array.isArray(value) && value.includes(wanted)
      case 'array-contains-any':
        return Array.isArray(value) && value.some((entry) => (wanted as unknown[]).includes(entry))
      case '<':
        return value !== undefined && compare(value, wanted) < 0
      case '<=':
        return value !== undefined && compare(value, wanted) <= 0
      case '>':
        return value !== undefined && compare(value, wanted) > 0
      case '>=':
        return value !== undefined && compare(value, wanted) >= 0
      default:
        throw new Error(`memory firestore: no operator ${filter.op}`)
    }
  }

  const run = (state: QueryState): any[] => {
    const prefix = `${state.path}/`
    let found = [...docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, data]) => ({ path, id: path.slice(prefix.length), data }))
      .filter((entry) => state.filters.every((filter) => matches(entry.data, entry.id, filter)))
    const order = state.order.length ? state.order : [{ field: DOCUMENT_ID, direction: 'asc' as const }]
    for (const { field } of order) {
      if (field !== DOCUMENT_ID) found = found.filter((entry) => readPath(entry.data, field as string) !== undefined)
    }
    found.sort((a, b) => {
      for (const { field, direction } of [...order, { field: DOCUMENT_ID, direction: 'asc' as const }]) {
        const result = compare(fieldOf(a.data, a.id, field), fieldOf(b.data, b.id, field))
        if (result) return direction === 'desc' ? -result : result
      }
      return 0
    })
    if (state.after) {
      const at = found.findIndex((entry) => entry.id === state.after.id)
      found = at >= 0 ? found.slice(at + 1) : found
    }
    if (state.limit !== undefined) found = found.slice(0, state.limit)
    return found.map((entry) => snapshot(entry.path))
  }

  const query = (state: QueryState): any => ({
    where: (field: string | typeof DOCUMENT_ID, op: string, value: unknown) =>
      query({ ...state, filters: [...state.filters, { field, op, value }] }),
    orderBy: (field: string | typeof DOCUMENT_ID, direction: 'asc' | 'desc' = 'asc') =>
      query({ ...state, order: [...state.order, { field, direction }] }),
    limit: (count: number) => query({ ...state, limit: count }),
    startAfter: (after: any) => query({ ...state, after }),
    get: async () => {
      const found = run(state)
      return { docs: found, empty: !found.length, size: found.length }
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: run({ ...state, limit: undefined }).length }) }),
    }),
  })

  const collectionRef = (path: string): any => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    get parent() {
      const at = path.lastIndexOf('/')
      return at > 0 ? docRef(path.slice(0, at)) : null
    },
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${Math.random().toString(36).slice(2, 12)}`}`),
    ...query({ path, filters: [], order: [] }),
  })

  const firestore = {
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((ref) => snapshot(ref.path)),
    batch: () => {
      const staged: Array<() => Promise<void>> = []
      const batch = {
        set: (ref: any, data: Data, options?: { merge?: boolean }) => (staged.push(() => ref.set(data, options)), batch),
        create: (ref: any, data: Data) => (staged.push(() => ref.create(data)), batch),
        update: (ref: any, ...args: unknown[]) => (staged.push(() => ref.update(...args)), batch),
        delete: (ref: any) => (staged.push(() => ref.delete()), batch),
        commit: async () => {
          for (const write of staged) await write()
        },
      }
      return batch
    },
    /**
     * Read-then-write with OPTIMISTIC CONCURRENCY, as the server SDK commits
     * one: every document the body read is versioned, and a commit that finds
     * one of them written since is thrown away and the body run again. Two
     * transactions racing on one document therefore end the way they do in
     * Firestore — the second re-reads the first one's write — which is the
     * property a one-open-shift or a lockout counter rests on.
     */
    runTransaction: async <T>(body: (transaction: any) => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const staged: Array<() => Promise<void>> = []
        const seen = new Map<string, number>()
        const transaction = {
          get: async (target: any) => {
            const result = await target.get()
            if (typeof target.path === 'string' && !('docs' in result)) {
              seen.set(target.path, versions.get(target.path) ?? 0)
            } else if (result?.docs) {
              for (const doc of result.docs) seen.set(doc.ref.path, versions.get(doc.ref.path) ?? 0)
            }
            return result
          },
          set: (ref: any, data: Data, options?: { merge?: boolean }) => (staged.push(() => ref.set(data, options)), transaction),
          create: (ref: any, data: Data) => (staged.push(() => ref.create(data)), transaction),
          update: (ref: any, ...args: unknown[]) => (staged.push(() => ref.update(...args)), transaction),
          delete: (ref: any) => (staged.push(() => ref.delete()), transaction),
        }
        const result = await body(transaction)
        const stale = [...seen].some(([path, version]) => (versions.get(path) ?? 0) !== version)
        if (stale) continue
        // Every write starts before any is awaited, so the commit is atomic
        // against another transaction checking its own reads.
        await Promise.all(staged.map((write) => write()))
        return result
      }
      throw new Error('memory firestore: transaction contended too many times')
    },
  }

  return {
    docs,
    now: clock,
    firestore: firestore as unknown as FirebaseFirestore.Firestore,
    seed: (path, data) => docs.set(path, copy(data)),
    read: (path) => copy(docs.get(path)),
  }
}
