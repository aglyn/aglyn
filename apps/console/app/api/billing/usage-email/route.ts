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
import { recordCronBeat } from '../../../../utils/cron-beat'
import { selectCronChunk } from '../../../../utils/cron-chunk'
import { previousMonth } from '../../../../utils/billing-month'
import {
  isEmailConfigured,
  rateLimitedRetryAtMs,
  sendEmail,
} from '@aglyn/shared-util-email'
import { brandSupportLine } from '../../_lib/brand-support-line'
import {
  loadSystemEmail,
  renderLoadedSystemEmail,
} from '../../_lib/render-system-email'
import {
  findUserByUidAcrossPools,
  firebaseAdmin,
  meterOrgEmail,
} from '@aglyn/tenant-data-admin'
// From the LEAF, not the barrel (AGL-2407). Route- and cron-level specs mock
// `@aglyn/tenant-data-admin` wholesale — its graph reaches the admin SDK — and
// a `jest.mock` factory is a closed world, so a gate imported through the
// barrel is silently replaced by `undefined` or by whatever stub the factory
// lists. A suppression check that is not actually running is the exact defect
// this issue is about, one level up. Same reasoning as `email-events.ts`.
import { isEmailSuppressed } from '@aglyn/tenant-data-admin/server/email-suppression'

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller.

// `previousMonth` is shared (AGL-2219) — see `utils/billing-month.ts`.

function formatUsd(costUsd: number) {
  return `$${costUsd.toFixed(2)}`
}

/**
 * Orgs one invocation will mail, at most (AGL-2409).
 *
 * This route read `orgs` with `.limit(1000)` and then looped with `await
 * sendEmail` inside — one invocation, up to a thousand messages, as fast as
 * Resend accepts them, from a domain whose steady-state volume is a few
 * hundred a day. That burst is half of what AGL-2409 is about.
 *
 * The chunk is the *shape* fix and the platform send-rate governor is the
 * *rate* fix; they do different jobs and both are needed. The chunk makes the
 * sweep resumable, so a run that stops for any reason can be continued rather
 * than restarted; the governor decides how many messages an hour may carry,
 * and it is the thing an operator ramps.
 *
 * 100 rather than `CRON_CHUNK_SIZE` (10): each subject here is one rollup
 * read, one auth lookup and one send, where a `report-usage` subject is a
 * whole org rollup. Ten would make the sweep 100 HTTP round trips.
 */
export const USAGE_EMAIL_CHUNK_SIZE = 100

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
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY. Stamped on the invocation, not on the work, so a run that finds
  // nothing to do still proves the schedule is alive; POST only, because a
  // human's GET is not the scheduler and must not stand in for it.
  if (method === 'POST') await recordCronBeat('usage-email')
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

    // Resumable chunk (AGL-2409/AGL-1141). Ordered by id, so "everything
    // after the cursor" means the same thing across invocations.
    const byId = new Map(orgsSnapshot.docs.map((doc) => [doc.id, doc]))
    const chunk = selectCronChunk(
      orgsSnapshot.docs.map((doc) => doc.id),
      typeof body?.cursor === 'string' ? body.cursor : null,
      USAGE_EMAIL_CHUNK_SIZE,
    )

    // Resolve the staff-designed template ONCE for the whole batch (AGL-768),
    // not once per recipient; null keeps every org's built-in summary copy.
    const template = await loadSystemEmail('usage-summary')

    const results: Record<string, any> = {}
    /**
     * Set when the platform send-rate governor refuses (AGL-2409).
     *
     * The run then STOPS and reports `done: true`, deliberately not
     * `done: false` — the workflow's cursor loop would otherwise re-POST
     * immediately into a window that is still full, up to its 50-chunk limit,
     * and go red on a governor working exactly as intended. The retry is the
     * next hourly run instead, which is why the schedule for this route is
     * hourly across the first two days of the month rather than a single
     * monthly firing.
     *
     * Nothing is lost by stopping: `emailedAt` is the idempotence key, so the
     * next run re-walks from the start and mails only the orgs still missing
     * a stamp.
     */
    let rateLimited = 0
    for (const orgId of chunk.items) {
      const orgDoc = byId.get(orgId)
      if (!orgDoc) continue
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
      /*
       * The platform suppression list (AGL-2407). THIS is a reader for it.
       *
       * The monthly summary is the purest case the list exists for: a cron
       * that mails the same address on the same day every month, forever,
       * with nothing anywhere that ever noticed the address stopped
       * existing. Twelve deliveries a year at a dead mailbox is what teaches
       * a provider that `aglyn.com` does not read its bounces — and
       * `aglyn.com` carries the password resets and receipts on the same
       * key and the same From address.
       *
       * Not in `sendEmail`, deliberately: a password reset or an invite
       * answers something the human just did, and refusing one over a stale
       * bounce would lock a real customer out of their own account. See
       * `email-suppression.ts` for the full rule.
       */
      if (await isEmailSuppressed(email, firestore)) {
        results[orgId] = { skipped: 'suppressed' }
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
      // The support line is OMITTED, not defaulted, when the org has none
      // (AGL-2428). This mail goes to a white-label org's own customer and
      // reads as that org throughout; a "Need help?" pointing at Aglyn sends
      // them to a desk that cannot help them and names a vendor they were
      // never told about. No line at all reads as plain, which is correct.
      const fallbackText =
        `Here is your ${branding.productName} usage summary for ${month}.\n\n` +
        `${usageSummary}${brandSupportLine(branding)}`
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
        /*
         * BULK, not transactional (AGL-2409).
         *
         * This is the purest bulk send in the product: a cron that mails a
         * thousand addresses on the same morning every month and answers
         * nothing anybody just did. It is refusable BECAUSE this sweep is
         * resumable — `emailedAt` is only stamped after a successful send, so
         * a refused org is simply not stamped and the next run picks it up.
         *
         * Nothing else here may be `bulk`. A caller that cannot come back
         * would turn a refusal into a summary nobody ever receives.
         */
        priority: 'bulk',
      })
      // Cost meter (AGL-1438). Org-scoped and transactional: the org's own
      // billing summary, sent to no site.
      if (result.sent) await meterOrgEmail(orgId)
      if (!result.sent) {
        // The hourly ceiling refused this one, so it will refuse every one
        // after it in this window — the counter only goes up. Stop the run;
        // the rollup is unstamped, so the next hourly run mails it.
        const retryAtMs = rateLimitedRetryAtMs(result)
        if (retryAtMs !== null) {
          rateLimited += 1
          results[orgId] = { deferred: true, retryAtMs }
          break
        }
        results[orgId] = { sent: false }
        continue
      }
      await rollup.ref.set(
        { emailedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      )
      results[orgId] = { sent: true }
    }
    return Response.json(
      {
        month,
        orgs: results,
        // The sweep contract the workflow's loop reads (AGL-1141). A
        // rate-limited run reports `done: true` — see `rateLimited` above.
        done: rateLimited > 0 ? true : chunk.done,
        nextCursor: rateLimited > 0 ? null : chunk.nextCursor,
        total: chunk.total,
        ...(rateLimited > 0 ? { deferred: rateLimited } : {}),
      },
      { status: 200 },
    )
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
