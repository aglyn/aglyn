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
 * A small in-memory stand-in for the firebase-admin Firestore surface the
 * print queue uses (AGL-3619), for specs. Transactions are OPTIMISTIC, as
 * Firestore's server SDK effectively is under contention: every read records
 * the version it saw, the commit re-checks them (and re-runs any query read
 * in the transaction), and a conflict retries the whole function. Each read
 * yields to the event loop, so two transactions started together really do
 * interleave, which is what a race spec needs.
 *
 * Supports: `collection().doc()`, `get`, `set` (with `merge`), `create`,
 * `update`, `delete`; queries with `==`, `in` and `array-contains`, `orderBy`, `limit`,
 * and a collection's `count()`;
 * `runTransaction` with `get` (document or query), `set`, `update`;
 * `batch()`. Field paths are top-level only.
 */

interface Stored {
  data: Record<string, any>
  version: number
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export class MemoryFirestore {
  readonly docs = new Map<string, Stored>()
  private autoId = 0
  private clock = 0
  /** Committed transactions that had to retry, for specs that assert contention happened. */
  retries = 0

  collection(path: string): MemoryCollection {
    return new MemoryCollection(this, path)
  }

  /** The document at a slash path, for assertions. */
  read(path: string): Record<string, any> | undefined {
    const stored = this.docs.get(path)
    return stored ? { ...stored.data } : undefined
  }

  nextId(): string {
    this.autoId += 1
    return `auto${String(this.autoId).padStart(4, '0')}`
  }

  write(path: string, data: Record<string, any> | null): void {
    this.clock += 1
    if (data === null) this.docs.delete(path)
    else this.docs.set(path, { data: { ...data }, version: this.clock })
  }

  version(path: string): number {
    return this.docs.get(path)?.version ?? 0
  }

  batch() {
    const ops: Array<() => void> = []
    return {
      set: (ref: MemoryDoc, data: any, options?: { merge?: boolean }) =>
        ops.push(() => ref.applySet(data, options)),
      update: (ref: MemoryDoc, data: any) => ops.push(() => ref.applyUpdate(data)),
      delete: (ref: MemoryDoc) => ops.push(() => this.write(ref.path, null)),
      commit: async () => {
        await tick()
        for (const op of ops) op()
      },
    }
  }

  async runTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const seen = new Map<string, number>()
      const queries: Array<{ query: MemoryQuery; snapshot: string }> = []
      const writes: Array<() => void> = []
      const transaction = {
        get: async (target: MemoryDoc | MemoryQuery) => {
          await tick()
          if (target instanceof MemoryDoc) {
            seen.set(target.path, this.version(target.path))
            return target.snapshot()
          }
          const result = target.run()
          queries.push({ query: target, snapshot: target.signature() })
          for (const doc of result.docs) seen.set(doc.ref.path, this.version(doc.ref.path))
          return result
        },
        set: (ref: MemoryDoc, data: any, options?: { merge?: boolean }) => {
          writes.push(() => ref.applySet(data, options))
          return transaction
        },
        update: (ref: MemoryDoc, data: any) => {
          writes.push(() => ref.applyUpdate(data))
          return transaction
        },
        create: (ref: MemoryDoc, data: any) => {
          writes.push(() => ref.applyCreate(data))
          return transaction
        },
      }
      const result = await fn(transaction)
      await tick()
      const conflicted =
        [...seen].some(([path, version]) => this.version(path) !== version) ||
        queries.some(({ query, snapshot }) => query.signature() !== snapshot)
      if (conflicted) {
        this.retries += 1
        continue
      }
      for (const write of writes) write()
      return result
    }
    throw new Error('transaction contention: too many retries')
  }
}

export class MemoryCollection {
  constructor(
    readonly store: MemoryFirestore,
    readonly path: string,
  ) {}

  doc(id?: string): MemoryDoc {
    return new MemoryDoc(this.store, `${this.path}/${id ?? this.store.nextId()}`)
  }

  where(field: string, op: MemoryFilterOp, value: unknown): MemoryQuery {
    return new MemoryQuery(this.store, this.path).where(field, op, value)
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): MemoryQuery {
    return new MemoryQuery(this.store, this.path).orderBy(field, direction)
  }

  limit(count: number): MemoryQuery {
    return new MemoryQuery(this.store, this.path).limit(count)
  }

  /** The aggregate: its result's `data().count`. */
  count(): MemoryQuery {
    return new MemoryQuery(this.store, this.path)
  }

  get() {
    return Promise.resolve(new MemoryQuery(this.store, this.path).run())
  }
}

/** What a {@link MemoryDoc} read returns, shaped like a Firestore snapshot. */
export interface MemoryDocSnapshot {
  id: string
  ref: MemoryDoc
  exists: boolean
  data: () => Record<string, any> | undefined
  get: (field: string) => unknown
}

export class MemoryDoc {
  constructor(
    readonly store: MemoryFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.split('/').pop() ?? ''
  }

  collection(name: string): MemoryCollection {
    return new MemoryCollection(this.store, `${this.path}/${name}`)
  }

  snapshot(): MemoryDocSnapshot {
    const stored = this.store.docs.get(this.path)
    const data = stored ? { ...stored.data } : undefined
    return {
      id: this.id,
      ref: this,
      exists: Boolean(stored),
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => data?.[field],
    }
  }

  async get(): Promise<MemoryDocSnapshot> {
    await tick()
    return this.snapshot()
  }

  applySet(data: Record<string, any>, options?: { merge?: boolean }): void {
    const previous = this.store.docs.get(this.path)?.data
    this.store.write(this.path, options?.merge && previous ? { ...previous, ...data } : data)
  }

  applyUpdate(data: Record<string, any>): void {
    const previous = this.store.docs.get(this.path)?.data
    if (!previous) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
    this.store.write(this.path, { ...previous, ...data })
  }

  applyCreate(data: Record<string, any>): void {
    if (this.store.docs.has(this.path)) {
      throw Object.assign(new Error('Document already exists'), { code: 6 })
    }
    this.store.write(this.path, data)
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }): Promise<void> {
    await tick()
    this.applySet(data, options)
  }

  async create(data: Record<string, any>): Promise<void> {
    await tick()
    this.applyCreate(data)
  }

  async update(data: Record<string, any>): Promise<void> {
    await tick()
    this.applyUpdate(data)
  }

  async delete(): Promise<void> {
    await tick()
    this.store.write(this.path, null)
  }
}

export type MemoryFilterOp = '==' | 'in' | 'array-contains'

export class MemoryQuery {
  private filters: Array<{ field: string; op: MemoryFilterOp; value: unknown }> = []
  private order: { field: string; direction: 'asc' | 'desc' } | null = null
  private max = Infinity

  constructor(
    readonly store: MemoryFirestore,
    readonly path: string,
  ) {}

  private clone(): MemoryQuery {
    const next = new MemoryQuery(this.store, this.path)
    next.filters = [...this.filters]
    next.order = this.order
    next.max = this.max
    return next
  }

  where(field: string, op: MemoryFilterOp, value: unknown): MemoryQuery {
    const next = this.clone()
    next.filters.push({ field, op, value })
    return next
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): MemoryQuery {
    const next = this.clone()
    next.order = { field, direction }
    return next
  }

  limit(count: number): MemoryQuery {
    const next = this.clone()
    next.max = count
    return next
  }

  run() {
    const prefix = `${this.path}/`
    let rows = [...this.store.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .filter(([, stored]) =>
        this.filters.every(({ field, op, value }) =>
          op === 'in'
            ? (value as unknown[]).includes(stored.data[field])
            : op === 'array-contains'
              ? Array.isArray(stored.data[field]) && stored.data[field].includes(value)
              : stored.data[field] === value,
        ),
      )
    if (this.order) {
      const { field, direction } = this.order
      rows = rows.sort(([, a], [, b]) => {
        const delta = a.data[field] < b.data[field] ? -1 : a.data[field] > b.data[field] ? 1 : 0
        return direction === 'asc' ? delta : -delta
      })
    }
    const docs = rows
      .slice(0, this.max)
      .map(([path]) => new MemoryDoc(this.store, path).snapshot())
    // `data()` answers a `count()` aggregate read through the same query.
    return { docs, size: docs.length, empty: docs.length === 0, data: () => ({ count: docs.length }) }
  }

  /** The paths and versions this query matches now, to detect a changed result. */
  signature(): string {
    return this.run()
      .docs.map((doc) => `${doc.ref.path}@${this.store.version(doc.ref.path)}`)
      .join('|')
  }

  get() {
    return tick().then(() => this.run())
  }
}
