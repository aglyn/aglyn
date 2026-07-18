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
import { resolveOrgEntitlements, UNLIMITED } from '@aglyn/aglyn/server'
import { firebaseAdmin, notifyOrgAdmins } from '@aglyn/tenant-data-admin'

/**
 * Usage-threshold notifications (AGL-276, wave v5): the in-console
 * quota banner only helps people who are looking — this cron pushes a
 * `billing.usage` notification to org admins when a quota crosses 80%
 * or 100%. One alert per quota per threshold per month, guarded by
 * `orgs/{orgId}.usageAlerts`. Covers the org-scoped quotas that are
 * cheap to compute server-side: monthly email sends, dataset count, and
 * dataset storage. Scheduler-invoked (x-cron-secret, like report-usage).
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Usage alerts are not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const month = new Date().toISOString().slice(0, 7)
    const orgs = await firestore.collection('orgs').limit(500).get()
    const alerted: Array<Record<string, unknown>> = []

    for (const org of orgs.docs) {
      const orgData = org.data()
      // Plan-less orgs resolve to Free with zero included quotas —
      // alerting them would just be noise; the console banner covers it.
      if (!orgData['plan']) continue
      const entitlements = resolveOrgEntitlements(orgData as any)

      // Monthly email sends: summed over the org's hosts' counters.
      const hosts = await firestore
        .collection('hosts')
        .where('orgId', '==', org.id)
        .limit(100)
        .get()
      let emailSends = 0
      // Run caps (AGL-477): the runtime silently stops workflow/action
      // automation at the monthly cap; surface it here so the owner learns
      // why automations went quiet, once per threshold per month.
      let workflowRuns = 0
      let actionRuns = 0
      // Media storage (AGL-484): total bytes stored across the org's hosts,
      // to warn when a downgrade leaves an org over its media allowance.
      let mediaBytes = 0
      for (const host of hosts.docs) {
        const [emailCounter, workflowCounter, actionCounter, mediaCounter] =
          await Promise.all([
            host.ref.collection('counters').doc('emailSends').get(),
            host.ref.collection('counters').doc('workflowRuns').get(),
            host.ref.collection('counters').doc('actionRuns').get(),
            host.ref.collection('counters').doc('media').get(),
          ])
        emailSends += Number(emailCounter.get(month) ?? 0)
        workflowRuns += Number(workflowCounter.get(month) ?? 0)
        actionRuns += Number(actionCounter.get(month) ?? 0)
        mediaBytes += Number(mediaCounter.get('bytes') ?? 0)
      }
      const hostCount = hosts.size
      const mediaMb = mediaBytes / (1024 * 1024)

      // Org datasets: count + approximate storage from the rollup the
      // monthly report writes (fresh enough for an alert).
      const datasetCount = Number(
        (await org.ref.collection('datasets').count().get()).data().count ??
          0,
      )
      const latestUsage = await org.ref
        .collection('usage')
        .orderBy('computedAt', 'desc')
        .limit(1)
        .get()
      const dataStorageMb = Number(
        latestUsage.docs[0]?.get('dataStorageMb') ?? 0,
      )

      const checks: Array<{ key: string; label: string; used: number; limit: number }> = [
        {
          // AGL-484: a downgrade can leave an org over its site/storage
          // caps; these persist and keep serving, so surface them here.
          key: 'hosts',
          label: 'sites',
          used: hostCount,
          limit: entitlements.hostLimit,
        },
        {
          key: 'mediaStorage',
          label: 'media storage',
          used: mediaMb,
          // Org-wide media allowance: per-host cap × the site allowance.
          limit: entitlements.hostLimit * entitlements.storagePerHostMb,
        },
        {
          key: 'emailSends',
          label: 'monthly email sends',
          used: emailSends,
          limit: entitlements.emailSendsPerMonth,
        },
        {
          key: 'datasets',
          label: 'datasets',
          used: datasetCount,
          limit: entitlements.maxDatasetsPerOrg,
        },
        {
          key: 'dataStorage',
          label: 'data storage',
          used: dataStorageMb,
          limit: entitlements.dataStorageMbPerOrg,
        },
        {
          key: 'workflowRuns',
          label: 'monthly workflow runs',
          used: workflowRuns,
          limit: entitlements.workflowRunsPerMonth,
        },
        {
          key: 'actionRuns',
          label: 'monthly automation runs',
          used: actionRuns,
          limit: entitlements.actionRunsPerMonth,
        },
      ]

      const guards =
        (orgData['usageAlerts'] as Record<
          string,
          { month?: string; threshold?: number }
        >) ?? {}
      const guardUpdates: Record<string, { month: string; threshold: number }> =
        {}
      for (const check of checks) {
        if (check.limit === UNLIMITED || !(check.limit > 0)) continue
        const ratio = check.used / check.limit
        const threshold = ratio >= 1 ? 100 : ratio >= 0.8 ? 80 : 0
        if (!threshold) continue
        const guard = guards[check.key]
        if (guard?.month === month && (guard.threshold ?? 0) >= threshold) {
          continue
        }
        guardUpdates[check.key] = { month, threshold }
        await notifyOrgAdmins(org.id, {
          type: 'billing.usage',
          title:
            threshold >= 100
              ? `You've reached your ${check.label} limit`
              : `You're above 80% of your ${check.label} quota`,
          body:
            `${Math.round(check.used)} of ${check.limit} used — upgrade ` +
            'in Billing to raise the limit.',
          link: '/org/billing',
        })
        alerted.push({ orgId: org.id, quota: check.key, threshold })
      }
      if (Object.keys(guardUpdates).length) {
        await org.ref.set(
          { usageAlerts: { ...guards, ...guardUpdates } },
          { merge: true },
        )
      }
    }
    return Response.json({ alerted: alerted.length, details: alerted }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Usage alert run failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
