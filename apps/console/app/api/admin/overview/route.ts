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
import {
  meteredBandField,
  meteredPluginBands,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import {
  ORG_BILLING_SUBCOLLECTION,
  isBillingSubscription,
  isEnterpriseOrg,
  orgCogsInputFrom,
  orgMonthlyCogsUsd,
  orgMonthlyRevenueUsd,
  resolveEffectivePlan,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import { classifyOrgRevenueState } from '../../../../utils/server/revenue-report'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { previousMonth } from '../../../../utils/billing-month'

/** Previous calendar month as YYYY-MM (the rollup key). */
function monthBefore(month: string): string {
  const [year, monthPart] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthPart - 1 - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
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

    // The marketplace's purchases and its refund-reversal recovery queue are
    // the marketplace's own collection, drawn by its widget in the page's
    // `staffOverview` zone from its own staff route (AGL-3080).
    const [orgsSnapshot, hostsCount] = await Promise.all([
      firestore
        .collection('orgs')
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get()
        // Orgs created before createdAt existed still count.
        .catch(() => firestore.collection('orgs').limit(500).get()),
      firestore.collection('hosts').count().get(),
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
    // Orgs sitting on a paid plan that bills nothing — staff overrides,
    // comps, dark launches (AGL-925). They are excluded from MRR, and
    // reported so the headline is legible rather than mysteriously low.
    let compedOrgs = 0
    let payingOrgs = 0
    let signups30d = 0
    const planCounts: Record<string, number> = {}
    const newestOrgs: any[] = []
    // `subscription` moved to `orgs/{orgId}/billing/stripe` (AGL-1028), so the
    // revenue signal is no longer on the org doc. One unfiltered collection-
    // group read fetches every billing doc at once — the alternative, a get per
    // org inside the loop, is an N+1 across the whole orgs collection. Needs no
    // composite index: the query has no filter or ordering.
    const billingByOrgId = new Map<string, Record<string, unknown>>()
    const billingSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collectionGroup(ORG_BILLING_SUBCOLLECTION)
      .get()
    for (const billingDoc of billingSnapshot.docs) {
      const parentOrgId = billingDoc.ref.parent.parent?.id
      if (parentOrgId) billingByOrgId.set(parentOrgId, billingDoc.data())
    }
    for (const doc of orgsSnapshot.docs) {
      const data = doc.data()
      const plan = (data['plan'] ?? '') as OrgPlan | ''
      // MRR follows the Stripe subscription mirror, not the plan field: a
      // staff override sets `plan` and never writes `subscription`, so
      // billing state is the only honest signal of revenue (AGL-925).
      //
      // Merged org doc + billing doc: `plan`, `seatAddons` and `discount` are
      // still inline, `subscription` is not, and the revenue helpers need all
      // of them. Org doc first so a stale inline `subscription` left over from
      // before the backfill loses to the authoritative one.
      const billing = {
        ...data,
        ...(billingByOrgId.get(doc.id) ?? {}),
      } as { plan?: OrgPlan; subscription?: any }
      // The plan each org GETS (AGL-3034): a staff comp's, or Free for a
      // stored plan whose subscription died. Orgs that never stored a plan
      // keep their own bucket, as before.
      const effectivePlan = resolveEffectivePlan(billing as never)
      const planBucket = plan || effectivePlan !== 'free' ? effectivePlan : 'none'
      planCounts[planBucket] = (planCounts[planBucket] ?? 0) + 1
      if (isBillingSubscription(billing)) {
        payingOrgs += 1
        mrrUsd += orgMonthlyRevenueUsd(billing)
      } else if (classifyOrgRevenueState(billing as never) === 'comped') {
        // The revenue page's one classification (AGL-2486), so the two staff
        // surfaces count the same orgs: an explicit comp (AGL-3034) or a paid
        // plan with no subscription at all — never a canceled one, which is
        // churn wearing a stale plan field.
        compedOrgs += 1
      }
      const createdMs = data['createdAt']?.toMillis?.() ?? null
      if (createdMs && createdMs >= thirtyDaysAgo) signups30d += 1
      if (newestOrgs.length < 20) {
        newestOrgs.push({
          $id: doc.id,
          name: data['name'] ?? null,
          slug: data['slug'] ?? null,
          // Report the plan the org READS as (AGL-1118). `enterprise` is a
          // real plan now, but an org provisioned before that carries a base
          // plan plus a custom price / comped marker — listing it as "agency"
          // is how the staff table kept contradicting the org's own Billing
          // page.
          plan:
            (isEnterpriseOrg(billing)
              ? 'enterprise'
              : plan || effectivePlan !== 'free'
                ? effectivePlan
                : '') || null,
          createdAt: createdMs,
        })
      }
    }

    /*
     * A staff reader recognizes a customer by name, never by document id.
     * The lists below are keyed on `orgId` and rendered it raw — the cards
     * that exist to say "look at this organization" were the ones that did
     * not say which.
     *
     * Built from `orgsSnapshot`, which is already loaded for the plan and MRR
     * roll-ups, so naming these costs NO additional read. The fallback chain
     * matches the recent-orgs list on the page (`name` → `slug` → id) so one
     * org cannot appear under two different labels on the same screen.
     *
     * ⚠️ Declared HERE, above every caller. `const` bindings have a temporal
     * dead zone and each of the three lists below is built eagerly, so a
     * `orgLabel(...)` call that runs before this line throws
     * `ReferenceError: Cannot access 'orgLabel' before initialization` — and
     * the anomaly list only calls it on a row that actually spiked, so the
     * failure would appear on the first abuse alert and never before it.
     *
     * ⚠️ The snapshot is capped at 500. An org outside it keeps its id rather
     * than going blank — an unfamiliar id is still a lead a staff member can
     * paste into the org search, and an empty cell is not.
     */
    const orgLabelById = new Map<string, string>()
    for (const doc of orgsSnapshot.docs) {
      const data = doc.data()
      const label = (data['name'] ?? data['slug'] ?? '') as string
      if (label) orgLabelById.set(doc.id, label)
    }
    const orgLabel = (orgId: string): string =>
      orgLabelById.get(orgId) ?? orgId

    // Anomaly flags (AGL-205): orgs whose page views or metered cost
    // jumped >=10x month-over-month — an abuse/runaway early warning.
    const anomalies = usagePairs
      .map(({ orgId, current, prior }) => {
        if (!current.exists || !prior.exists) return null
        // Priced through the shared cost model (AGL-1134) rather than the
        // rollup's own `costUsd`, so this detector and the discount guardrail
        // cannot disagree about what an org costs. It also widens what counts
        // as a spike: `costUsd` prices the infrastructure meters only, so a
        // runaway in dataset storage, API requests, email or any plugin's
        // meter — all recorded on the same document — was invisible here. The
        // fields are read through `orgCogsInputFrom`, the guardrail's own
        // projection, so a meter a plugin adds is in the detector too.
        //
        // Both sides of the ratio use the same function, so the 10x
        // comparison is unaffected by the change in absolute scale.
        const measured = (snap: typeof current) =>
          orgMonthlyCogsUsd(orgCogsInputFrom(snap.data()), 0).measuredUsd
        const pageViews = Number(current.get('pageViews') ?? 0)
        const costUsd = measured(current)
        const priorPageViews = Number(prior.get('pageViews') ?? 0)
        const priorCostUsd = measured(prior)
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
        return spikes.length ? { orgId, orgLabel: orgLabel(orgId), spikes } : null
      })
      .filter(Boolean)
      .slice(0, 20)

    const topUsage = usagePairs
      .filter(({ current }) => current.exists)
      .map(({ orgId, current }) => ({
        orgId,
        orgLabel: orgLabel(orgId),
        month: current.get('month'),
        storageGb: Number(current.get('storageGb') ?? 0),
        pageViews: Number(current.get('pageViews') ?? 0),
        // Each metered band, in running prose: "12 form submissions".
        meters: meteredPluginBands().map((band) => ({
          noun: band.metered.noun,
          count: Number(current.get(meteredBandField(band)) ?? 0),
        })),
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
        payingOrgs,
        compedOrgs,
        planCounts,
        rollupMonth: month,
      },
      newestOrgs,
      topUsage,
    }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Overview failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
