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
'use client'

/**
 * THE TAB THAT STOPPED LISTENING TO ITS SIBLINGS (AGL-3280).
 *
 * Accounts live in pools — the project pool, and one GCIP tenant per SSO org
 * — and `auth.tenantId` aims the instance at one of them. The SDK asserts
 * that it agrees with `auth.currentUser.tenantId`.
 *
 * Firebase keeps tabs in step by writing the auth record to shared storage;
 * every other tab takes the storage event and calls `_updateCurrentUser` with
 * the incoming user. When that user belongs to a DIFFERENT pool the assert
 * fires — `auth/tenant-id-mismatch` — inside the SDK's own listener, with no
 * `catch` of ours on the stack. It arrives as an unhandled rejection, and the
 * tab it happened in quietly stops tracking the shared record: it keeps its
 * own user while the rest of the browser has moved on.
 *
 * ## Why this is recovery and not prevention
 *
 * AGL-2486 repairs a different bug with the same error code — a restored
 * tenanted user leaves `tenantId` at the constructor's `null` — by adopting
 * the restored user's pool on the first auth state. That does nothing here:
 * `tenantId` was already right, and the incoming user is simply from
 * somewhere else.
 *
 * Adopting the pool earlier or more often cannot help either. To accept the
 * incoming user the instance would have to ALREADY name their tenant, and it
 * learns who they are from the event that throws. There is no ordering that
 * works, because the SDK has no representation for two pools sharing one
 * origin's persistence.
 *
 * What does work is re-initializing auth, which reads the shared record
 * afresh and adopts the pool it names. That is a reload.
 *
 * ## Why the reload is fenced in three ways
 *
 * Reloading somebody's page is not a thing to do casually, so:
 *
 * 1. **Only this error.** Every other rejection is left alone.
 * 2. **Only a HIDDEN tab, and only one holding a user.** A visible tab may
 *    have something half-typed in it, and the three reports that prompted
 *    this arrived on `/signin`. A tab with no `currentUser` has no listeners
 *    that could have desynced and no session to heal — its next sign-in aims
 *    the pool itself — so it is left alone whatever it is showing, which is
 *    also what keeps a sign-in form safe.
 * 3. **Rate-bound**, in session storage, the shape `shouldReloadForStaleBuild`
 *    uses (AGL-3279). One storage event produces several rejections — three
 *    inside one second, on the day this was found — and every one of them
 *    must not be its own reload. A browser that refuses storage gets no
 *    reload rather than an unbounded one.
 */

const RELOADED_KEY = 'aglyn.crossPoolReloaded'

/** How long one recovery suppresses the next, in this tab. */
export const CROSS_POOL_RECOVERY_INTERVAL_MS = 5 * 60 * 1_000

/**
 * The SDK's code for "the incoming user is not in this instance's pool".
 * Matched on `code` first, which is the field Firebase promises; the message
 * is the fallback for a rejection that arrived as something plainer.
 */
export function isCrossPoolDesync(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false
  const error = reason as { code?: unknown; message?: unknown }
  if (String(error.code ?? '') === 'auth/tenant-id-mismatch') return true
  return String(error.message ?? '').includes('auth/tenant-id-mismatch')
}

/**
 * Should this tab reload itself to re-read the shared auth record — and, if
 * so, SPEND the recovery, so a burst of rejections cannot ask twice.
 *
 * The decision and the reload are separate: the decision is the part with the
 * rate limit in it and the part worth proving, and the reload is one line at
 * the call site where a reader can see it happen.
 *
 * Every storage path is guarded. An accessor throws in a private window or
 * with site data blocked, and failing to RECOVER from an error must never be
 * a second error.
 */
export function shouldReloadForCrossPoolDesync(options: {
  /** Whether this tab currently holds a signed-in user. */
  signedIn: boolean
  /** `document.visibilityState`, passed in so the decision stays pure. */
  visibility: DocumentVisibilityState
}): boolean {
  if (typeof window === 'undefined') return false
  if (!options.signedIn) return false
  if (options.visibility !== 'hidden') return false
  const now = Date.now()
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? '')
    // An unreadable mark is not a recent one: a value we cannot parse must
    // not suppress the recovery forever.
    if (
      Number.isFinite(last) &&
      last > 0 &&
      now - last < CROSS_POOL_RECOVERY_INTERVAL_MS
    ) {
      return false
    }
    window.sessionStorage.setItem(RELOADED_KEY, String(now))
  } catch {
    // No storage is no rate limit, and an unbounded reload is worse than a
    // tab that has to be reloaded by hand.
    return false
  }
  return true
}

/**
 * Re-initialize auth by re-loading the document.
 *
 * A function of its own, beside the decision rather than inside it, for two
 * reasons: the decision stays pure and provable, and jsdom refuses to let a
 * spec redefine `location.reload` — so the only way to assert that a tab
 * WOULD have reloaded is to have one seam to stand in for.
 */
export function reloadForCrossPoolRecovery(): void {
  if (typeof window === 'undefined') return
  try {
    window.location.reload()
  } catch {
    // A refused reload leaves the tab where it already was.
  }
}
