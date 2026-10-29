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
 * A Firestore stand-in for this plugin's specs (AGL-4098): documents by full
 * path in one map, the reads and writes the request routes make, a
 * transaction that applies its writes when its body resolves, and a
 * collection-group query on one field. Test-only.
 */
export interface StandInFirestore {
  docs: Map<string, Record<string, any>>
  firestore: FirebaseFirestore.Firestore
}

const merge = (base: Record<string, any> | undefined, patch: Record<string, any>) => {
  const next: Record<string, any> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    next[key] =
      value && typeof value === 'object' && !Array.isArray(value) && next[key] && typeof next[key] === 'object'
        ? merge(next[key], value)
        : value
  }
  return next
}

export function standInFirestore(seed: Record<string, Record<string, any>> = {}): StandInFirestore {
  const docs = new Map<string, Record<string, any>>(Object.entries(seed))
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      ref: doc(path),
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => data?.[field],
    }
  }
  function doc(path: string): any {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => snapshot(path),
      set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
        docs.set(path, options?.merge ? merge(docs.get(path), data) : { ...data })
      },
      create: async (data: Record<string, any>) => {
        if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
        docs.set(path, { ...data })
      },
      update: async (data: Record<string, any>) => {
        if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
        docs.set(path, { ...docs.get(path), ...data })
      },
      delete: async () => void docs.delete(path),
      collection: (name: string) => collection(`${path}/${name}`),
    }
  }
  let auto = 0
  function collection(path: string): any {
    return {
      doc: (id?: string) => doc(`${path}/${id ?? `auto-${++auto}`}`),
      add: async (data: Record<string, any>) => {
        const ref = doc(`${path}/auto-${++auto}`)
        docs.set(ref.path, { ...data })
        return ref
      },
    }
  }
  const firestore = {
    collection: (name: string) => collection(name),
    collectionGroup: (name: string) => {
      const filters: Array<(data: Record<string, any>) => boolean> = []
      let max = Infinity
      let order: string | null = null
      const query: any = {
        where: (field: string, op: string, value: any) => {
          filters.push((data) => (op === '<=' ? data[field] <= value : op === '==' ? data[field] === value : false))
          return query
        },
        orderBy: (field: string) => {
          order = field
          return query
        },
        limit: (count: number) => {
          max = count
          return query
        },
        get: async () => {
          const matches = [...docs.keys()]
            .filter((path) => path.split('/').slice(-2, -1)[0] === name)
            .filter((path) => filters.every((filter) => filter(docs.get(path) as Record<string, any>)))
            .sort((a, b) => (order ? Number(docs.get(a)?.[order] ?? 0) - Number(docs.get(b)?.[order] ?? 0) : 0))
            .slice(0, max)
          return { empty: matches.length === 0, size: matches.length, docs: matches.map(snapshot) }
        },
      }
      return query
    },
    runTransaction: async <T>(body: (transaction: any) => Promise<T>): Promise<T> => {
      const writes: Array<() => void> = []
      const answer = await body({
        get: async (ref: any) => snapshot(ref.path),
        set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) =>
          writes.push(() => docs.set(ref.path, options?.merge ? merge(docs.get(ref.path), data) : { ...data })),
      })
      writes.forEach((write) => write())
      return answer
    },
  }
  return { docs, firestore: firestore as unknown as FirebaseFirestore.Firestore }
}
