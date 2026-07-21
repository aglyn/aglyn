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
import { PLAN_PRICING, type OrgPlan } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

/** Previous calendar month as YYYY-MM (the rollup key). */
function monthBefore(month: string): string {
  const [year, monthPart] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthPart - 1 - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousMonth(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

/**
 * Staff overview (AGL-135/238): headline metrics (organizations, 30-day
 * signups, MRR estimate from plan base prices + seat/dataset addons, site
 * count), the newest-org feed, the marketplace purchase feed, and the top
 * org usage rollups from the AGL-41 pipeline. Read-only — every mutation
 * stays on the Organizations page where it's audited. Gated on the
 * `staff` custom claim, same trust anchor as the Firestore rules.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
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
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const month = previousMonth()

    const [orgsSnapshot, hostsCount, purchasesSnapshot] = await Promise.all([
      firestore
        .collection('orgs')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get()
        // Orgs created before createdAt existed still count.
        .catch(() => firestore.collection('orgs').limit(500).get()),
      firestore.collection('hosts').count().get(),
      firestore
        .collection('communityPurchases')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
        .catch(() =>
          firestore.collection('communityPurchases').limit(50).get(),
        ),
    ])
    // Org usage rollups live at orgs/{orgId}/usage/{month} (AGL-238) —
    // direct doc gets per fetched org, no collection-group index needed.
    const priorMonth = monthBefore(month)
    const usagePairs = await Promise.all(
      orgsSnapshot.docs.map(async (orgDoc) => {
        const usageRef = orgDoc.ref.collection('usage')
        const [current, prior] = await Promise.all([
          usageRef.doc(month).get(),
          usageRef.doc(priorMonth).get(),
        ])
        return { orgId: orgDoc.id, current, prior }
      }),
    )

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    let mrrUsd = 0
    let signups30d = 0
    const planCounts: Record<string, number> = {}
    const newestOrgs: any[] = []
    for (const doc of orgsSnapshot.docs) {
      const data = doc.data()
      const plan = (data['plan'] ?? '') as OrgPlan | ''
      planCounts[plan || 'none'] = (planCounts[plan || 'none'] ?? 0) + 1
      if (plan && PLAN_PRICING[plan]) {
        const pricing = PLAN_PRICING[plan]
        mrrUsd += pricing.basePriceMonthlyUsd
        const addons = data['seatAddons'] ?? {}
        mrrUsd +=
          Math.max(0, addons.managers ?? 0) * (pricing.extraSeatMonthlyUsd ?? 0)
        mrrUsd +=
          Math.max(0, addons.members ?? 0) *
          (pricing.extraMemberMonthlyUsd ?? 0)
        mrrUsd +=
          Math.max(0, addons.datasets ?? 0) *
          (pricing.extraDatasetMonthlyUsd ?? 0)
      }
      const createdMs = data['createdAt']?.toMillis?.() ?? null
      if (createdMs && createdMs >= thirtyDaysAgo) signups30d += 1
      if (newestOrgs.length < 20) {
        newestOrgs.push({
          $id: doc.id,
          name: data['name'] ?? null,
          slug: data['slug'] ?? null,
          plan: plan || null,
          createdAt: createdMs,
        })
      }
    }

    const purchases = purchasesSnapshot.docs.slice(0, 50).map((doc) => {
      const data = doc.data()
      return {
        $id: doc.id,
        listingId: data['listingId'] ?? null,
        buyerUid: data['buyerUid'] ?? null,
        sellerOrgId: data['sellerOrgId'] ?? null,
        amountCents: data['amountCents'] ?? 0,
        feeCents: data['feeCents'] ?? 0,
        createdAt: data['createdAt']?.toMillis?.() ?? null,
      }
    })

    // Anomaly flags (AGL-205): orgs whose page views or metered cost
    // jumped >=10x month-over-month — an abuse/runaway early warning.
    const anomalies = usagePairs
      .map(({ orgId, current, prior }) => {
        if (!current.exists || !prior.exists) return null
        const pageViews = Number(current.get('pageViews') ?? 0)
        const costUsd = Number(current.get('costUsd') ?? 0)
        const priorPageViews = Number(prior.get('pageViews') ?? 0)
        const priorCostUsd = Number(prior.get('costUsd') ?? 0)
        const spikes: string[] = []
        if (priorPageViews >= 100 && pageViews >= priorPageViews * 10) {
          spikes.push(
            `page views ${priorPageViews.toLocaleString()} → ${pageViews.toLocaleString()}`,
          )
        }
        if (priorCostUsd >= 1 && costUsd >= priorCostUsd * 10) {
          spikes.push(
            `metered cost $${priorCostUsd.toFixed(2)} → $${costUsd.toFixed(2)}`,
          )
        }
        return spikes.length ? { orgId, spikes } : null
      })
      .filter(Boolean)
      .slice(0, 20)

    const topUsage = usagePairs
      .filter(({ current }) => current.exists)
      .map(({ orgId, current }) => ({
        orgId,
        month: current.get('month'),
        storageGb: Number(current.get('storageGb') ?? 0),
        pageViews: Number(current.get('pageViews') ?? 0),
        formSubmissions: Number(current.get('formSubmissions') ?? 0),
        costUsd: Number(current.get('costUsd') ?? 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 20)

    return Response.json({
      anomalies,
      metrics: {
        orgs: orgsSnapshot.size,
        signups30d,
        hosts: hostsCount.data().count,
        mrrUsd: Math.round(mrrUsd * 100) / 100,
        planCounts,
        rollupMonth: month,
      },
      newestOrgs,
      purchases,
      topUsage,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Overview failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
