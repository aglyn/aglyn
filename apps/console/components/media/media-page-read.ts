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
  FirestoreStallError,
  type BoundedRead,
} from '@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read'
import { FIRESTORE_STALL_MS } from '@aglyn/tenant-feature-instance/hooks/firebase/firestore-stall-recovery'

/**
 * A page of the media library that ALWAYS settles (AGL-3660).
 *
 * The library's page read was a bare `getDocs`. In the multi-tab wedge
 * (`firestore-stall-recovery.ts`) a `getDocs` in a tab that is not syncing
 * never settles, so `useMediaPages` held `loading` forever and the library
 * read "Loading media…" under a progress bar for as long as the tab stayed
 * open — reported on the organization Media page with no console error and
 * no failed request, because nothing had failed: the read was simply never
 * answered.
 *
 * `bounded` is `getDocsBounded`: it asks the client to recover after
 * {@link FIRESTORE_STALL_MS} and answers from the cache. This then:
 *
 * 1. gives the server a further `graceMs` — the recovery cycle usually frees
 *    the read within a second or two, and a confirmed page beats a cached one;
 * 2. else takes the cache's page when it has rows — a library that may be a
 *    little out of date is still the library;
 * 3. else REJECTS with {@link FirestoreStallError}. An empty cache is not an
 *    empty library, and "No media here yet" over a stalled read is the
 *    AGL-1062 lie. The rejection lands on the library's Retry notice.
 */
export async function settleMediaPageRead<S extends { empty: boolean }>(
  bounded: () => Promise<BoundedRead<S>>,
  options: { graceMs?: number } = {},
): Promise<{ snapshot: S; stale: boolean }> {
  const { graceMs = FIRESTORE_STALL_MS } = options
  const read = await bounded()
  if (!read.stale) return { snapshot: read.snapshot, stale: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  const fresh = await Promise.race([
    read.fresh ?? Promise.resolve(undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), graceMs)
    }),
  ]).finally(() => clearTimeout(timer))
  if (fresh) return { snapshot: fresh, stale: false }
  if (!read.snapshot.empty) return { snapshot: read.snapshot, stale: true }
  throw new FirestoreStallError()
}

export default settleMediaPageRead
