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
 * A Firestore stand-in for specs that span MORE THAN ONE COLLECTION
 * (AGL-1592). Test-only; deliberately not exported from the barrel.
 *
 * The one-collection fakes elsewhere in this directory return the same
 * document whatever collection name they are handed, which is fine when the
 * code under test touches one document and actively misleading when it does
 * not: the phone opt-out path reads `users/{uid}` and `contactSuppressions/{n}`
 * and the whole point is that they are different records. A fake that conflated
 * them would pass while the real thing wrote the marker on top of the
 * suppression.
 *
 * `FieldValue.delete()` is honoured for real, because "the field is gone" and
 * "the field holds a sentinel object" are different states and only the first
 * one makes `seedUserProfile`'s blank check fire.
 */

import { FieldValue } from 'firebase-admin/firestore'

const DELETE = FieldValue.delete()

export interface FakeFirestore {
  /** Every document in a collection, keyed by id. */
  docs: (collection: string) => Record<string, any>
  collection: (name: string) => any
}

export function fakeFirestore(
  seed: Record<string, Record<string, any>> = {},
): FakeFirestore {
  const store: Record<string, Record<string, any>> = JSON.parse(
    JSON.stringify(seed),
  )

  const snapshotFor = (collection: string, id: string) => {
    const data = store[collection]?.[id]
    return {
      id,
      exists: data !== undefined,
      get: (field: string) => data?.[field],
      data: () => data,
    }
  }

  return {
    docs: (collection: string) => store[collection] ?? {},
    collection(name: string) {
      store[name] = store[name] ?? {}
      const api: any = {
        doc: (id: string) => ({
          id,
          get: async () => snapshotFor(name, id),
          set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
            const base = options?.merge ? (store[name][id] ?? {}) : {}
            const next: Record<string, any> = { ...base }
            for (const [key, value] of Object.entries(data)) {
              // A real delete, not a stored sentinel — see the header.
              if (value && typeof value === 'object' && DELETE.isEqual(value as any)) {
                delete next[key]
                continue
              }
              // Server timestamps arrive as sentinels too. Freeze them into
              // something a spec can assert on and a date can be read from.
              next[key] =
                value && typeof value === 'object' && typeof (value as any).isEqual === 'function'
                  ? { seconds: Math.floor(Date.now() / 1000) }
                  : value
            }
            store[name][id] = next
          },
        }),
        // Ordering and limits are not what these specs are about; the queue
        // read just needs to return everything it stored.
        orderBy: () => api,
        limit: () => api,
        get: async () => ({
          docs: Object.keys(store[name]).map((id) => snapshotFor(name, id)),
        }),
        add: async (data: Record<string, any>) => {
          const id = `auto-${Object.keys(store[name]).length + 1}`
          store[name][id] = data
          return { id }
        },
      }
      return api
    },
  }
}

export default fakeFirestore
