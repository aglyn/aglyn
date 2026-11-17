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
 * THE ONE ENGAGE WRITE of the free plan's bandwidth cap (AGL-1967/2155,
 * AGL-4232), shared by its three writers: the analytics beacon, the media CDN
 * and the daily usage-alerts sweep. Each decides THAT the org is past its band
 * from the figures it already holds; this decides what the engagement is.
 *
 * ## The one-time grace
 *
 * The first time an org's sites go over, EVER, they stay online for
 * `BANDWIDTH_CAP_GRACE_MS` (72 hours) so the owner can upgrade before visitors
 * are turned away; after that the cap refuses as before until the month turns.
 * Once per SITE: the grant is recorded on every one of the org's host
 * documents (`bandwidthGraceUsedAt`), never cleared, and an org is granted it
 * only when NONE of its sites has had it. On the site rather than the org
 * because the grace is the site's, and a site can move between
 * organizations; durable because a month rollover, a plan change down and back
 * up, or a process restart re-reads the same documents and finds the stamp.
 *
 * Each writer checks the month on the org doc it already holds before it
 * calls this, so a month already engaged writes nothing. Two writers crossing
 * the band in the same instant can both stamp it; they stamp the same month,
 * and a grace both granted ends within the same seconds, so the race costs
 * nothing a reader can see.
 */

import {
  bandwidthCapMarker,
  bandwidthGraceForEngagement,
} from '@aglyn/aglyn/app-utils/bandwidth-cap'

export interface BandwidthCapEngaged {
  /** Whether THIS call engaged the cap. */
  stamped: boolean
  /** When the grace this engagement carries ends; null when it pauses now. */
  graceUntil: number | null
  /**
   * Whether this engagement GRANTED the grace. False on a re-stamp that
   * carried a running one forward, which was already announced.
   */
  graceIsNew: boolean
}

/** A site of the org, as the caller already read it. */
export interface BandwidthCapHostDoc {
  ref: FirebaseFirestore.DocumentReference
  data?(): { bandwidthGraceUsedAt?: unknown } | undefined
}

/**
 * Engage the cap for this month. The CALLER has already decided the org is
 * past its band and that this month is not engaged yet (each writer holds the
 * org doc it read that from), and hands in the org's sites as it read them:
 * the sweep and the media CDN have them already; the beacon reads them.
 */
export async function engageBandwidthCap(options: {
  orgRef: FirebaseFirestore.DocumentReference
  hosts: readonly BandwidthCapHostDoc[]
  month: string
  nowMs: number
  pageViews: number
  includedPageViews: number
}): Promise<BandwidthCapEngaged> {
  const { orgRef, hosts, month, nowMs, pageViews, includedPageViews } = options
  const grace = bandwidthGraceForEngagement(
    hosts.map((host) => (typeof host.data === 'function' ? host.data() : undefined) ?? {}),
    nowMs,
  )
  const grantsGrace = grace.grants
  const marker = bandwidthCapMarker({
    month,
    nowMs,
    pageViews,
    includedPageViews,
    graceUntil: grace.graceUntil,
  })
  // The SITES first: a grace recorded and then not granted (the marker write
  // failing) costs the site its grace; a grace granted and not recorded would
  // be granted again next month, which is the one thing it must never be.
  if (grantsGrace) {
    await Promise.all(
      hosts.map((host) => host.ref.set({ bandwidthGraceUsedAt: nowMs }, { merge: true })),
    )
  }
  // `merge: true`: one field on a document that carries the plan, the
  // subscription and the sites. A set without it would delete the org.
  await orgRef.set({ bandwidthCap: marker }, { merge: true })
  return { stamped: true, graceUntil: marker.graceUntil ?? null, graceIsNew: grantsGrace }
}
