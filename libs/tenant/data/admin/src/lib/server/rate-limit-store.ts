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

import { createHash } from 'crypto'
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
          region: process.env['VERCEL_REGION'] ?? null,
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
 * Wall-clock budget for one durable counter transaction (AGL-2404).
 *
 * Without a bound this function could not fail at all — it could only hang.
 * `runTransaction` on a single hot document contends, retries with backoff,
 * and on a contended key routinely outran the platform's function ceiling, so
 * the request died as a **504 with no body and no `Retry-After`** instead of
 * the cheap 429 the limiter exists to produce. Measured against production on
 * 2026-08-19 at `/api/protection/unlock`: sequential traffic refused cleanly
 * at the 10th attempt, while **two** concurrent requests on one key were
 * already enough to produce a 504 at ~10.3 s — the account-default function
 * ceiling, since that route declares no `maxDuration`.
 *
 * 2.5 s is chosen to sit far below the smallest ceiling any caller runs at
 * (10 s at the Vercel account default) while leaving room for a normal
 * transaction, which measured ~0.6 s end to end on the same endpoint. The
 * point is not to make the limiter faster; it is to make it *answerable*, so
 * that a contended key produces a decision rather than a held function.
 */
export const RATE_LIMIT_TRANSACTION_BUDGET_MS = 2_500

/**
 * Attempts the SDK may spend before it gives up on its own.
 *
 * The default is 5, each separated by a growing backoff — which is how a
 * single contended document turns into ten seconds of held function. Three
 * bounds the work the *abandoned* transaction goes on doing after this
 * function has already stopped waiting for it, so a refused caller stops
 * adding to the contention it was refused for.
 */
const RATE_LIMIT_TRANSACTION_ATTEMPTS = 3

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
 * What this deliberately does NOT do is make the counter cheaper. Bringing
 * the contention threshold up — a sharded counter, or an atomic
 * `FieldValue.increment` with a read-back instead of a read-modify-write
 * transaction — is a change to the storage shape shared by nine auth
 * surfaces, and belongs behind a load rehearsal rather than in the same pass
 * as the bound that stops the bleeding.
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

    // Explicit type argument: `firestore` is `any`, so the transaction's
    // promise infers as `any` and would widen the counter to `unknown`.
    const count = await withBudget<number>(
      firestore.runTransaction(
        async (tx: any) => {
          const snapshot = await tx.get(ref)
          const next = ((snapshot.exists ? snapshot.get('count') : 0) ?? 0) + 1
          tx.set(
            ref,
            {
              count: next,
              windowStartMs,
              // For a Firestore TTL policy on `expiresAt` — without one these
              // documents accumulate forever. See docs/RATE_LIMITING.md.
              expiresAt: new Date(resetMs + windowMs),
            },
            { merge: true },
          )
          return next
        },
        { maxAttempts: RATE_LIMIT_TRANSACTION_ATTEMPTS },
      ),
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
