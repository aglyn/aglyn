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
import { getApp } from 'firebase-admin/app'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, same as the health/backups route.
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Scheduled Firestore GCS export (AGL-1843): invoke weekly from the scheduler
 * with `x-cron-secret` (same contract as audit-archive and friends).
 *
 * This exists because the Google-managed backups proved unreliable: every
 * backup this project took flipped `READY` → `NOT_AVAILABLE` at roughly one
 * week old (AGL-1843), collapsing the nominal 14-week retention into "the
 * single newest backup". An `exportDocuments` run writes a portable snapshot
 * to `gs://<project>-firestore-exports/<timestamp>` — a copy whose lifetime
 * WE control (90-day bucket lifecycle), restorable via import into any
 * database (docs/DISASTER_RECOVERY.md, Procedure D).
 *
 * The route only STARTS the export — `exportDocuments` is a long-running
 * operation (measured 2026-08-17: 1m42s for 2,166 documents / 4.3 MiB) and
 * waiting here would burn function seconds against a Vercel duration cap for
 * nothing. Completion is watched where it belongs: `/api/health/backups`
 * lists the bucket's completion markers and goes degraded when the newest
 * export is missing or stale, so a run that starts and never finishes still
 * pages someone.
 *
 * Cost per run at today's size: one read per exported document (thousands of
 * reads ≈ cents) plus ~4 MiB of GCS storage — noise against the $20/month
 * budget. IAM (granted 2026-08-17): the service account holds
 * `roles/datastore.importExportAdmin`; the Firestore service agent holds
 * `roles/storage.admin` on the bucket, which is where the objects are
 * actually written from.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return Response.json(
      { error: 'Firestore export is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    void firebaseAdmin
    const app = getApp()
    const projectId =
      app.options.projectId ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    const credential = app.options.credential
    if (!projectId || !credential) {
      return Response.json(
        { error: 'Firestore export is not configured (credentials).' },
        { status: 501 },
      )
    }
    const bucket =
      process.env.FIRESTORE_EXPORT_BUCKET ?? `${projectId}-firestore-exports`
    // Timestamped prefix, colon/dot-free so it stays a clean object path.
    // The export writes its `*.overall_export_metadata` completion marker
    // under this prefix, which is exactly what the health probe lists.
    const outputUriPrefix = `gs://${bucket}/${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}`

    const token = await credential.getAccessToken()
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outputUriPrefix }),
        cache: 'no-store',
      },
    )
    if (!response.ok) {
      // The status code, never Google's error body — it can carry project
      // ids and resource paths, and the workflow log keeps this response.
      console.error(
        `firestore-export: exportDocuments returned ${response.status}`,
      )
      return Response.json(
        { error: `Export request failed (http-${response.status})` },
        { status: 502 },
      )
    }
    const operation = (await response.json()) as { name?: string }
    return Response.json(
      {
        started: true,
        outputUriPrefix,
        operation: operation.name ?? null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Firestore export failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }

/**
 * Kickoff only — the export itself runs server-side at Google. 30s covers
 * token minting plus one REST round-trip with margin.
 */
export const maxDuration = 30
