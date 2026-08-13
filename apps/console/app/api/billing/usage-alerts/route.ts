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

import { buildRoute, pluginRequestFromWeb, Route } from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { resolveOrgEntitlements, UNLIMITED } from '@aglyn/aglyn/server'
import { bandwidthGbFromPageViews } from '../../../../utils/usage-metering'
import {
  measureScreenCaps,
  screenCapMaxBillable,
} from '../../../../utils/screen-cap-reconciliation'
import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, notifyOrgAdmins } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  billingAutoLockEnabled,
  shouldAutoLockOrgForBilling,
} from '../../../../utils/billing-auto-lock'
import { applyOrgLockdown } from '../../../../utils/server/org-lockdown'

/**
 * Usage-threshold notifications (AGL-276, wave v5): the in-console
 * quota banner only helps people who are looking — this cron pushes a
 * `billing.usage` notification to org admins when a quota crosses 80%
 * or 100%. One alert per quota per threshold per month, guarded by
 * `orgs/{orgId}.usageAlerts`. Covers sites, media storage, monthly email
 * sends, dataset count + storage, workflow/automation runs, and — added
 * AGL-1106 — monthly bandwidth, which is the included band the invoice meters
 * page views against, so the alert is a real pre-invoice heads-up. The
 * published-site-size check AGL-1107 added was removed in AGL-1370 as
 * unreachable. Scheduler-invoked (x-cron-secret, like report-usage).
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

      // Monthly email (AGL-1438). TWO figures, because the plan's cap and
      // the org's cost are no longer the same number. `campaignEmailSends` is
      // the discretionary volume `emailSendsPerMonth` may refuse;
      // `emailSends` is everything the org sent, including transactional mail
      // that is counted and never blocked. Alerting on the first tells an
      // owner why a campaign was refused; alerting on the second tells them
      // about an overage before the invoice does.
      const hosts = await firestore
        .collection('hosts')
        .where('orgId', '==', org.id)
        .limit(100)
        .get()
      let emailSends = 0
      let campaignEmailSends = 0
      // Run caps (AGL-477): the runtime silently stops workflow/action
      // automation at the monthly cap; surface it here so the owner learns
      // why automations went quiet, once per threshold per month.
      let workflowRuns = 0
      let actionRuns = 0
      // Media storage (AGL-484): total bytes stored across the org's hosts,
      // to warn when a downgrade leaves an org over its media allowance.
      //
      // Plus the ORG LIBRARY, added below (AGL-1473). An org DAM upload counts
      // against `orgs/{id}/counters/media`, which this sum never read — so an
      // org sitting over its allowance purely in the shared library got no
      // warning at all, on the one alert whose entire job is telling somebody
      // before a downgrade bites.
      let mediaBytes = 0
      // Bandwidth (AGL-1106): this month's page views × the average page
      // transfer — same estimate the billing meter uses; it was displayed
      // but never alerted. Computed fresh (bandwidth accrues within the
      // month, so last month's rollup would be stale).
      let pageViews = 0
      for (const host of hosts.docs) {
        const [
          emailCounter,
          campaignEmailCounter,
          workflowCounter,
          actionCounter,
          mediaCounter,
          analytics,
        ] = await Promise.all([
          host.ref.collection('counters').doc('emailSends').get(),
          host.ref.collection('counters').doc('campaignEmailSends').get(),
          host.ref.collection('counters').doc('workflowRuns').get(),
          host.ref.collection('counters').doc('actionRuns').get(),
          host.ref.collection('counters').doc('media').get(),
          host.ref
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
        emailSends += Number(emailCounter.get(month) ?? 0)
        campaignEmailSends += Number(campaignEmailCounter.get(month) ?? 0)
        workflowRuns += Number(workflowCounter.get(month) ?? 0)
        actionRuns += Number(actionCounter.get(month) ?? 0)
        mediaBytes += Number(mediaCounter.get('bytes') ?? 0)
        pageViews += analytics.docs.reduce(
          (sum, day) => sum + Number(day.get('total') ?? 0),
          0,
        )
      }
      // The org library's own counter (AGL-1473). ONE read for the whole org,
      // not one per host — it belongs to no site, so it cannot fan out.
      //
      // This is a WARNING, not a charge, so it is not behind
      // `BILL_ORG_LIBRARY_STORAGE_FROM`: the bytes are already enforced
      // against `storagePerHostMb` at upload, and an alert that stays silent
      // about storage the platform will refuse the next upload for is the
      // defect, not the caution.
      const orgMediaCounter = await org.ref
        .collection('counters')
        .doc('media')
        .get()
      mediaBytes += Math.max(0, Number(orgMediaCounter.get('bytes') ?? 0) || 0)

      const hostCount = hosts.size
      const mediaMb = mediaBytes / (1024 * 1024)
      // Org-wide: the loop above summed every host's page views, and
      // `bandwidthGb` is an org-wide band. Shared with the console meter and
      // the metered estimate since AGL-1371 — this cron was already right,
      // and the meter is what moved to match it.
      const bandwidthGb = bandwidthGbFromPageViews(pageViews)

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
      const rollup = latestUsage.docs[0]
      const dataStorageMb = Number(rollup?.get('dataStorageMb') ?? 0)

      // Screens per site (AGL-1390): the ONLY thing that ever re-asks whether
      // a live site is inside the plan's screen allowance. Everywhere else the
      // cap is a gate on a write, and three issues in one night found three
      // different ways past it — each invisible until somebody read the code,
      // because nothing counted afterwards. Keyed on the org's worst host,
      // since the cap is per site and the alert is per org. Detection only:
      // over-cap sites keep serving every page they serve today.
      //
      // Read off the rollup rather than re-measured (AGL-1440). The rollup
      // writes `maxBillableScreens` daily and this cron already reads that very
      // document two lines up for `dataStorageMb`, so the figure is free —
      // where measuring it here meant an UNBOUNDED scan of every host's whole
      // `screens` collection, one billed read per screen, every single day.
      // Same staleness this cron already accepts for data storage, and the
      // helper falls back to measuring when there is no usable figure, so an
      // org the rollup has not reached is measured rather than reported as 0.
      const maxBillableScreens = await screenCapMaxBillable(
        rollup
          ? {
              maxBillableScreens: rollup.get('maxBillableScreens'),
              computedAt: rollup.get('computedAt'),
            }
          : null,
        Date.now(),
        async () =>
          (
            await measureScreenCaps(
              hosts.docs.map((host) => ({
                id: host.id,
                ref: host.ref,
                routingMap: host.get('screens'),
              })),
              orgData,
            )
          ).maxBillable,
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
          // AGL-1390: per SITE, so the org-level alert reports the worst one.
          // Reaching it is not an error — a site at its cap is a site using
          // what it bought — but crossing it means something created screens
          // the gate never saw, and this is the only place that would notice.
          key: 'screens',
          label: 'screens on a site',
          used: maxBillableScreens,
          limit: entitlements.screensPerHost,
        },
        {
          key: 'mediaStorage',
          label: 'media storage',
          // Every site's library PLUS the org's shared one (AGL-1473).
          used: mediaMb,
          // Org-wide media allowance: per-host cap × the site allowance.
          limit: entitlements.hostLimit * entitlements.storagePerHostMb,
        },
        {
          // The only email figure a quota can refuse (AGL-1438). Reading the
          // all-mail counter here would tell an owner they were at their
          // campaign limit because their store had a busy week of orders.
          key: 'emailSends',
          label: 'monthly campaign email sends',
          used: campaignEmailSends,
          limit: entitlements.emailSendsPerMonth,
        },
        {
          // Total volume, including the transactional mail the cap never
          // refuses (AGL-1438). Crossing the band is not an error and nothing
          // is blocked — this exists so the overage is not first seen on an
          // invoice. Distinct key, so it thresholds and dedupes on its own.
          key: 'emailSendsTotal',
          label: 'monthly email sends including transactional (not capped)',
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
        {
          // AGL-1106: bandwidth was displayed but never alerted/enforced.
          key: 'bandwidth',
          label: 'monthly bandwidth',
          used: bandwidthGb,
          limit: entitlements.bandwidthGb,
        },
        // No `siteSize` check (AGL-1370). It was added in AGL-1107 and could
        // never fire: `measure-node-map.ts` refuses any node map over 900 KB
        // (AGL-678) and the rollup sweep is bounded per host, so the measured
        // total tops out at 2.3–20.9% of `totalSiteSizeMb` depending on plan —
        // never the 80% this loop alerts at. The measurement itself stays on
        // the rollup as an internal signal; the dead alert does not.
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
          orgId: org.id,
          // Billing is org-scoped now (AGL-621/644); links are frozen at write
          // time, so emit canonical and let the reader repair the legacy ones.
          link: (org.get('slug') as string | undefined)
            ? buildRoute(Route.MANAGE_BILLING, {
                orgSlug: org.get('slug') as string,
              })
            : '/org/billing',
        })
        alerted.push({ orgId: org.id, quota: check.key, threshold })
      }
      if (Object.keys(guardUpdates).length) {
        await org.ref.set(
          { usageAlerts: { ...guards, ...guardUpdates } },
          { merge: true },
        )
      }

      /*==========================================
       * BILLING AUTO-LOCK (AGL-1501) — DISABLED BY DEFAULT.
       *
       * Locks orgs whose subscription has been unpaid for 30+ days past
       * the end of their paid period, through the SAME `applyOrgLockdown`
       * core the staff panic button uses (org doc + member projection +
       * tenant cache eviction; no token revocation — billing locks keep
       * sessions so people can reach Billing and fix it).
       *
       * THE SWITCH: `AUTO_LOCK_BILLING_FROM=YYYY-MM` (utils/
       * billing-auto-lock.ts). Unset/malformed = this whole block is
       * inert — auto-suspending paying-ish customers is a policy Zach
       * flips deliberately, never a default. The manual button is
       * /admin/lockdown, reason `billing`.
       *=========================================*/
      if (
        billingAutoLockEnabled(month, process.env.AUTO_LOCK_BILLING_FROM) &&
        orgData['suspendedAt'] == null
      ) {
        try {
          const billingDoc = await org.ref
            .collection(ORG_BILLING_SUBCOLLECTION)
            .doc(ORG_BILLING_DOC_ID)
            .get()
          const billingSubscription =
            (billingDoc.get('subscription') as {
              status?: string
              currentPeriodEnd?: { seconds?: number } | null
            } | null) ?? null
          if (
            shouldAutoLockOrgForBilling(
              orgData as never,
              billingSubscription,
              Date.now(),
            )
          ) {
            await applyOrgLockdown({
              firestore,
              orgId: org.id,
              action: 'lock',
              lock: { reason: 'billing' },
              revokeMemberTokens: false,
            })
            await firestore.collection('adminAudit').add({
              actorUid: 'system:billing-auto-lock',
              actorEmail: null,
              action: 'lockdown.lock',
              target: `orgs/${org.id}`,
              before: { locked: false },
              after: { locked: true, reason: 'billing', automated: true },
              at: FieldValue.serverTimestamp(),
            })
            alerted.push({ orgId: org.id, quota: 'billing-auto-lock', threshold: 100 })
          }
        } catch (error) {
          // One org's failure must not stop the sweep.
          console.error('[usage-alerts] billing auto-lock failed', org.id, error)
        }
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

/**
 * Cron routes run long: this one sweeps every org (AGL-1141).
 *
 * Vercel Hobby defaults a function to 10s, and nothing here set a duration —
 * so `report-usage` 504d with FUNCTION_INVOCATION_TIMEOUT at 10.2s on
 * 2026-07-31 having succeeded the day before. A pass sitting right on the
 * boundary fails intermittently, which reads as flaky rather than as a limit.
 */
export const maxDuration = 60
