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

import { deploymentRegion } from '@aglyn/aglyn/app-utils/deployment-shape'
import { createHash } from 'crypto'
// The atomic counter primitive for the AGL-1921 server-error markers below.
// Commutative server-side, so instances converging on one minute's document
// neither contend nor retry — see `flushServerErrors`.
import { FieldValue } from 'firebase-admin/firestore'
import { firebaseAdmin } from './firebase-admin'
import {
  checkRateLimit,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
  type RateLimitResult,
} from './api-http'

/**
 * Durable, cross-instance rate limiting (AGL-794).
 *
 * Every limiter in the codebase was a per-instance `Map`, each carrying its
 * own "best-effort, serverless instances are ephemeral" caveat. On Vercel that
 * is close to no limit at all: the counter resets on every cold start and each
 * concurrent instance keeps its own, so the effective cap is roughly
 * `limit × instances` and an attacker can widen it just by going wider. That
 * is tolerable for blunting accidental bursts; it is not a brute-force
 * defense.
 *
 * This backs the same fixed-window shape with a Firestore counter, so the cap
 * is global. `api-http.ts` deliberately stays pure — it has no imports and is
 * unit-tested directly — so the storage-backed variant lives here instead of
 * being bolted onto it.
 *
 * **Cost is the reason this isn't the default everywhere.** Each call is a
 * transaction (one read + one write). That is the right trade for a password
 * unlock attempt; it is the wrong trade for an analytics beacon, which can
 * fire on every page view. Use `checkRateLimit` for volume, this for
 * consequence.
 */

/** Collection holding one document per (key, window). Server-writes only. */
export const RATE_LIMIT_COLLECTION = 'rateLimits'

/**
 * Document-id prefix for degradation markers (AGL-1679).
 *
 * `degraded: true` used to exist only in a `console.error`, which means a
 * Firestore blip silently dropped every durable limiter — auth, password
 * reset, and now the public REST API's per-key quota — back to a per-instance
 * cap for as long as it lasted, and nobody found out. Fail-soft is only a
 * defensible choice if someone can tell that it fired.
 *
 * This is deliberately not an alerting stack. It is the cheapest thing that
 * makes a degraded window answerable after the fact: when an episode ends,
 * the instance writes one summary document into the SAME collection, so it
 * inherits the deny-all rule and the `expiresAt` TTL policy that already
 * exist rather than needing a new collection, a rules deploy and a second TTL
 * policy. Ids are minute-bucketed so concurrent instances converge on a
 * handful of documents:
 *
 * ```
 * rateLimits/degraded_1755100800000
 * ```
 *
 * Written on RECOVERY, never during the outage — the store is unreachable
 * exactly when the episode is happening, so a marker written then would be
 * the one write guaranteed to fail.
 */
export const DEGRADATION_DOC_PREFIX = 'degraded_'

/** Marker id granularity, and the log re-notice interval for a long episode. */
const DEGRADATION_BUCKET_MS = 60_000

/** How long a marker survives the TTL sweep — long enough to look back. */
const DEGRADATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface DegradationEpisode {
  /** Calls that fell back to the in-process limiter. */
  count: number
  firstAtMs: number
  lastAtMs: number
  /** Last failure's code/message, truncated. */
  code: string
  /** Last minute we logged, so a sustained outage cannot flood the log. */
  lastLoggedBucket: number
}

/**
 * The episode currently in progress on THIS instance, or null when healthy.
 * Module-scoped on purpose: it is a per-instance observation being reported,
 * and there is nowhere durable to keep it while the durable store is down.
 */
let episode: DegradationEpisode | null = null

/** Short, stable error code for the marker and the log line. */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'string' || typeof code === 'number') return String(code)
  return String((error as { message?: unknown })?.message ?? 'unknown').slice(
    0,
    120,
  )
}

/**
 * Record one fallback. Logs at the start of an episode and at most once a
 * minute after that — the public REST API now calls this path on every
 * request, so a per-call `console.error` during a Firestore outage would be a
 * log flood that buries the signal it is meant to be.
 */
function noteDegradation(nowMs: number, error: unknown): void {
  const bucket = Math.floor(nowMs / DEGRADATION_BUCKET_MS)
  if (!episode) {
    episode = {
      count: 1,
      firstAtMs: nowMs,
      lastAtMs: nowMs,
      code: failureCode(error),
      lastLoggedBucket: bucket,
    }
    console.error(
      '[rate-limit] degraded: durable store unavailable, falling back to the per-instance cap',
      { code: episode.code, atMs: nowMs },
    )
    return
  }
  episode.count += 1
  episode.lastAtMs = nowMs
  episode.code = failureCode(error)
  if (bucket > episode.lastLoggedBucket) {
    episode.lastLoggedBucket = bucket
    console.error('[rate-limit] degraded: still falling back', {
      code: episode.code,
      count: episode.count,
      sinceMs: episode.firstAtMs,
    })
  }
}

/**
 * An episode ended: close it out and leave a durable record of the window.
 *
 * Fire-and-forget and best-effort — this is a diagnostic, and failing a
 * customer's request because the postmortem breadcrumb could not be written
 * would be a worse bug than the one it documents. The transaction shape
 * matches the counter above so a marker merges cleanly when several instances
 * recover into the same minute.
 */
function flushDegradation(firestore: any, nowMs: number): void {
  const ended = episode
  if (!ended) return
  // Cleared BEFORE the await so a concurrent recovery cannot flush it twice.
  episode = null
  console.error('[rate-limit] recovered from degraded window', {
    count: ended.count,
    firstAtMs: ended.firstAtMs,
    lastAtMs: ended.lastAtMs,
    code: ended.code,
  })

  const bucketStart =
    Math.floor(ended.firstAtMs / DEGRADATION_BUCKET_MS) * DEGRADATION_BUCKET_MS
  const ref = firestore
    .collection(RATE_LIMIT_COLLECTION)
    .doc(`${DEGRADATION_DOC_PREFIX}${bucketStart}`)

  void firestore
    .runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const priorCalls = (snapshot.exists ? snapshot.get('calls') : 0) ?? 0
      const priorEpisodes = (snapshot.exists ? snapshot.get('episodes') : 0) ?? 0
      const priorFirst = snapshot.exists ? snapshot.get('firstAtMs') : undefined
      const priorLast = snapshot.exists ? snapshot.get('lastAtMs') : undefined
      tx.set(
        ref,
        {
          calls: priorCalls + ended.count,
          episodes: priorEpisodes + 1,
          firstAtMs: Math.min(priorFirst ?? ended.firstAtMs, ended.firstAtMs),
          lastAtMs: Math.max(priorLast ?? ended.lastAtMs, ended.lastAtMs),
          code: ended.code,
          region: deploymentRegion(),
          // Same TTL field the counters use, so the policy already configured
          // on this collection sweeps these too — just far later.
          expiresAt: new Date(nowMs + DEGRADATION_RETENTION_MS),
        },
        { merge: true },
      )
    })
    .catch(() => undefined)
}

/**
 * The degradation episode in progress on this instance, or `null`. Exposed
 * for tests and for any future health surface; callers must not treat it as a
 * global view — it only ever describes the instance that answers.
 */
export function currentRateLimitDegradation(): Readonly<DegradationEpisode> | null {
  return episode
}

/** Test seam: forget any in-progress episode. */
export function resetRateLimitDegradationForTests(): void {
  episode = null
}

/**
 * Document-id prefix for signup-refusal markers (AGL-1907).
 *
 * `/api/orgs/create` has been rate-limited since AGL-1534 (3/h per uid, 10/h
 * per IP) and AGL-1536 watches org-creation VOLUME — but volume only counts
 * the signups that SUCCEEDED. A scripted farm that trips the limiter is
 * therefore invisible in exactly the moment it is being contained: the 429s
 * are the attack's signature and nothing recorded them. Before Sep 1 that is
 * the difference between "the limiter held" and "we have no idea whether it
 * was ever tested".
 *
 * Written into the SAME `rateLimits` collection as the counters and the
 * AGL-1679 degradation markers, for the same reason that one gave: it inherits
 * the deny-all security rule and the `expiresAt` TTL policy that already
 * exist, instead of needing a new collection, a rules deploy and a second TTL
 * policy. Minute-bucketed so concurrent instances converge:
 *
 * ```
 * rateLimits/signupRefused_1755100800000
 * ```
 *
 * **The timestamp field is `refusedAtMs`, deliberately not `lastAtMs`.** The
 * AGL-1693 rate-limiter health probe queries this collection with
 * `where('lastAtMs', '>=', cutoff).orderBy('lastAtMs','desc').limit(N)`. A
 * refusal marker carrying `lastAtMs` would be picked up by that range and,
 * under a flood, could fill the limit and push the real degradation markers
 * out of the result — silently blinding a sibling alarm. A distinct field name
 * keeps the two queries disjoint at the index level rather than relying on the
 * id-prefix filter that runs after the read.
 */
export const SIGNUP_REFUSAL_DOC_PREFIX = 'signupRefused_'

/** Marker id granularity. Matches the degradation markers. */
const SIGNUP_REFUSAL_BUCKET_MS = 60_000

/**
 * How long a refusal marker survives the TTL sweep. Shorter than the 30 days
 * degradation markers get: these can be written once a minute under sustained
 * pressure, and the question they answer ("was there a wave, and when") is
 * asked in the days after launch, not the month after.
 */
const SIGNUP_REFUSAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Which cap refused. Bounded on purpose — this is a public health body. */
export type SignupRefusalReason = 'uid' | 'ip'

/**
 * Record one refused org-creation attempt.
 *
 * Fire-and-forget and best-effort, like `flushDegradation`: refusing the
 * request is the control, and failing a 429 because its breadcrumb could not
 * be written would be strictly worse than not having the breadcrumb. Callers
 * must not await this on the response path.
 *
 * **On the write-per-refusal cost.** A refused request is free to the attacker
 * and now costs one transaction — the usual amplification objection. It does
 * not apply here in kind, only in degree: `/api/orgs/create` already spends
 * TWO `consumeRateLimit` transactions on every hit including the refused ones
 * (AGL-1534 counts over-limit attempts by design), so this is a third write on
 * a path that was already three, not a new class of cost. If it ever shows up
 * on the bill the fix is in-process coalescing like `episode` above, not
 * dropping the signal.
 *
 * Nothing identifying is stored. The counts are per-reason only; the uid and
 * IP that were refused stay in the (hashed) limiter keys, which this never
 * reads.
 */
export function recordSignupRefusal(
  reason: SignupRefusalReason,
  options?: { now?: number; firestore?: any },
): void {
  const nowMs = options?.now ?? Date.now()
  const bucketStart =
    Math.floor(nowMs / SIGNUP_REFUSAL_BUCKET_MS) * SIGNUP_REFUSAL_BUCKET_MS
  let firestore: any
  try {
    firestore = options?.firestore ?? firebaseAdmin.app().firestore()
  } catch {
    // No Admin app (a unit test, a misconfigured instance). The refusal still
    // happened and the caller still refuses; only the breadcrumb is lost.
    return
  }
  const ref = firestore
    .collection(RATE_LIMIT_COLLECTION)
    .doc(`${SIGNUP_REFUSAL_DOC_PREFIX}${bucketStart}`)

  void firestore
    .runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const priorTotal = (snapshot.exists ? snapshot.get('refusals') : 0) ?? 0
      const priorByReason =
        (snapshot.exists ? snapshot.get('byReason') : undefined) ?? {}
      const priorFirst = snapshot.exists
        ? snapshot.get('firstRefusedAtMs')
        : undefined
      tx.set(
        ref,
        {
          refusals: priorTotal + 1,
          byReason: {
            ...priorByReason,
            [reason]: ((priorByReason as any)?.[reason] ?? 0) + 1,
          },
          firstRefusedAtMs: Math.min(priorFirst ?? nowMs, nowMs),
          // NOT `lastAtMs` — see the prefix doc above.
          refusedAtMs: Math.max(
            (snapshot.exists ? snapshot.get('refusedAtMs') : 0) ?? 0,
            nowMs,
          ),
          expiresAt: new Date(nowMs + SIGNUP_REFUSAL_RETENTION_MS),
        },
        { merge: true },
      )
    })
    .catch(() => undefined)
}

/**
 * Document-id prefix for server-error markers (AGL-1921).
 *
 * ## Why a Firestore marker when the errors already go to Cloud Logging
 *
 * `reportServerError` forwards every `onRequestError` to a `server-errors` log
 * in `aglyn-main`, which is the right sink for triage — Error Reporting groups
 * them and a log-match policy can page on them. It is not a sink anything in
 * this repo can READ. Measured 2026-08-24 against the production credential:
 * `POST logging.googleapis.com/v2/entries:list` for that log answers
 * **403 `Permission denied for all log views`**, because the firebase-admin
 * service account can create log entries and cannot list them. So the only
 * reader the log has is a GCP alert policy that does not exist yet, and
 * creating one is the click, not a thing that ships with a commit.
 *
 * That is the AGL-2486 shape exactly — a detector written into a place nothing
 * watches. This marker is the second copy of the count, in a store we can
 * already read, so `/api/health/server-errors` can grade it and the readers
 * that already exist (the 15-minute GitHub uptime probe, the external keyword
 * monitors, `docs.aglyn.com/status`) become the listeners on day one.
 *
 * Written into the SAME `rateLimits` collection as the counters, the AGL-1679
 * degradation markers and the AGL-1907 refusal markers, for the reason those
 * two gave: it inherits the deny-all security rule and the `expiresAt` TTL
 * policy that already exist, instead of needing a new collection, a rules
 * deploy and a second TTL policy — i.e. instead of needing a console action
 * nobody can take from code. Minute bucketed so concurrent instances
 * converge:
 *
 * ```
 * rateLimits/serverError_1755100800000
 * ```
 *
 * **The timestamp field is `erroredAtMs`**, deliberately neither `lastAtMs`
 * (AGL-1679's) nor `refusedAtMs` (AGL-1907's), for the reason spelled out on
 * `SIGNUP_REFUSAL_DOC_PREFIX`: each health probe range-queries its own field,
 * and a shared field would let one signal's flood fill another's read limit
 * and silently blind it. Three signals, three disjoint indexes.
 */
export const SERVER_ERROR_DOC_PREFIX = 'serverError_'

/** Marker id granularity. Matches both sibling marker kinds. */
const SERVER_ERROR_BUCKET_MS = 60_000

/**
 * How long a server-error marker survives the TTL sweep. Seven days, matching
 * the refusal markers rather than the degradation markers' thirty: these can
 * be written every few seconds under a spike, and the question they answer
 * ("was there a spike, when, and on which deployment") is asked in the days
 * after an incident, not the month after.
 */
const SERVER_ERROR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Minimum spacing between marker writes from ONE instance (AGL-1921).
 *
 * The failure being watched for is a SPIKE, and a spike is exactly when an
 * unbounded recorder turns one incident into a billing incident — the same
 * argument that gave `reportServerError` its per-minute Logging budget. A
 * write per error would also be a write per error onto a SINGLE document,
 * which is where Firestore's per-document write ceiling lives and where
 * AGL-2404's contention storm came from.
 *
 * So errors coalesce in process and land at most once every five seconds per
 * instance — twelve writes a minute at the very worst, against a threshold
 * measured in single digits over half an hour. The count is never rounded
 * down: what is pending is added to the next flush, and a bucket rollover
 * flushes what it was holding before the new bucket starts.
 *
 * **The first error of a window is written IMMEDIATELY** (`lastFlushAtMs`
 * starts at 0), so a lone error is durable within a second and the alarm
 * never waits on a second one to become visible.
 */
const SERVER_ERROR_FLUSH_INTERVAL_MS = 5_000

interface ServerErrorAccumulator {
  /** The minute bucket these pending errors belong to. */
  bucketStart: number
  /** Errors observed and not yet written. */
  pending: number
  /** Pending split by deployment — `console-web`, `tenant-web`. */
  pendingByService: Record<string, number>
  /** When this instance last wrote, so the spacing above can be enforced. */
  lastFlushAtMs: number
  /** The newest error in the bucket, which becomes `erroredAtMs`. */
  lastErrorAtMs: number
}

/**
 * The errors this instance is holding, or null when it is holding none.
 * Module-scoped for the same reason `episode` above is: it is a per-instance
 * observation on its way to a durable place.
 */
let serverErrors: ServerErrorAccumulator | null = null

/**
 * Write what the accumulator is holding, and forget it.
 *
 * Fire-and-forget and best-effort, like `flushDegradation`: this runs while a
 * request is already failing, and a monitoring breadcrumb must never be the
 * reason a second thing breaks.
 *
 * `FieldValue.increment` with a merge, rather than the read-modify-write
 * transaction the two sibling markers use: increments are commutative
 * server-side, so several instances converging on one minute's document
 * neither contend nor retry — which is the AGL-2416 lesson applied to a path
 * that only ever runs during an incident.
 */
function flushServerErrors(firestore: any, nowMs: number): void {
  const held = serverErrors
  if (!held || held.pending <= 0) return
  // Zeroed BEFORE the await so a concurrent flush cannot write them twice.
  const errors = held.pending
  const byService = held.pendingByService
  const erroredAtMs = held.lastErrorAtMs
  const bucketStart = held.bucketStart
  held.pending = 0
  held.pendingByService = {}
  held.lastFlushAtMs = nowMs

  const ref = firestore
    .collection(RATE_LIMIT_COLLECTION)
    .doc(`${SERVER_ERROR_DOC_PREFIX}${bucketStart}`)
  const byServiceIncrements: Record<string, unknown> = {}
  for (const [service, count] of Object.entries(byService)) {
    byServiceIncrements[service] = FieldValue.increment(count)
  }
  void Promise.resolve(
    ref.set(
      {
        errors: FieldValue.increment(errors),
        byService: byServiceIncrements,
        // NOT `lastAtMs`, NOT `refusedAtMs` — see the prefix doc above.
        erroredAtMs,
        expiresAt: new Date(nowMs + SERVER_ERROR_RETENTION_MS),
      },
      { merge: true },
    ),
  ).catch(() => undefined)
}

/**
 * Record one uncaught server-side error, for `/api/health/server-errors`.
 *
 * Called from `reportServerError`, which is called from each app's
 * `onRequestError` hook — so this counts exactly what that hook can see: an
 * uncaught throw in a render or a route handler. It does NOT see an error that
 * kills the process first, a platform-level 5xx (function timeout, OOM,
 * cold-start 502), or anything thrown in the edge runtime. Those need the
 * Vercel log drain; `docs/UPTIME_AND_SLA.md` carries the list.
 *
 * Fire-and-forget and never throws. Nothing identifying is stored — a count
 * and which deployment produced it. The message, the stack and the route
 * pattern stay in the Logging entry, which is not public; this marker is read
 * by an endpoint that is.
 */
export function recordServerError(
  service: string,
  options?: { now?: number; firestore?: any },
): void {
  const nowMs = options?.now ?? Date.now()
  const bucketStart =
    Math.floor(nowMs / SERVER_ERROR_BUCKET_MS) * SERVER_ERROR_BUCKET_MS
  let firestore: any
  try {
    firestore = options?.firestore ?? firebaseAdmin.app().firestore()
  } catch {
    // No Admin app (a unit test, a misconfigured instance). The error still
    // happened and the caller still reports it to Logging; only the count is
    // lost — and a deployment that cannot reach Firestore at all is already
    // red on `/api/health`'s own `firestore` check.
    return
  }

  // A rollover flushes what the OLD bucket was holding before anything is
  // added to the new one, so a minute's count is never smeared into the next.
  if (serverErrors && serverErrors.bucketStart !== bucketStart) {
    flushServerErrors(firestore, nowMs)
    serverErrors = null
  }
  if (!serverErrors) {
    serverErrors = {
      bucketStart,
      pending: 0,
      pendingByService: {},
      // 0, so the first error of a bucket is written immediately.
      lastFlushAtMs: 0,
      lastErrorAtMs: nowMs,
    }
  }
  serverErrors.pending += 1
  serverErrors.pendingByService[service] =
    (serverErrors.pendingByService[service] ?? 0) + 1
  serverErrors.lastErrorAtMs = Math.max(serverErrors.lastErrorAtMs, nowMs)

  if (nowMs - serverErrors.lastFlushAtMs >= SERVER_ERROR_FLUSH_INTERVAL_MS) {
    flushServerErrors(firestore, nowMs)
  }
}

/**
 * Errors this instance is holding but has not written yet. Exposed for tests
 * and for anyone reasoning about the coalescing window; callers must not treat
 * it as a global view — it only ever describes the instance that answers.
 */
export function pendingServerErrors(): number {
  return serverErrors?.pending ?? 0
}

/** Test seam: forget anything held. */
export function resetServerErrorsForTests(): void {
  serverErrors = null
}

/**
 * Wall-clock budget for one durable counter round trip (AGL-2404).
 *
 * Without a bound this function could not fail at all — it could only hang.
 * The counter used to be a read-modify-write `runTransaction` on a single hot
 * document: it contended, retried with backoff, and on a contended key
 * routinely outran the platform's function ceiling, so the request died as a
 * **504 with no body and no `Retry-After`** instead of the cheap 429 the
 * limiter exists to produce. Measured against production on 2026-08-19 at
 * `/api/protection/unlock`: sequential traffic refused cleanly at the 10th
 * attempt, while **two** concurrent requests on one key were already enough
 * to produce a 504 at ~10.3 s — the account-default function ceiling, since
 * that route declares no `maxDuration`.
 *
 * AGL-2416 removed the read-modify-write (see {@link consumeRateLimit}), so
 * the retry storm this bound was catching should no longer occur. The bound
 * STAYS: it is what makes the function answerable at all, and a store that is
 * slow for any other reason — a hot document at Firestore's own single-doc
 * write ceiling, a network stall — must still produce a decision rather than
 * a held function.
 *
 * 2.5 s is chosen to sit far below the smallest ceiling any caller runs at
 * (10 s at the Vercel account default) while leaving room for the two round
 * trips below, which measured ~0.6 s end to end on the same endpoint.
 */
export const RATE_LIMIT_TRANSACTION_BUDGET_MS = 2_500

/**
 * Thrown when the durable counter could not reach a decision inside
 * {@link RATE_LIMIT_TRANSACTION_BUDGET_MS}. Distinct from a store *error* on
 * purpose — see the classification note on {@link consumeRateLimit}.
 */
export class RateLimitContentionError extends Error {
  constructor(message = 'rate-limit counter contended') {
    super(message)
    this.name = 'RateLimitContentionError'
  }
}

/**
 * gRPC status codes that mean "the store is up, this document is hot":
 * `ABORTED` (10) is what Firestore returns when a transaction loses its
 * optimistic race too many times, and `DEADLINE_EXCEEDED` (4) is the same
 * condition observed as a timeout. Neither is an outage, so neither may take
 * the fail-soft path — degrading on contention would let a caller widen its
 * own cap just by going concurrent, which is the exact defect AGL-794 closed.
 */
const CONTENTION_CODES = new Set([4, 10])

function isContention(error: unknown): boolean {
  if (error instanceof RateLimitContentionError) return true
  const code = (error as { code?: unknown })?.code
  return typeof code === 'number' && CONTENTION_CODES.has(code)
}

/**
 * Resolve `work`, or reject with {@link RateLimitContentionError} once
 * `budgetMs` elapses.
 *
 * The losing promise is explicitly silenced: an abandoned transaction that
 * rejects later would otherwise surface as an unhandled rejection and, on a
 * strict runtime, take the instance down — turning a contention fix into an
 * availability bug.
 */
async function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  work.catch(() => undefined)
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RateLimitContentionError()), budgetMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Add one to `ref`'s counter and report the total (AGL-2416).
 *
 * Two round trips, in this order and no other. The write MUST land before the
 * read: reading first and writing second is a read-modify-write again, only
 * without the transaction that made it safe, which would under-count under
 * concurrency and let a caller widen its own cap by racing itself.
 *
 * `merge: true` creates the document on the first request of a window —
 * `increment` on a missing field starts from zero — so no separate create is
 * needed, and `windowStartMs`/`expiresAt` are re-stamped idempotently on every
 * write rather than only on the first.
 *
 * A read-back that carries no usable count means the store accepted a write
 * and then failed to show it. That is a malfunction, not contention, so it
 * throws a plain error and takes the fail-SOFT path — the same posture as any
 * other store failure. Returning `0` instead would read as "no requests yet"
 * and admit every caller: fail-open, from the one branch that exists because
 * the store is misbehaving.
 */
async function countOne(
  ref: any,
  windowStartMs: number,
  resetMs: number,
  windowMs: number,
): Promise<number> {
  await ref.set(
    {
      count: firebaseAdmin.firestore.FieldValue.increment(1),
      windowStartMs,
      // For a Firestore TTL policy on `expiresAt` — without one these
      // documents accumulate forever. See docs/RATE_LIMITING.md.
      expiresAt: new Date(resetMs + windowMs),
    },
    { merge: true },
  )
  const snapshot = await ref.get()
  const observed = Number(snapshot?.get?.('count'))
  if (!Number.isFinite(observed) || observed < 1) {
    throw new Error('rate-limit counter read-back returned no count')
  }
  return observed
}

export interface DurableRateLimitOptions {
  limit?: number
  windowMs?: number
  now?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: any
  /** Injectable for tests; defaults to {@link RATE_LIMIT_TRANSACTION_BUDGET_MS}. */
  budgetMs?: number
}

export interface DurableRateLimitResult extends RateLimitResult {
  /**
   * True when the durable store was unreachable and the in-memory limiter
   * answered instead — the cap held for this instance only.
   */
  degraded: boolean
  /**
   * True when the counter could not be read and written inside its budget
   * because the key is contended, and the request was refused on that basis
   * rather than on a counted overage (AGL-2404). Always `false` on an
   * allowed result.
   */
  contended: boolean
}

/**
 * Document id for a (key, window) pair.
 *
 * The key is hashed rather than embedded: callers key on client IPs, and an
 * IP is personal data that would otherwise sit in plaintext document ids
 * (which also show up in any index export). Hashing additionally makes the id
 * safe — Firestore ids may not contain `/`, which IPv6-mapped and
 * path-derived keys can. Truncated to 32 hex chars: collisions would merely
 * merge two callers into one bucket, and 128 bits is far past needing that.
 */
function bucketId(key: string, windowStartMs: number): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 32)
  return `${hash}_${windowStartMs}`
}

/**
 * Counts one request against `key`'s fixed window, globally.
 *
 * Fails *soft, not open*: if Firestore is unreachable the in-memory limiter
 * answers and the result is flagged `degraded`. Failing fully open would let
 * an attacker disable brute-force protection by inducing a storage error;
 * failing fully closed would lock legitimate visitors out of a site because of
 * an unrelated Firestore blip. Degrading to the per-instance cap keeps some
 * protection and keeps the site usable, and says which happened.
 *
 * ## Two failures, two postures (AGL-2404)
 *
 * "Firestore is unreachable" and "this one document is contended" are not the
 * same event and must not get the same answer:
 *
 * - **The store is down** (fast error — `UNAVAILABLE`, a missing app, a
 *   credential failure). Fail SOFT, exactly as before: degrade to the
 *   per-instance cap and flag `degraded`. A real visitor must not lose access
 *   to a customer's site over an unrelated blip.
 * - **The key is contended** (`ABORTED`, `DEADLINE_EXCEEDED`, or the budget
 *   above elapsing). Fail CLOSED: refuse with `contended: true` and let the
 *   caller answer 429 with its usual `Retry-After`. Degrading here would be a
 *   partial bypass — concurrent requests on ONE key are cheap to generate,
 *   and if they dropped the cap to a per-instance count then going wide would
 *   widen the cap, which is precisely the property AGL-794 removed.
 *
 * Refusing on contention is never worse than the 504 it replaces. A 504 is
 * also a failed request, but it costs a full function timeout, carries no
 * `Retry-After` for a well-behaved client to back off on, and invites an
 * immediate retry that deepens the contention. Contention on a single key
 * also means, at nearly every call site, either abuse or a client
 * double-submitting: the keys are per (host, screen, IP), per uid, or per API
 * key, so a legitimate visitor essentially never races themselves.
 *
 * ## The counter is an atomic increment, not a transaction (AGL-2416)
 *
 * It used to be `runTransaction(read count, write count + 1)`. That is
 * optimistic concurrency on ONE document, so two writers in flight at once
 * already race: measured in production on 2026-08-19, **two** concurrent
 * requests on a single fresh key were enough to make a transaction lose,
 * retry, and blow past its budget. Two is ordinary client behaviour — a
 * double-submit, a mobile retry, two visitors behind one NAT — and the
 * documented 120/min per API key is not even reachable without concurrency,
 * so an integration built to the published budget met this by design.
 *
 * `set({count: increment(1)}, {merge: true})` is applied by the server with
 * no read set to conflict over, so concurrent writers do not abort each
 * other. The decision then needs the value, which costs a read back — the
 * same two round trips a transaction spent, and the same billing: one
 * document read plus one document write.
 *
 * **The trade is exactness for headroom, and it is deliberately biased.** The
 * read-back can observe increments from writers that landed after ours, so
 * under `C` concurrent requests a caller may see a count up to `C - 1` higher
 * than its own position. The consequences, precisely:
 *
 * - It can only ever refuse EARLY, never late. The count is monotonic within
 *   a window and always includes this request's own increment, so an admitted
 *   request is one where at most `limit` increments had landed. The cap can
 *   never be exceeded, and going concurrent can never widen it.
 * - "Exactly `limit` admitted" becomes "**at most** `limit` admitted". At the
 *   window's edge, `C` simultaneous requests can all read the same post-burst
 *   total and all be refused, so as few as `limit - C + 1` are admitted where
 *   `limit` would have been. Bounded by the concurrency, confined to one
 *   window, and in the customer-favourable direction for a *security* limiter
 *   — which is what all nine of this store's call sites are.
 * - A fixed-window limiter already admits up to `2 × limit` across a window
 *   boundary, so exactness was never a property this shape had end to end.
 * - **A call abandoned on its budget may already have counted.** The write
 *   lands before the read-back, so a caller that gives up during the read-back
 *   still spent its increment. The transaction it replaced committed nothing
 *   when it timed out — which is exactly how AGL-2416 could observe "10
 *   admitted" after a burst of 504s — so this is a genuine change, not a
 *   restatement. It errs in the same safe direction: the counter over-counts,
 *   so the cap still cannot be exceeded, and a caller can never buy budget by
 *   timing out.
 *
 * The failure classification above is unchanged and still load-bearing: the
 * budget can still elapse on a genuinely slow store, and when it does the
 * answer is still a refusal rather than a degradation.
 */
export async function consumeRateLimit(
  key: string,
  options?: DurableRateLimitOptions,
): Promise<DurableRateLimitResult> {
  const limit = options?.limit ?? DEFAULT_RATE_LIMIT
  const windowMs = options?.windowMs ?? DEFAULT_RATE_WINDOW_MS
  const now = options?.now ?? Date.now()
  const windowStartMs = Math.floor(now / windowMs) * windowMs
  const resetMs = windowStartMs + windowMs

  try {
    const firestore =
      options?.firestore ?? firebaseAdmin.app().firestore()
    const ref = firestore
      .collection(RATE_LIMIT_COLLECTION)
      .doc(bucketId(key, windowStartMs))

    // Explicit type argument: `firestore` is `any`, so the helper's promise
    // infers as `any` and would widen the counter to `unknown`.
    const count = await withBudget<number>(
      countOne(ref, windowStartMs, resetMs, windowMs),
      options?.budgetMs ?? RATE_LIMIT_TRANSACTION_BUDGET_MS,
    )

    // The store answered, so any episode this instance was in is over. The
    // marker is written here rather than in the `catch` because the store is
    // unreachable exactly while the episode is happening (AGL-1679).
    if (episode) flushDegradation(firestore, now)

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetMs,
      degraded: false,
      contended: false,
    }
  } catch (error) {
    if (isContention(error)) {
      // NOT `noteDegradation`: nothing degraded. The durable counter is still
      // the only authority and it still holds — this caller simply did not get
      // a turn. Recording it as a degradation would put contention markers in
      // front of `/api/health/rate-limits`, whose whole question is "did the
      // durable store stop answering", and answer it wrongly.
      //
      // `resetMs` stays the true end of the window so `X-RateLimit-Reset`
      // remains honest, which also makes the caller's `Retry-After` a bounded
      // back-off to the window boundary — the one client behaviour that
      // actually relieves the contention.
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs,
        degraded: false,
        contended: true,
      }
    }
    noteDegradation(now, error)
    return {
      ...checkRateLimit(key, { limit, windowMs, now }),
      degraded: true,
      contended: false,
    }
  }
}

export default consumeRateLimit
