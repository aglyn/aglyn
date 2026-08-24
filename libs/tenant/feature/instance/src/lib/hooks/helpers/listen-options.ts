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

import { type SnapshotListenOptions } from 'firebase/firestore'

/**
 * The listen options every hook that reports `fromCache` MUST pass (AGL-2486).
 *
 * ## What breaks without it
 *
 * `fromCache` is the signal `writeGuardedBySeed` refuses on, and without this
 * option it can LATCH TRUE FOR THE LIFE OF THE LISTENER — so every guarded
 * save on the page is refused forever, across reloads, while the connection is
 * perfectly healthy. That is the "We could not confirm your SEO settings with
 * the server" banner in AGL-2486, and it is not a connection fault at all.
 *
 * The cause is in the SDK's own event-raising rule
 * (`@firebase/firestore` 4.17.0, `QueryListener.shouldRaiseEvent`):
 *
 * ```js
 * if (snap.docChanges.length > 0) return true;
 * const pendingChanged = this.snap && this.snap.hasPendingWrites !== snap.hasPendingWrites;
 * return !(!snap.syncStateChanged && !pendingChanged)
 *   && true === this.options.includeMetadataChanges;
 * ```
 *
 * The cache→server confirmation is a `syncStateChanged` tick and nothing else:
 * when the server confirms a document the cache already held, the data is
 * IDENTICAL, so `docChanges` is empty. The rule above then raises the event
 * **only if `includeMetadataChanges === true`**. At the default of `false` the
 * confirmation is silently dropped, `setFromCache(false)` never runs, and the
 * hook keeps reporting the value it was initialised with — `true`.
 *
 * So the bug fires precisely when the local cache is WARM and AGREES with the
 * server, which under `persistentLocalCache` is the ordinary state of any
 * console page the author has opened before. It clears only by luck: if the
 * server's copy happens to differ, `docChanges` is non-empty and the event is
 * raised. That is why this survived — it is intermittent by data, not by
 * network.
 *
 * ## Measured, not argued (2026-08-24)
 *
 * A real browser, the real SDK, `persistentLocalCache`, one document seeded so
 * cache and server agree, reloading between runs:
 *
 * - default options → 1 event, `fromCache: true`, never clears (6s), and
 *   IDENTICAL on reload — while `…/Firestore/Listen/channel` returned 200.
 * - `{ includeMetadataChanges: true }` → 2 events; the second at 121ms with
 *   `fromCache: false` and the same data. Latch cleared.
 *
 * Note the first bullet: the Listen channel is OPEN and ANSWERING. The old
 * theory that the refusal means "a tab that never opened a listener" is wrong,
 * and so is the "only a fresh tab fixes it" folklore — a fresh tab only helps
 * when it happens to read a document the cache does not already agree with.
 *
 * ## Why this is the fix and not a workaround
 *
 * It does not weaken the gate: `fromCache` still comes from the SDK, still
 * starts `true`, and still refuses while the server has genuinely not
 * confirmed. It restores the SDK event the guard was always written to
 * consume. Defaulting the flag to `false`, or adding a "save anyway" escape,
 * would trade the banner for the silent whole-object overwrite the guard
 * exists to prevent.
 *
 * ## Cost
 *
 * One extra callback per listener when the server confirms (measured at ~100ms
 * after subscribe, i.e. at page load, long before a user has typed), plus the
 * pending-write acknowledgement tick — which was ALSO being suppressed, so
 * `hasPendingWrites` was equally unreliable before this. Consumers must
 * therefore tolerate a snapshot whose data is unchanged; none may treat a new
 * emission as "the document changed".
 *
 * `useOrgScope` has passed this since AGL-886 for the same reason, and
 * `useConfirmedDoc` pays for a whole extra `getDocFromServer` to work around
 * not passing it.
 */
export const CONFIRMABLE_LISTEN_OPTIONS: SnapshotListenOptions = {
  includeMetadataChanges: true,
}

export default CONFIRMABLE_LISTEN_OPTIONS
