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
import { isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  authorizeMaintenanceActor,
  recordStaffMaintenanceRun,
} from '../../../../utils/server/maintenance-actor'
import {
  findMaintenanceJob,
  refuseStaffRun,
  type StaffRunRequest,
} from '../../../../utils/maintenance-jobs'
import { sendEmail } from '@aglyn/shared-util-email'
import { renderSystemEmail } from '../../_lib/render-system-email'
import { firebaseAdmin, meterPlatformEmail } from '@aglyn/tenant-data-admin'

/**
 * This job's console descriptor (AGL-1949) — the confirmation phrase and the
 * audit action, shared with the Staff → Maintenance page rather than
 * transcribed into it. Two copies of a safety rule is how `audit-archive`
 * shipped without the dry-run guard its two siblings each wrote by hand.
 */
const JOB = findMaintenanceJob('audit-archive') as ReturnType<
  typeof findMaintenanceJob
> &
  object

const RETENTION_DAYS = 90
const BATCH_SIZE = 500
const MAX_BATCHES_PER_RUN = 10
const ERASURE_HOLD_DAYS = 7

/**
 * Scheduled audit archival (AGL-214): invoke nightly from the scheduler
 * with `x-cron-secret` (same contract as report-usage/reminders). Entries
 * older than the 90-day retention window move out of Firestore into a
 * Storage compliance trail — JSON lines under
 * `adminAudit-archive/{yyyy-MM}/{runId}.jsonl`, partitioned by the month
 * the entry was written — and are then deleted. The CSV export button stays
 * the ad-hoc path for recent entries.
 *
 * The same run also handles erasure-hold reminders: orgs whose GDPR
 * erasure request passed the 7-day hold are emailed to staff
 * (STAFF_ALERT_EMAIL, env-gated) — the erase script stays the only
 * deletion path.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Audit archival is not configured (CRON_SECRET).' }, { status: 501 })
  }
  // Staff, or the scheduler (AGL-1949). This route was cron-secret-only, so
  // the console could not reach it at all and the only way to run or preview
  // an archival was a shell holding the production secret.
  const actor = await authorizeMaintenanceActor(headers)
  if (!actor) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY. Stamped on the invocation, not on the work, so a run that finds
  // nothing to do still proves the schedule is alive; the SCHEDULER's POST
  // only, because a human pressing the button in the console is not the cron
  // and must not make a job that stopped being scheduled read as alive.
  if (method === 'POST' && actor.kind === 'cron') {
    await recordCronBeat('audit-archive')
  }

  // A GET REPORTS; it never archives and never deletes (AGL-2084). This route
  // was one of the two irreversible scheduled routes that lacked the guard its
  // siblings chose deliberately — a bare GET on this URL wrote every audit row
  // older than 90 days into Storage and then DELETED it from Firestore. The
  // exposure was never remote (CRON_SECRET gates the whole route); it is every
  // way an intended READ turns into a GET — a pasted URL, a link-preview
  // fetcher, a prefetching browser, a re-run line in shell history.
  //
  // `scheduled-crons.yml` fires this route with a bodyless POST, which is
  // exactly why the shared helper keys the default on the METHOD and not on
  // the body being absent.
  const dryRun = isCronDryRun({ method, query, body })

  /*==========================================
   * A CONSOLE BUTTON IS WORSE THAN CURL UNLESS IT IS HARDER TO FIRE (AGL-1949).
   *
   * A real run here writes audit rows to Storage and then DELETES them from
   * Firestore. Putting that one click away would be strictly worse than the
   * curl it replaces, which at least required assembling an invocation. So a
   * staff-triggered real run needs a reason AND the exact typed phrase, both
   * enforced HERE rather than only in the page — a control that lives only in
   * the UI is not a control.
   *
   * The scheduler is untouched: it has no user, no reason and no phrase, and
   * gating it on any of those would silently stop nightly archival.
   *=========================================*/
  if (actor.kind === 'staff' && !dryRun) {
    const refusal = refuseStaffRun(JOB, (body ?? {}) as StaffRunRequest)
    if (refusal) return Response.json({ error: refusal }, { status: 400 })
  }

  try {
    const app = firebaseAdmin.app()
    const firestore = app.firestore()
    // Recorded BEFORE any row moves: this job audits nothing about itself,
    // and a run that dies halfway is exactly when "who asked for this" is
    // the question.
    if (actor.kind === 'staff' && !dryRun) {
      await recordStaffMaintenanceRun(
        firestore,
        JOB,
        actor,
        String((body as { reason?: unknown } | undefined)?.reason ?? ''),
      )
    }
    const bucket = app
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const runId = new Date().toISOString().replace(/[:.]/g, '-')

    let archived = 0
    let batches = 0
    // A dry run has to page with a cursor. The real run advances the window by
    // DELETING the batch it just archived, so a dry run reusing that loop
    // unchanged would re-read the same first 500 rows until it hit
    // MAX_BATCHES_PER_RUN and report a plan five thousand rows too big.
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
    while (batches < MAX_BATCHES_PER_RUN) {
      let pending: FirebaseFirestore.Query = firestore
        .collection('adminAudit')
        .where('at', '<', cutoff)
        .orderBy('at', 'asc')
      if (cursor) pending = pending.startAfter(cursor)
      const snapshot = await pending.limit(BATCH_SIZE).get()
      if (snapshot.empty) break
      batches += 1

      if (dryRun) {
        // Report what a real run WOULD move out of Firestore, and touch
        // nothing: no Storage object, no delete, and no staff email below.
        archived += snapshot.size
        cursor = snapshot.docs[snapshot.docs.length - 1] ?? null
        if (snapshot.size < BATCH_SIZE) break
        continue
      }

      // Partition lines by the month the entry was written.
      const byMonth: Record<string, string[]> = {}
      for (const doc of snapshot.docs) {
        const at = doc.get('at')?.toDate?.() ?? new Date(0)
        const month = at.toISOString().slice(0, 7)
        ;(byMonth[month] ??= []).push(
          JSON.stringify({
            $id: doc.id,
            ...doc.data(),
            at: at.toISOString(),
          }),
        )
      }
      for (const [month, lines] of Object.entries(byMonth)) {
        await bucket
          .file(`adminAudit-archive/${month}/${runId}-${batches}.jsonl`)
          .save(lines.join('\n') + '\n', {
            contentType: 'application/x-ndjson',
            resumable: false,
          })
      }

      // Only after the Storage write succeeds do the entries leave
      // Firestore — a crash between the two duplicates, never loses.
      const batch = firestore.batch()
      for (const doc of snapshot.docs) batch.delete(doc.ref)
      await batch.commit()
      archived += snapshot.size
      if (snapshot.size < BATCH_SIZE) break
    }

    // Erasure-hold reminders (AGL-214, optional automation): orgs whose
    // request has aged past the hold get flagged to staff once per run.
    const holdCutoff = new Date(
      Date.now() - ERASURE_HOLD_DAYS * 24 * 60 * 60 * 1000,
    )
    const dueSnapshot = await firestore
      .collection('orgs')
      .where('erasureRequestedAt', '<', holdCutoff)
      .limit(50)
      .get()
      .catch(() => null)
    const due = (dueSnapshot?.docs ?? []).map((doc) => ({
      orgId: doc.id,
      name: doc.get('name') ?? null,
      requestedAt: doc.get('erasureRequestedAt')?.toDate?.() ?? null,
    }))
    const staffEmail = process.env.STAFF_ALERT_EMAIL
    if (due.length && staffEmail && !dryRun) {
      const orgsList = due
        .map(
          (entry) =>
            `- ${entry.name ?? entry.orgId} (${entry.orgId}), ` +
            `requested ${entry.requestedAt?.toISOString() ?? '?'}`,
        )
        .join('\n')
      const fallbackText =
        'These organizations are past their GDPR erasure hold. Run ' +
        'tools/scripts/erase-tenant.mjs to hard-delete. No copy is kept:\n\n' +
        orgsList
      // One send per run, so resolving the staff-designed template here is a
      // single Firestore read (AGL-768); null keeps the built-in copy.
      const designed = await renderSystemEmail('erasure-hold-alert', {
        count: String(due.length),
        'orgs.list': orgsList,
      })
      await sendEmail({
        to: staffEmail,
        subject:
          designed?.subject ??
          `${due.length} erasure request(s) past the 7-day hold`,
        text: designed?.text || fallbackText,
        ...(designed?.html ? { html: designed.html } : {}),
        context: 'erasure-hold staff alert',
      })
      // Cost meter (AGL-1438). Platform-scoped: Aglyn's own staff alert, not
      // any customer's mail, so it stays out of every org rollup while still
      // being counted.
      await meterPlatformEmail()
    }

    return Response.json({
      dryRun,
      // On a dry run this is the PLAN, not a result: the number of rows a real
      // run would move into Storage and then delete.
      archived,
      batches,
      retentionDays: RETENTION_DAYS,
      erasureDue: due.map((entry) => entry.orgId),
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Audit archival failed' }, { status: 500 })
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
