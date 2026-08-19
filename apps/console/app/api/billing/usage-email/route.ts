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

import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import {
  brandMergeTokens,
  pluginRequestFromWeb,
  resolveBrandingProfile,
} from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import {
  loadSystemEmail,
  renderLoadedSystemEmail,
} from '../../_lib/render-system-email'
import {
  findUserByUidAcrossPools,
  firebaseAdmin,
  meterOrgEmail,
} from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller.

/** Previous calendar month as YYYY-MM (the default summary target). */

function previousMonth(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

function formatUsd(costUsd: number) {
  return `$${costUsd.toFixed(2)}`
}

/**
 * Monthly usage email summary (AGL-98, item 3). Invoke from the same
 * scheduler as `report-usage` (after it, so rollups exist) with
 * `x-cron-secret`. Env-gated on the email provider: without
 * `RESEND_API_KEY` + `USAGE_EMAIL_FROM` the route answers 501 and sends
 * nothing. Per plan-gated tenant with a rollup for the month it emails the
 * account address one summary (storage, page views, form submissions,
 * metered estimate) and stamps `emailedAt` on the rollup so re-runs are
 * idempotent.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Usage email is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  if (!isEmailConfigured()) {
    return Response.json({
      error:
        'Usage email is not configured (RESEND_API_KEY, USAGE_EMAIL_FROM).',
    }, { status: 501 })
  }
  const month = /^\d{4}-\d{2}$/.test(String(body?.month ?? ''))
    ? String(body.month)
    : previousMonth()

  try {
    const firestore = firebaseAdmin.app().firestore()
    const auth = firebaseAdmin.app().auth()
    // Org usage rollups (AGL-238): orgs/{orgId}/usage/{month}, emailed to
    // the org owner's account address.
    const orgsSnapshot = await firestore.collection('orgs').limit(1000).get()

    // Resolve the staff-designed template ONCE for the whole batch (AGL-768),
    // not once per recipient; null keeps every org's built-in summary copy.
    const template = await loadSystemEmail('usage-summary')

    const results: Record<string, any> = {}
    for (const orgDoc of orgsSnapshot.docs) {
      const orgId = orgDoc.id
      const rollup = await orgDoc.ref.collection('usage').doc(month).get()
      if (!rollup.exists) continue
      if (rollup.get('emailedAt')) {
        results[orgId] = { skipped: 'already emailed' }
        continue
      }
      // Dark-launch rule: only orgs with an explicit plan get billing
      // email; everyone else isn't metered in any user-visible way yet.
      const plan = orgDoc.get('plan')
      if (!plan) {
        results[orgId] = { skipped: 'no plan' }
        continue
      }
      const ownerUid = String(orgDoc.get('ownerUid') ?? '')
      // Across pools (AGL-1122): an SSO owner lives in their org's GCIP
      // tenant, which project-level `getUser` cannot see — it throws
      // `auth/user-not-found`, the catch below swallowed it, and the org was
      // recorded as `skipped: 'no email'`. Measured 2026-08-01: aglyn-org is
      // on the `enterprise` plan and its owner is exactly such a user, so the
      // one org most likely to want a usage summary was the one silently not
      // getting one.
      const email = ownerUid
        ? await findUserByUidAcrossPools(ownerUid)
            .then((found) => found?.record.email)
            .catch(() => undefined)
        : undefined
      if (!email) {
        results[orgId] = { skipped: 'no email' }
        continue
      }

      const storageGb = Number(rollup.get('storageGb') ?? 0)
      const pageViews = Number(rollup.get('pageViews') ?? 0)
      const formSubmissions = Number(rollup.get('formSubmissions') ?? 0)
      const dataStorageMb = Number(rollup.get('dataStorageMb') ?? 0)
      const dataOverageUsd = Number(rollup.get('dataOverageUsd') ?? 0)
      // `billedCents` is the whole metered bill — infra overage at cost × 1.3
      // PLUS the dataset/API/contact overages. It replaced `costUsd +
      // dataOverageUsd`, which was wrong twice over (AGL-1280): `costUsd` is
      // our raw cost with no markup and, until now, no included band
      // subtracted, so this line quoted a number matching nothing.
      const billedUsd = Number(rollup.get('billedCents') ?? 0) / 100
      // The metric block, reused as the built-in body and as the
      // {{usage.summary}} token a staff-designed template drops in.
      const usageSummary = [
        `Plan: ${plan}`,
        `Storage: ${storageGb.toFixed(2)} GB`,
        `Page views: ${pageViews}`,
        `Form submissions: ${formSubmissions}`,
        `Dataset storage: ${(dataStorageMb / 1024).toFixed(2)} GB` +
          (dataOverageUsd > 0
            ? ` (overage ${formatUsd(dataOverageUsd)})`
            : ''),
        `Metered usage estimate: ${formatUsd(billedUsd)}`,
        '',
        'Full meters and plan limits: your console → Manage → Billing.',
      ].join('\n')
      // White-label brand (White-Label Phase 1): a white-label org's usage
      // mail reads as their brand — from-name, product name, support footer —
      // resolved through the one shared resolver so it can't drift from the
      // site/console. Non-white-label orgs get the Aglyn defaults unchanged.
      const branding = resolveBrandingProfile(
        orgDoc.data() as Partial<AglynOrgBilling>,
      )
      const fallbackText =
        `Here is your ${branding.productName} usage summary for ${month}.\n\n` +
        `${usageSummary}\n\nNeed help? ${branding.supportUrl}`
      const orgName = orgDoc.get('name') ?? 'your organization'
      // Render the batch-resolved template for this org's values (AGL-768);
      // null falls back to the built-in copy above.
      const designed = template
        ? renderLoadedSystemEmail(
            template,
            {
              // AGL-2139. The template is loaded ONCE for the batch and
              // rendered per org, so the brand has to ride the per-recipient
              // merge map — a batch-level brand would send every org the
              // first one's.
              ...brandMergeTokens(branding),
              month,
              'org.name': String(orgName),
              'usage.summary': usageSummary,
            },
            { brandLogoUrl: branding.emailLogoUrl },
          )
        : null
      const result = await sendEmail({
        to: email,
        subject:
          designed?.subject ??
          `Your ${branding.productName} usage summary for ${month}`,
        text: designed?.text || fallbackText,
        ...(designed?.html ? { html: designed.html } : {}),
        // White-label the sender display name off the org's brand profile
        // (keeps the verified address; White-Label Phase 1).
        fromName: branding.fromName,
        context: `usage summary (${orgId})`,
      })
      // Cost meter (AGL-1438). Org-scoped and transactional: the org's own
      // billing summary, sent to no site.
      if (result.sent) await meterOrgEmail(orgId)
      if (!result.sent) {
        results[orgId] = { sent: false }
        continue
      }
      await rollup.ref.set(
        { emailedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      )
      results[orgId] = { sent: true }
    }
    return Response.json({ month, orgs: results }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Usage email failed' }, { status: 500 })
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
