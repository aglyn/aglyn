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
 * Server half of the lockdown system (AGL-1501): the verdict every
 * enforcement chokepoint asks for. The pure shape/precedence logic lives in
 * `@aglyn/aglyn` `app-utils/lockdown.ts`; this module adds the Admin-SDK
 * reads and the two properties only the server can hold:
 *
 * **The un-panic invariant.** A verified `staff` claim bypasses EVERY scope,
 * unconditionally, before any read happens. A platform-wide lockdown must
 * never lock out the staff who can lift it — a panic button that panics its
 * own operator is worse than none. Nothing may be added to
 * `getLockdownVerdict` above the staff check.
 *
 * **Fail-open on infrastructure error.** If the `lockdowns/platform` read
 * throws (Firestore outage, emulator without the collection), the verdict is
 * "not locked": an infrastructure blip must not weld the whole platform
 * shut. The same posture as the sanctions gate on an absent geo signal
 * (AGL-1492) and the release-flag reader on a missing template.
 */

import {
  featureLockdownDocId,
  isLockdownActive,
  LOCKDOWN_FEATURE_STAFF_BYPASS,
  type LockdownFeatureKey,
  LOCKDOWNS_COLLECTION,
  lockdownBlocks,
  type LockdownDoc,
  type LockdownIntent,
  lockdownIntentForMethod,
  type LockdownNotice,
  lockdownNotice,
  lockdownRetryAfterSeconds,
  type LockdownState,
  normalizeHostLockdown,
  normalizeLockdownDoc,
  normalizeOrgLockdown,
  PLATFORM_LOCKDOWN_DOC_ID,
  resolveLockdown,
  userLockdownDocId,
} from '@aglyn/aglyn/server'
import firebaseAdmin from './firebase-admin'

/**
 * Platform-doc TTL. Short on purpose: this is the panic path, and 15s is the
 * worst-case lag between staff pressing the button and a warm server process
 * refusing its next request. Per-request reads would be ~1 Firestore read
 * per API call platform-wide, which AGL-1302 showed is real money at scale.
 */
const PLATFORM_TTL_MS = 15_000

let platformCache: { at: number; state: LockdownState | null } | undefined
let platformPending: Promise<LockdownState | null> | undefined

/**
 * Drop the in-process platform cache. Called by /api/admin/lockdown after a
 * platform write so the process that took the action serves fresh verdicts
 * immediately; other processes converge within PLATFORM_TTL_MS.
 */
export function invalidatePlatformLockdownCache(): void {
  platformCache = undefined
  platformPending = undefined
}

/** `lockdowns/platform`, normalized; null = not locked (incl. on error). */
export async function getPlatformLockdown(): Promise<LockdownState | null> {
  if (platformCache && Date.now() - platformCache.at < PLATFORM_TTL_MS) {
    return platformCache.state
  }
  if (!platformPending) {
    platformPending = (async () => {
      let state: LockdownState | null = null
      try {
        const snapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection(LOCKDOWNS_COLLECTION)
          .doc(PLATFORM_LOCKDOWN_DOC_ID)
          .get()
        state = snapshot.exists
          ? normalizeLockdownDoc(
              snapshot.data() as Partial<LockdownDoc>,
              'platform',
            )
          : null
      } catch {
        // Fail open: an unreachable Firestore is an outage, not a lockdown.
      }
      platformCache = { at: Date.now(), state }
      return state
    })().finally(() => {
      platformPending = undefined
    })
  }
  return platformPending
}

/**
 * Feature-doc cache (AGL-1510): same TTL and the same reasoning as the
 * platform doc — feature gates sit on hot chokepoints (the session mint,
 * every media ingress, the plugin dispatcher), and 15s is the worst-case
 * lag between staff flipping a feature switch and a warm process enforcing
 * it. One map for all keys; the admin route invalidates after every write.
 */
const featureCache = new Map<
  LockdownFeatureKey,
  { at: number; state: LockdownState | null }
>()
const featurePending = new Map<
  LockdownFeatureKey,
  Promise<LockdownState | null>
>()

/** Drop the in-process feature cache (all keys) after an admin write. */
export function invalidateFeatureLockdownCache(): void {
  featureCache.clear()
  featurePending.clear()
}

/** `lockdowns/feature--{key}`, normalized; null = not locked (incl. error). */
export async function getFeatureLockdown(
  feature: LockdownFeatureKey,
): Promise<LockdownState | null> {
  const cached = featureCache.get(feature)
  if (cached && Date.now() - cached.at < PLATFORM_TTL_MS) return cached.state
  let pending = featurePending.get(feature)
  if (!pending) {
    pending = (async () => {
      let state: LockdownState | null = null
      try {
        const snapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection(LOCKDOWNS_COLLECTION)
          .doc(featureLockdownDocId(feature))
          .get()
        state = snapshot.exists
          ? normalizeLockdownDoc(
              snapshot.data() as Partial<LockdownDoc>,
              'feature',
            )
          : null
      } catch {
        // Fail open, matching the platform read: an unreachable Firestore is
        // an outage, not a feature lockdown.
      }
      featureCache.set(feature, { at: Date.now(), state })
      return state
    })().finally(() => {
      featurePending.delete(feature)
    })
    featurePending.set(feature, pending)
  }
  return pending
}

/**
 * The feature verdict and refusal in one call (AGL-1510) — the one-line
 * wiring a feature chokepoint carries:
 *
 *   const locked = await featureLockdownRefusal({ feature: 'checkout', staff })
 *   if (locked) return locked
 *
 * Composition, not ranking: a PLATFORM lock implies every feature, so it is
 * checked first (TTL-cached — routes that already ran the scope verdict pay
 * no extra read), and the platform-scope staff bypass there is UNCHANGED
 * and unconditional. The feature doc is checked second, and its staff
 * bypass is per-feature (`LOCKDOWN_FEATURE_STAFF_BYPASS`): granted where a
 * staff action aids incident response (uploads, installs, ai-assist),
 * withheld where it would BE the incident (checkout — a staff checkout
 * session is still a real charge). A feature lock implies nothing about the
 * org/host/user scopes — those stay with `lockdownRefusal` at the routes
 * that carry it.
 */
export async function featureLockdownRefusal(options: {
  feature: LockdownFeatureKey
  /** Verified `staff` custom claim — from a VERIFIED token only. */
  staff?: boolean
  nowMs?: number
}): Promise<Response | null> {
  const nowMs = options.nowMs ?? Date.now()
  const platform = await getPlatformLockdown()
  if (isLockdownActive(platform, nowMs)) {
    // The un-panic invariant at the platform scope, unchanged.
    if (options.staff === true) return null
    return lockdownJsonResponse(platform as LockdownState)
  }
  const state = await getFeatureLockdown(options.feature)
  if (!isLockdownActive(state, nowMs)) return null
  if (
    options.staff === true &&
    LOCKDOWN_FEATURE_STAFF_BYPASS[options.feature]
  ) {
    return null
  }
  return lockdownJsonResponse(state as LockdownState)
}

/**
 * User-doc cache (AGL-1522): the last per-call read on the verdict path.
 * AGL-1506 wired the verdict into ~36 routes plus the session mint/exchange,
 * and every call carrying a `uid` paid one Firestore get on
 * `lockdowns/user--{uid}` — an active console editor generated one read per
 * wired mutation, against the AGL-1302 read budget. Same TTL, same pending
 * dedupe, same fail-open posture as the platform and feature caches above —
 * ONE cache pattern in this module, not three implementations.
 *
 * The staleness tradeoff, stated: a user locked mid-window keeps passing
 * this check for up to PLATFORM_TTL_MS (15s) plus the caller's polling
 * cadence — on every process EXCEPT the one that took the action, which
 * refuses immediately because /api/admin/lockdown invalidates this uid's
 * entry after the write (the platform/feature invalidation hook, mirrored).
 * That bound is acceptable here for the same reason `media/sign` omits the
 * user scope entirely: the hard kill never rode this read. A user lock also
 * disables the Auth account and revokes refresh tokens, so the ID token
 * stops refreshing and the session cookie dies at its next
 * `verifySessionCookie(…, true)` — the cache can only delay the DISTINCT
 * 423 body, not access itself, and 15s matches the platform scope's stated
 * worst case and the drill's measured flip times.
 *
 * Bounded so a scan of uids cannot balloon a warm process: past
 * USER_LOCKDOWN_CACHE_MAX entries the least-recently-USED is evicted (a
 * cache hit refreshes recency, so active sessions survive a scan).
 */
export const USER_LOCKDOWN_CACHE_MAX = 5000

const userCache = new Map<
  string,
  { at: number; state: LockdownState | null }
>()
const userPending = new Map<string, Promise<LockdownState | null>>()

/**
 * Drop one uid's cached verdict (after a user lock/unlock write), or the
 * whole cache when called bare. The acting process serves a fresh verdict
 * immediately; other processes converge within PLATFORM_TTL_MS.
 */
export function invalidateUserLockdownCache(uid?: string): void {
  if (uid === undefined) {
    userCache.clear()
    userPending.clear()
    return
  }
  userCache.delete(uid)
  userPending.delete(uid)
}

/** `lockdowns/user--{uid}`, normalized; null = not locked (incl. on error). */
export async function getUserLockdown(
  uid: string,
): Promise<LockdownState | null> {
  const cached = userCache.get(uid)
  if (cached && Date.now() - cached.at < PLATFORM_TTL_MS) {
    // Re-insert to refresh recency: eviction is by least-recently-used, and
    // an ACTIVE session must not be the one a uid scan pushes out.
    userCache.delete(uid)
    userCache.set(uid, cached)
    return cached.state
  }
  let pending = userPending.get(uid)
  if (!pending) {
    pending = (async () => {
      let state: LockdownState | null = null
      try {
        const snapshot = await firebaseAdmin
          .app()
          .firestore()
          .collection(LOCKDOWNS_COLLECTION)
          .doc(userLockdownDocId(uid))
          .get()
        state = snapshot.exists
          ? normalizeLockdownDoc(snapshot.data() as Partial<LockdownDoc>, 'user')
          : null
      } catch {
        // Fail open, matching the platform and feature reads: an unreachable
        // Firestore is an outage, not a lockdown.
      }
      userCache.delete(uid)
      userCache.set(uid, { at: Date.now(), state })
      while (userCache.size > USER_LOCKDOWN_CACHE_MAX) {
        const oldest = userCache.keys().next().value
        if (oldest === undefined) break
        userCache.delete(oldest)
      }
      return state
    })().finally(() => {
      userPending.delete(uid)
    })
    userPending.set(uid, pending)
  }
  return pending
}

export interface LockdownVerdictOptions {
  /**
   * The verified `staff` custom claim of the caller — from a VERIFIED token
   * only, never from a header or body. True bypasses every scope: this is
   * the un-panic invariant.
   */
  staff?: boolean
  /** Verified caller uid; enables the user scope. */
  uid?: string | null
  /**
   * Already-loaded org doc (or its suspension fields), when the caller has
   * one in hand — org scope costs no extra read. Absent = scope not
   * evaluated.
   */
  org?: Parameters<typeof normalizeOrgLockdown>[0]
  /** Already-loaded host doc; same contract as `org`. */
  host?: Parameters<typeof normalizeHostLockdown>[0]
  /**
   * READ-ONLY discrimination (AGL-1511). A `read-only` lock refuses writes
   * and passes reads; a `full` lock refuses both, so this changes nothing
   * for every lock written before the mode existed.
   *
   * The request the chokepoint is answering — its METHOD decides. Passing
   * the route's own `request` is the wiring, because a single console
   * handler is usually exported as both GET and POST and the verdict runs
   * before the method branch: derive the intent, never restate it.
   */
  request?: { method?: string } | null
  /**
   * Explicit intent, overriding `request`. For the routes whose method lies
   * about what they do — a POST that is really a query (`where-used`,
   * `plugin-impact`), or a GET that mutates.
   *
   * Neither given = `write`, the fail-safe: a chokepoint that never declared
   * its intent refuses during a migration rather than letting an
   * unconsidered write race the repair.
   */
  intent?: LockdownIntent
  nowMs?: number
}

/** The declared or derived intent of a verdict request; `write` by default. */
function verdictIntent(options: LockdownVerdictOptions): LockdownIntent {
  if (options.intent) return options.intent
  if (options.request) return lockdownIntentForMethod(options.request.method)
  return 'write'
}

/**
 * The one verdict: the lockdown that REFUSES this caller's request, or null.
 * Precedence platform > org > host > user, strictness before width (from
 * `resolveLockdown`).
 *
 * "Refuses this request" rather than "covers this caller" since AGL-1511: a
 * read-only lock is active but does not refuse a read, and returning it
 * anyway would make every wired chokepoint 423 a GET — a read-only mode that
 * behaves exactly like a full one. The active state is still what
 * `resolveLockdown` chose, so the staff probe and the notice copy see the
 * real lock; only the ANSWER is intent-aware.
 */
export async function getLockdownVerdict(
  options: LockdownVerdictOptions,
): Promise<LockdownState | null> {
  // THE UN-PANIC INVARIANT. Staff are never locked out, by any scope, ever
  // — they are the only ones who can lift a lockdown. Keep this line first:
  // everything below it may read Firestore, and a staff verdict must not
  // depend on any read succeeding.
  //
  // This line is also the whole of AGL-1511's "staff writes bypass
  // read-only": staff bypass every scope AND every mode, unconditionally,
  // and read-only exists precisely so staff can work while the world reads.
  // A mode-aware staff rule below would be a second bypass to keep correct.
  if (options.staff === true) return null

  const nowMs = options.nowMs ?? Date.now()
  const [platform, user] = await Promise.all([
    getPlatformLockdown(),
    options.uid ? getUserLockdown(options.uid) : Promise.resolve(null),
  ])
  const state = resolveLockdown(
    {
      platform,
      org: normalizeOrgLockdown(options.org),
      host: normalizeHostLockdown(options.host),
      user,
    },
    nowMs,
  )
  return lockdownBlocks(state, verdictIntent(options)) ? state : null
}

/**
 * The refusal an API route returns for a locked caller: **423 Locked** with
 * a machine-readable body, so an API consumer sees "suspended: billing" and
 * not a mystery 403. Carries only the sanitized, user-facing subset — never
 * the actor uid or staff rationale.
 */
/**
 * Verdict and refusal in one call — the two-line wiring every org-scoped
 * API route carries (AGL-1506):
 *
 *   const locked = await lockdownRefusal({ staff, uid, org, host })
 *   if (locked) return locked
 *
 * Null means "not locked, proceed". One mechanism: this delegates to
 * `getLockdownVerdict` (so the un-panic invariant and fail-open posture are
 * inherited, never re-implemented) and to `lockdownJsonResponse` for the
 * distinct 423 body. Routes with a richer flow (the session mint clears
 * cookies on refusal) keep calling the two halves directly.
 */
export async function lockdownRefusal(
  options: LockdownVerdictOptions & {
    /** Visitor-facing copy override; see `lockdownJsonResponse`. */
    notice?: LockdownNotice
  },
): Promise<Response | null> {
  const state = await getLockdownVerdict(options)
  return state ? lockdownJsonResponse(state, { notice: options.notice }) : null
}

export function lockdownJsonResponse(
  state: LockdownState,
  options?: {
    /**
     * Substitute copy for a surface whose reader is not the account holder
     * — the tenant runtime's visitor-facing pause (AGL-1511). ONE wire
     * shape and ONE writer either way: only the words change, so
     * `parseLockdownRefusal` reads a paused checkout exactly as it reads a
     * locked console.
     */
    notice?: LockdownNotice
  },
): Response {
  const notice = options?.notice ?? lockdownNotice(state)
  const retryAfter = lockdownRetryAfterSeconds(state, Date.now())
  return Response.json(
    {
      error: 'locked',
      scope: state.scope,
      // The strictness, on the wire (AGL-1511): a client that can tell
      // "paused" from "down" renders the difference; one that cannot still
      // has the title and message, which already say it in words.
      ...(state.mode ? { mode: state.mode } : {}),
      // Distinct per-feature body (AGL-1510): an API consumer sees WHICH
      // capability is off ("uploads"), not a generic locked platform.
      ...(state.feature ? { feature: state.feature } : {}),
      reason: state.reason,
      title: notice.title,
      message: notice.body,
      ...(notice.contact ? { contact: notice.contact } : {}),
      ...(typeof state.untilMs === 'number' ? { untilMs: state.untilMs } : {}),
    },
    {
      status: 423,
      headers: {
        'Cache-Control': 'no-store',
        ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
      },
    },
  )
}
