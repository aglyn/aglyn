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
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import { resolveBrandingProfile } from '@aglyn/aglyn/server'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import {
  ERASURE_HOLD_MS,
  eraseOrg,
  findUserByUidAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
  meterPlatformEmail,
} from '@aglyn/tenant-data-admin'

/**
 * Executes due GDPR erasures (AGL-487) — completes the self-serve deletion
 * loop so no manual staff step is required. Scheduler-invoked with the
 * shared `x-cron-secret`, like report-usage / usage-alerts / audit-archive.
 *
 * Finds orgs whose `erasureRequestedAt` is past the 7-day hold and erases
 * each via `eraseOrg` (which re-verifies the hold and, since AGL-1443, writes
 * no copy of the workspace anywhere before deleting it — the proof is an
 * `adminAudit` row of ids and counts). Batched small — irreversible work, so a
 * bounded number per run and eraseOrg is safe to re-run on the rest.
 */
const MAX_PER_RUN = 5

/**
 * How many pending erasures the GET preview lists. Higher than
 * `MAX_PER_RUN` on purpose: the point of the preview is to show what is
 * WAITING, including the ones this run will not reach.
 */
const MAX_PENDING_LISTED = 50

/**
 * Staff, or the scheduler (AGL-2165).
 *
 * This route was cron-secret-only, and the console had no way to reach it:
 * `staff-org-actions.component.tsx` documents it as the operator's escape
 * hatch while itself only calling `erasure-request`, which QUEUES an erasure.
 * So a staff member could ask for a workspace to be erased and then had no way
 * to run it, see what was pending, or find out why one had not gone through —
 * short of hand-dispatching a GitHub workflow, or `tools/scripts/erase-tenant.mjs`,
 * neither of which is the console.
 *
 * A staff ID token is accepted alongside the cron secret rather than instead of
 * it: the scheduler has no user and must keep working. Returns the actor for
 * the audit row, or null when neither credential checks out.
 */
async function authorizeActor(
  headers: Partial<Record<string, string>>,
): Promise<{ uid: string; kind: 'cron' | 'staff' } | null> {
  if (isCronAuthorized(headers)) return { uid: 'system:cron', kind: 'cron' }
  const authorization = headers.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) return null
  try {
    const decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(authorization.slice('Bearer '.length))
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return null
    if (!decoded['staff']) return null
    return { uid: decoded.uid, kind: 'staff' }
  } catch {
    return null
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Erasure runner is not configured (CRON_SECRET).' }, { status: 501 })
  }
  const actor = await authorizeActor(headers)
  if (!actor) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()

    // GET is READ-ONLY (AGL-2165). It used to be an alias for POST, so a bare
    // GET on this URL permanently erased up to five workspaces. Nothing ever
    // called it that way — `scheduled-crons.yml` POSTs every route it fires,
    // and the manual dispatch goes through the same step — so the alias was
    // pure hazard: an irreversible delete behind the one verb everything on
    // the web treats as safe to retry, prefetch and follow.
    //
    // It is now the preview the console reads: what is due, what is still
    // holding, and when each hold expires.
    if (method === 'GET') {
      const now = Date.now()
      // `orderBy` rather than `where('erasureRequestedAt', '!=', null)`:
      // both filter to documents that HAVE the field, but orderBy rides the
      // automatic single-field index every Firestore collection already has,
      // while the inequality wants a composite one that is not deployed —
      // and a missing index fails this query at runtime, in production only,
      // which is the one place this surface has to work.
      // Oldest first, which is also the order the runner takes them in.
      const pending = await firestore
        .collection('orgs')
        .orderBy('erasureRequestedAt', 'asc')
        .limit(MAX_PENDING_LISTED)
        .get()
      const rows = pending.docs
        .map((org) => {
          const requestedAt = org.get('erasureRequestedAt')
          const requestedMs =
            typeof requestedAt?.toMillis === 'function'
              ? requestedAt.toMillis()
              : Number(requestedAt ?? 0)
          return {
            orgId: org.id,
            name: String(org.get('name') ?? ''),
            slug: String(org.get('slug') ?? ''),
            requestedAtMs: requestedMs || null,
            // The whole question a staff member has: is this one waiting on
            // the hold, or waiting on us?
            holdExpiresAtMs: requestedMs ? requestedMs + ERASURE_HOLD_MS : null,
            due: Boolean(requestedMs) && requestedMs + ERASURE_HOLD_MS <= now,
          }
        })
      return Response.json(
        {
          pending: rows,
          dueCount: rows.filter((row) => row.due).length,
          maxPerRun: MAX_PER_RUN,
          // A lower bound, and said so: the query is capped, so a longer
          // queue reads identically to a complete one from the length alone.
          truncated: pending.size >= MAX_PENDING_LISTED,
        },
        { status: 200 },
      )
    }

    // A staff-triggered run is recorded with its actor and reason BEFORE it
    // runs anything: `eraseOrg` audits each erasure, but nothing said who
    // asked for the batch or why they did not wait for 04:00 UTC.
    if (actor.kind === 'staff') {
      const reason = String(body?.reason ?? '').trim().slice(0, 500)
      if (reason.length < 8) {
        return Response.json(
          {
            error:
              'Running erasures early needs a reason of at least 8 ' +
              'characters — this permanently deletes workspaces.',
          },
          { status: 400 },
        )
      }
      await firestore
        .collection('adminAudit')
        .add({
          actorUid: actor.uid,
          action: 'erasure.runBatch',
          target: 'orgs/*',
          reason,
          before: null,
          after: { maxPerRun: MAX_PER_RUN },
          at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }
    const holdCutoff = new Date(Date.now() - ERASURE_HOLD_MS)
    const due = await firestore
      .collection('orgs')
      .where('erasureRequestedAt', '<', holdCutoff)
      .limit(MAX_PER_RUN)
      .get()

    const auth = firebaseAdmin.app().auth()
    const emailConfigured = isEmailConfigured()
    const erased: string[] = []
    const skipped: Array<{ orgId: string; reason?: string }> = []
    for (const org of due.docs) {
      // Capture before erasing — eraseOrg deletes the org document, but the
      // owner's auth account survives it, so the address stays reachable.
      const orgName = org.get('name') ?? 'your organization'
      // White-label brand (White-Label Phase 3): resolved BEFORE eraseOrg
      // deletes the doc, so the completion notice still reads as the org's
      // brand. One shared resolver, same as every other surface.
      const branding = resolveBrandingProfile(
        org.data() as Partial<AglynOrgBilling>,
      )
      const ownerUid = String(org.get('ownerUid') ?? '')
      // Across pools (AGL-1122) — an SSO owner is invisible to project-level
      // `getUser`, so the "your workspace has been erased" notice never went
      // out for exactly the orgs on the plan that has SSO.
      const ownerEmail =
        emailConfigured && ownerUid
          ? await findUserByUidAcrossPools(ownerUid)
              .then((found) => found?.record.email)
              .catch(() => undefined)
          : undefined

      // Per-org, NOT per-run (AGL-1455). The whole loop sat inside the outer
      // `try`, so a throw from `eraseOrg` — and every step after its export
      // write can throw — abandoned every org left in the batch and answered
      // 500. Since `erasureRequestedAt` survives a failure, the same org led
      // the next run and starved them again: one broken erasure indefinitely
      // blocking everyone else's. `eraseOrg` has already written the durable
      // `org.erase-failed` audit row by the time this catches.
      const result = await eraseOrg(org.id).catch((error) => {
        console.error(`run-erasures: erasure failed for ${org.id}`, error)
        return { ok: false, skippedReason: 'erase-failed' }
      })
      if (!result.ok) {
        skipped.push({ orgId: org.id, reason: result.skippedReason })
        continue
      }
      erased.push(org.id)

      // Confirm completion to the owner (AGL-768). Best-effort and wrapped so
      // a send problem never affects the erasure result.
      if (ownerEmail) {
        try {
          const fallbackText =
            `${orgName} and all of its data have been permanently erased ` +
            `from ${branding.productName}, as requested. This is complete and ` +
            'cannot be undone.'
          const designed = await renderSystemEmail('erasure-confirmation', {
            'org.name': String(orgName),
          })
          await sendEmail({
            to: ownerEmail,
            subject: designed?.subject ?? 'Your Aglyn data has been erased',
            text: designed?.text || fallbackText,
            ...(designed?.html ? { html: designed.html } : {}),
            fromName: branding.fromName,
            context: 'erasure-confirmation',
          })
          // Cost meter (AGL-1438). Platform-scoped DELIBERATELY, even though
          // an org id is right here: the org has just been hard-erased, and a
          // counter written under `orgs/{id}` would resurrect a document
          // inside the thing this route exists to delete.
          await meterPlatformEmail()
        } catch (confirmError) {
          console.error('erasure-confirmation email skipped', confirmError)
        }
      }
    }

    return Response.json({ erased, skipped, scanned: due.size }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Erasure run failed' }, { status: 500 })
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
