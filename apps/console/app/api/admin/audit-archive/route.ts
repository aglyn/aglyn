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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

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
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json({ error: 'Audit archival is not configured (CRON_SECRET).' }, { status: 501 })
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const app = firebaseAdmin.app()
    const firestore = app.firestore()
    const bucket = app
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const runId = new Date().toISOString().replace(/[:.]/g, '-')

    let archived = 0
    let batches = 0
    while (batches < MAX_BATCHES_PER_RUN) {
      const snapshot = await firestore
        .collection('adminAudit')
        .where('at', '<', cutoff)
        .orderBy('at', 'asc')
        .limit(BATCH_SIZE)
        .get()
      if (snapshot.empty) break
      batches += 1

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
    const resendKey = process.env.RESEND_API_KEY
    const emailFrom = process.env.USAGE_EMAIL_FROM
    const staffEmail = process.env.STAFF_ALERT_EMAIL
    if (due.length && resendKey && emailFrom && staffEmail) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [staffEmail],
          subject: `${due.length} erasure request(s) past the 7-day hold`,
          text:
            'These organizations are past their GDPR erasure hold. Run ' +
            'tools/scripts/erase-tenant.mjs to export and hard-delete:\n\n' +
            due
              .map(
                (entry) =>
                  `- ${entry.name ?? entry.orgId} (${entry.orgId}), ` +
                  `requested ${entry.requestedAt?.toISOString() ?? '?'}`,
              )
              .join('\n'),
        }),
      }).catch(() => undefined)
    }

    return Response.json({
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
