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
 * the query shapes the plugin's server code uses — equality-free ranges,
 * one ordering, a projection, a cursor and a limit. Nothing else.
 */

type Data = Record<string, any>

const comparable = (value: any): any =>
  value && typeof value.toMillis === 'function' ? value.toMillis() : value

function snapshot(path: string, data: Data | undefined) {
  const id = path.split('/').pop() as string
  return {
    id,
    exists: data !== undefined,
    ref: { path },
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
  ) {}

  protected clone(next: Partial<{ filters: Array<[string, string, any]>; order: [string, 'asc' | 'desc'] | null; max: number | null; after: string | null }>) {
    return new FakeQuery(
      this.db,
      this.path,
      next.filters ?? this.filters,
      next.order === undefined ? this.order : next.order,
      next.max === undefined ? this.max : next.max,
      next.after === undefined ? this.after : next.after,
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
    let rows = [...this.db.docs.entries()].filter(
      ([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
    )
    for (const [field, op, raw] of this.filters) {
      const value = comparable(raw)
      rows = rows.filter(([, data]) => {
        const held = comparable(data[field])
        if (held === undefined) return false
        if (op === '>=') return held >= value
        if (op === '<') return held < value
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
    const docs = this.matching().map(([path, data]) => snapshot(path, data))
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
  collection(name: string) {
    return new FakeCollection(this.db, `${this.path}/${name}`)
  }
  async get() {
    return snapshot(this.path, this.db.docs.get(this.path))
  }
  async set(data: Data, options?: { merge?: boolean }) {
    this.db.writes.push({ op: 'set', path: this.path, data, options })
    const held = options?.merge ? this.db.docs.get(this.path) ?? {} : {}
    this.db.docs.set(this.path, { ...held, ...data })
  }
  async update(data: Data) {
    this.db.writes.push({ op: 'update', path: this.path, data })
    const held = this.db.docs.get(this.path)
    if (!held) throw new Error(`no document at ${this.path}`)
    this.db.docs.set(this.path, { ...held, ...data })
  }
  async delete() {
    this.db.writes.push({ op: 'delete', path: this.path })
    this.db.docs.delete(this.path)
  }
}
