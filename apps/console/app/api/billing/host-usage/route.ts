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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { bandwidthGbFromPageViews } from '../../../../utils/usage-metering'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/**
 * This month's page views for ONE site (AGL-41 follow-up — the bandwidth row
 * previously showed "not yet metered"). The console sums this across the
 * org's sites, because the `bandwidthGb` band it is rendered against is
 * org-wide, as are the usage-alerts cron and the invoice (AGL-1371).
 *
 * Authorization is per-site membership, which is why this endpoint stayed
 * per-site while the arithmetic moved up to the org.
 *
 * It used to return `siteSizeBytes` too — a live per-site sweep of every
 * published version payload, ~250 document reads per site per page load. That
 * had exactly one reader, the site-size meter, and that meter now reads the
 * org-wide `siteSizeMb` the monthly rollup writes (the same field the cron
 * alerts on), so the sweep here was pure cost for a number nothing rendered.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(query['hostId'] ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole) {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }

    const month = new Date().toISOString().slice(0, 7)
    const analytics = await hostRef
      .collection('analytics')
      .where(firebaseAdmin.firestore.FieldPath.documentId(), '>=', `${month}-01`)
      .where(firebaseAdmin.firestore.FieldPath.documentId(), '<=', `${month}-31`)
      .get()

    const monthPageViews = analytics.docs.reduce(
      (sum, day) => sum + Number(day.get('total') ?? 0),
      0,
    )
    return Response.json(
      {
        monthPageViews,
        // Per-site GB, for a caller that wants one site's share. The METER
        // does not use it — it sums `monthPageViews` org-wide and converts
        // once, so rounding cannot accumulate per site (AGL-1371).
        bandwidthGb: bandwidthGbFromPageViews(monthPageViews),
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Usage lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
