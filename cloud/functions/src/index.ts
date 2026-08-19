/**
 * Cloud Functions for Aglyn.
 *
 * Deliberately thin. Everything these do lives in the apps — a function here
 * is a BEAT or a hook, never a place where product logic accumulates. Keeping
 * it that way is what lets the tenant app own entitlement checks, cache keys
 * and `revalidatePath`, none of which are reachable from this package (it is a
 * plain npm project outside the nx workspace, with only firebase-admin and
 * firebase-functions available).
 */

import { onSchedule } from 'firebase-functions/scheduler'
import { defineSecret } from 'firebase-functions/params'
import * as logger from 'firebase-functions/logger'

/**
 * Shared secret for the tenant's job runner. Must match `PLUGIN_JOBS_SECRET`
 * on the tenant Vercel project — the runner returns 501 when it is unset and
 * 401 when it does not match, so a mismatch is silent from up here beyond the
 * status this logs.
 */
const PLUGIN_JOBS_SECRET = defineSecret('PLUGIN_JOBS_SECRET')

/**
 * Tenant origin to poke. Any host on THIS deployment works — the runner is not
 * host-scoped — but it must be a host on this deployment (AGL-2176).
 *
 * The default used to be `https://northwind-coffee.aglyn.app/...`: not merely
 * Aglyn's domain but one specific customer's published site. `cloud/functions`
 * ships in the open-source distribution, so an operator who deployed it and
 * missed this variable got a function POSTing to that stranger's site every
 * minute forever, carrying THEIR `PLUGIN_JOBS_SECRET` — while none of their own
 * scheduled publishing or booking-hold expiry ran, and nothing said so, because
 * the beat logged a perfectly healthy status from a server that was not theirs.
 *
 * So there is no default. Unset means the beat does not fire and says why, once
 * per tick, naming the variable. A job that visibly never runs is a bug the
 * operator can find; a request landing on someone else's server is one they
 * cannot see at all.
 */
const JOB_RUNNER_URL = process.env.AGLYN_JOB_RUNNER_URL?.trim()

/**
 * The platform's job beat (AGL-1159).
 *
 * `/api/plugins/run-jobs` has existed since AGL-435 and was built for exactly
 * this — "cloud cron, uptime pinger, GitHub Action, anything that can POST on
 * a beat". Nothing ever POSTed. `PLUGIN_JOBS_SECRET` was never set in
 * production, so the route returned 501 and **no scheduled job has ever run**:
 * not scheduled publishing, and not the bookings `expire-stale-holds` job that
 * has been registered and dark since AGL-435.
 *
 * Vercel cron was not an option — the Aglyn team is on the Hobby plan, which
 * caps crons at roughly daily, and scheduled publishing is supposed to be
 * accurate to the minute.
 *
 * Every-minute, because that is the resolution scheduled publishing promises.
 * The work itself is bounded per beat (the runner skips jobs that are not due,
 * and each job batches), so the cost is one small request per minute.
 */
export const pluginJobsBeat = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Etc/UTC',
    secrets: [PLUGIN_JOBS_SECRET],
    // A beat that overruns must not pile up behind itself: the next tick will
    // pick up whatever is still due, and overlapping runs would double-apply
    // work the runner assumes is sequential.
    retryCount: 0,
    timeoutSeconds: 120,
  },
  async () => {
    if (!JOB_RUNNER_URL) {
      // Deliberately an error rather than a silent return: a scheduled job
      // that does nothing is indistinguishable from one that is working until
      // somebody notices a post that never published (AGL-2176).
      logger.error(
        'plugin job beat skipped — set AGLYN_JOB_RUNNER_URL to a tenant ' +
          'origin on THIS deployment, e.g. ' +
          'https://sites.example.com/api/plugins/run-jobs. Until it is set, ' +
          'no scheduled publishing and no booking-hold expiry will run.',
      )
      return
    }

    const response = await fetch(JOB_RUNNER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-plugin-jobs-secret': PLUGIN_JOBS_SECRET.value(),
      },
      // The runner decides what is due; this carries no instructions.
      body: '{}',
    })

    if (!response.ok) {
      // Logged, not thrown. Throwing would retry a beat that is about to fire
      // again anyway, and a 501 (secret unset on the tenant) would then log an
      // error every minute forever.
      logger.error('plugin job runner refused', {
        status: response.status,
        body: await response.text().catch(() => ''),
      })
      return
    }

    const result = (await response.json().catch(() => null)) as {
      ran?: unknown[]
    } | null
    // Quiet on the common case — most minutes have nothing due, and an
    // every-minute function that logs unconditionally buries everything else.
    if (result?.ran?.length) {
      logger.info('plugin jobs ran', { ran: result.ran })
    }
  },
)
