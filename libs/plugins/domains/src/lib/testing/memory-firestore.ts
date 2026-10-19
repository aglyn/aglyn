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
 * An in-memory Firestore with the slice of the Admin SDK this plugin's
 * server code calls: documents, equality and `array-contains` queries with a
 * limit, and transactions. Specs reach it through a `jest.mock` of
 * `@aglyn/tenant-data-admin`'s `firebaseAdmin`.
 */

type Data = Record<string, unknown>

export class MemoryFirestore {
  readonly docs = new Map<string, Data>()

  collection(name: string) {
    return new MemoryCollection(this, name)
  }

  async runTransaction<T>(body: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    return body(new MemoryTransaction())
  }
}

export class MemoryTransaction {
  async get(target: MemoryDocRef | MemoryQuery) {
    return target.get()
  }
  set(ref: MemoryDocRef, data: Data, options?: { merge?: boolean }) {
    ref.write(data, options)
  }
}

class MemoryCollection {
  constructor(
    private readonly store: MemoryFirestore,
    private readonly name: string,
  ) {}
  doc(id: string) {
    return new MemoryDocRef(this.store, `${this.name}/${id}`)
  }
  where(field: string, op: string, value: unknown) {
    return new MemoryQuery(this.store, this.name, [[field, op, value]])
  }
}

export class MemoryQuery {
  private max = Infinity
  constructor(
    private readonly store: MemoryFirestore,
    private readonly name: string,
    private readonly filters: [string, string, unknown][],
  ) {}
  where(field: string, op: string, value: unknown) {
    return new MemoryQuery(this.store, this.name, [...this.filters, [field, op, value]])
  }
  limit(count: number) {
    this.max = count
    return this
  }
  async get() {
    const docs = [...this.store.docs.entries()]
      .filter(([path]) => path.startsWith(`${this.name}/`) && path.split('/').length === 2)
      .filter(([, data]) =>
        this.filters.every(([field, op, value]) =>
          op === 'array-contains'
            ? Array.isArray(data[field]) && (data[field] as unknown[]).includes(value)
            : data[field] === value,
        ),
      )
      .slice(0, this.max)
      .map(([path, data]) => snapshot(path, data))
    return { docs, empty: docs.length === 0, size: docs.length }
  }
}

function snapshot(path: string, data: Data | undefined) {
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
    get: (field: string) => data?.[field],
  }
}

export class MemoryDocRef {
  constructor(
    private readonly store: MemoryFirestore,
    readonly path: string,
  ) {}
  get id() {
    return this.path.split('/').pop() as string
  }
  async get() {
    return snapshot(this.path, this.store.docs.get(this.path))
  }
  async set(data: Data, options?: { merge?: boolean }) {
    this.write(data, options)
  }

  write(data: Data, options?: { merge?: boolean }) {
    // The Admin SDK's own refusal, modeled: a double that took `undefined`
    // would pass code that throws in production.
    assertNoUndefined(data, this.path)
    const base = options?.merge ? (this.store.docs.get(this.path) ?? {}) : {}
    const next: Data = { ...base }
    for (const [key, value] of Object.entries(clone(data))) next[key] = value
    this.store.docs.set(this.path, next)
  }
}

function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined) {
    throw new Error(`Cannot use "undefined" as a Firestore value (${path})`)
  }
  if (Array.isArray(value)) value.forEach((entry) => assertNoUndefined(entry, path))
  else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertNoUndefined(entry, path)
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
