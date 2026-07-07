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
  estimateMonthlyUsageCost,
  type HostUsageSnapshot,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/** Previous calendar month as YYYY-MM (the default rollup target). */
function previousMonth(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
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
 * Monthly usage rollup + metered billing report (AGL-41). Invoke from a
 * scheduler (Vercel cron / GitHub Action) with `x-cron-secret`; per tenant
 * it sums host counters (storage bytes, month page views, month form
 * submissions), prices them at cost × 1.30, writes an audit rollup to
 * `tenants/{id}/usageRollups/{month}`, and — when Stripe is configured —
 * sends one idempotent Billing Meter event (value = billed cents) for
 * tenants with a Stripe customer. Re-runs skip already-reported tenants.
 * Validate rates against a real invoice month before enabling live billing.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res
      .status(501)
      .json({ error: 'Usage rollup is not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  const month = /^\d{4}-\d{2}$/.test(String(req.body?.month ?? ''))
    ? String(req.body.month)
    : previousMonth()
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const meterEventName =
    process.env.STRIPE_METER_EVENT_NAME ?? 'aglyn_metered_usage'

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hosts = await firestore.collection('hosts').limit(1000).get()

    // Group hosts by owning tenant (host.tenantId; fall back to the first
    // admin uid for hosts created before the field existed).
    const byTenant: Record<string, FirebaseFirestore.DocumentReference[]> = {}
    for (const host of hosts.docs) {
      const tenantId =
        host.get('tenantId') ?? Object.keys(host.get('admins') ?? {})[0]
      if (!tenantId) continue
      ;(byTenant[tenantId] ??= []).push(host.ref)
    }

    const results: Record<string, any> = {}
    for (const [tenantId, hostRefs] of Object.entries(byTenant)) {
      const usage = await Promise.all(
        hostRefs.map((hostRef) => hostUsage(hostRef, month)),
      )
      const estimate = estimateMonthlyUsageCost(usage)
      const rollupRef = firestore
        .collection('tenants')
        .doc(tenantId)
        .collection('usageRollups')
        .doc(month)
      const existing = await rollupRef.get()
      if (existing.get('reportedAt')) {
        results[tenantId] = { billedCents: estimate.billedCents, skipped: true }
        continue
      }

      let reported = false
      if (stripeKey && estimate.billedCents > 0) {
        const tenantSnapshot = await firestore
          .collection('tenants')
          .doc(tenantId)
          .get()
        const customerId = tenantSnapshot.get('stripeCustomerId')
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
                // Idempotent per tenant-month on Stripe's side too.
                identifier: `${tenantId}-${month}`,
                'payload[stripe_customer_id]': String(customerId),
                'payload[value]': String(estimate.billedCents),
              }).toString(),
            },
          )
          if (response.ok) reported = true
          else console.error('meter event failed', await response.json())
        }
      }

      await rollupRef.set(
        {
          month,
          storageGb: estimate.storageGb,
          pageViews: estimate.pageViews,
          formSubmissions: estimate.formSubmissions,
          costUsd: estimate.costUsd,
          billedCents: estimate.billedCents,
          computedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          ...(reported && {
            reportedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          }),
        },
        { merge: true },
      )
      results[tenantId] = { billedCents: estimate.billedCents, reported }
    }
    return res.status(200).json({ month, tenants: results })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Rollup failed' })
  }
}
