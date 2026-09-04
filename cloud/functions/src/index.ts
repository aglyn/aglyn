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
  '/api/lists/materialize',
  /*
   * The publish outbox drain (AGL-2575).
   *
   * Publishing a screen is a client Firestore write, so the cache-drop
   * announce is a fetch from the publishing tab and a tab that closes
   * mid-flight strands it — the page stays stale for the hour-long document
   * TTL and nothing records that it happened. The publish now writes the
   * announce down in the same batch as the routing map; this is what fires
   * the ones no tab ever managed to.
   *
   * A console route rather than a job on the platform beat for the same
   * reason its neighbours are: it holds `REVALIDATE_SECRET` and reaches the
   * tenant deployment, which is the console's side of that call.
   */
  '/api/admin/drain-publish-outbox',
  /*
   * The sending-domain sweep belongs on a runner rather than on nothing.
   *
   * It is a console route because issuing a DKIM key needs a full-access
   * mail-provider credential and writing the zone needs `VERCEL_TOKEN`,
   * neither of which the tenant runtime may hold — so the platform job beat,
   * which runs in the tenant app, cannot carry it. `CRON_SECRET` and this
   * function are the console-side equivalent. (The credential's own name is
   * deliberately absent here: `sending-domain-credential-isolation.spec.ts`
   * refuses it outside the console app, mention included.)
   *
   * Frequent rather than daily for the same reason `finish-domain-attachments`
   * is: a site's claim buys nothing until the vendor work behind it finishes,
   * and this sweep is the only thing that does it.
   *
   * What waits is the site's REPUTATION rather than its mail. An unverified
   * platform subdomain falls through to the shared pool, so receipts and
   * password resets keep going the whole time; what does not go is marketing,
   * which may not leave on the pool at all. So the cost of a slow beat is a
   * paying merchant who cannot run a campaign yet, and fifteen minutes is what
   * keeps that measured in minutes rather than in a day.
   */
  '/api/admin/provision-sending-domains',
]

/** What one POST to a cron route settled as. */
interface ConsoleCronChunk {
  /** The request was accepted (200 or 207). A refusal is already logged. */
  accepted: boolean
  /** 207 — finished, and something in it needs a person. */
  partial: boolean
  /** The sweep has no further chunk. A route that does not chunk is done. */
  done: boolean
  nextCursor: string | null
}

/**
 * One POST. `cursor` resumes a chunked sweep (AGL-1141), exactly the body
 * `scheduled-crons.yml` sends: `{"cursor":"…"}`, and `{}` for a first call.
 */
async function postConsoleCron(
  route: string,
  cursor: string | null = null,
): Promise<ConsoleCronChunk> {
  const url = `${CONSOLE_URL}${route}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-cron-secret': CONSOLE_CRON_SECRET.value(),
  }
  if (PROBE_TOKEN) headers['x-aglyn-probe'] = PROBE_TOKEN

  const refused: ConsoleCronChunk = {
    accepted: false,
    partial: false,
    done: true,
    nextCursor: null,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    // The routes treat a bodyless POST as their normal invocation; a body is
    // how `report-usage` and friends resume a sweep.
    body: cursor ? JSON.stringify({ cursor }) : '{}',
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
    return refused
  }
  if (!response.ok && response.status !== 207) {
    logger.error('console cron refused', { route, status: response.status, body: text.slice(0, 2000) })
    return refused
  }
  if (response.status === 207) {
    // "Finished this chunk, and something in it needs a person" — the same
    // meaning the workflow gives it. The sweep CONTINUES (the cursor has
    // already moved past the failures) so one bad org cannot both stall the
    // run and go unnoticed; it must simply not read as success.
    logger.error('console cron chunk finished with failures (207)', {
      route,
      body: text.slice(0, 2000),
    })
  }

  const compact = text.replace(/\s/g, '')
  const done = !compact.includes('"done":false')
  const match = /"nextCursor":"([^"]*)"/.exec(compact)
  return {
    accepted: true,
    partial: response.status === 207,
    done,
    nextCursor: match?.[1] ?? null,
  }
}

/**
 * The chunk ceiling, mirroring `scheduled-crons.yml`. A sweep that has not
 * finished in fifty chunks is not a slow sweep, it is a loop.
 */
const CRON_SWEEP_MAX_CHUNKS = 50

/**
 * Drive one cron route to completion, following `nextCursor`.
 *
 * The workflow has always looped; this caller used to refuse to, and said so
 * loudly, because neither high-frequency route chunks. The daily routes do —
 * `report-usage` returns `done:false` with a cursor whenever a sweep outgrows
 * one invocation — so a caller that stopped after the first chunk would
 * report half the platform and leave the rest unmetered, silently.
 */
async function sweepConsoleCron(route: string): Promise<void> {
  let cursor: string | null = null
  let partial = false
  for (let chunk = 1; chunk <= CRON_SWEEP_MAX_CHUNKS; chunk += 1) {
    const result = await postConsoleCron(route, cursor)
    if (!result.accepted) return
    partial = partial || result.partial
    if (result.done) {
      logger.debug('console cron ok', { route, chunks: chunk, partial })
      return
    }
    if (!result.nextCursor) {
      // The one shape that must never be retried blindly: without a cursor
      // the next call would re-read the same chunk for ever.
      logger.error('console cron returned done:false with no nextCursor', {
        route,
        chunk,
      })
      return
    }
    cursor = result.nextCursor
  }
  logger.error('console cron sweep did not finish', {
    route,
    chunks: CRON_SWEEP_MAX_CHUNKS,
  })
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
      CONSOLE_FAST_CRON_ROUTES.map((route) => sweepConsoleCron(route)),
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
 * THE CONSOLE'S DAILY CRONS
 *=============================================================*/

/**
 * WHY THESE MOVED TOO.
 *
 * AGL-1617 moved the frequent sweeps here and left the daily ones on GitHub
 * Actions, on the reasoning that "an hour of GitHub's drift costs nothing and
 * the six-hour graces are honest". On 2026-08-27 that reasoning failed: the
 * workflow's 02:00 and 03:00 schedules did not fire until 12:25 and 13:56 —
 * ten and eleven hours late — and the 04:00, 07:00 and 08:00 schedules did not
 * fire at all. `run-erasures`, `report-usage-current` and `usage-alerts` went
 * silent for thirty-plus hours and the uptime monitor correctly went red.
 *
 * Every run that DID fire succeeded. Nothing was broken but the dispatch, and
 * dispatch is the one part of GitHub's scheduler that is documented as
 * best-effort. In the same window both Cloud Scheduler jobs beat within a
 * minute of every tick, as they have since AGL-1617.
 *
 * What these jobs drive is not tolerant of a lost day: `report-usage` is the
 * only run that meters a closed month into Stripe, and `run-erasures` is a
 * deletion a customer has asked for with a clock running on it.
 *
 * ONE FUNCTION PER JOB, unlike the fast pair. Their times are staggered on
 * purpose — `report-usage-current` at 07:00 is deliberately an hour ahead of
 * `usage-alerts` so the budget evaluation reads a figure computed today — and
 * one function per schedule keeps those times exactly as `SCHEDULED_JOBS`
 * describes them, so `/api/health/crons` judges the same job it did before.
 * It also gives each sweep its own 540-second budget rather than five of them
 * sharing one.
 *
 * ⚠️ These routes must be scheduled in EXACTLY ONE place. `report-usage`
 * meters into Stripe, so a day on which both runners fired would be a day
 * customers were billed twice — which is why the matching `- cron:` entries
 * leave `scheduled-crons.yml` in the same commit that adds these.
 */
const CONSOLE_DAILY_CRONS = {
  'report-usage': {
    schedule: '0 2 * * *',
    route: '/api/billing/report-usage',
  },
  'audit-archive': {
    schedule: '0 3 * * *',
    route: '/api/admin/audit-archive',
  },
  'run-erasures': {
    schedule: '0 4 * * *',
    route: '/api/admin/run-erasures',
  },
  'report-usage-current': {
    schedule: '0 7 * * *',
    route: '/api/billing/report-usage?month=current',
  },
  'usage-alerts': {
    schedule: '0 8 * * *',
    route: '/api/billing/usage-alerts',
  },
  /*
   * AN HOUR AFTER `run-erasures`, and that ordering is the point.
   *
   * An erasure must never be held up by a mail provider or a DNS API, so it
   * records what it could not release and moves on. This is what collects
   * that debt — and what collects a site delete whose teardown the provider
   * refused, which `teardownSendingDomain` leaves "for the next pass".
   *
   * Daily rather than on the fifteen-minute job, because nothing waits on it:
   * a provider slot released four hours later costs nothing, while the
   * provisioning sweep beside it is what makes a new site able to send at
   * all. Daily also keeps a walk of every label claim to once a day.
   */
  'reap-sending-domains': {
    schedule: '0 5 * * *',
    route: '/api/admin/reap-sending-domains',
  },
  /*
   * ⛔ THE `?dryRun=0` IS WHAT ARMS IT (AGL-2585).
   *
   * `/api/admin/reap-unverified-orgs` erases whole workspaces, so unlike its
   * five siblings it reports rather than acts unless a caller says otherwise —
   * on a POST as much as on a GET. This is the one place that says otherwise,
   * which makes putting the sweep back into preview a four-character edit here
   * rather than a code change, and makes the fact that a scheduled job deletes
   * workspaces legible at the schedule instead of only inside the route.
   *
   * An hour after `run-erasures`, for the same ordering reason the sweep above
   * carries: it calls `eraseOrg`, and the erasure runner should be done first.
   */
  'reap-unverified-orgs': {
    schedule: '0 6 * * *',
    route: '/api/admin/reap-unverified-orgs?dryRun=0',
  },
} as const

/**
 * One scheduled function for one console route.
 *
 * `retryCount: 0` for the same reason the fast pair carries it: these sweeps
 * are idempotent claim-and-work passes, a retried tick can only duplicate
 * reads, and a run that failed is already visible as a silent job on
 * `/api/health/crons` well inside its six-hour grace. That visibility is the
 * signal that matters — a retry that quietly succeeded would hide a route
 * that is refusing every other call.
 */
function consoleDailyCron(job: keyof typeof CONSOLE_DAILY_CRONS) {
  const { schedule, route } = CONSOLE_DAILY_CRONS[job]
  return onSchedule(
    {
      schedule,
      timeZone: 'Etc/UTC',
      secrets: [CONSOLE_CRON_SECRET],
      retryCount: 0,
      timeoutSeconds: 540,
    },
    async () => {
      if (!CONSOLE_URL) {
        logger.error(
          `console daily cron ${job} skipped — set AGLYN_CONSOLE_URL to the ` +
            'origin that SERVES your console, e.g. https://app.example.com.',
        )
        return
      }
      await sweepConsoleCron(route)
    },
  )
}

export const consoleReportUsage = consoleDailyCron('report-usage')
export const consoleAuditArchive = consoleDailyCron('audit-archive')
export const consoleRunErasures = consoleDailyCron('run-erasures')
export const consoleReportUsageCurrent = consoleDailyCron('report-usage-current')
export const consoleUsageAlerts = consoleDailyCron('usage-alerts')
export const consoleReapSendingDomains = consoleDailyCron('reap-sending-domains')
export const consoleReapUnverifiedOrgs = consoleDailyCron('reap-unverified-orgs')

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
 * The lock read, as ONE function, so the warm-up below and the handler
 * cannot end up reading different documents.
 */
async function readSignupsLock(): Promise<{ untilMs?: number } | null> {
  const snapshot = await firestore()
    .collection(SIGNUPS_LOCK_COLLECTION)
    .doc(SIGNUPS_LOCK_DOC)
    .get()
  return snapshot.exists ? (snapshot.data() as { untilMs?: number }) : null
}

/**
 * The entry point Cloud Run names in `FUNCTION_TARGET` for the container
 * that serves the blocking function. Pinned to the export below by the
 * wiring guard, because a rename that missed this string would leave a
 * warm-up that silently never runs and a cold read back on the critical
 * path.
 */
const SIGNUPS_LOCK_WARM_TARGET = 'beforeSignupCreate'

/** Tells "the warm read failed" apart from "there is no lock document". */
const WARM_READ_FAILED = Symbol('signups lock warm read failed')

/**
 * PAY THE COLD-START COST BEFORE THE REQUEST, NOT INSIDE ITS BUDGET
 * (AGL-2581).
 *
 * The first Firestore read in a container is not one round trip: it is
 * `initializeApp`, a metadata-server token fetch and a fresh gRPC channel,
 * and on a cold instance that is most of what the read costs. Cloud Run
 * starts the container and waits for it to listen before routing a request
 * to it, so work started here runs in that gap rather than inside the
 * handler's timeout.
 *
 * Gated on the target because this module is loaded by every function in
 * this package and again by the deploy-time trigger scan: an ungated read
 * would charge the every-minute job beat for a document it never uses, and
 * would run against whatever credentials the deploying machine happens to
 * carry.
 *
 * Consumed once. It answers the FIRST account creation this instance sees —
 * the only one whose read is cold — and every later one reads live, so a
 * lever pulled after the container started is still seen.
 */
let warmSignupsLock:
  | Promise<{ untilMs?: number } | null | typeof WARM_READ_FAILED>
  | undefined =
  process.env.FUNCTION_TARGET === SIGNUPS_LOCK_WARM_TARGET
    ? readSignupsLock().then(
        (state) => state,
        () => WARM_READ_FAILED,
      )
    : undefined

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
 * whole purpose is to be reachable when nothing else is — behind this read at
 * all. The lock stops accounts being born; it never stops one coming home.
 *
 * NO STAFF BYPASS, which is not an omission: an account being created has no
 * claim yet, so a bypass here could only ever fire on a misattributed one.
 * `LOCKDOWN_FEATURE_STAFF_BYPASS.signups` has said `false` since AGL-1510
 * for exactly this reason.
 *
 * Cost while the lever is off: one Firestore `get` per account created, plus
 * one per cold start of this function for the warm-up above — not per
 * sign-in, not per request. Nothing here is on a hot path.
 *
 * !!! DEPLOY: this only exists in production once `firebase deploy --only
 * functions` has run AND Identity Platform shows the `beforeCreate` trigger
 * registered. Merging changes nothing. The staff lockdown page reports
 * whether the trigger is registered, so the gap is visible rather than
 * assumed.
 */
export const beforeSignupCreate = beforeUserCreated(async () => {
  const verdict = await signupsCreationVerdict(async () => {
    // The warm-up answers at most one creation, and only if it succeeded;
    // clearing it first means a second creation cannot be served a stale
    // answer even if this one throws.
    const warmed = warmSignupsLock
    warmSignupsLock = undefined
    if (warmed !== undefined) {
      const state = await warmed
      if (state !== WARM_READ_FAILED) return state
    }
    return readSignupsLock()
  }, Date.now())

  if (!verdict.refused) {
    // An admission made blind is the one outcome nothing else records: the
    // account is created, the person sees nothing unusual, and this line is
    // the only sign that the lever could not be consulted. Without it a
    // Firestore read outage is indistinguishable from a quiet week.
    if (verdict.unreadable) {
      logger.warn('signups lock unreadable at creation, account admitted', {
        cause: 'unreadable',
      })
    }
    return
  }

  // Logged before the throw because a refusal is otherwise invisible: the
  // caller sees a generic Auth error and nothing on the Aglyn side records
  // that the brake bit. `cause` is the field that matters during an
  // incident — `held` means the refusal rests on an earlier read rather
  // than on the one just made.
  logger.warn('signup refused at creation', { cause: verdict.cause })

  // THROWN, not returned. A returned value MODIFIES the user being created;
  // only a thrown error refuses the operation. A `return` here would be a
  // lock that runs, decides "refuse", and creates the account anyway.
  // ONE sentence for both causes. `held` rests on an earlier read and the
  // operator needs to know that (the log line above says so), but the person
  // at the signup form cannot act on the difference, and the freshness of
  // that reading is an operational detail that does not belong in an error
  // handed to an anonymous caller. The wording matches the `signups` notice
  // in the lockdown library so the two doors read alike.
  throw new HttpsError(
    'permission-denied',
    'New signups are temporarily paused. Existing accounts can sign in and ' +
      'work as usual.',
  )
})
