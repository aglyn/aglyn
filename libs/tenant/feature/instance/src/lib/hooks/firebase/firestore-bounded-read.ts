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

import {
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore'
import {
  FIRESTORE_STALL_MS,
  recoverStalledFirestore,
} from './firestore-stall-recovery'

/**
 * ONE-OFF READS THAT CANNOT HANG (AGL-3373).
 *
 * `getDocs` and `getDoc` wait for the server whenever the client believes it
 * is online. When the client is wrong about that — the multi-tab wedge
 * `firestore-stall-recovery.ts` describes — they never settle, and a page
 * that set `loading` before awaiting one never clears it. The notifications
 * feed read "No notifications match these filters" for ten minutes that way.
 *
 * These race the server read against {@link FIRESTORE_STALL_MS}. If the
 * server has not answered by then, the client is asked to recover, and the
 * read settles from the local cache with `stale: true`, so the caller can
 * say "this may be out of date" instead of spinning. The server read is not
 * abandoned: `fresh` resolves with its answer if it arrives, so a caller can
 * swap the cached rows for confirmed ones without reading again.
 *
 * When the cache cannot answer either — `getDocFromCache` for a document the
 * cache has never held — the read REJECTS with {@link FirestoreStallError}.
 * A caller's error path is a better place to land than a spinner that never
 * ends.
 */

/** A read that settled, and whether it had to settle for the cache. */
export interface BoundedRead<S> {
  snapshot: S
  /**
   * The server did not answer in time and `snapshot` is the local cache's.
   * It may be out of date.
   */
  stale: boolean
  /**
   * For a stale read, the server's answer if it ever arrives, otherwise
   * `undefined`. Never rejects. Absent for a read the server answered.
   */
  fresh?: Promise<S | undefined>
}

export interface BoundedReadOptions {
  /** Override {@link FIRESTORE_STALL_MS}. */
  stallMs?: number
}

/** Neither the server nor the cache could answer in time. */
export class FirestoreStallError extends Error {
  readonly code = 'unavailable'
  /** Why the cache could not answer. */
  constructor(readonly cacheError?: unknown) {
    super(
      'The server did not answer in time and nothing is cached for this read.',
    )
    this.name = 'FirestoreStallError'
  }
}

interface BoundedReadDeps<S> {
  server: () => Promise<S>
  cache: () => Promise<S>
  firestore: Firestore | undefined
  stallMs: number
  recover?: (firestore: Firestore | undefined) => unknown
}

const STALLED = Symbol('stalled')

/** The race itself, over injected reads. */
export async function boundedRead<S>(
  deps: BoundedReadDeps<S>,
): Promise<BoundedRead<S>> {
  const { server, cache, firestore, stallMs } = deps
  const recover = deps.recover ?? recoverStalledFirestore
  const serverRead = server()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<typeof STALLED>((resolve) => {
    timer = setTimeout(() => resolve(STALLED), stallMs)
  })
  let winner: S | typeof STALLED
  try {
    winner = await Promise.race([serverRead, stalled])
  } finally {
    clearTimeout(timer)
  }
  if (winner !== STALLED) return { snapshot: winner, stale: false }

  void recover(firestore)
  const fresh = serverRead.then(
    (snapshot) => snapshot,
    () => undefined,
  )
  try {
    const snapshot = await cache()
    return { snapshot, stale: true, fresh }
  } catch (error) {
    throw new FirestoreStallError(error)
  }
}

/** `getDocs`, bounded. See the module comment. */
export function getDocsBounded<T = DocumentData>(
  query: Query<T>,
  options: BoundedReadOptions = {},
): Promise<BoundedRead<QuerySnapshot<T>>> {
  return boundedRead({
    server: () => getDocs(query),
    cache: () => getDocsFromCache(query),
    firestore: (query as { firestore?: Firestore }).firestore,
    stallMs: options.stallMs ?? FIRESTORE_STALL_MS,
  })
}

/** `getDoc`, bounded. See the module comment. */
export function getDocBounded<T = DocumentData>(
  reference: DocumentReference<T>,
  options: BoundedReadOptions = {},
): Promise<BoundedRead<DocumentSnapshot<T>>> {
  return boundedRead({
    server: () => getDoc(reference),
    cache: () => getDocFromCache(reference),
    firestore: (reference as { firestore?: Firestore }).firestore,
    stallMs: options.stallMs ?? FIRESTORE_STALL_MS,
  })
}

/** The notice a surface shows over a stale read. */
export const STALE_READ_NOTICE = 'This may be out of date — reconnecting…'
