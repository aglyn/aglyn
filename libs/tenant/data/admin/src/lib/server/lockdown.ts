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
  type LockdownDoc,
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

/** `lockdowns/user--{uid}`, normalized; null = not locked (incl. on error). */
export async function getUserLockdown(
  uid: string,
): Promise<LockdownState | null> {
  try {
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection(LOCKDOWNS_COLLECTION)
      .doc(userLockdownDocId(uid))
      .get()
    return snapshot.exists
      ? normalizeLockdownDoc(snapshot.data() as Partial<LockdownDoc>, 'user')
      : null
  } catch {
    return null
  }
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
  nowMs?: number
}

/**
 * The one verdict: the widest active lockdown covering this caller, or null.
 * Precedence platform > org > host > user (from `resolveLockdown`).
 */
export async function getLockdownVerdict(
  options: LockdownVerdictOptions,
): Promise<LockdownState | null> {
  // THE UN-PANIC INVARIANT. Staff are never locked out, by any scope, ever
  // — they are the only ones who can lift a lockdown. Keep this line first:
  // everything below it may read Firestore, and a staff verdict must not
  // depend on any read succeeding.
  if (options.staff === true) return null

  const nowMs = options.nowMs ?? Date.now()
  const [platform, user] = await Promise.all([
    getPlatformLockdown(),
    options.uid ? getUserLockdown(options.uid) : Promise.resolve(null),
  ])
  return resolveLockdown(
    {
      platform,
      org: normalizeOrgLockdown(options.org),
      host: normalizeHostLockdown(options.host),
      user,
    },
    nowMs,
  )
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
  options: LockdownVerdictOptions,
): Promise<Response | null> {
  const state = await getLockdownVerdict(options)
  return state ? lockdownJsonResponse(state) : null
}

export function lockdownJsonResponse(state: LockdownState): Response {
  const notice = lockdownNotice(state)
  const retryAfter = lockdownRetryAfterSeconds(state, Date.now())
  return Response.json(
    {
      error: 'locked',
      scope: state.scope,
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
