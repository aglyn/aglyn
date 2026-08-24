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
 * Degraded (503) when there is no recent restore point: no READY backup and
 * nothing recent to be waiting on, or a newest READY backup older than
 * `MAX_BACKUP_AGE_DAYS` — a weekly cadence that stops producing is as broken
 * as one that fails.
 *
 * It answers 200 with an explicit `determinate: false` for the third state,
 * where the answer could not be READ — a transient upstream error, a partial
 * listing, or a run that has not finished. Reporting those as
 * `backup-failed` is what made this endpoint 503 for four and a half days
 * with healthy backups behind it (AGL-1843). The verdict logic is
 * `backupsHealth` in the shared health lib, where every state is spec-covered
 * and the escalation that keeps 200-on-unknown from being fail-open is
 * argued in full.
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
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  exportsHealth,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  platformVersion,
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

/**
 * Upstream statuses that will NOT heal on their own (AGL-1843).
 *
 * The split matters because it is what keeps "indeterminate answers 200" from
 * becoming fail-open. A 429 or a 503 from `firestore.googleapis.com` says
 * nothing about the backups and is gone by the next probe; paging on it is
 * the noise this pass exists to remove. A 401/403/404 or a missing credential
 * is a configuration fact — a revoked `roles/datastore.backupsViewer`, a
 * deleted database — that stays true until someone acts, so it stays RED and
 * cannot silently retire the check.
 */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404])

const backupsProbe = memoizeWithTtl<BackupsCheck>(PROBE_TTL_MS, async () => {
  const startedAt = Date.now()
  const fail = (code: string): BackupsCheck => ({
    ok: false,
    ms: Date.now() - startedAt,
    code,
    states: EMPTY_STATES,
    newestReadyAgeDays: null,
  })
  /**
   * The third state: we could not read the listing, so we have no verdict.
   * `backupsHealth(null, …)` owns what that reports — the route only decides
   * WHICH failures are undeterminable rather than determined-bad.
   */
  const unreadable = (code: string): BackupsCheck =>
    backupsHealth(null, Date.now() - startedAt, Date.now(), { code })
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
    if (!response.ok) {
      return PERMANENT_HTTP_STATUSES.has(response.status)
        ? fail(`http-${response.status}`)
        : unreadable(`http-${response.status}`)
    }

    const body = (await response.json()) as {
      backups?: { state?: string; snapshotTime?: string }[]
      // Rather than failing the whole request when one location is
      // unreachable, the API returns a PARTIAL result set and names the
      // locations it could not reach here. Dropping this field turned a
      // partial read into a confident "no READY backup" (AGL-1843) — the
      // swallowed-query-as-measured-zero shape, one layer up.
      unreachable?: string[]
    }
    return backupsHealth(body.backups ?? [], Date.now() - startedAt, Date.now(), {
      unreachable: body.unreachable ?? [],
    })
  } catch (error) {
    // A throw here is a transport fault or an unparseable body — never a
    // statement about the backups themselves.
    return unreadable(String((error as { code?: string })?.code ?? 'unknown'))
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
      commit: deploymentCommitRef(),
      // Which VERSION of the platform answered. The commit above is only
      // set off Vercel if the operator stamped it; this one is inlined
      // from package.json by every build, so a self-hoster always has
      // something to quote in a bug report (AGL-2091).
      version: platformVersion(),
      environment: deploymentEnvironmentLabel(),
      region: process.env['VERCEL_REGION'] ?? null,
    }),
    { status: healthHttpStatus(status), headers: healthHeaders(status) },
  )
}

/**
 * HEAD answers exactly what GET would, minus the body (AGL-1148).
 *
 * It used to return a hardcoded 200 and "touches nothing" — which made it a
 * check that could not go red, for the monitors most likely to use it. See
 * `healthHeadOf`. The probe memo is what keeps this cheap.
 */
export async function HEAD(): Promise<Response> {
  return healthHeadOf(GET)
}
