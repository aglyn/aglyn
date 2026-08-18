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

/**
 * Are the Firestore backups actually restorable? (AGL-1490, AGL-1502)
 *
 * The weekly backup schedule ran perfectly while producing a backup that was
 * `NOT_AVAILABLE` — unusable — and nothing noticed for eleven days, because
 * backup state lives behind a gcloud command nobody runs on a schedule. This
 * turns that command into the same 200/503 health contract as `/api/health`,
 * so the uptime probe + alert path that already watches serving also watches
 * the thing we would need on the worst day.
 *
 * Degraded (503) when any backup is in a failed state, when no READY backup
 * exists, or when the newest READY backup is older than `MAX_BACKUP_AGE_DAYS`
 * — a weekly cadence that stops producing is as broken as one that fails.
 * The verdict logic is `backupsHealth` in the shared health lib, where it is
 * spec-covered branch by branch.
 *
 * Same three rules as the sibling health endpoints — never cached, checks the
 * real thing, cost-bounded. Each probe is one metadata-only REST call (backup
 * ids and sizes, zero documents) memoised per instance; backups change weekly,
 * so the longer TTL loses nothing. The body carries state COUNTS and an age —
 * never backup ids or resource paths, because this is public. Since AGL-1843
 * the endpoint carries a second, separately-labeled check for the independent
 * GCS exports — see `exportsProbe` below.
 *
 * The service account authenticates exactly as the rest of the console does;
 * listing backups additionally requires `roles/datastore.backupsViewer`
 * (granted 2026-08-13 — `datastore.backups.get/list`, nothing else).
 */
import { getApp } from 'firebase-admin/app'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling health route.
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  backupsHealth,
  exportsHealth,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  type BackupsCheck,
  type ExportsCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Backups change weekly; five minutes bounds the probe cost without letting a
 * failed Sunday run hide for longer than one monitor interval.
 */
const PROBE_TTL_MS = 5 * 60_000

const EMPTY_STATES: BackupsCheck['states'] = {}

const backupsProbe = memoizeWithTtl<BackupsCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  const fail = (code: string): BackupsCheck => ({
    ok: false,
    ms: Date.now() - startedAt,
    code,
    states: EMPTY_STATES,
    newestReadyAgeDays: null,
  })
  try {
    // Touch the facade so the import above can never be tree-shaken into
    // skipping app initialization.
    void firebaseAdmin
    const app = getApp()
    const projectId =
      app.options.projectId ?? process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']
    const credential = app.options.credential
    if (!projectId || !credential) return fail('no-credential')

    const token = await credential.getAccessToken()
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/locations/-/backups`,
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: 'no-store',
      },
    )
    // The status code, never the error body — this response is public and a
    // Google error message can carry project ids and resource paths.
    if (!response.ok) return fail(`http-${response.status}`)

    const body = (await response.json()) as {
      backups?: { state?: string; snapshotTime?: string }[]
    }
    return backupsHealth(body.backups ?? [], Date.now() - startedAt)
  } catch (error) {
    return fail(String((error as { code?: string })?.code ?? 'unknown'))
  }
})

/**
 * The independent GCS exports, watched as a SEPARATE check (AGL-1843).
 *
 * Managed backups have been flipping `READY` → `NOT_AVAILABLE` at ~day 7, so
 * a weekly `exportDocuments` cron (`/api/admin/firestore-export`) writes a
 * portable copy to a GCS bucket. This probe lists that bucket's completion
 * markers — `*.overall_export_metadata`, one per FINISHED export — so the
 * verdict knows the newest export's age and a managed-backup flip stops
 * meaning "one copy only". One metadata-only listing (name + timeCreated,
 * ~13 objects under the 90-day lifecycle), same memoisation, and the body
 * carries a count and an age — never the bucket name, because this is public.
 *
 * The listing needs `storage.objects.list` on the bucket; the service
 * account's project-level `roles/storage.admin` (pre-existing) covers it.
 */
const exportsProbe = memoizeWithTtl<ExportsCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  const fail = (code: string): ExportsCheck => ({
    ok: false,
    ms: Date.now() - startedAt,
    code,
    exportCount: null,
    newestExportAgeDays: null,
  })
  try {
    void firebaseAdmin
    const app = getApp()
    const projectId =
      app.options.projectId ?? process.env['NEXT_PUBLIC_FIREBASE_PROJECT_ID']
    const credential = app.options.credential
    if (!projectId || !credential) return fail('no-credential')
    const bucket =
      process.env['FIRESTORE_EXPORT_BUCKET'] ?? `${projectId}-firestore-exports`

    const token = await credential.getAccessToken()
    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o?` +
        'matchGlob=**.overall_export_metadata&fields=items(name,timeCreated)&maxResults=1000',
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        cache: 'no-store',
      },
    )
    // The status code, never the error body — same rule as the backups probe.
    if (!response.ok) return fail(`http-${response.status}`)

    const body = (await response.json()) as {
      items?: { timeCreated?: string }[]
    }
    return exportsHealth(body.items ?? [], Date.now() - startedAt)
  } catch (error) {
    return fail(String((error as { code?: string })?.code ?? 'unknown'))
  }
})

export async function GET(): Promise<Response> {
  const [backups, exports] = await Promise.all([backupsProbe(), exportsProbe()])
  const checks = { backups, exports }
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-backups',
      checks,
      commit: process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null,
      environment: process.env['VERCEL_ENV'] ?? 'development',
      region: process.env['VERCEL_REGION'] ?? null,
    }),
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/** Cheap liveness for monitors that only issue HEAD. Touches nothing. */
export async function HEAD(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: healthHeaders('ok'),
  })
}
