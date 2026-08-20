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
 * Is every scheduled job still being scheduled? (AGL-1955)
 *
 * Every failure signal the cron path had was triggered BY A RUN — the
 * `Cloud Scheduler job run failed` log-match fires on an error entry, and
 * `scheduled-crons.yml` goes red on a non-200. A job that is deleted, paused
 * or whose `- cron:` line was edited away produces no run, so it trips
 * neither, and quiet reads exactly like healthy. That is the AGL-1923 shape
 * one subsystem over, and what is downstream of these jobs is metered
 * billing, GDPR erasures and the audit archive.
 *
 * This is the reading half. Each job stamps `platformCronBeats/{jobId}` when
 * it is invoked; this endpoint compares each mark against the job's own cron
 * expression and reports the ones that should have run and did not.
 *
 * **Nothing on a schedule winds this.** The verdict is computed by the
 * READER — the AGL-1502 uptime probe, and any staff member opening
 * /admin/health. A detector that needed its own cron would only move the
 * problem one layer out, which is the argument AGL-1923 settled.
 *
 * **A quiet job is not a silent one.** The mark is stamped by the
 * INVOCATION, not by the work, and the expected time comes from the job's
 * cron rather than a fixed interval — so `usage-email`, which runs hourly on
 * the 1st and 2nd and not at all for the rest of the month, reads green for
 * the twenty-nine days it is deliberately idle. See `cronJobsHealth`.
 *
 * Same three rules as its sibling health endpoints — never cached, checks
 * the real thing, cost-bounded. The read is one small collection (one
 * document per job) memoised per instance. The body carries job ids,
 * schedules and ages, all of which are already in the open-source repo, and
 * never a secret, a customer or a resource path.
 */
import { getApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
// Imported for its side effect too: guarantees the firebase-admin default app
// is initialized before `getApp()` runs, exactly like the sibling routes.
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  CRON_BEAT_COLLECTION,
  CRON_BEAT_WATCH_DOC,
  cronJobsHealth,
  healthBody,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  type CronBeat,
  type CronJobCheck,
} from '@aglyn/aglyn/server'

// lockdown-423: exempt — infrastructure monitoring probe; no org-scoped action.

/** Never prerender, never revalidate. */

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Five minutes, matching the sibling probes. The tightest schedule watched
 * here is the every-minute plugin beat, whose grace is thirty minutes, so
 * the TTL is never what decides how fast a dead job is found.
 */
const PROBE_TTL_MS = 5 * 60_000

/**
 * When this deployment started watching.
 *
 * Needed because "has never reported" and "has stopped reporting" are the
 * same absence. Without a floor, the day this ships every row is red — and
 * `usage-email` stays red until the 1st of the next month, which is how a
 * board gets ignored. Created once, then only read.
 *
 * Deleting it re-opens the bootstrap window, which is worth knowing during
 * an incident: it is a plain document, not a reserved id.
 */
async function readWatchStart(
  db: FirebaseFirestore.Firestore,
  now: number,
): Promise<number> {
  const ref = db.collection(CRON_BEAT_COLLECTION).doc(CRON_BEAT_WATCH_DOC)
  const snapshot = await ref.get()
  const existing = snapshot.get('startedAtMs')
  if (typeof existing === 'number' && Number.isFinite(existing)) return existing
  await ref.set(
    { startedAtMs: now, startedAt: new Date(now).toISOString() },
    { merge: true },
  )
  return now
}

const cronsProbe = memoizeWithTtl<Record<string, CronJobCheck>>(
  PROBE_TTL_MS,
  async () => {
    const startedAt = Date.now()
    try {
      // Touch the facade so the import above can never be tree-shaken into
      // skipping app initialization.
      void firebaseAdmin
      const db = getFirestore(getApp())
      const now = Date.now()
      const watchStartedAtMs = await readWatchStart(db, now)
      const snapshot = await db.collection(CRON_BEAT_COLLECTION).get()
      const beats: CronBeat[] = snapshot.docs
        .filter((doc) => doc.id !== CRON_BEAT_WATCH_DOC)
        .map((doc) => ({ jobId: doc.id, atMs: Number(doc.get('atMs')) }))
        .filter((beat) => Number.isFinite(beat.atMs))
      return cronJobsHealth(beats, watchStartedAtMs, Date.now() - startedAt, now)
    } catch {
      // A null census is degraded for every row, by contract. "We cannot see
      // whether the jobs are running" is the condition this endpoint exists
      // to catch, not a reason to report calm.
      return cronJobsHealth(null, Date.now(), Date.now() - startedAt)
    }
  },
)

export async function GET(): Promise<Response> {
  const checks = await cronsProbe()
  const status = healthStatus(checks)
  return Response.json(
    healthBody({
      service: 'console-crons',
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
