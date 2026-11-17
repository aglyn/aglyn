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
 * The first time a workspace's sites go over, EVER, they stay online for
 * `BANDWIDTH_CAP_GRACE_MS` (72 hours) so the owner can upgrade before visitors
 * are turned away; after that the cap refuses as before until the month turns.
 * Given once: the grant is recorded on the workspace
 * (`orgs/{id}.bandwidthGraceUsedAt`) AND on every one of its sites
 * (`hosts/{id}.bandwidthGraceUsedAt`), never cleared, and granted only when
 * NONE of them carries it. Both, so neither a site moved to another workspace
 * nor a site deleted and made again brings it back; durable because a month
 * rollover, a plan change down and back, or a restart re-reads the same
 * documents.
 *
 * ## One transaction
 *
 * The marker, the workspace's stamp and every site's stamp are re-read INSIDE
 * it, so two writers crossing the band together engage the month, grant the
 * grace and tell the owner once: the second finds the month engaged and
 * writes nothing. A site's stamp is written with `update`, and only to a site
 * read as existing, so a site deleted meanwhile is not recreated as an empty
 * document (its deletion retries the transaction, which reads it as gone).
 *
 * It engages only the CURRENT month: a writer that fixed its month before
 * midnight UTC on the 1st and reaches an org after it must not spend the
 * grace on a month that has ended.
 */

import {
  bandwidthCapMarker,
  bandwidthCapMonthKey,
  bandwidthGraceForEngagement,
} from '@aglyn/aglyn/app-utils/bandwidth-cap'

export interface BandwidthCapEngaged {
  /** Whether THIS call engaged the cap (false: already engaged, or not this month). */
  stamped: boolean
  /** When the grace this engagement carries ends; null when it pauses now. */
  graceUntil: number | null
  /** Whether this engagement GRANTED the grace (false: one carried forward). */
  graceIsNew: boolean
}

const NOT_STAMPED: BandwidthCapEngaged = { stamped: false, graceUntil: null, graceIsNew: false }

export async function engageBandwidthCap(options: {
  firestore: FirebaseFirestore.Firestore
  orgRef: FirebaseFirestore.DocumentReference
  /** The workspace's sites, as references; read inside the transaction. */
  hostRefs: readonly FirebaseFirestore.DocumentReference[]
  month: string
  nowMs: number
  pageViews: number
  includedPageViews: number
}): Promise<BandwidthCapEngaged> {
  const { firestore, orgRef, month, nowMs, pageViews, includedPageViews } = options
  if (bandwidthCapMonthKey(new Date(nowMs)) !== month) return NOT_STAMPED
  // One reference per site: a caller that seeds the list with its own site
  // (a legacy site with no `orgId` is missing from the query) may repeat one.
  const hostRefs = [...new Map(options.hostRefs.map((ref) => [ref.path, ref])).values()]
  return firestore.runTransaction(async (transaction) => {
    const org = await transaction.get(orgRef)
    const orgData = (org.data() ?? {}) as {
      bandwidthCap?: { month?: string }
      bandwidthGraceUsedAt?: unknown
    }
    if (orgData.bandwidthCap?.month === month) return NOT_STAMPED
    const hosts = (await Promise.all(hostRefs.map((ref) => transaction.get(ref)))).filter(
      (host) => host.exists,
    )
    const grace = bandwidthGraceForEngagement(
      hosts.map((host) => (host.data() ?? {}) as { bandwidthGraceUsedAt?: unknown }),
      nowMs,
      orgData,
    )
    const marker = bandwidthCapMarker({
      month,
      nowMs,
      pageViews,
      includedPageViews,
      graceUntil: grace.graceUntil,
    })
    // `merge: true`: two fields on a document that carries the plan, the
    // subscription and the sites. A set without it would delete the org.
    transaction.set(
      orgRef,
      { bandwidthCap: marker, ...(grace.grants ? { bandwidthGraceUsedAt: nowMs } : {}) },
      { merge: true },
    )
    if (grace.grants) {
      for (const host of hosts) {
        transaction.update(host.ref, { bandwidthGraceUsedAt: nowMs })
      }
    }
    return { stamped: true, graceUntil: grace.graceUntil, graceIsNew: grace.grants }
  })
}
