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
import { isCronAuthorized } from '../../../../utils/cron-auth'
import {
  checkApiRequestQuota,
  checkDataStorageQuota,
} from '@aglyn/aglyn/server'
import {
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
} from '../../../../utils/usage-metering'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/** Previous calendar month as YYYY-MM (the default rollup target). */
function previousMonth(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

/**
 * Approximate aggregate dataset bytes for an org (AGL-240): per dataset,
 * an aggregate record count × the average serialized size of a small
 * sample — O(datasets) reads instead of O(records), good enough for
 * metering (the billing export replaces this when it lands).
 */
async function orgDatasetBytes(
  orgRef: FirebaseFirestore.DocumentReference,
): Promise<number> {
  const datasets = await orgRef.collection('datasets').get()
  let total = 0
  for (const dataset of datasets.docs) {
    total += JSON.stringify(dataset.data() ?? {}).length
    const records = dataset.ref.collection('records')
    const [countSnapshot, sample] = await Promise.all([
      records.count().get(),
      records.limit(50).get(),
    ])
    const count = Number(countSnapshot.data().count ?? 0)
    const sampleBytes = sample.docs.reduce(
      (sum, record) => sum + JSON.stringify(record.data() ?? {}).length,
      0,
    )
    const average = sample.size > 0 ? sampleBytes / sample.size : 0
    total += Math.round(average * count)
  }
  return total
}

async function hostUsage(
  hostRef: FirebaseFirestore.DocumentReference,
  month: string,
): Promise<HostUsageSnapshot> {
  const [media, forms, analytics] = await Promise.all([
    hostRef.collection('counters').doc('media').get(),
    hostRef.collection('counters').doc('formSubmissions').get(),
    hostRef
      .collection('analytics')
      .where(
        firebaseAdmin.firestore.FieldPath.documentId(),
        '>=',
        `${month}-01`,
      )
      .where(
        firebaseAdmin.firestore.FieldPath.documentId(),
        '<=',
        `${month}-31`,
      )
      .get(),
  ])
  return {
    storageBytes: Number(media.get('bytes') ?? 0),
    formSubmissions: Number(forms.get(month) ?? 0),
    pageViews: analytics.docs.reduce(
      (sum, day) => sum + Number(day.get('total') ?? 0),
      0,
    ),
  }
}

/**
 * Monthly usage rollup + metered billing report (AGL-41, org-keyed since
 * the AGL-238 cutover). Invoke from a scheduler (Vercel cron / GitHub
 * Action) with `x-cron-secret`: sums host counters (storage bytes, month
 * page views, month form submissions) at cost × 1.30, writes audit
 * rollups per tenant (legacy) and per org, and — when Stripe is
 * configured — sends one idempotent Billing Meter event per ORG-month
 * against the org's mirrored Stripe customer. Re-runs skip
 * already-reported org-months. Validate rates against a real invoice
 * month before enabling live billing.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Usage rollup is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const month = /^\d{4}-\d{2}$/.test(String(body?.month ?? ''))
    ? String(body.month)
    : previousMonth()
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const meterEventName =
    process.env.STRIPE_METER_EVENT_NAME ?? 'aglyn_metered_usage'

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hosts = await firestore.collection('hosts').limit(1000).get()

    // Group hosts by org — the sole billing subject (AGL-238; the legacy
    // per-tenant rollups retired with the tenants collection).
    const byOrg: Record<string, FirebaseFirestore.DocumentReference[]> = {}
    for (const host of hosts.docs) {
      const orgId = host.get('orgId')
      if (orgId) (byOrg[orgId] ??= []).push(host.ref)
    }

    const usageCache = new Map<string, Promise<HostUsageSnapshot>>()
    const usageFor = (hostRef: FirebaseFirestore.DocumentReference) => {
      let pending = usageCache.get(hostRef.path)
      if (!pending) {
        pending = hostUsage(hostRef, month)
        usageCache.set(hostRef.path, pending)
      }
      return pending
    }

    // Org rollups + metering (AGL-238 cutover): orgs are the billing
    // subject — the meter event uses the org's mirrored Stripe customer
    // and an org-month identifier, idempotent via the usage doc's
    // reportedAt on our side and the identifier on Stripe's.
    const orgResults: Record<string, any> = {}
    for (const [orgId, hostRefs] of Object.entries(byOrg)) {
      const usage = await Promise.all(hostRefs.map(usageFor))
      const estimate = estimateMonthlyUsageCost(usage)
      const orgRef = firestore.collection('orgs').doc(orgId)
      const orgSnapshot = await orgRef.get()
      // Dataset storage overage (AGL-240): plan-priced (not cost-plus),
      // metered on top of the infra estimate.
      const datasetBytes = await orgDatasetBytes(orgRef)
      const dataStorageMb =
        Math.round((datasetBytes / (1024 * 1024)) * 10) / 10
      const dataQuota = checkDataStorageQuota(
        orgSnapshot.data() as any,
        dataStorageMb,
      )
      // Customer REST API request overage (AGL-635): plan-priced per 1,000
      // requests over the included quota, metered like dataset storage. The
      // durable counter is written per-request by the API auth chokepoint.
      const apiUsageSnap = await orgRef.collection('apiUsage').doc(month).get()
      const apiRequests = Number(apiUsageSnap.get('count') ?? 0)
      const apiQuota = checkApiRequestQuota(orgSnapshot.data() as any, apiRequests)
      const billedCents =
        estimate.billedCents +
        Math.round(dataQuota.overageMonthlyUsd * 100) +
        Math.round(apiQuota.overageMonthlyUsd * 100)
      const usageRef = orgRef.collection('usage').doc(month)
      const existing = await usageRef.get()
      if (existing.get('reportedAt')) {
        orgResults[orgId] = { billedCents, skipped: true }
        continue
      }

      let reported = false
      if (stripeKey && billedCents > 0) {
        const customerId = orgSnapshot.get('stripeCustomerId')
        if (customerId) {
          const response = await fetch(
            'https://api.stripe.com/v1/billing/meter_events',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${stripeKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                event_name: meterEventName,
                identifier: `${orgId}-${month}`,
                'payload[stripe_customer_id]': String(customerId),
                'payload[value]': String(billedCents),
              }).toString(),
            },
          )
          if (response.ok) reported = true
          else console.error('meter event failed', await response.json())
        }
      }

      await usageRef.set(
        {
          month,
          hostCount: hostRefs.length,
          storageGb: estimate.storageGb,
          pageViews: estimate.pageViews,
          formSubmissions: estimate.formSubmissions,
          costUsd: estimate.costUsd,
          dataStorageMb,
          dataOverageUsd: dataQuota.overageMonthlyUsd,
          apiRequests,
          apiOverageUsd: apiQuota.overageMonthlyUsd,
          billedCents,
          computedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          ...(reported && {
            reportedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          }),
        },
        { merge: true },
      )
      orgResults[orgId] = { billedCents, reported }
    }
    return Response.json({ month, orgs: orgResults }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Rollup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
