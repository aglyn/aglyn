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
  type AglynOrgBilling,
  analyticsBandwidthReading,
  bandwidthCapApplies,
  bandwidthCapMonthKey,
  bandwidthCapShouldEngage,
  bandwidthGbFromPageViews,
  pageViewsFromBandwidthGb,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from './firebase-admin'
import { notifyHostManagers } from './notifications'

/**
 * The Free cap, engaged by the media CDN (AGL-3474).
 *
 * The cap's marker (`orgs/{id}.bandwidthCap`) had two writers, and both are
 * driven by PAGES: the analytics beacon, on a sample of page views, and the
 * daily usage sweep. Video and files count against the same band now, but a
 * film or a PDF linked from somewhere else is served with no page view at
 * all — so a Free org whose traffic is its media would cross its band and
 * keep serving until the next morning's sweep. A day of one popular clip is
 * hundreds of gigabytes.
 *
 * So the CDN is a third writer, on the same terms as the other two: the same
 * `bandwidthCapShouldEngage` predicate, the same marker fields, the same UTC
 * month key, and a write only when the marker does not already name this
 * month. A reader cannot tell which writer stamped a marker.
 *
 * ## The month it totals
 *
 * Org-wide, because the band is: every site's page views and counted media,
 * plus the org library's media, read from the same analytics day documents
 * the invoice reads, through the same {@link analyticsBandwidthReading}.
 *
 * ## What it costs
 *
 * Nothing for a paying org: the CDN asks only for an org whose plan the cap
 * stops (`bandwidthCapApplies`, decided off the org document its delivery
 * verdict already holds). For those, one evaluation per
 * {@link MEDIA_BANDWIDTH_EVALUATE_EVERY_BYTES} an instance serves — the org
 * document, its site ids and the month's day documents, a few dozen reads
 * against about three cents of delivery.
 *
 * ## The slop, stated
 *
 * Each instance evaluates on its first counted request for an org and then
 * once per {@link MEDIA_BANDWIDTH_EVALUATE_EVERY_BYTES}, so the cap engages at
 * most that much per instance past the band, and the CDN's own verdict cache
 * takes up to fifteen seconds to see the marker. The beacon's slop is the
 * same shape, measured in views.
 */

/** How many counted bytes an instance serves an org between evaluations. */
export const MEDIA_BANDWIDTH_EVALUATE_EVERY_BYTES = 32 * 1024 * 1024

/** Sites totalled per org. The cap is for Free, which has one. */
const MEDIA_BANDWIDTH_MAX_HOSTS = 100

/** Bound on the per-instance maps, whose keys come from served requests. */
const MAX_TRACKED_ORGS = 5_000

/** Counted bytes since an org's last evaluation, on this instance. */
const bytesSinceEvaluation = new Map<string, number>()

/** Orgs this instance has seen engaged, by the month they were engaged for. */
const engagedOrgs = new Map<string, string>()

/** Drop the per-instance state. Tests need it between cases. */
export function invalidateMediaBandwidthCapState(): void {
  bytesSinceEvaluation.clear()
  engagedOrgs.clear()
}

/**
 * Note `bytes` counted for `orgId`, and say whether this instance should now
 * total the org's month.
 *
 * Due on the first counted request an instance sees for the org — a cold
 * instance under a spike evaluates at once, which is when it matters — and
 * then each time another {@link MEDIA_BANDWIDTH_EVALUATE_EVERY_BYTES} has
 * gone out. Never due again in a month this instance has seen it engaged.
 */
export function mediaBandwidthEvaluationDue(
  orgId: string,
  bytes: number,
  now: Date = new Date(),
): boolean {
  if (!orgId || !(bytes > 0)) return false
  if (engagedOrgs.get(orgId) === bandwidthCapMonthKey(now)) return false
  if (bytesSinceEvaluation.size > MAX_TRACKED_ORGS) bytesSinceEvaluation.clear()
  const since = bytesSinceEvaluation.get(orgId)
  if (since === undefined || since + bytes >= MEDIA_BANDWIDTH_EVALUATE_EVERY_BYTES) {
    bytesSinceEvaluation.set(orgId, 0)
    return true
  }
  bytesSinceEvaluation.set(orgId, since + bytes)
  return false
}

/** `YYYY-MM` as the day it rolls over, the way a notice prints it. */
function monthRolloverLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Total `orgId`'s month and engage the cap if it is past the band. Answers
 * whether THIS call engaged it.
 *
 * Best-effort, like the beacon's writer: it runs beside a delivery that has
 * already been decided, and a failure here is logged and costs the request
 * nothing.
 */
export async function engageMediaBandwidthCap(
  orgId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const month = bandwidthCapMonthKey(now)
  if (!orgId || engagedOrgs.get(orgId) === month) return false
  try {
    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) return false
    const org = (orgSnapshot.data() ?? {}) as Partial<AglynOrgBilling>
    if (!bandwidthCapApplies(org)) return false
    if (org.bandwidthCap?.month === month) {
      rememberEngaged(orgId, month)
      return false
    }
    const documentId = firebaseAdmin.firestore.FieldPath.documentId()
    // The query `report-usage` and the beacon run, per scope: a cap that
    // counted a different month from the invoice would refuse traffic nobody
    // was charged for.
    const monthOf = (ref: FirebaseFirestore.DocumentReference) =>
      ref
        .collection('analytics')
        .where(documentId, '>=', `${month}-01`)
        .where(documentId, '<=', `${month}-31`)
        .get()
    const hosts = await firestore
      .collection('hosts')
      .where('orgId', '==', orgId)
      .select()
      .limit(MEDIA_BANDWIDTH_MAX_HOSTS)
      .get()
    const months = await Promise.all([
      monthOf(orgRef),
      ...hosts.docs.map((host) => monthOf(host.ref)),
    ])
    const reading = analyticsBandwidthReading(months.flatMap((days) => days.docs))
    const includedBandwidthGb = resolveOrgEntitlements(org).bandwidthGb
    if (
      !bandwidthCapShouldEngage({
        org,
        usedBandwidthGb: bandwidthGbFromPageViews(reading.meteredPageViews),
        includedBandwidthGb,
      })
    ) {
      return false
    }
    // Stamped inside a transaction that re-reads the marker, so two instances
    // crossing the band together stamp it, and tell the owner, once.
    const stamped = await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(orgRef)
      if (current.get('bandwidthCap')?.month === month) return false
      // `merge: true`: one field on a document that carries the plan, the
      // subscription and the sites. A set without it would delete the org.
      transaction.set(
        orgRef,
        {
          bandwidthCap: {
            month,
            engagedAt: now.getTime(),
            pageViews: Math.round(reading.meteredPageViews),
            includedPageViews: Math.round(
              pageViewsFromBandwidthGb(includedBandwidthGb),
            ),
          },
        },
        { merge: true },
      )
      return true
    })
    rememberEngaged(orgId, month)
    if (!stamped) return false
    const included = includedBandwidthGb.toLocaleString('en-US', {
      maximumFractionDigits: 2,
    })
    // Every site's managers, because the cap pauses every site in the org.
    // `{site}` is filled by `notifyHostManagers` from the host it reads.
    await Promise.all(
      hosts.docs.map((host) =>
        notifyHostManagers(host.id, {
          type: 'system.bandwidthCapEngaged',
          title: '{site} paused — monthly traffic limit reached',
          body:
            `{site} has used the ${included} GB of traffic its plan includes ` +
            'this month. Video and files served from your media library count ' +
            'toward it as well as page views, so visitors see a temporary ' +
            'notice instead of its pages, and its video and files do not load, ' +
            `until ${monthRolloverLabel(month)}. Nothing is charged for the ` +
            'extra traffic. The site comes back on its own then, or as soon as ' +
            'you upgrade in Billing.',
          link: `/${host.id}`,
        }),
      ),
    )
    return true
  } catch (error) {
    console.error('[media-cdn] bandwidth cap evaluation failed', orgId, error)
    return false
  }
}

function rememberEngaged(orgId: string, month: string): void {
  if (engagedOrgs.size > MAX_TRACKED_ORGS) engagedOrgs.clear()
  engagedOrgs.set(orgId, month)
}
