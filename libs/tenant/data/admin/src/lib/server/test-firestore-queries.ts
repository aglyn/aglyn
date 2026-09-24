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
 * A Firestore stand-in that QUERIES (AGL-3320). Test-only; deliberately not
 * exported from the barrel, like `test-firestore.ts` beside it.
 *
 * That fake holds documents and nothing else, which is enough for code that
 * reads a document by id. A consent group change pages whole subcollections
 * by document id, filters on nested map fields, counts, writes through a
 * `BulkWriter` with `lastUpdateTime` preconditions and takes transactions —
 * and its correctness properties (a second pass writes nothing, a resumed
 * pass skips nothing) are properties of exactly those mechanics, so a fake
 * that skipped them would be asserting itself.
 *
 * What is modeled, and is load-bearing:
 *
 *  - A document missing a field never matches a filter or an ordering on it,
 *    including `!=` — the rule that makes an `orderBy` on a data field drop
 *    documents, and the reason every scan here pages by `__name__`.
 *  - `update()` needs the document to exist, replaces the value at each
 *    (dotted) path whole, and fails its `lastUpdateTime` precondition when
 *    the document was written since; `create()` fails on an existing one.
 *    The error codes are gRPC's: 5, 6, 9.
 *  - `FieldValue` sentinels are applied, not stored: `delete`,
 *    `serverTimestamp` (the fake clock), `increment`, `arrayUnion`,
 *    `arrayRemove`.
 *  - Every write moves `updateTime`, and a `BulkWriter` runs its queued
 *    writes when it is flushed or closed, rejecting each failed write's
 *    promise the way the real one does.
 *  - A transaction is SERIALIZABLE: one whose reads changed before it
 *    committed runs its body again, as the SDK retries a contended one, so
 *    two transactions racing on one document cannot both act on what they
 *    read. That is the property a start's "no change in flight" rests on.
 *
 * What is not: a `BulkWriter`'s own retries, which nothing here branches on.
 */

import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'

type Data = Record<string, any>

interface Stored {
  data: Data
  createTime: Timestamp
  updateTime: Timestamp
}

/** A Firestore-style error: the gRPC code the SDK attaches. */
function grpcError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const isTransform = (value: unknown): value is FieldValue & { methodName: string } =>
  value instanceof FieldValue

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Timestamp || value instanceof FieldValue) return value
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T
  const out: Data = {}
  for (const [key, item] of Object.entries(value as Data)) out[key] = clone(item)
  return out as T
}

/** A field as a plain dotted path; a `FieldPath`'s segments are joined unquoted. */
function fieldName(field: string | FieldPath): string {
  if (typeof field === 'string') return field
  const segments = (field as unknown as { segments?: string[] }).segments
  return Array.isArray(segments) ? segments.join('.') : String(field)
}

/** The value at a dotted path, or `undefined` when any segment is missing. */
function valueAt(data: Data | undefined, path: string): unknown {
  let node: unknown = data
  for (const segment of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
    node = (node as Data)[segment]
  }
  return node
}

/** Firestore's cross-type order: null, booleans, numbers, timestamps, strings, the rest. */
function rank(value: unknown): number {
  if (value === null) return 0
  if (typeof value === 'boolean') return 1
  if (typeof value === 'number') return 2
  if (value instanceof Timestamp) return 3
  if (typeof value === 'string') return 4
  if (Array.isArray(value)) return 6
  return 7
}

function compare(a: unknown, b: unknown): number {
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const left = JSON.stringify(a)
  const right = JSON.stringify(b)
  return left < right ? -1 : left > right ? 1 : 0
}

const equal = (a: unknown, b: unknown) => rank(a) === rank(b) && compare(a, b) === 0

interface Filter {
  field: string
  op: string
  value: unknown
}

function matches(id: string, data: Data, filter: Filter): boolean {
  const actual = filter.field === '__name__' ? id : valueAt(data, filter.field)
  if (actual === undefined) return false
  const { op, value } = filter
  switch (op) {
    case '==':
      return equal(actual, value)
    case '!=':
      return actual !== null && !equal(actual, value)
    case '<':
      return rank(actual) === rank(value) && compare(actual, value) < 0
    case '<=':
      return rank(actual) === rank(value) && compare(actual, value) <= 0
    case '>':
      return rank(actual) === rank(value) && compare(actual, value) > 0
    case '>=':
      return rank(actual) === rank(value) && compare(actual, value) >= 0
    case 'in':
      return (value as unknown[]).some((candidate) => equal(actual, candidate))
    case 'not-in':
      return actual !== null && !(value as unknown[]).some((candidate) => equal(actual, candidate))
    case 'array-contains':
      return Array.isArray(actual) && actual.some((item) => equal(item, value))
    case 'array-contains-any':
      return (
        Array.isArray(actual) &&
        actual.some((item) => (value as unknown[]).some((candidate) => equal(item, candidate)))
      )
    default:
      throw new Error(`test-firestore-queries: unsupported operator ${op}`)
  }
}

export interface QueryFakeFirestore {
  collection(path: string): any
  doc(path: string): any
  getAll(...refs: any[]): Promise<any[]>
  runTransaction<T>(body: (transaction: any) => Promise<T>): Promise<T>
  batch(): any
  bulkWriter(): any
  /** Seed or overwrite one document, with no transforms and no write counted. */
  seed(path: string, data: Data): void
  /** One document's data as stored, or `undefined`. */
  read(path: string): Data | undefined
  /** Every document directly in a collection, by id. */
  docs(collectionPath: string): Record<string, Data>
  /** Committed writes since the last reset. */
  writes(): number
  resetWrites(): void
  /** The clock `serverTimestamp()` and every `updateTime` read. */
  setNow(ms: number): void
  /** Makes the next writes to `path` fail with `error` — a stand-in for an outage. */
  failWritesTo(path: string, error: Error | null): void
}

export function queryFakeFirestore(
  seed: Record<string, Data> = {},
  options: { nowMs?: number } = {},
): QueryFakeFirestore {
  const store = new Map<string, Stored>()
  let nowMs = options.nowMs ?? Date.UTC(2026, 8, 24)
  /** Keeps every write's `updateTime` distinct even on a frozen clock. */
  let tick = 0
  let writeCount = 0
  const failing = new Map<string, Error>()
  let autoIds = 0

  const stamp = () => Timestamp.fromMillis(nowMs + (tick += 0.001))
  const nextAutoId = () => {
    autoIds += 1
    return String(autoIds).padStart(8, '0')
  }

  for (const [path, data] of Object.entries(seed)) {
    const at = Timestamp.fromMillis(nowMs)
    store.set(path, { data: clone(data), createTime: at, updateTime: at })
  }

  /** Applies a write's value at one path of `target`, honoring transforms. */
  function put(target: Data, path: string[], value: unknown, previous: unknown): void {
    const [head, ...rest] = path
    if (rest.length) {
      const child = target[head]
      const next = child && typeof child === 'object' && !Array.isArray(child) ? child : {}
      target[head] = next
      put(next, rest, value, valueAt(previous as Data, rest.join('.')))
      return
    }
    if (isTransform(value)) {
      const current = target[head]
      switch (value.methodName) {
        case 'FieldValue.delete':
          delete target[head]
          return
        case 'FieldValue.serverTimestamp':
          target[head] = Timestamp.fromMillis(nowMs)
          return
        case 'FieldValue.increment': {
          const operand = (value as unknown as { operand: number }).operand
          target[head] = (typeof current === 'number' ? current : 0) + operand
          return
        }
        case 'FieldValue.arrayUnion': {
          const elements = (value as unknown as { elements: unknown[] }).elements
          const base = Array.isArray(current) ? [...current] : []
          for (const element of elements) {
            if (!base.some((item) => equal(item, element))) base.push(element)
          }
          target[head] = base
          return
        }
        case 'FieldValue.arrayRemove': {
          const elements = (value as unknown as { elements: unknown[] }).elements
          target[head] = (Array.isArray(current) ? current : []).filter(
            (item) => !elements.some((element) => equal(item, element)),
          )
          return
        }
        default:
          throw new Error(`test-firestore-queries: unsupported transform ${value.methodName}`)
      }
    }
    target[head] = materialize(value)
  }

  /** A written value with any nested transforms resolved against nothing. */
  function materialize(value: unknown): unknown {
    if (value === undefined) throw new Error('test-firestore-queries: undefined is not a Firestore value')
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Timestamp) return value
    if (isTransform(value)) {
      if (value.methodName === 'FieldValue.serverTimestamp') return Timestamp.fromMillis(nowMs)
      throw new Error(`test-firestore-queries: ${value.methodName} inside a nested value`)
    }
    if (Array.isArray(value)) return value.map((item) => materialize(item))
    const out: Data = {}
    for (const [key, item] of Object.entries(value as Data)) {
      if (isTransform(item) && item.methodName === 'FieldValue.delete') continue
      out[key] = materialize(item)
    }
    return out
  }

  function mergeInto(target: Data, source: Data): void {
    for (const [key, value] of Object.entries(source)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Timestamp) &&
        !isTransform(value)
      ) {
        const child = target[key]
        const next = child && typeof child === 'object' && !Array.isArray(child) && !(child instanceof Timestamp)
          ? child
          : {}
        target[key] = next
        mergeInto(next, value as Data)
      } else {
        put(target, [key], value, target[key])
      }
    }
  }

  type Write =
    | { type: 'set'; path: string; data: Data; merge: boolean }
    | { type: 'update'; path: string; data: Data; precondition?: { lastUpdateTime?: Timestamp } }
    | { type: 'create'; path: string; data: Data }
    | { type: 'delete'; path: string; precondition?: { lastUpdateTime?: Timestamp } }

  /** Why a write cannot apply, or `null`. */
  function refusal(write: Write): Error | null {
    const failure = failing.get(write.path)
    if (failure) return failure
    const existing = store.get(write.path)
    if (write.type === 'create' && existing) {
      return grpcError(6, `ALREADY_EXISTS: ${write.path}`)
    }
    if (write.type === 'update' && !existing) {
      return grpcError(5, `NOT_FOUND: ${write.path}`)
    }
    if ((write.type === 'update' || write.type === 'delete') && write.precondition?.lastUpdateTime) {
      if (!existing || !existing.updateTime.isEqual(write.precondition.lastUpdateTime)) {
        return grpcError(9, `FAILED_PRECONDITION: ${write.path}`)
      }
    }
    return null
  }

  function apply(write: Write): Timestamp {
    const existing = store.get(write.path)
    const at = stamp()
    writeCount += 1
    if (write.type === 'delete') {
      store.delete(write.path)
      return at
    }
    if (write.type === 'update') {
      const data = clone(existing?.data ?? {})
      for (const [path, value] of Object.entries(write.data)) {
        put(data, path.split('.'), value, valueAt(existing?.data, path))
      }
      store.set(write.path, { data, createTime: existing?.createTime ?? at, updateTime: at })
      return at
    }
    if (write.type === 'set' && write.merge) {
      const data = clone(existing?.data ?? {})
      mergeInto(data, write.data)
      store.set(write.path, { data, createTime: existing?.createTime ?? at, updateTime: at })
      return at
    }
    const data: Data = {}
    mergeInto(data, write.data)
    store.set(write.path, { data, createTime: existing?.createTime ?? at, updateTime: at })
    return at
  }

  function snapshot(path: string): any {
    const stored = store.get(path)
    const id = path.split('/').pop() as string
    return {
      id,
      ref: docRef(path),
      exists: stored !== undefined,
      data: () => (stored ? clone(stored.data) : undefined),
      get: (field: string | FieldPath) => clone(valueAt(stored?.data, fieldName(field))),
      updateTime: stored?.updateTime,
      createTime: stored?.createTime,
    }
  }

  function docRef(path: string): any {
    const segments = path.split('/')
    if (segments.length % 2 !== 0) throw new Error(`test-firestore-queries: ${path} is not a document path`)
    const ref: any = {
      id: segments[segments.length - 1],
      path,
      collection: (name: string) => collectionRef(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data: Data, setOptions?: { merge?: boolean }) =>
        run({ type: 'set', path, data, merge: setOptions?.merge === true }),
      update: async (data: Data, precondition?: { lastUpdateTime?: Timestamp }) =>
        run({ type: 'update', path, data, precondition }),
      create: async (data: Data) => run({ type: 'create', path, data }),
      delete: async (precondition?: { lastUpdateTime?: Timestamp }) =>
        run({ type: 'delete', path, precondition }),
      isEqual: (other: { path?: string }) => other?.path === path,
    }
    Object.defineProperty(ref, 'parent', {
      get: () => collectionRef(segments.slice(0, -1).join('/')),
    })
    return ref
  }

  function run(write: Write): { writeTime: Timestamp } {
    const failure = refusal(write)
    if (failure) throw failure
    return { writeTime: apply(write) }
  }

  interface QueryState {
    path: string
    filters: Filter[]
    orders: Array<{ field: string; direction: 'asc' | 'desc' }>
    after: unknown[] | null
    limit: number | null
  }

  function execute(state: QueryState): any[] {
    const prefix = `${state.path}/`
    let rows = [...store.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, stored]) => ({ path, id: path.slice(prefix.length), data: stored.data }))
      .filter((row) => state.filters.every((filter) => matches(row.id, row.data, filter)))
    const orders = [...state.orders]
    if (!orders.some((order) => order.field === '__name__')) {
      orders.push({ field: '__name__', direction: 'asc' })
    }
    rows = rows.filter((row) =>
      orders.every((order) => order.field === '__name__' || valueAt(row.data, order.field) !== undefined),
    )
    const keyOf = (row: { id: string; data: Data }, field: string) =>
      field === '__name__' ? row.id : valueAt(row.data, field)
    rows.sort((a, b) => {
      for (const order of orders) {
        const result = compare(keyOf(a, order.field), keyOf(b, order.field))
        if (result !== 0) return order.direction === 'desc' ? -result : result
      }
      return 0
    })
    if (state.after) {
      const cursor = state.after
      rows = rows.filter((row) => {
        for (let index = 0; index < cursor.length; index += 1) {
          const order = orders[index]
          const result = compare(keyOf(row, order.field), cursor[index])
          const signed = order.direction === 'desc' ? -result : result
          if (signed !== 0) return signed > 0
        }
        return false
      })
    }
    if (state.limit !== null) rows = rows.slice(0, state.limit)
    return rows.map((row) => snapshot(row.path))
  }

  function query(state: QueryState): any {
    return {
      where: (field: string | FieldPath, op: string, value: unknown) =>
        query({ ...state, filters: [...state.filters, { field: fieldName(field), op, value }] }),
      orderBy: (field: string | FieldPath, direction: 'asc' | 'desc' = 'asc') =>
        query({ ...state, orders: [...state.orders, { field: fieldName(field), direction }] }),
      startAfter: (...values: unknown[]) => query({ ...state, after: values }),
      limit: (limit: number) => query({ ...state, limit }),
      count: () => ({
        get: async () => {
          const total = execute({ ...state, limit: null, after: state.after }).length
          const count = state.limit === null ? total : Math.min(total, state.limit)
          return { data: () => ({ count }) }
        },
      }),
      get: async () => {
        const docs = execute(state)
        return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: any) => docs.forEach(fn) }
      },
    }
  }

  function collectionRef(path: string): any {
    const base = query({ path, filters: [], orders: [], after: null, limit: null })
    return {
      ...base,
      id: path.split('/').pop(),
      path,
      doc: (id: string) => docRef(`${path}/${id ?? nextAutoId()}`),
      add: async (data: Data) => {
        const ref = docRef(`${path}/${nextAutoId()}`)
        run({ type: 'create', path: ref.path, data })
        return ref
      },
    }
  }

  function transactionOrBatch(): { writes: Write[]; reads: Map<string, Timestamp | null>; api: any } {
    const writes: Write[] = []
    const reads = new Map<string, Timestamp | null>()
    const read = (path: string) => {
      if (!reads.has(path)) reads.set(path, store.get(path)?.updateTime ?? null)
      return snapshot(path)
    }
    const api: any = {
      get: async (target: any) =>
        typeof target?.path === 'string' && target.path.split('/').length % 2 === 0
          ? read(target.path)
          : target.get(),
      getAll: async (...refs: any[]) => refs.map((ref) => read(ref.path)),
      set: (ref: any, data: Data, setOptions?: { merge?: boolean }) => {
        writes.push({ type: 'set', path: ref.path, data, merge: setOptions?.merge === true })
        return api
      },
      update: (ref: any, data: Data, precondition?: { lastUpdateTime?: Timestamp }) => {
        writes.push({ type: 'update', path: ref.path, data, precondition })
        return api
      },
      create: (ref: any, data: Data) => {
        writes.push({ type: 'create', path: ref.path, data })
        return api
      },
      delete: (ref: any, precondition?: { lastUpdateTime?: Timestamp }) => {
        writes.push({ type: 'delete', path: ref.path, precondition })
        return api
      },
    }
    return { writes, reads, api }
  }

  /** Whether every document a transaction read is still as it read it. */
  function unchanged(reads: Map<string, Timestamp | null>): boolean {
    for (const [path, seen] of reads) {
      const now = store.get(path)?.updateTime ?? null
      if (seen === null ? now !== null : now === null || !now.isEqual(seen)) return false
    }
    return true
  }

  /** All or nothing, in order: every write is checked against the state the earlier ones leave. */
  function commitAll(writes: Write[]): void {
    const saved = new Map(store)
    const count = writeCount
    try {
      for (const write of writes) run(write)
    } catch (error) {
      store.clear()
      for (const [path, stored] of saved) store.set(path, stored)
      writeCount = count
      throw error
    }
  }

  const firestore: QueryFakeFirestore = {
    collection: (path: string) => collectionRef(path),
    doc: (path: string) => docRef(path),
    getAll: async (...refs: any[]) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async (body) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { writes, reads, api } = transactionOrBatch()
        const result = await body(api)
        if (!unchanged(reads)) continue
        commitAll(writes)
        return result
      }
      throw grpcError(10, 'ABORTED: too much contention')
    },
    batch: () => {
      const { writes, api } = transactionOrBatch()
      return { ...api, commit: async () => commitAll(writes) }
    },
    bulkWriter: () => {
      const queued: Array<{ write: Write; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = []
      const enqueue = (write: Write) =>
        new Promise((resolve, reject) => queued.push({ write, resolve, reject }))
      const drain = async () => {
        while (queued.length) {
          const next = queued.shift() as (typeof queued)[number]
          try {
            next.resolve(run(next.write))
          } catch (error) {
            next.reject(error)
          }
        }
      }
      return {
        create: (ref: any, data: Data) => enqueue({ type: 'create', path: ref.path, data }),
        set: (ref: any, data: Data, setOptions?: { merge?: boolean }) =>
          enqueue({ type: 'set', path: ref.path, data, merge: setOptions?.merge === true }),
        update: (ref: any, data: Data, precondition?: { lastUpdateTime?: Timestamp }) =>
          enqueue({ type: 'update', path: ref.path, data, precondition }),
        delete: (ref: any, precondition?: { lastUpdateTime?: Timestamp }) =>
          enqueue({ type: 'delete', path: ref.path, precondition }),
        onWriteError: () => undefined,
        flush: drain,
        close: drain,
      }
    },
    seed: (path, data) => {
      const at = Timestamp.fromMillis(nowMs)
      const existing = store.get(path)
      store.set(path, { data: clone(data), createTime: existing?.createTime ?? at, updateTime: stamp() })
    },
    read: (path) => {
      const stored = store.get(path)
      return stored ? clone(stored.data) : undefined
    },
    docs: (collectionPath) => {
      const prefix = `${collectionPath}/`
      const out: Record<string, Data> = {}
      for (const [path, stored] of store) {
        const rest = path.slice(prefix.length)
        if (path.startsWith(prefix) && !rest.includes('/')) out[rest] = clone(stored.data)
      }
      return out
    },
    writes: () => writeCount,
    resetWrites: () => {
      writeCount = 0
    },
    setNow: (ms) => {
      nowMs = ms
    },
    failWritesTo: (path, error) => {
      if (error) failing.set(path, error)
      else failing.delete(path)
    },
  }
  return firestore
}
