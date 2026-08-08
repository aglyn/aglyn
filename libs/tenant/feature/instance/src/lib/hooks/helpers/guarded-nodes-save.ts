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
  ConcurrentEditError,
  hasConcurrentWrite,
  versionStamp,
} from '@aglyn/aglyn'
import { runTransaction, type DocumentReference } from 'firebase/firestore'
import isEqual from 'lodash-es/isEqual'

/**
 * What the editor believes the stored document looked like when it last
 * agreed with it. Both fields optional: an absent baseline means "never
 * established", which must not refuse the save (see `hasConcurrentWrite`).
 */
export interface NodesSaveBaseline {
  /** `versionStamp(...)` of the document's `updatedAt` at load/last save. */
  baseStamp?: string | null
  /** The stored nodes as of that agreement, in STORED shape. */
  baseNodes?: unknown
}

/**
 * Persists a besigner node map only if the stored document still matches the
 * baseline the editor loaded (AGL-1301).
 *
 * The AGL-674 guard is listener-based, so a save clicked in the window
 * between another writer's commit and the local snapshot's delivery still
 * overwrote it — the guard had simply not heard yet. Running the same check
 * inside a Firestore transaction closes that window: the `get` is served by
 * the backend (never the local cache), the check runs against what is
 * actually stored, and the write only commits if nothing moved. Contention
 * during the transaction re-runs it against fresh data, so the late writer
 * aborts rather than winning by timing.
 *
 * TWO preconditions, deliberately:
 *
 * - The `updatedAt` stamp, same equality-only comparison as the listener
 *   guard.
 * - The stored `nodes` content itself. `updatedAt` is an app-level FIELD
 *   that a writer can forget — admin backfills have updated `nodes` without
 *   touching it, and such a write was invisible to the stamp and got
 *   clobbered. The web client SDK exposes no server-side `updateTime` on a
 *   snapshot (`snapshot.metadata` carries only `hasPendingWrites` /
 *   `fromCache`; document update times are Admin-SDK-only), so comparing
 *   the content is the strongest check actually available to this client —
 *   and it is exact: this save only ever writes `nodes` (+ stamp), so
 *   "did `nodes` change under me" is precisely the conflict that loses work.
 *
 * Aborts by throwing `ConcurrentEditError`, which `useBesignerDocument`
 * surfaces through the existing refusal UX. A converter on `ref` applies as
 * usual, so compressed-at-rest documents stay compressed and keep stamping
 * `updatedAt` on write.
 *
 * Trade-off, accepted: a transaction requires the backend, so this save no
 * longer queues offline. A conflict guard that consults a local cache would
 * be theatre — the AGL-674 refusal already implies "the server has spoken".
 */
export async function saveNodesGuarded<T>(
  ref: DocumentReference<T>,
  data: Partial<T>,
  baseline?: NodesSaveBaseline,
): Promise<void> {
  await runTransaction(ref.firestore, async (transaction) => {
    const snapshot = await transaction.get(ref)
    const stored = snapshot.data() as
      | { updatedAt?: unknown; nodes?: unknown }
      | undefined
    if (stored) {
      const storedStamp = versionStamp(stored.updatedAt)
      if (hasConcurrentWrite(baseline?.baseStamp ?? null, storedStamp)) {
        throw new ConcurrentEditError()
      }
      if (
        baseline?.baseNodes != null &&
        stored.nodes != null &&
        !isEqual(stored.nodes, baseline.baseNodes)
      ) {
        throw new ConcurrentEditError()
      }
    }
    transaction.set(ref, data, { merge: true })
  })
}

export default saveNodesGuarded
