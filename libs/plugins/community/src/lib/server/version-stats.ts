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

import type { CommunityArtifactType } from '../model/community'

/**
 * Per-version install counters (AGL-1036).
 *
 * The listing already carries `installCount` (cumulative) and `activeInstalls`
 * (live pins), but neither answers the question a publisher asks before
 * changing anything: **who is still on the old version?** A listing-level
 * number cannot, and a re-pin does not even move it — the pin already existed,
 * so nothing increments while the install quietly changes version underneath.
 *
 * This module is the one writer of the per-version pair, deliberately: the
 * listing-level counters drifted apart precisely because five install routes
 * each incremented their own, and the per-version pair has twice the surface —
 * every version change is TWO writes, a decrement of what was left and an
 * increment of what was taken.
 */

/**
 * Where a version's counters live, which differs by artifact type.
 *
 * Plugins keep their versions in `pluginVersions` (publish internals, review
 * state, bundle pointers); everything else keeps content snapshots in
 * `versions`. Both are server-only, which is why the counters are read back
 * out through the listing-versions route rather than by the client.
 */
export function versionCollectionFor(
  artifactType: CommunityArtifactType | string | null | undefined,
): 'pluginVersions' | 'versions' {
  return artifactType === 'plugin' ? 'pluginVersions' : 'versions'
}

export interface VersionMoveInput {
  firestore: FirebaseFirestore.Firestore
  listingRef: FirebaseFirestore.DocumentReference
  artifactType: CommunityArtifactType | string | null | undefined
  /** The version this install was on, if any. Null for a first install. */
  from?: string | number | null
  /** The version it is on now. Null for an uninstall. */
  to?: string | number | null
}

const asId = (value: string | number | null | undefined): string | null =>
  value == null || value === '' ? null : String(value)

/**
 * Moves one install from one version's tally to another's.
 *
 * Rules, all of which exist because a wrong count is worse than no count:
 *
 * * `activeInstalls` is clamped at zero, so a repeat uninstall — which the
 *   plugin route already tolerates at listing level — cannot go negative.
 * * `installCount` only rises, and only on the version being taken: it records
 *   that an install once landed there, which stays true after they leave.
 * * A version whose document is gone is skipped rather than created. Writing
 *   `increment()` blind would resurrect a deleted version as a counters-only
 *   stub, and in `pluginVersions` that stub would surface through
 *   `newestApprovedVersion` as a version with no publish date and no review.
 * * `from === to` is a no-op. Re-installing the same version is not a new
 *   install of it, and counting it would inflate every re-install.
 *
 * Never on the critical path: a counter that cannot be written must not fail
 * an install the user asked for.
 */
export async function recordVersionMove(input: VersionMoveInput): Promise<void> {
  const from = asId(input.from)
  const to = asId(input.to)
  if (from === to) return
  const collection = input.listingRef.collection(
    versionCollectionFor(input.artifactType),
  )
  const bump = async (versionId: string, activeDelta: 1 | -1) => {
    const ref = collection.doc(versionId)
    await input.firestore
      .runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        if (!snapshot.exists) return
        const active = Number(snapshot.get('activeInstalls') ?? 0)
        tx.update(ref, {
          activeInstalls: Math.max(0, active + activeDelta),
          ...(activeDelta > 0
            ? { installCount: Number(snapshot.get('installCount') ?? 0) + 1 }
            : {}),
        })
      })
      .catch(() => undefined)
  }
  if (from) await bump(from, -1)
  if (to) await bump(to, 1)
}
