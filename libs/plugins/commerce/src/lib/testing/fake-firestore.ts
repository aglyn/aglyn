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
 * An in-memory stand-in for the Admin SDK's Firestore, for the register's
 * money-path specs (AGL-3607). Faithful where the code under test leans on
 * it: `create()` refuses an existing document, `update()` refuses a missing
 * one, merge-sets merge one level, and the `increment`, `delete` and
 * `arrayUnion` sentinels resolve against the stored value. A transaction
 * buffers its writes and applies them at commit, so a throw inside it writes
 * nothing.
 */

const INCREMENT = Symbol('increment')
const DELETE = Symbol('delete')
const UNION = Symbol('arrayUnion')

export const fakeFieldValue = {
  increment: (value: number) => ({ [INCREMENT]: value }),
  delete: () => ({ [DELETE]: true }),
  arrayUnion: (...values: unknown[]) => ({ [UNION]: values }),
  serverTimestamp: () => '<server-timestamp>',
}

export const fakeDocs = new Map<string, Record<string, any>>()

let autoId = 0

function resolveValue(existing: any, value: any): any {
  if (value && typeof value === 'object') {
    if (INCREMENT in value) return (Number(existing) || 0) + value[INCREMENT]
    if (UNION in value) {
      const base = Array.isArray(existing) ? [...existing] : []
      for (const item of value[UNION]) {
        if (!base.some((entry) => JSON.stringify(entry) === JSON.stringify(item))) base.push(item)
      }
      return base
    }
  }
  return value
}

function applyWrite(
  path: string,
  value: Record<string, any>,
  mode: 'set' | 'merge' | 'update',
) {
  const existing = fakeDocs.get(path)
  if (mode === 'update' && !existing) {
    const error: any = new Error(`NOT_FOUND: ${path}`)
    error.code = 5
    throw error
  }
  const next: Record<string, any> = mode === 'set' ? {} : { ...(existing ?? {}) }
  for (const [key, raw] of Object.entries(value)) {
    if (raw && typeof raw === 'object' && DELETE in raw) {
      delete next[key]
      continue
    }
    if (
      mode === 'merge' &&
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      !(INCREMENT in raw) &&
      !(UNION in raw) &&
      next[key] &&
      typeof next[key] === 'object' &&
      !Array.isArray(next[key])
    ) {
      const nested = { ...next[key] }
      for (const [inner, innerValue] of Object.entries(raw)) {
        if (innerValue && typeof innerValue === 'object' && DELETE in (innerValue as any)) {
          delete nested[inner]
        } else {
          nested[inner] = resolveValue(nested[inner], innerValue)
        }
      }
      next[key] = nested
      continue
    }
    next[key] = resolveValue(existing?.[key], raw)
  }
  fakeDocs.set(path, next)
}

function snapshotOf(path: string) {
  const data = fakeDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    ref: docRef(path),
    data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
    get: (field: string) => data?.[field],
  }
}

export function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) =>
      applyWrite(path, value, options?.merge ? 'merge' : 'set'),
    update: async (value: Record<string, any>) => applyWrite(path, value, 'update'),
    create: async (value: Record<string, any>) => {
      if (fakeDocs.has(path)) {
        const error: any = new Error(`ALREADY_EXISTS: ${path}`)
        error.code = 6
        throw error
      }
      applyWrite(path, value, 'set')
    },
    delete: async () => {
      fakeDocs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string, filters: Array<[string, string, any]> = []): any {
  const children = () =>
    [...fakeDocs.keys()].filter(
      (key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'),
    )
  const query = {
    where: (field: string, op: string, value: any) =>
      collectionRef(path, [...filters, [field, op, value]]),
    limit: () => query,
    orderBy: () => query,
    get: async () => {
      const docs = children()
        .filter((key) =>
          filters.every(([field, op, value]) => {
            const stored = fakeDocs.get(key)?.[field]
            if (op === '==') return stored === value
            if (op === 'array-contains') return Array.isArray(stored) && stored.includes(value)
            return false
          }),
        )
        .map(snapshotOf)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
  return {
    ...query,
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    add: async (value: Record<string, any>) => {
      const ref = docRef(`${path}/auto-${++autoId}`)
      applyWrite(ref.path, value, 'set')
      return ref
    },
  }
}

/**
 * Every document in a collection named `name` at any depth, filtered by
 * equality (AGL-4038). `orderBy` sorts on one field, ties broken by path as
 * Firestore does, `startAfter` takes a document snapshot, and `limit` caps
 * the answer, so a cursor-paged staff list can be specced.
 */
interface GroupShape {
  filters: Array<[string, any]>
  order?: { field: string; desc: boolean }
  after?: string
  cap?: number
}
function collectionGroupRef(name: string, shape: GroupShape = { filters: [] }): any {
  const next = (patch: Partial<GroupShape>) => collectionGroupRef(name, { ...shape, ...patch })
  return {
    where: (field: string, _op: string, value: any) => next({ filters: [...shape.filters, [field, value]] }),
    orderBy: (field: string, direction?: string) => next({ order: { field, desc: direction === 'desc' } }),
    startAfter: (snapshot: { ref: { path: string } }) => next({ after: snapshot.ref.path }),
    limit: (cap: number) => next({ cap }),
    get: async () => {
      let keys = [...fakeDocs.keys()]
        .filter((key) => {
          const parts = key.split('/')
          return parts.length >= 2 && parts.length % 2 === 0 && parts[parts.length - 2] === name
        })
        .filter((key) => shape.filters.every(([field, value]) => fakeDocs.get(key)?.[field] === value))
      if (shape.order) {
        const { field, desc } = shape.order
        const sign = desc ? -1 : 1
        keys.sort((a, b) => {
          const left = fakeDocs.get(a)?.[field] ?? 0
          const right = fakeDocs.get(b)?.[field] ?? 0
          if (left !== right) return left < right ? -sign : sign
          return a < b ? -sign : a > b ? sign : 0
        })
      }
      if (shape.after) {
        const at = keys.indexOf(shape.after)
        keys = at >= 0 ? keys.slice(at + 1) : keys
      }
      if (shape.cap !== undefined) keys = keys.slice(0, shape.cap)
      const docs = keys.map(snapshotOf)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

export const fakeFirestore: any = {
  collection: (name: string) => collectionRef(name),
  collectionGroup: (name: string) => collectionGroupRef(name),
  doc: (path: string) => docRef(path),
  runTransaction: async (fn: (transaction: any) => Promise<any>) => {
    const writes: Array<() => void> = []
    const outcome = await fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: { merge?: boolean }) => {
        writes.push(() => applyWrite(ref.path, value, options?.merge ? 'merge' : 'set'))
      },
      update: (ref: any, value: any) => {
        writes.push(() => applyWrite(ref.path, value, 'update'))
      },
      create: (ref: any, value: any) => {
        if (fakeDocs.has(ref.path)) {
          const error: any = new Error(`ALREADY_EXISTS: ${ref.path}`)
          error.code = 6
          throw error
        }
        writes.push(() => applyWrite(ref.path, value, 'set'))
      },
      delete: (ref: any) => {
        writes.push(() => fakeDocs.delete(ref.path))
      },
    })
    for (const write of writes) write()
    return outcome
  },
  recursiveDelete: async (ref: any) => {
    for (const key of [...fakeDocs.keys()]) {
      if (key === ref.path || key.startsWith(`${ref.path}/`)) fakeDocs.delete(key)
    }
  },
}

export function resetFakeFirestore(): void {
  fakeDocs.clear()
  autoId = 0
}
