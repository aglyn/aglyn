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
 * A small in-memory Firestore for the funnels specs: documents by path, and
 * the query shapes the plugin's server code uses — ranges and equality, one
 * ordering, a projection, a cursor, a limit, a collection group, a batch, a
 * transaction (applied as it goes: the specs run one writer at a time) —
 * and the update sentinels it writes ({@link FAKE_FIELD_VALUE}). Nothing else.
 */

/**
 * Stand-ins for `FieldValue`, which a spec mocks `firebase-admin/firestore`
 * with so `update` can apply them.
 */
export const FAKE_FIELD_VALUE = {
  serverTimestamp: () => 'SERVER_TIME',
  delete: () => ({ __fake: 'delete' }),
  arrayUnion: (...values: unknown[]) => ({ __fake: 'arrayUnion', values }),
}

function applyUpdate(held: Data, patch: Data): Data {
  const next: Data = { ...held }
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.split('.')
    let target: Data = next
    for (const part of parts.slice(0, -1)) {
      target[part] = { ...(target[part] ?? {}) }
      target = target[part]
    }
    const leaf = parts[parts.length - 1]
    if (value && value.__fake === 'delete') delete target[leaf]
    else if (value && value.__fake === 'arrayUnion') {
      const list = Array.isArray(target[leaf]) ? [...target[leaf]] : []
      for (const one of value.values) {
        if (!list.some((held: unknown) => JSON.stringify(held) === JSON.stringify(one))) list.push(one)
      }
      target[leaf] = list
    } else target[leaf] = value
  }
  return next
}

type Data = Record<string, any>

interface FakeTransaction {
  get(target: { get(): Promise<any> }): Promise<any>
  create(ref: FakeDoc, data: Data): void
  update(ref: FakeDoc, data: Data): void
  set(ref: FakeDoc, data: Data): void
}

const comparable = (value: any): any =>
  value && typeof value.toMillis === 'function' ? value.toMillis() : value

function snapshot(db: FakeFirestore, path: string, data: Data | undefined) {
  const id = path.split('/').pop() as string
  return {
    id,
    exists: data !== undefined,
    ref: new FakeDoc(db, path),
    data: () => (data === undefined ? undefined : { ...data }),
    get: (field: string) => data?.[field],
  }
}

export class FakeFirestore {
  readonly docs = new Map<string, Data>()
  readonly writes: Array<{ op: string; path: string; data?: Data; options?: unknown }> = []

  collection(name: string) {
    return new FakeCollection(this, name)
  }

  /** Every collection named `name`, at any depth. */
  collectionGroup(name: string) {
    return new FakeQuery(this, name, [], null, null, null, true)
  }

  batch() {
    const ops: Array<() => Promise<void>> = []
    return {
      update: (ref: FakeDoc, data: Data) => void ops.push(() => ref.update(data)),
      delete: (ref: FakeDoc) => void ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op()
      },
    }
  }

  /** Reads through `get`, writes through `create`/`update`/`set`, each applied at once. */
  async runTransaction<T>(run: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return run({
      get: (target: { get(): Promise<any> }) => target.get(),
      create: (ref: FakeDoc, data: Data) => void ref.create(data),
      update: (ref: FakeDoc, data: Data) => void ref.update(data),
      set: (ref: FakeDoc, data: Data) => void ref.set(data),
    })
  }

  seed(path: string, data: Data): this {
    this.docs.set(path, data)
    return this
  }
}

class FakeQuery {
  constructor(
    protected readonly db: FakeFirestore,
    readonly path: string,
    protected readonly filters: Array<[string, string, any]> = [],
    protected readonly order: [string, 'asc' | 'desc'] | null = null,
    protected readonly max: number | null = null,
    protected readonly after: string | null = null,
    protected readonly group = false,
  ) {}

  protected clone(next: Partial<{ filters: Array<[string, string, any]>; order: [string, 'asc' | 'desc'] | null; max: number | null; after: string | null }>) {
    return new FakeQuery(
      this.db,
      this.path,
      next.filters ?? this.filters,
      next.order === undefined ? this.order : next.order,
      next.max === undefined ? this.max : next.max,
      next.after === undefined ? this.after : next.after,
      this.group,
    )
  }

  where(field: string, op: string, value: any) {
    return this.clone({ filters: [...this.filters, [field, op, value]] })
  }
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return this.clone({ order: [field, direction] })
  }
  select() {
    return this
  }
  limit(max: number) {
    return this.clone({ max })
  }
  startAfter(doc: { ref: { path: string } }) {
    return this.clone({ after: doc.ref.path })
  }

  private matching(): Array<[string, Data]> {
    const prefix = `${this.path}/`
    let rows = [...this.db.docs.entries()].filter(([path]) => {
      if (this.group) {
        const parts = path.split('/')
        return parts.length % 2 === 0 && parts[parts.length - 2] === this.path
      }
      return path.startsWith(prefix) && !path.slice(prefix.length).includes('/')
    })
    for (const [field, op, raw] of this.filters) {
      const value = comparable(raw)
      rows = rows.filter(([, data]) => {
        const held = comparable(data[field])
        if (held === undefined) return false
        if (op === '>=') return held >= value
        if (op === '<') return held < value
        if (op === '<=') return held <= value
        if (op === '==') return held === value
        throw new Error(`unsupported op ${op}`)
      })
    }
    if (this.order) {
      const [field, direction] = this.order
      rows.sort((a, b) => {
        const left = comparable(a[1][field])
        const right = comparable(b[1][field])
        const cmp = left < right ? -1 : left > right ? 1 : 0
        return direction === 'desc' ? -cmp : cmp
      })
    }
    if (this.after) {
      const index = rows.findIndex(([path]) => path === this.after)
      rows = rows.slice(index + 1)
    }
    return this.max === null ? rows : rows.slice(0, this.max)
  }

  async get() {
    const docs = this.matching().map(([path, data]) => snapshot(this.db, path, data))
    return { docs, empty: docs.length === 0, size: docs.length }
  }

  count() {
    return { get: async () => ({ data: () => ({ count: this.matching().length }) }) }
  }
}

class FakeCollection extends FakeQuery {
  private auto = 0
  doc(id?: string) {
    this.auto += 1
    return new FakeDoc(this.db, `${this.path}/${id ?? `auto-${this.auto}`}`)
  }
}

class FakeDoc {
  constructor(private readonly db: FakeFirestore, readonly path: string) {}
  get id() {
    return this.path.split('/').pop() as string
  }
  /** The collection, whose `parent` is the document above it. */
  get parent() {
    const parts = this.path.split('/')
    return {
      id: parts[parts.length - 2],
      parent: parts.length > 2 ? { id: parts[parts.length - 3] } : null,
    }
  }
  collection(name: string) {
    return new FakeCollection(this.db, `${this.path}/${name}`)
  }
  async get() {
    return snapshot(this.db, this.path, this.db.docs.get(this.path))
  }
  async set(data: Data, options?: { merge?: boolean }) {
    this.db.writes.push({ op: 'set', path: this.path, data, options })
    const held = options?.merge ? this.db.docs.get(this.path) ?? {} : {}
    this.db.docs.set(this.path, { ...held, ...data })
  }
  /** Refuses a document that exists, as Firestore's `create` does. */
  create(data: Data) {
    if (this.db.docs.has(this.path)) throw new Error(`document already exists at ${this.path}`)
    this.db.writes.push({ op: 'create', path: this.path, data })
    this.db.docs.set(this.path, { ...data })
  }
  async update(data: Data) {
    this.db.writes.push({ op: 'update', path: this.path, data })
    const held = this.db.docs.get(this.path)
    if (!held) throw new Error(`no document at ${this.path}`)
    this.db.docs.set(this.path, applyUpdate(held, data))
  }
  async delete() {
    this.db.writes.push({ op: 'delete', path: this.path })
    this.db.docs.delete(this.path)
  }
}
