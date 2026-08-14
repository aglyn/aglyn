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

export interface DurableRateLimitOptions {
  limit?: number
  windowMs?: number
  now?: number
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: any
}

export interface DurableRateLimitResult extends RateLimitResult {
  /**
   * True when the durable store was unreachable and the in-memory limiter
   * answered instead — the cap held for this instance only.
   */
  degraded: boolean
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

    const count = await firestore.runTransaction(async (tx: any) => {
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
    })

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
    }
  } catch (error) {
    noteDegradation(now, error)
    return { ...checkRateLimit(key, { limit, windowMs, now }), degraded: true }
  }
}

export default consumeRateLimit
