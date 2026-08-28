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

import { Timestamp } from '@aglyn/shared-util-timestamp'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import type { HostArtifactCollection } from '../utils/host-artifact-queries'

/**
 * Every timestamp is greater than this one, and no `null` is.
 *
 * Firestore orders values by TYPE before value, and `null` sorts below every
 * number, string and timestamp — so an inequality against the epoch selects
 * exactly the documents whose `deletedAt` holds a real timestamp. Documents
 * with no `deletedAt` field are excluded from an inequality outright, which
 * is the other half of the same answer.
 */
const BEFORE_EVERY_TOMBSTONE = Timestamp.fromMillis(0)

/**
 * How many artifacts of a kind a site actually holds — a server aggregate,
 * not the length of a page (AGL-1716, the AGL-1706 shape).
 *
 * A list that pages holds ten rows. Handing that ten to a quota readout is a
 * confident wrong number in the flattering direction: "10/10 layouts on your
 * plan" on a site with sixty of them reads as room to spare, right up until
 * `/api/hosts/resources` refuses the create. The list and the count are
 * different questions and are asked separately — one aggregate per mount,
 * re-asked when `epoch` moves.
 *
 * ## Why two aggregates rather than one
 *
 * Deleting an artifact stamps `deletedAt` and leaves the document in place,
 * so a published tenant page keeps grafting until its next revalidate. The
 * enforcing route counts the LIVE ones — `/api/hosts/resources` reads the
 * collection with a `deletedAt` projection and keeps the entries where it is
 * `== null` — so a console count over the whole collection would quote a cap
 * usage the server does not enforce, and would disagree with the list beside
 * it row for row.
 *
 * Firestore cannot express "field is absent" as a predicate, and the two live
 * shapes are not one value: an artifact created through the resources route
 * carries no `deletedAt` at all, while one installed from the marketplace
 * carries an explicit `deletedAt: null` (`install.ts` writes it). So
 * `where('deletedAt', '==', null)` would return the marketplace copies alone.
 * Counting the TOMBSTONES instead is exact, because there is only one shape
 * of tombstone — a `Timestamp` — and subtracting them from the total leaves
 * precisely the documents the server calls live.
 *
 * Both aggregates bill one document read each at these collection sizes.
 *
 * @returns the live count, or `null` while it is pending or if it was
 * refused. A caller must fall back to something that can only UNDERSTATE the
 * truth, never to `0`: an entitlement check answers from whatever it is
 * handed, and zero used is the one wrong answer that opens a gate.
 */
export function useLiveArtifactCount(
  hostId: string,
  artifact: HostArtifactCollection,
  epoch = 0,
): number | null {
  const firestore = useFirestore()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    const artifacts = collection(firestore, 'hosts', hostId, artifact)
    void Promise.all([
      getCountFromServer(artifacts),
      getCountFromServer(
        query(artifacts, where('deletedAt', '>', BEFORE_EVERY_TOMBSTONE)),
      ),
    ])
      .then(([total, tombstones]) => {
        if (!active) return
        // Never below zero: the two aggregates are separate round-trips and a
        // delete landing between them can make the second the larger read.
        setCount(
          Math.max(0, total.data().count - tombstones.data().count),
        )
      })
      .catch(() => {
        // The caller's fallback stands. Deliberately not 0 — see the return
        // contract above.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, artifact, epoch])

  return count
}

export default useLiveArtifactCount
