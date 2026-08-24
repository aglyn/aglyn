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
import { beforeUserCreated } from 'firebase-functions/identity'
import { HttpsError } from 'firebase-functions/https'
import { defineSecret } from 'firebase-functions/params'
import * as logger from 'firebase-functions/logger'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { signupsCreationVerdict } from './signups-lock'

/**
 * Shared secret for the tenant's job runner. Must match `PLUGIN_JOBS_SECRET`
 * on the tenant Vercel project — the runner returns 501 when it is unset and
 * 401 when it does not match, so a mismatch is silent from up here beyond the
 * status this logs.
 */
const PLUGIN_JOBS_SECRET = defineSecret('PLUGIN_JOBS_SECRET')

/**
 * Shared secret for the CONSOLE's scheduled routes. Must match `CRON_SECRET`
 * on the console Vercel project — every cron route compares it and answers
 * 401 when it does not match, 501 when it is unset there.
 *
 * The same value `.github/workflows/scheduled-crons.yml` sends as
 * `x-cron-secret` for the daily and weekly jobs. Two callers, one secret, on
 * purpose: rotating it is one act (docs/SECRET_ROTATION.md), not two.
 */
const CONSOLE_CRON_SECRET = defineSecret('CRON_SECRET')

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
 * Console origin to poke for the high-frequency cron routes below.
 *
 * NO DEFAULT, for the AGL-2176 reason one variable up: a wrong-but-plausible
 * default sends a request carrying OUR `CRON_SECRET` to somebody else's host
 * while our own jobs quietly never run. Unset means the beat does not fire and
 * says which variable to set, once per tick.
 *
 * It must be the host that SERVES the console, not one that redirects to it.
 * A redirect drops the POST body and the `x-cron-secret` header — that is
 * AGL-786, and the fetch below refuses to follow one so it fails loudly
 * instead of quietly succeeding at nothing.
 */
const CONSOLE_URL = process.env.AGLYN_CONSOLE_URL?.trim()?.replace(/\/+$/, '')

/**
 * Optional Vercel Bot Protection bypass, same header and same token as every
 * other Aglyn-owned caller of our own hosts (`tools/scripts/lib/probe-headers.mjs`,
 * `scheduled-crons.yml`, `uptime-probe.yml`).
 *
 * ABSENT MEANS NOT SENT, never a crash — the failure direction the shared
 * helper argues for. A self-hoster with no firewall in front of their console
 * needs nothing here; on app.aglyn.com an unrecognised automated client is
 * answered with a 429 Security Checkpoint page, which the status check below
 * reports by number (AGL-2483).
 *
 * A plain env var rather than a Secret Manager binding so that "not
 * configured" is a state this can HAVE. `defineSecret` makes a deploy fail
 * when the secret does not exist, which would make the whole function
 * undeployable for every operator who does not need it.
 */
const PROBE_TOKEN = process.env.AGLYN_PROBE_TOKEN?.trim()

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

/*==============================================================
 * THE CONSOLE'S HIGH-FREQUENCY CRONS (AGL-1617)
 *=============================================================*/

/**
 * The schedule the two routes below are driven on, five-field UTC cron.
 *
 * Pinned as a named constant because `scheduled-crons-wiring.spec.ts` reads
 * this file as text and asserts it against `SCHEDULED_JOBS` — the inventory
 * `/api/health/crons` judges these jobs against. A schedule changed here and
 * not there would silently redefine what "on time" means.
 */
const CONSOLE_FAST_CRON_SCHEDULE = '*/15 * * * *'

/**
 * WHY THESE TWO ARE NOT ON GITHUB ACTIONS ANY MORE.
 *
 * They were, until AGL-1617. GitHub coalesces and silently DROPS scheduled
 * triggers under load, and it does so per workflow — `scheduled-crons.yml`
 * carried fourteen `- cron:` entries and each run served exactly one, resolved
 * from `github.event.schedule`. Measured over 2026-08-22..24: the workflow
 * should have fired at least seven times an hour from the every-15-minute and
 * every-20-minute entries alone and actually fired **two to four**, a delivery
 * rate under 40%.
 * Because the surviving runs were split across both schedules, the campaign
 * processor specifically went **104 minutes** without a beat on 2026-08-24 —
 * on a fifteen-minute schedule — and the `scheduled-jobs` uptime monitor
 * correctly 503ed.
 *
 * That is not a monitoring artifact and not something a longer grace fixes:
 * `/product/marketing` SELLS "Schedule campaigns and overlays ahead of time",
 * the processor claims at most ten due campaigns per invocation, and a
 * backlog only drains at 40/hour while the schedule actually holds.
 *
 * The contrast was in the same health payload the whole time: `pluginJobsBeat`
 * above runs on Cloud Scheduler at `every 1 minutes` and reported an age of
 * zero. Cloud Scheduler is punctual; GitHub's scheduler is best-effort and
 * says so. So the frequent jobs move to the punctual runner and the daily and
 * weekly ones — for which an hour of drift is nothing — stay where they are.
 *
 * ONE function for both, not two: it is one Cloud Scheduler job rather than
 * two (the free tier is three jobs per billing account and `pluginJobsBeat`
 * already holds one), and the two routes are independent below, so neither can
 * stop the other. `finish-domain-attachments` moves from every twenty minutes
 * to every fifteen in the process, which is the direction AGL-2010 argued for
 * anyway — the customer is sitting there waiting for their site.
 *
 * THIS FUNCTION WRITES NO BEAT, deliberately. Each ROUTE stamps its own
 * `platformCronBeats/{jobId}` when it is invoked, so a tick that fired
 * perfectly and got a 401 back leaves no mark and `/api/health/crons` goes red
 * — which is correct. A beat written up here would mean "the scheduler is
 * alive", and the scheduler being alive is not the thing anyone downstream
 * needs to be true.
 */
const CONSOLE_FAST_CRON_ROUTES: readonly string[] = [
  '/api/campaigns/process-scheduled',
  '/api/admin/finish-domain-attachments',
]

/** One route's outcome, for the log line. */
async function postConsoleCron(route: string): Promise<void> {
  const url = `${CONSOLE_URL}${route}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-cron-secret': CONSOLE_CRON_SECRET.value(),
  }
  if (PROBE_TOKEN) headers['x-aglyn-probe'] = PROBE_TOKEN

  const response = await fetch(url, {
    method: 'POST',
    headers,
    // The routes treat a bodyless POST as their normal invocation; a body is
    // how `report-usage` and friends resume a sweep, and neither of these
    // chunks.
    body: '{}',
    // AGL-786. fetch would follow the redirect and drop `x-cron-secret` doing
    // it, turning a misconfigured origin into a request that 200s having
    // authenticated as nobody. Manual, so a 3xx is a status we can name.
    redirect: 'manual',
    signal: AbortSignal.timeout(240_000),
  })

  const text = await response.text().catch(() => '')
  if (response.status >= 300 && response.status < 400) {
    logger.error('console cron redirected — AGLYN_CONSOLE_URL is not the host that serves the console', {
      route,
      status: response.status,
      location: response.headers.get('location') ?? '',
    })
    return
  }
  if (response.status === 207) {
    // "Finished, and something in it needs a person" — the same meaning the
    // workflow gives it, and the same reason it must not read as success.
    logger.error('console cron finished with failures (207)', { route, body: text.slice(0, 2000) })
    return
  }
  if (!response.ok) {
    logger.error('console cron refused', { route, status: response.status, body: text.slice(0, 2000) })
    return
  }
  if (text.replace(/\s/g, '').includes('"done":false')) {
    // A resumable sweep (AGL-1141). This caller does not loop on `nextCursor`,
    // because neither route chunks today — so if one starts to, it must be a
    // loud error here rather than a sweep that silently stops after chunk one.
    logger.error('console cron returned done:false — this caller does not resume sweeps', {
      route,
      body: text.slice(0, 2000),
    })
    return
  }
  logger.debug('console cron ok', { route, status: response.status })
}

/**
 * Drives the console's high-frequency cron routes on Cloud Scheduler.
 *
 * See `CONSOLE_FAST_CRON_ROUTES` above for why these two are here and the
 * daily/weekly jobs are not.
 */
export const consoleFastCrons = onSchedule(
  {
    schedule: CONSOLE_FAST_CRON_SCHEDULE,
    timeZone: 'Etc/UTC',
    secrets: [CONSOLE_CRON_SECRET],
    // No retry: the next tick is fifteen minutes away and both routes are
    // idempotent claim-and-work sweeps, so a retried tick can only duplicate
    // reads. A run that fails is visible as a silent job on /api/health/crons
    // within the grace, which is the signal that matters.
    retryCount: 0,
    timeoutSeconds: 540,
  },
  async () => {
    if (!CONSOLE_URL) {
      logger.error(
        'console cron beat skipped — set AGLYN_CONSOLE_URL to the origin that ' +
          'SERVES your console, e.g. https://app.example.com. Until it is set, ' +
          'no scheduled email campaign will send and no pending custom domain ' +
          'will finish attaching.',
      )
      return
    }
    if (!PROBE_TOKEN) {
      // Not fatal — a console with no bot protection in front of it needs
      // nothing here. Said once per tick so that a 429 below has an
      // explanation sitting next to it rather than three files away.
      logger.debug(
        'AGLYN_PROBE_TOKEN is not set; these POSTs will be challenged by ' +
          'Vercel Bot Protection on any host that has it enabled.',
      )
    }

    // allSettled, not a loop with awaits: one route that throws must not stop
    // the other from being called at all. They share nothing but a secret.
    const outcomes = await Promise.allSettled(
      CONSOLE_FAST_CRON_ROUTES.map((route) => postConsoleCron(route)),
    )
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        logger.error('console cron threw', {
          route: CONSOLE_FAST_CRON_ROUTES[index],
          error: String(outcome.reason),
        })
      }
    })
  },
)


/*==============================================================
 * THE SIGNUPS LOCK, AT ACCOUNT CREATION (AGL-1531)
 *=============================================================*/

/**
 * Admin SDK, initialised once and lazily.
 *
 * Top-level `initializeApp()` would run on every cold start of every
 * function in this package, including the every-minute job beat that has no
 * use for it. `getApps()` makes a second call a no-op, which is what lets
 * the beat and the blocking function share one process safely.
 */
function firestore() {
  if (getApps().length === 0) initializeApp()
  return getFirestore()
}

/**
 * `lockdowns/feature--signups` — the SAME document the staff panic page
 * writes through /api/admin/lockdown, spelled out because
 * `featureLockdownDocId('signups')` lives in a library this package cannot
 * import. Pinned by the wiring guard: a typo here would produce a valve that
 * reads a document nothing ever writes, and therefore never refuses
 * anything, silently and forever.
 */
const SIGNUPS_LOCK_COLLECTION = 'lockdowns'
const SIGNUPS_LOCK_DOC = 'feature--signups'

/**
 * REFUSE ACCOUNT CREATION WHILE THE SIGNUPS LOCK IS ENGAGED (AGL-1531).
 *
 * The lock already refused the session mint, the legal-acceptance recorder
 * and the signup-page doors — so a bot wave's accounts were unusable, but
 * they were still CREATED, accumulating in the pool and against the Auth
 * quotas. Account creation is client -> Firebase Auth: a blocking function
 * is the only thing that can sit in front of it, which is what this is.
 *
 * ONE CHOKEPOINT, THREE DOORS. `beforeUserCreated` fires for every way an
 * account can come into existence — email/password
 * (`createUserWithEmailAndPassword` on /signup), Google
 * (`signInWithPopup`/`signInWithRedirect` on /signup and /signin, which
 * create the account on first sign-in), and SAML/OIDC SSO (/sso). This
 * handler is deliberately blind to which: it reads no provider, no email and
 * no `event.data.tenantId`, so there is nowhere for a per-door carve-out to
 * be added later. AGL-1993's two pools are covered by the same blindness —
 * SSO creates into a per-org GCIP tenant pool and everything else into the
 * project pool, and this refuses either.
 *
 * CREATION ONLY. There is deliberately no `beforeUserSignedIn` sibling. That
 * one fires for EXISTING accounts, and registering it would put every
 * sign-in — including the permanent break-glass account of AGL-1888, whose
 * whole purpose is to be reachable when nothing else is — behind this read
 * and this fail-closed posture. The lock stops accounts being born; it never
 * stops one coming home.
 *
 * NO STAFF BYPASS, which is not an omission: an account being created has no
 * claim yet, so a bypass here could only ever fire on a misattributed one.
 * `LOCKDOWN_FEATURE_STAFF_BYPASS.signups` has said `false` since AGL-1510
 * for exactly this reason.
 *
 * Cost while the lever is off: one Firestore `get` per account created,
 * ever — not per sign-in, not per request. Nothing here is on a hot path.
 *
 * !!! DEPLOY: this only exists in production once `firebase deploy --only
 * functions` has run AND Identity Platform shows the `beforeCreate` trigger
 * registered. Merging changes nothing. The staff lockdown page reports
 * whether the trigger is registered, so the gap is visible rather than
 * assumed.
 */
export const beforeSignupCreate = beforeUserCreated(async () => {
  const verdict = await signupsCreationVerdict(async () => {
    const snapshot = await firestore()
      .collection(SIGNUPS_LOCK_COLLECTION)
      .doc(SIGNUPS_LOCK_DOC)
      .get()
    return snapshot.exists
      ? (snapshot.data() as { untilMs?: number })
      : null
  }, Date.now())

  if (!verdict.refused) return

  // Logged before the throw because a refusal is otherwise invisible: the
  // caller sees a generic Auth error and nothing on the Aglyn side records
  // that the brake bit. `cause` is the field that matters during an
  // incident — `unreadable` means the lever may not even be pulled.
  logger.warn('signup refused at creation', { cause: verdict.cause })

  // THROWN, not returned. A returned value MODIFIES the user being created;
  // only a thrown error refuses the operation. A `return` here would be a
  // lock that runs, decides "refuse", and creates the account anyway.
  // ONE sentence for both causes. `unreadable` is a fail-closed refusal and
  // the operator needs to know that (the log line above says so), but the
  // person at the signup form cannot act on the difference, and "our
  // database is unreachable" is an operational detail that does not belong
  // in an error handed to an anonymous caller. The wording matches the
  // `signups` notice in the lockdown library so the two doors read alike.
  throw new HttpsError(
    'permission-denied',
    'New signups are temporarily paused. Existing accounts can sign in and ' +
      'work as usual.',
  )
})
