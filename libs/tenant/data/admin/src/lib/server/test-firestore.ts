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
  /**
   * Every document in a collection, keyed by id.
   *
   * A SUBcollection is addressed by its full path — `hosts/host-1/suppressions`
   * — which is also how it is seeded.
   */
  docs: (collection: string) => Record<string, any>
  collection: (name: string) => any
  /**
   * Several documents in one round trip, the shape the real `getAll` has:
   * the results come back POSITIONALLY, one per reference, so a caller that
   * zips them back against its own input list gets what it asked for.
   */
  getAll: (...refs: any[]) => Promise<any[]>
  /**
   * A transaction, real enough for a read-then-write body.
   *
   * Reads pass straight through and writes are held until the body resolves,
   * which is the property the code under test depends on: a writer that
   * decides what to store FROM what it read must not observe its own
   * half-finished write. It does not model contention or retries — nothing in
   * this repo's transaction bodies branches on a retry, and a fake that
   * pretended to would be asserting the fake.
   */
  runTransaction: <T>(body: (transaction: any) => Promise<T>) => Promise<T>
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

  const fake: FakeFirestore = {
    docs: (collection: string) => store[collection] ?? {},
    getAll: async (...refs: any[]) =>
      refs.map((ref) => snapshotFor(ref.collectionPath, ref.id)),
    async runTransaction<T>(body: (transaction: any) => Promise<T>): Promise<T> {
      const pending: Array<() => Promise<void>> = []
      const transaction = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) => {
          pending.push(() => ref.set(data, options))
          return transaction
        },
      }
      const result = await body(transaction)
      for (const write of pending) await write()
      return result
    },
    collection(name: string) {
      store[name] = store[name] ?? {}
      const api: any = {
        doc: (id: string) => ({
          id,
          /**
           * Which collection this reference came from, so `getAll` can resolve
           * a bare reference the way the real client does.
           */
          collectionPath: name,
          /**
           * A subcollection is a collection at the joined path, so the fake
           * stays one flat map. Nesting matters here because a per-site list
           * lives under the site — a fake that returned the same documents for
           * `hosts/a/suppressions` and `hosts/b/suppressions` would certify a
           * sender that leaks one site's unsubscribes into another's.
           */
          collection: (sub: string) => fake.collection(`${name}/${id}/${sub}`),
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
  return fake
}

export default fakeFirestore
