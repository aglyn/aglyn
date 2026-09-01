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
  deploymentCommitRef,
  deploymentEnvironmentLabel,
  healthBody,
  healthHeadOf,
  healthHeaders,
  healthHttpStatus,
  healthStatus,
  memoizeWithTtl,
  platformVersion,
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

/**
 * Name the rows that failed, in the log, at the moment the verdict is formed.
 *
 * The body already says which job is late — but only to whoever is holding
 * it. The uptime probe reads the STATUS and throws the body away, so a red
 * window leaves nothing behind saying what was red. Two of those windows in
 * one week were unattributable afterwards for exactly that reason:
 *
 *   2026-08-27  08:00:53 → 14:43:26 UTC   169 × 503   median 83ms
 *   2026-09-01  02:01:07 → 05:00:58 UTC    77 × 503   median 158ms
 *
 * Both answered fast — 337 of the 346 in under a second — so these were
 * deliberate refusals, not a Firestore read timing out into a 503. Which
 * makes the absence the interesting part: the endpoint decided, quickly,
 * that a row was late, and kept no record of which one.
 *
 * Neither start time lands on any single job's schedule plus its grace, so
 * they cannot be attributed by arithmetic after the fact either. That is the
 * whole argument for logging the verdict where it is formed.
 *
 * A `console.error` is enough BECAUSE of the log drain. The same argument in
 * `../route.ts` rejects it — "a log retained for about an hour, so by the
 * time anyone asked why, the answer was gone" — and that was true when the
 * only sink was Vercel's own buffer. Runtime logs now ship to Cloud Logging,
 * where this line is queryable for days.
 *
 * Written where the PROBE resolves rather than per request, so the rate is
 * the read's (one per TTL at most), not the caller's. A burst of monitors,
 * HEAD requests and staff opening /admin/health inside one window shares a
 * single line instead of each emitting their own.
 *
 * Returns its input so it can wrap a return without moving anything.
 */
function reportDegradedCrons(
  checks: Record<string, CronJobCheck>,
): Record<string, CronJobCheck> {
  const failing = Object.entries(checks).filter(([, check]) => !check.ok)
  if (!failing.length) return checks
  console.error(
    `health/crons degraded (${failing.length}/${Object.keys(checks).length}): ` +
      failing
        .map(
          ([jobId, check]) =>
            `${jobId} schedule="${check.schedule}" runner=${check.runner} ` +
            `dueAt=${check.dueAt ?? 'none'} ` +
            `lastBeatAgeMinutes=${check.lastBeatAgeMinutes ?? 'never'} ` +
            `graceMinutes=${check.graceMinutes}`,
        )
        .join(' | '),
  )
  return checks
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
      return reportDegradedCrons(
        cronJobsHealth(beats, watchStartedAtMs, Date.now() - startedAt, now),
      )
    } catch {
      // A null census is degraded for every row, by contract. "We cannot see
      // whether the jobs are running" is the condition this endpoint exists
      // to catch, not a reason to report calm.
      return reportDegradedCrons(
        cronJobsHealth(null, Date.now(), Date.now() - startedAt),
      )
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
