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
 * AGL-2606: the Firestore double the two CRM `/v1` suites share.
 *
 * The sibling `/v1` suites each carry a double of their own, and each models
 * exactly the operators its subject issues — `==` and `array-contains` in the
 * list-filters suite, dotted `update()` paths in the contact-writes suite.
 * The CRM resources issue a range (`updatedAt >`), an `array-contains-any`
 * (the pipeline visible from a site), an `orderBy` on a field other than the
 * id with a two-value `startAfter`, and `FieldValue.delete()` on a PATCH, so
 * a double that ignored any of those would let a broken query pass green.
 *
 * Everything it models it models faithfully, and every operator it is not
 * asked to model THROWS — the anti-vacuity rule the list-filters suite
 * states: an unmodelled operator silently answering `false` is a filter
 * assertion that can never fail.
 *
 * Every `where()` the code under test issues is recorded in `issued`, so a
 * suite can assert how many clauses reached Firestore — which is what keeps
 * "one clause, the rest on the page" a property of the code and not of the
 * fake.
 */

export const mockDocs = new Map<string, Record<string, unknown>>()

export interface IssuedFilter {
  field: string
  op: string
  value: unknown
}

/** Every filter list a query ran with, most recent query last. */
export const issued: IssuedFilter[][] = []

/**
 * `firebase-admin/firestore`'s `Timestamp`, with the two static
 * constructors the code uses and the `seconds`/`nanoseconds` pair the
 * `updated`-ordered cursor is built from.
 */
export class MockTimestamp {
  constructor(
    public seconds: number,
    public nanoseconds: number,
  ) {}
  static now() {
    return MockTimestamp.fromMillis(mockClock.nowMs)
  }
  static fromMillis(ms: number) {
    const seconds = Math.floor(ms / 1000)
    return new MockTimestamp(seconds, (ms - seconds * 1000) * 1_000_000)
  }
  toMillis() {
    return this.seconds * 1000 + this.nanoseconds / 1_000_000
  }
  toDate() {
    return new Date(this.toMillis())
  }
}

/** `Timestamp.now()` reads this, so a suite can order writes in time. */
export const mockClock = { nowMs: 1_760_000_000_000 }

class MockDelete {}
class MockIncrement {
  constructor(public by: number) {}
}
/** The array transforms the contact–company link writes with (AGL-2613). */
class MockArrayUnion {
  constructor(public values: unknown[]) {}
}
class MockArrayRemove {
  constructor(public values: unknown[]) {}
}

export const mockFieldValue = {
  delete: () => new MockDelete(),
  increment: (by: number) => new MockIncrement(by),
  arrayUnion: (...values: unknown[]) => new MockArrayUnion(values),
  arrayRemove: (...values: unknown[]) => new MockArrayRemove(values),
  serverTimestamp: () => MockTimestamp.now(),
}

function compare(a: unknown, b: unknown): number {
  const left = a instanceof MockTimestamp ? a.toMillis() : a
  const right = b instanceof MockTimestamp ? b.toMillis() : b
  if (left === right) return 0
  if (left === undefined) return -1
  if (right === undefined) return 1
  return (left as number | string) < (right as number | string) ? -1 : 1
}

function matches(stored: unknown, op: string, value: unknown): boolean {
  if (op === '==') return compare(stored, value) === 0
  if (op === '>') return stored !== undefined && compare(stored, value) > 0
  if (op === 'array-contains') {
    return Array.isArray(stored) && stored.includes(value)
  }
  if (op === 'array-contains-any') {
    return (
      Array.isArray(stored) &&
      Array.isArray(value) &&
      value.some((candidate) => stored.includes(candidate))
    )
  }
  throw new Error(`unmodelled Firestore operator: ${op}`)
}

function resolveWrite(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    const stored: unknown[] = Array.isArray(existing?.[key])
      ? (existing?.[key] as unknown[])
      : []
    out[key] =
      value instanceof MockIncrement
        ? Number(existing?.[key] ?? 0) + value.by
        : value instanceof MockArrayUnion
          ? [...stored, ...value.values.filter((entry) => !stored.includes(entry))]
          : value instanceof MockArrayRemove
            ? stored.filter((entry) => !value.values.includes(entry))
            : value
  }
  return out
}

/** Immediate children of a collection path — not grandchildren. */
export function childPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function snapshotOf(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    id,
    ref: mockDocRef(path),
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => mockDocs.get(path)?.[field],
  }
}

export function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  const parentPath = path.slice(0, path.lastIndexOf('/'))
  return {
    path,
    id,
    get parent() {
      return mockCollectionRef(parentPath)
    },
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
    create: async (data: Record<string, unknown>) => {
      // `create` is not an upsert: Firestore's rejection on an existing
      // document IS the idempotency primitive.
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockDocs.set(path, resolveWrite(undefined, data))
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      const existing = mockDocs.get(path)
      mockDocs.set(path, {
        ...(options?.merge ? (existing ?? {}) : {}),
        ...resolveWrite(existing, data),
      })
    },
    update: async (data: Record<string, unknown>) => {
      const existing = mockDocs.get(path)
      if (!existing) throw new Error('NOT_FOUND')
      // Dotted keys are FIELD PATHS on `update`, and a `FieldValue.delete()`
      // removes the field rather than storing a sentinel — both are what a
      // PATCH that clears one holder's facet field relies on.
      const next: Record<string, unknown> = { ...existing }
      for (const [key, value] of Object.entries(resolveWrite(existing, data))) {
        const segments = key.split('.')
        let cursor = next
        for (const segment of segments.slice(0, -1)) {
          const child = cursor[segment]
          cursor[segment] =
            child && typeof child === 'object' && !Array.isArray(child)
              ? { ...(child as Record<string, unknown>) }
              : {}
          cursor = cursor[segment] as Record<string, unknown>
        }
        const leaf = segments[segments.length - 1]
        if (value instanceof MockDelete) delete cursor[leaf]
        else cursor[leaf] = value
      }
      mockDocs.set(path, next)
    },
    delete: async () => {
      mockDocs.delete(path)
    },
  }
}

interface QueryState {
  filters: IssuedFilter[]
  orderBy: string[]
  startAfter: unknown[] | null
  limit: number
}

function mockQuery(collectionPath: string, state: QueryState) {
  const run = () => {
    issued.push(state.filters)
    const orderFields = state.orderBy.length ? state.orderBy : ['__name__']
    const valueOf = (path: string, field: string) =>
      field === '__name__' ? path.slice(path.lastIndexOf('/') + 1) : mockDocs.get(path)?.[field]
    let paths = childPaths(collectionPath).filter((path) =>
      state.filters.every(({ field, op, value }) =>
        matches(mockDocs.get(path)?.[field], op, value),
      ),
    )
    paths.sort((a, b) => {
      for (const field of orderFields) {
        const order = compare(valueOf(a, field), valueOf(b, field))
        if (order !== 0) return order
      }
      return a < b ? -1 : a > b ? 1 : 0
    })
    if (state.startAfter) {
      const after = state.startAfter
      paths = paths.filter((path) => {
        for (let index = 0; index < after.length; index += 1) {
          const order = compare(valueOf(path, orderFields[index] ?? '__name__'), after[index])
          if (order !== 0) return order > 0
        }
        return false
      })
    }
    const docs = (state.limit > 0 ? paths.slice(0, state.limit) : paths).map(snapshotOf)
    return { empty: docs.length === 0, docs, size: docs.length }
  }
  const next = (patch: Partial<QueryState>) =>
    mockQuery(collectionPath, { ...state, ...patch })
  return {
    where: (field: string, op: string, value: unknown) =>
      next({ filters: [...state.filters, { field, op, value }] }),
    orderBy: (field: string) => next({ orderBy: [...state.orderBy, field] }),
    startAfter: (...values: unknown[]) => next({ startAfter: values }),
    limit: (limit: number) => next({ limit }),
    get: async () => run(),
    count: () => ({
      get: async () => ({ data: () => ({ count: run().docs.length }) }),
    }),
  }
}

export function mockCollectionRef(path: string) {
  return {
    ...mockQuery(path, { filters: [], orderBy: [], startAfter: null, limit: 0 }),
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
  }
}

export const mockFirestore = {
  collection: (name: string) => mockCollectionRef(name),
}

/** The filters the LAST issued query carried. */
export const lastFilters = (): IssuedFilter[] => issued[issued.length - 1] ?? []

export function resetMockFirestore(): void {
  mockDocs.clear()
  issued.length = 0
  mockClock.nowMs = 1_760_000_000_000
}
