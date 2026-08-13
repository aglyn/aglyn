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
'use client'

import {
  type FirestoreLocalCache,
  memoryLocalCache,
  memoryLruGarbageCollector,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { type AuthPersistenceClass } from './auth-persistence'

/**
 * The Firestore `localCache` an origin of this persistence class may use
 * (AGL-1456).
 *
 * ## Why this keys off the *auth* persistence class
 *
 * The name is historical — the class predates this file (AGL-1379) — but the
 * question it answers was never auth-specific. `AuthPersistenceClass` is
 * documented as *"how much of a session an origin is allowed to keep"*, and
 * AGL-1099a's D6 justified `ephemeral` on the grounds that **"the customer can
 * re-point the DNS and read this origin."**
 *
 * That reasoning does not stop at the credential. It is equally true of every
 * document body Firestore caches in IndexedDB on that origin — measured, not
 * argued: the PoC (`docs/design/agl-1099a-poc-findings.md` §5) dumped every
 * object store on the origin and found full document contents under
 * `firestore/<app>/<project>/main → remoteDocumentsV14`, alongside
 * `firestore_clients_*` / `firestore_online_state_*` /
 * `firestore_sequence_number_*` in `localStorage`. D6 hardened the key and
 * left the safe behind it open; this closes it.
 *
 * **One declaration, two consequences — deliberately.** A separate
 * `firestoreCache` prop would let a caller declare a custom console domain
 * `ephemeral` for auth and still hand it a persistent cache, which is exactly
 * the split that produced this bug. There is one fact about the origin, so
 * there is one place to state it.
 *
 * ## The two classes
 *
 * - `durable` → `persistentLocalCache` with the multi-tab manager. Unchanged
 *   from what every host has always run, and it must stay that way:
 *   `*.aglyn.com` / `*.aglyn.app` are ours forever, and this cache is part of
 *   why console read volume is what it is (AGL-1440).
 * - `ephemeral` → `memoryLocalCache`, so **nothing** reaches disk on an origin
 *   whose DNS the customer can re-point at their own server.
 *
 * ## Why the memory cache gets the LRU collector, not the default
 *
 * `memoryLocalCache()` defaults to `memoryEagerGarbageCollector`, which drops
 * a document the moment no listener references it — so navigating away from a
 * console page and back re-reads its whole working set from the server. The
 * LRU collector keeps documents in the JS heap up to its 40 MB default instead,
 * which recovers most of the intra-session read saving `persistentLocalCache`
 * was giving us.
 *
 * It costs nothing against the property being protected: the LRU collector is
 * still **memory only**. Nothing is written to IndexedDB, nothing survives a
 * tab close, and a page load on a re-pointed origin starts empty — the same
 * bound `inMemoryPersistence` gives the refresh token.
 *
 * The read cost that remains is real and is the stated trade: a **cold** page
 * load on a custom console domain re-reads its working set where a durable
 * origin would have resumed from disk, and multiple tabs no longer share one
 * backend connection through `persistentMultipleTabManager`. That is the right
 * trade for an Enterprise-only feature, but it is a trade.
 */
export function localCacheFor(
  originClass: AuthPersistenceClass,
): FirestoreLocalCache {
  if (originClass === 'ephemeral') {
    return memoryLocalCache({ garbageCollector: memoryLruGarbageCollector() })
  }
  return persistentLocalCache({ tabManager: persistentMultipleTabManager() })
}
