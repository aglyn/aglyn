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
 * An in-memory Firestore for this plugin's specs: documents by path,
 * `create()` that refuses an existing document, `update()` that refuses an
 * absent one, equality and range filters, ordering and limits, and
 * transactions whose writes are buffered and applied at commit, one body at
 * a time, and `startAfter` on the first ordering. Only what this plugin's
 * server half calls.
 */

type Data = Record<string, any>

export interface MemoryFirestore {
  docs: Map<string, Data>
  collection(name: string): any
  runTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T>
  batch(): any
}

export function createMemoryFirestore(): MemoryFirestore {
  const docs = new Map<string, Data>()
  let generated = 0

  const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      data: () => clone(data),
      get: (field: string) => field.split('.').reduce<any>((at, key) => at?.[key], data),
      ref: docRef(path),
    }
  }

  const applyMerge = (existing: Data, value: Data): Data => {
    const next: Data = { ...existing }
    for (const [key, entry] of Object.entries(value)) {
      if (key.includes('.')) {
        const parts = key.split('.')
        let at = next
        for (const part of parts.slice(0, -1)) {
          at[part] = { ...(at[part] ?? {}) }
          at = at[part]
        }
        at[parts[parts.length - 1]] = entry
      } else if (entry && typeof entry === 'object' && !Array.isArray(entry) && existing[key] && typeof existing[key] === 'object') {
        next[key] = applyMerge(existing[key], entry)
      } else {
        next[key] = entry
      }
    }
    return next
  }

  const write = {
    set(path: string, value: Data, options?: { merge?: boolean }) {
      const existing = docs.get(path)
      docs.set(path, clone(options?.merge && existing ? applyMerge(existing, value) : value))
    },
    update(path: string, value: Data) {
      const existing = docs.get(path)
      if (existing === undefined) {
        throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 })
      }
      docs.set(path, clone(applyMerge(existing, value)))
    },
    create(path: string, value: Data) {
      if (docs.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS: ${path}`), { code: 6 })
      docs.set(path, clone(value))
    },
    delete(path: string) {
      docs.delete(path)
    },
  }

  function docRef(path: string): any {
    return {
      id: path.split('/').pop() as string,
      path,
      get: async () => snapshot(path),
      set: async (value: Data, options?: { merge?: boolean }) => write.set(path, value, options),
      update: async (value: Data) => write.update(path, value),
      create: async (value: Data) => write.create(path, value),
      delete: async () => write.delete(path),
      collection: (name: string) => collectionRef(`${path}/${name}`),
    }
  }

  function query(
    path: string,
    filters: Array<[string, string, unknown]>,
    order: Array<[string, 'asc' | 'desc']>,
    max: number | null,
    after: unknown = undefined,
  ): any {
    const matches = (data: Data) =>
      filters.every(([field, op, expected]) => {
        const actual = field.split('.').reduce<any>((at, key) => at?.[key], data)
        switch (op) {
          case '==':
            return actual === expected
          case '!=':
            return actual !== expected
          case '<':
            return actual < (expected as any)
          case '<=':
            return actual <= (expected as any)
          case '>':
            return actual > (expected as any)
          case '>=':
            return actual >= (expected as any)
          case 'in':
            return (expected as unknown[]).includes(actual)
          case 'array-contains':
            return Array.isArray(actual) && actual.includes(expected)
          default:
            throw new Error(`unsupported op ${op}`)
        }
      })
    const run = () => {
      const prefix = `${path}/`
      let rows = [...docs.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .filter(([, data]) => matches(data))
        .map(([key]) => snapshot(key))
      for (const [field, direction] of [...order].reverse()) {
        rows = rows.sort((a, b) => {
          const left = a.get(field)
          const right = b.get(field)
          const compared = left < right ? -1 : left > right ? 1 : 0
          return direction === 'desc' ? -compared : compared
        })
      }
      if (after !== undefined && order.length) {
        const [field, direction] = order[0]
        rows = rows.filter((row) => (direction === 'desc' ? row.get(field) < (after as any) : row.get(field) > (after as any)))
      }
      if (max !== null) rows = rows.slice(0, max)
      return { docs: rows, empty: rows.length === 0, size: rows.length }
    }
    return {
      where: (field: string, op: string, value: unknown) =>
        query(path, [...filters, [field, op, value]], order, max, after),
      orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
        query(path, filters, [...order, [field, direction]], max, after),
      limit: (count: number) => query(path, filters, order, count, after),
      startAfter: (value: unknown) => query(path, filters, order, max, value),
      get: async () => run(),
    }
  }

  function collectionRef(path: string): any {
    return {
      path,
      doc: (id?: string) => docRef(`${path}/${id ?? `generated-${++generated}`}`),
      ...query(path, [], [], null),
    }
  }

  let queue: Promise<unknown> = Promise.resolve()

  return {
    docs,
    collection: (name: string) => collectionRef(name),
    runTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const buffered: Array<() => void> = []
        const transaction = {
          get: async (ref: any) => (ref.get ? ref.get() : ref),
          set: (ref: any, value: Data, options?: { merge?: boolean }) => {
            buffered.push(() => write.set(ref.path, value, options))
          },
          update: (ref: any, value: Data) => {
            buffered.push(() => write.update(ref.path, value))
          },
          create: (ref: any, value: Data) => {
            buffered.push(() => write.create(ref.path, value))
          },
          delete: (ref: any) => {
            buffered.push(() => write.delete(ref.path))
          },
        }
        const result = await fn(transaction)
        for (const apply of buffered) apply()
        return result
      })
      queue = run.catch(() => undefined)
      return run
    },
    batch() {
      const buffered: Array<() => void> = []
      return {
        set: (ref: any, value: Data, options?: { merge?: boolean }) => {
          buffered.push(() => write.set(ref.path, value, options))
        },
        update: (ref: any, value: Data) => {
          buffered.push(() => write.update(ref.path, value))
        },
        delete: (ref: any) => {
          buffered.push(() => write.delete(ref.path))
        },
        commit: async () => {
          for (const apply of buffered) apply()
        },
      }
    },
  }
}
