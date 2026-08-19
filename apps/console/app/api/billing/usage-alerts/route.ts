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
import {
  bandwidthCapMonthKey,
  bandwidthCapShouldEngage,
  type OrgBandwidthCap,
  planMetersInfraOverage,
  resolveOrgEntitlements,
  UNLIMITED,
} from '@aglyn/aglyn/server'
import {
  bandwidthGbFromPageViews,
  pageViewsFromBandwidthGb,
} from '../../../../utils/usage-metering'
import {
  usageAlertApproachPct,
  usageAlertThreshold,
} from '../../../../utils/storage-overage'
import {
  measureScreenCaps,
  screenCapMaxBillable,
} from '../../../../utils/screen-cap-reconciliation'
import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  notifyOrgAdmins,
  notifyStaff,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  billingAutoLockEnabled,
  shouldAutoLockOrgForBilling,
} from '../../../../utils/billing-auto-lock'
import { applyOrgLockdown } from '../../../../utils/server/org-lockdown'
import {
  assistCogsAlertThresholdUsd,
  assistMarginBreach,
  assistMarginMultiple,
  budgetAlertDue,
  BUDGET_GUARD_KEY,
  orgMonthlySpend,
  resolveUsageBudget,
} from '../../../../utils/usage-budget'
import { consoleOrigin, emailOrgAdmins } from '../../_lib/usage-alert-email'

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller — and it HOSTS
// the billing auto-lock sweep; gating the locker on the lock is circular.

/**
 * Usage-threshold notifications (AGL-276, wave v5): the in-console
 * quota banner only helps people who are looking — this cron pushes a
 * `billing.usage` notification to org admins when a quota crosses the
 * approach threshold (80% by default, `USAGE_ALERT_APPROACH_PCT`) or 100%
 * — see `utils/storage-overage.ts` for why those two numbers and not
 * others. One alert per quota per threshold per month, guarded by
 * `orgs/{orgId}.usageAlerts`. Covers sites, media storage, monthly email
 * sends, dataset count + storage, workflow/automation runs, and — added
 * AGL-1106 — monthly bandwidth, which is the included band the invoice meters
 * page views against, so the alert is a real pre-invoice heads-up. The
 * published-site-size check AGL-1107 added was removed in AGL-1370 as
 * unreachable. Scheduler-invoked (x-cron-secret, like report-usage).
 *
 * AGL-1886 added `orgLibraryStorage`, the check that closes the last
 * structurally-silent case before org-library bytes start reaching invoices:
 * the org library is enforced against `storagePerHostMb` on its own but was
 * only ever compared to the ORG-WIDE band, which it cannot fill. See the
 * check itself.
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
    // ONE month boundary for the whole sweep, and the SAME function the
    // bandwidth cap is stamped and read with (AGL-2155). Frozen here rather
    // than recomputed per org so a run straddling midnight UTC on the 1st
    // cannot engage a cap for one month while deduping its alert guards
    // against another — the same discipline `approachPct` below is read once
    // for.
    const month = bandwidthCapMonthKey()
    const orgs = await firestore.collection('orgs').limit(500).get()
    const alerted: Array<Record<string, unknown>> = []
    /** Orgs whose free-plan bandwidth cap engaged on THIS run (AGL-2155). */
    const capped: Array<Record<string, unknown>> = []

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
      const orgLibraryBytes = Math.max(
        0,
        Number(orgMediaCounter.get('bytes') ?? 0) || 0,
      )
      mediaBytes += orgLibraryBytes

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

      // Does THIS org's plan bill storage past the band, rather than refusing
      // it? Read once, and only used to choose the alert's wording — the
      // thresholds themselves are identical either way.
      const metersInfra = planMetersInfraOverage(orgData as never)

      const checks: Array<{
        key: string
        label: string
        used: number
        limit: number
        /**
         * TRUE when crossing this band produces an INVOICE LINE rather than a
         * refusal (2026-08-18). The alert has to say which, because the two
         * call for opposite actions: "upgrade to raise the limit" is right
         * when the product is about to stop working and actively misleading
         * when the product will keep working and bill.
         */
        billsOverage?: boolean
      }> = [
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
          billsOverage: metersInfra,
        },
        {
          // THE ORG LIBRARY ON ITS OWN (AGL-1886), and this is the blind spot,
          // not a duplicate of the line above.
          //
          // AGL-1473 got the org library's bytes INTO the org-wide sum, which
          // is why `mediaStorage` is no longer blind to them. It is still
          // structurally unable to WARN about them, because the two numbers
          // are measured against different allowances: uploads are enforced
          // PER SCOPE against `storagePerHostMb` (`api/media/upload-url` reads
          // the very counter it increments), while the check above compares a
          // summed total against `hostLimit × storagePerHostMb`. On a Pro org
          // — three sites, 10 GB each — an org library sitting at its full
          // 10 GB is AT the cap that refuses the next upload and reads as 33%
          // of the org-wide band. It can never reach 80%, so the alert cannot
          // fire, on the one surface whose whole job is telling somebody
          // before a limit bites. An alert that cannot fire reads as coverage.
          //
          // Its own key, so it thresholds and dedupes independently: an org
          // over its org-library allowance and comfortably inside its
          // org-wide one must get this warning and only this one.
          key: 'orgLibraryStorage',
          label: 'organization library storage',
          used: orgLibraryBytes / (1024 * 1024),
          limit: entitlements.storagePerHostMb,
          billsOverage: metersInfra,
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
          //
          // ⚠️ THIS FIELD WAS MISSING UNTIL AGL-2070, and its absence was a
          // lie in both directions. A falsy `billsOverage` selects the "the
          // product stops at the band" copy below — so a free customer was
          // told they had been cut off while their site kept serving every
          // page, and a PAID customer, whose bandwidth overage does bill, was
          // told to "upgrade to raise the limit" as though they were stuck.
          //
          // Both halves are now true, and the second half is why the copy
          // could not simply be softened: the cap added in this same commit
          // (AGL-2155) makes free genuinely stop at the band, so the wall
          // wording is the correct wording for the plan that gets it.
          // `metersInfra` is the same predicate the cap keys off, which is
          // what keeps the sentence and the behaviour from drifting apart
          // again.
          key: 'bandwidth',
          label: 'monthly bandwidth',
          used: bandwidthGb,
          limit: entitlements.bandwidthGb,
          billsOverage: metersInfra,
        },
        // No `siteSize` check (AGL-1370). It was added in AGL-1107 and could
        // never fire: `measure-node-map.ts` refuses any node map over 900 KB
        // (AGL-678) and the rollup sweep is bounded per host, so the measured
        // total tops out at 2.3–20.9% of `totalSiteSizeMb` depending on plan —
        // never the 80% this loop alerts at. The measurement itself stays on
        // the rollup as an internal signal; the dead alert does not.
      ]

      // Frozen once per org, and used by BOTH channels. Billing is org-scoped
      // now (AGL-621/644); links are frozen at write time, so emit canonical
      // and let the reader repair the legacy ones.
      const billingLink = (org.get('slug') as string | undefined)
        ? buildRoute(Route.MANAGE_BILLING, {
            orgSlug: org.get('slug') as string,
          })
        : '/org/billing'

      const guards =
        (orgData['usageAlerts'] as Record<
          string,
          { month?: string; threshold?: number }
        >) ?? {}
      const guardUpdates: Record<string, { month: string; threshold: number }> =
        {}
      // Config-driven since AGL-1886, and shared with the specs that pin the
      // percentages. Read once per org rather than once per check so a single
      // sweep cannot use two different approach thresholds.
      const approachPct = usageAlertApproachPct(
        process.env.USAGE_ALERT_APPROACH_PCT,
      )
      for (const check of checks) {
        if (check.limit === UNLIMITED || !(check.limit > 0)) continue
        const threshold = usageAlertThreshold(
          check.used,
          check.limit,
          approachPct,
        )
        if (!threshold) continue
        const guard = guards[check.key]
        if (guard?.month === month && (guard.threshold ?? 0) >= threshold) {
          continue
        }
        guardUpdates[check.key] = { month, threshold }
        // THE ALERT IS THE PROTECTION (2026-08-18). Zach's condition on
        // billing storage was "so customers don't get a surprise bill" — and
        // once overage bills by default rather than being refused, this
        // notification is the entire thing standing between a customer and a
        // number they did not expect. So it must describe what actually
        // happens at the band:
        //
        //   billsOverage -> the product keeps working and starts charging;
        //                   the action is "cap it or upgrade", never "upgrade
        //                   to raise the limit", which implies you are stuck.
        //   otherwise    -> the product stops at the band; upgrading is the
        //                   only way through, and always was.
        // ONE set of words for BOTH channels (AGL-2052). Hoisted rather than
        // written twice: an email that says something the console does not is
        // how a customer ends up arguing with support about which one meant
        // it.
        const alertTitle =
          threshold >= 100
            ? check.billsOverage
              ? `You're past your included ${check.label} — extra usage is now billed`
              : `You've reached your ${check.label} limit`
            : `You're above ${approachPct}% of your ${check.label} quota`
        const alertBody = check.billsOverage
          ? `${Math.round(check.used)} of ${check.limit} used. Past ` +
            `${check.limit}, extra ${check.label} is billed on your ` +
            'monthly invoice — upgrade in Billing for a bigger allowance, ' +
            'or set a monthly cap there if you would rather it stopped.'
          : `${Math.round(check.used)} of ${check.limit} used — upgrade ` +
            'in Billing to raise the limit.'
        await notifyOrgAdmins(org.id, {
          type: 'billing.usage',
          title: alertTitle,
          body: alertBody,
          orgId: org.id,
          // Billing is org-scoped now (AGL-621/644); links are frozen at write
          // time, so emit canonical and let the reader repair the legacy ones.
          link: billingLink,
        })
        // AND BY EMAIL (AGL-2052). This route's header claimed for months
        // that it "emails org admins"; it never did — `notifyOrgAdmins`
        // writes `users/{uid}/notifications` and nothing turns that into
        // mail. So the one pre-invoice warning on the platform reached only
        // people already signed in and looking at the bell, which is the
        // audience a push warning is not for. Sequenced AFTER the console
        // write and independently: mail is best-effort, and a Resend outage
        // must degrade to what this route did before, not to nothing.
        const emailed = await emailOrgAdmins({
          firestore,
          orgId: org.id,
          subject: alertTitle,
          text:
            `${alertBody}\n\nSee your usage and billing: ` +
            `${consoleOrigin()}${billingLink}`,
          context: 'usage-alert',
        })
        alerted.push({
          orgId: org.id,
          quota: check.key,
          threshold,
          emailed: emailed.sent,
        })
      }

      /*==========================================
       * USAGE BUDGETS (AGL-1528) — the GCP billing-budget half.
       *
       * Zach, 2026-08-18, verbatim: "our usage metering, usage alerts,
       * budgets for usage alerts, similar to how google cloud charges".
       *
       * Everything above answers "am I near a band". A budget answers "what
       * will I owe", which is a different question and the one a metered
       * customer actually has: an org at 60% of four bands may owe nothing,
       * and an org at 101% of one band may owe $40. No sum of percentages
       * produces dollars.
       *
       * NOTHING IS RE-DERIVED HERE. `report-usage` writes `billedCents` onto
       * `orgs/{id}/usage/{month}` daily — the invoice's own arithmetic — and
       * `rollup` two screens up is already that document, read for
       * `dataStorageMb`. A second aggregation is the exact mistake AGL-1371
       * exists about, and a budget alert quoting a figure the invoice will
       * not show is worse than no alert because it is believed.
       *
       * A budget REFUSES NOTHING. The customer's hard cap lives in
       * `utils/storage-overage.ts` and is a separate, opt-in control; the
       * failure mode AGL-1529 rejected on arrival was a spend ceiling that
       * takes a site down to save $2.
       *=========================================*/
      const assistUsageDoc = await org.ref
        .collection('assistUsage')
        .doc(month)
        .get()
      const spend = orgMonthlySpend({
        month,
        rollupBilledCents: rollup?.get('billedCents'),
        // COMPARED, not trusted. `rollup` is the LATEST usage document by
        // `computedAt`, which on the first days of a month is still LAST
        // month's — evaluating August's budget against July's spend would
        // fire every budget on the platform on the 1st.
        rollupMonth: rollup?.get('month'),
        assistEstCostUsd: assistUsageDoc.get('estCostUsd'),
        assistBilledFrom: process.env.BILL_ASSIST_TOKENS_FROM,
      })
      const budget = resolveUsageBudget(orgData)
      const budgetThreshold = budgetAlertDue({
        spendUsd: spend.totalUsd,
        budget,
        guard: guards[BUDGET_GUARD_KEY],
        month,
      })
      if (budgetThreshold) {
        guardUpdates[BUDGET_GUARD_KEY] = { month, threshold: budgetThreshold }
        const amount = budget.amountUsd ?? 0
        const title =
          budgetThreshold >= 100
            ? `You've reached your $${amount.toFixed(0)} monthly usage budget`
            : `You're at ${budgetThreshold}% of your $${amount.toFixed(
                0,
              )} monthly usage budget`
        // The split, because a figure with no breakdown invites the support
        // ticket asking what the figure was. Assist is named only when it
        // counts toward the total — quoting a cost the customer is not being
        // charged would be a surprise bill invented by a notification.
        const split = spend.assistBilled
          ? ` ($${spend.meteredUsd.toFixed(2)} metered usage, ` +
            `$${spend.assistUsd.toFixed(2)} Assist)`
          : ''
        const body =
          `About $${spend.totalUsd.toFixed(2)} of usage so far this month` +
          `${split}, against the $${amount.toFixed(0)} budget you set. ` +
          'A budget is a heads-up, not a limit — nothing stops and nothing ' +
          'is refused. Change or remove it any time in Billing.'
        await notifyOrgAdmins(org.id, {
          type: 'billing.usage',
          title,
          body,
          orgId: org.id,
          link: billingLink,
        })
        await emailOrgAdmins({
          firestore,
          orgId: org.id,
          subject: title,
          text: `${body}\n\nSee your usage and billing: ${consoleOrigin()}${billingLink}`,
          context: 'usage-budget',
        })
        alerted.push({
          orgId: org.id,
          quota: BUDGET_GUARD_KEY,
          threshold: budgetThreshold,
        })
      }

      /*==========================================
       * THE MARGIN GUARD — staff-facing, and the live half of "covers Assist
       * token spend alike".
       *
       * `assistEntitledMonthlyLimit` caps an entitled org at 1,000 MESSAGES a
       * month. A thousand long, cache-cold, Opus-class exchanges is a
       * three-figure Anthropic bill against a subscription that did not move,
       * and no dollar figure anywhere gates it. This is that dollar figure.
       *
       * STAFF, not the customer: the org is not being charged for Assist and
       * has done nothing wrong, so mailing them about our cost would be
       * alarming and meaningless. Its own guard key, so a staff alert and a
       * customer budget can never suppress one another.
       *=========================================*/
      const assistCogsThreshold = assistCogsAlertThresholdUsd(
        process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD,
      )
      if (
        assistMarginBreach({
          assistUsd: spend.assistUsd,
          thresholdUsd: assistCogsThreshold,
          guard: guards['assistCogs'],
          month,
        })
      ) {
        const multiple = assistMarginMultiple(
          spend.assistUsd,
          assistCogsThreshold,
        )
        guardUpdates['assistCogs'] = { month, threshold: multiple }
        await notifyStaff({
          type: 'billing.usage',
          title: `Assist token spend is $${spend.assistUsd.toFixed(2)} for one org this month`,
          body:
            `${org.get('slug') ?? org.id} has run about ` +
            `$${spend.assistUsd.toFixed(2)} of Aglyn Assist tokens in ` +
            `${month}, past the $${assistCogsThreshold.toFixed(0)} review ` +
            'threshold. Assist is a plan entitlement with no per-token ' +
            'price, so this is margin, not revenue.',
          orgId: org.id,
          link: '/admin/orgs',
        })
        alerted.push({
          orgId: org.id,
          quota: 'assistCogs',
          threshold: multiple,
        })
      }

      /*==========================================
       * THE FREE PLAN'S BANDWIDTH HARD CAP (AGL-1967/2155).
       *
       * ZACH, 2026-08-19, choosing to enforce now rather than at launch:
       * "before public signups arrive, so the cap is proven under real
       * traffic while the cohort is small and a mistake is cheap."
       *
       * THE DECISION IS MADE HERE because the numbers are already here. This
       * sweep has just summed the org's page views for the current month and
       * converted them to `bandwidthGb` against `entitlements.bandwidthGb` —
       * the identical comparison the `bandwidth` alert above thresholds on.
       * The serving path then reads the VERDICT off the org doc it already
       * loads, so the cap costs no read on any render. Re-deriving the figure
       * anywhere else would be the AGL-1371 mistake: a cap that engages on a
       * number the customer's own alert does not show.
       *
       * ONE WRITE, not two. This rides the `usageAlerts` set below rather than
       * issuing its own, so engaging a cap costs nothing beyond what the sweep
       * already spends on this org.
       *
       * NOTHING IS EVER CLEARED. The marker names its month; next month it
       * stops matching. An org that UPGRADES is released faster still and
       * without any write at all, because `bandwidthCapEngaged` re-reads the
       * plan — see that function for why the asymmetry is deliberate.
       *=========================================*/
      const existingCap = orgData['bandwidthCap'] as OrgBandwidthCap | undefined
      const orgUpdates: Record<string, unknown> = {}
      if (
        bandwidthCapShouldEngage({
          org: orgData as never,
          usedBandwidthGb: bandwidthGb,
          includedBandwidthGb: entitlements.bandwidthGb,
        }) &&
        existingCap?.month !== month
      ) {
        // Guarded on the month so a cap engages once and the following 30
        // days of sweeps write nothing. The diagnostics are recorded at
        // ENGAGE time on purpose: they answer "what tripped this" for a
        // customer asking, and re-stamping them daily would replace the
        // moment the site was paused with the moment it was last swept.
        orgUpdates['bandwidthCap'] = {
          month,
          engagedAt: Date.now(),
          pageViews: Math.round(pageViews),
          includedPageViews: Math.round(
            pageViewsFromBandwidthGb(entitlements.bandwidthGb),
          ),
        } satisfies OrgBandwidthCap
        capped.push({ orgId: org.id, month })
      }

      if (Object.keys(guardUpdates).length) {
        orgUpdates['usageAlerts'] = { ...guards, ...guardUpdates }
      }
      if (Object.keys(orgUpdates).length) {
        // NO CACHE FAN-OUT (deliberate). The tenant's org doc is cached for 60
        // seconds and the middleware's verdict memo for 30, so the cap engages
        // within about a minute of this write on its own. Busting
        // `tenant-data:{hostId}` from here would mean one revalidate call per
        // host of every capped org, from a cron that sweeps the whole
        // platform — cost, and a fan-out that can fail, bought against a
        // latency already dwarfed by this sweep's own daily period.
        await org.ref.set(orgUpdates, { merge: true })
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
    return Response.json(
      {
        alerted: alerted.length,
        details: alerted,
        // Reported separately from `alerted` (AGL-2155): engaging a cap takes
        // a customer's site off the air, which is a different event from
        // warning them, and a run that capped somebody must say so in its own
        // field rather than inside a count of notifications.
        capped: capped.length,
        cappedDetails: capped,
      },
      { status: 200 },
    )
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
