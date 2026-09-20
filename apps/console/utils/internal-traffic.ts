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
 * The GA4 parameter/value pair, and the browser-pinned opt-in that rides
 * alongside the claims predicate below.
 *
 * These MOVED to `@aglyn/aglyn/app-utils/internal-traffic` (AGL-2064) when the
 * tenant runtime and the docs site started stamping the same parameter — the
 * strings have to agree with a setting in the GA UI that nothing here can
 * typecheck against, so having three surfaces spell them independently is how
 * one of them quietly becomes a different dimension. Re-exported rather than
 * repointed at every call site so this module stays the console's one door to
 * the subject.
 *
 * `isInternalTrafficSession` stays here: it reads Firebase ID-token claims,
 * which is console-only knowledge.
 */
export {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_QUERY_PARAM,
  readInternalTrafficOverride,
  readInternalTrafficOverrideForDomain,
} from '@aglyn/aglyn/app-utils/internal-traffic'

import { INTERNAL_TRAFFIC_VALUE } from '@aglyn/aglyn/app-utils/internal-traffic'

/**
 * Whether a signed-in console session is OURS rather than a customer's
 * (AGL-1582), decided from the ID token's custom claims.
 *
 * ## Why two claims and not just `staff`
 *
 * The flag has to follow the **actor**, not the subject. Staff impersonation
 * (AGL-246) mints a short-lived custom token for the TARGET account carrying
 * an `impersonatedBy` claim, and the endpoint refuses to impersonate a staff
 * account at all — so for the entire duration of an impersonation session
 * `staff` is `false` and the token is, by construction, a customer's.
 *
 * Keying on `staff` alone would therefore flag none of that traffic, and
 * impersonation is precisely the traffic AGL-1582 most wants excluded: it is
 * staff clicking through a customer's workspace, generating exactly the
 * activation events (`host_created`, `site_published`) the launch metrics are
 * read from.
 *
 * Getting it backwards is the expensive direction. Keying on the SUBJECT would
 * exclude a real customer's sessions while including ours, which is worse than
 * doing nothing — so the two claims are OR'd, and neither is a proxy for the
 * other.
 *
 * ## Not a security boundary
 *
 * This decides which bucket a hit is reported in, nothing else. It reads
 * whatever the token says without forcing a refresh, so a claim can be up to
 * an hour stale; the cost is one mis-bucketed session, and `useIsStaff` is
 * where the forced refresh is paid for because there the answer gates UI.
 */
export function isInternalTrafficSession(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  if (!claims) return false
  return Boolean(claims['staff']) || Boolean(claims['impersonatedBy'])
}

/**
 * Where the console remembers whether the last account this browser signed
 * into was ours (AGL-3007).
 *
 * ## Why the console needs a memory at all
 *
 * `isInternalTrafficSession` is decided from a token read, and a token read is
 * asynchronous while the tag is not. Measured on production (`docs/ANALYTICS.md`
 * §8): the boot burst — both `config` calls, the cold-load `page_view`, the
 * first web-vitals hit, and the `session_start` / `first_visit` they carry —
 * ships before the claims stamp lands. GA4's data filter matches per EVENT, so
 * a staff browser that was never opted in still reported one user and one
 * session every time it loaded. A phone is always that browser.
 *
 * ## Why it is not the `?aglyn_internal` override
 *
 * The override is a deliberate, sticky declaration that a BROWSER is ours, and
 * the release drills depend on it surviving a customer sign-in. Writing it from
 * the claims would make it sticky for the wrong reason: a customer signing in on
 * a browser staff once used would be erased from every report, permanently.
 *
 * This memory is the opposite shape. It is rewritten by EVERY token the browser
 * reads, in both directions, so it only ever answers for the window before the
 * current session's own token resolves — and a customer's first token clears it.
 * The cost, stated: a customer signing in on a browser whose last account was
 * staff has the hits sent before their token resolves stamped internal. Their
 * later events are not, so the session itself still reports.
 *
 * Origin-scoped like the override, and never throws — refused storage reads as
 * "not ours", which is the safe direction.
 */
export const INTERNAL_ACTOR_STORAGE_KEY = 'aglyn_internal_actor'

/** The storage bits the actor memory needs, so a spec can supply them. */
export type InternalActorStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
> | null

/** `window.localStorage` where reaching for it does not throw, else null. */
function consoleLocalStorage(): InternalActorStorage {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null)
  } catch {
    return null
  }
}

/**
 * Whether the last token this browser read was a staff or impersonation one.
 * Synchronous, so it can stamp the boot burst the token read cannot reach.
 */
export function readRememberedInternalActor(
  storage: InternalActorStorage = consoleLocalStorage(),
): boolean {
  if (!storage) return false
  try {
    return storage.getItem(INTERNAL_ACTOR_STORAGE_KEY) === INTERNAL_TRAFFIC_VALUE
  } catch {
    return false
  }
}

/**
 * Record the verdict of the token just read. Called with `false` as well as
 * `true`, because clearing on a customer token is what keeps this from becoming
 * the sticky flag the override is.
 */
export function rememberInternalActor(
  internal: boolean,
  storage: InternalActorStorage = consoleLocalStorage(),
): void {
  if (!storage) return
  try {
    if (internal) {
      storage.setItem(INTERNAL_ACTOR_STORAGE_KEY, INTERNAL_TRAFFIC_VALUE)
    } else {
      storage.removeItem(INTERNAL_ACTOR_STORAGE_KEY)
    }
  } catch {
    // Storage can throw outright (Safari private mode). Nothing is remembered,
    // and the claims stamp still covers the rest of the session.
  }
}

/**
 * The claims verdict for THIS pageview, while it is still being read
 * (AGL-3194).
 *
 * ## Why the remembered actor is not enough on its own
 *
 * {@link readRememberedInternalActor} — the `localStorage` memory — can
 * only answer for a browser that has already completed one signed-in load on
 * this origin. On the FIRST staff load of a new origin it is empty, the
 * override may be empty too, and the advertising gate therefore mounts the
 * tags before the token that would have stopped them has resolved. The hit is
 * already out by the time the memory is written; sweeping the tag afterwards
 * does not un-send it.
 *
 * So the read announces itself. A gate that cares can hold off while a verdict
 * is in flight, instead of guessing from a memory that is not written yet.
 *
 * ## Why this is not simply "wait for auth"
 *
 * `providers.tsx` puts the advertising tags deliberately OUTSIDE the auth
 * gate: the advertising grant belongs to a visitor who may never sign in, and
 * `/signin` is this surface's most-collected page. So `pending` is only ever
 * true when there is an actual token read in flight — a signed-out visitor
 * never sets it, and their tags mount exactly as before.
 *
 * Module state rather than context, for the same reason
 * `analytics-default-params.ts` owns its set: the layout that reads the token
 * and the component that mounts the tags are siblings, and threading a
 * provider between them would put a second copy of this verdict in the tree.
 */
export const INTERNAL_ACTOR_VERDICT_EVENT = 'aglyn:internal-actor-verdict'

let actorReadPending = false
let actorVerdict = false

/** A token read has started, so no verdict is known yet. */
export function beginInternalActorRead(): void {
  actorReadPending = true
  announceInternalActorVerdict()
}

/** The token resolved, one way or the other. */
export function settleInternalActorVerdict(internal: boolean): void {
  actorReadPending = false
  actorVerdict = internal
  announceInternalActorVerdict()
}

/** Whether a verdict is still in flight, and the last one that landed. */
export function readInternalActorVerdict(): {
  pending: boolean
  internal: boolean
} {
  return { pending: actorReadPending, internal: actorVerdict }
}

/** Test seam: no page outlives its own module, but a spec file does. */
export function resetInternalActorVerdict(): void {
  actorReadPending = false
  actorVerdict = false
}

function announceInternalActorVerdict(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new Event(INTERNAL_ACTOR_VERDICT_EVENT))
  } catch {
    // A browser that refuses to construct an Event leaves the gate on the
    // answer it already had, which is the pre-AGL-3193 behaviour.
  }
}

export default isInternalTrafficSession
