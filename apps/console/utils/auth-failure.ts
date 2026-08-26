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
 * Was a failed read the SESSION's fault, or the network's?
 *
 * The two latching read guards — `useHostResolution` and `useOrgScope`'s
 * membership listen — both spent their retry budget and then swallowed the
 * error object entirely (`catch {}` / `() => {}`), so the only thing they
 * could tell the user was the union of both causes: "Check your connection
 * and try again." That copy is wrong half the time, and worse, it hid the
 * fact that one of the two causes RESOLVES ITSELF: a stale ID token is
 * refreshed by Firebase (or by a sibling tab) without anyone touching the
 * page, and nothing re-ran the read.
 *
 * Splitting the two is therefore not cosmetic. It is what lets
 * `useAuthRecovery` re-run the AUTH failures on a recovery signal while
 * leaving a genuine network fault exactly as it was — a standing error with
 * a manual "Try again", because no auth event says anything about the
 * network coming back.
 *
 * Deliberately a leaf module with NO imports. `use-host-resolution.ts` takes
 * its Firestore as an argument precisely so its spec can run without loading
 * the `@aglyn/tenant-feature-instance` barrel, and a classifier that dragged
 * that barrel in behind it would undo that.
 */

/**
 * The codes that mean "the server refused this identity".
 *
 * This is the same discriminator `firestore-denial-reporter` already trusts,
 * and for the same stated reason: a client that has merely lost the network
 * fails `unavailable` (or gets no callback at all and is served from
 * `persistentLocalCache`), never `permission-denied`. So the set can stay
 * small and closed.
 *
 * `unauthenticated` is in here even though Firestore rarely emits it for a
 * rules refusal — the callable/REST surfaces do, and a caller passing one
 * through means the same thing.
 */
const AUTH_FAILURE_CODES = new Set(['permission-denied', 'unauthenticated'])

/**
 * True when `error` is a read refused for WHO you are, rather than a
 * transport failure.
 *
 * ## Why this does not prefix-match `auth/`
 *
 * It looks tempting — every Auth SDK code starts that way — but
 * `auth/network-request-failed` is in that namespace and is the exact
 * opposite of what this predicate means. Matching the prefix would classify
 * a dead network as a session fault, wire it to the self-heal, and print
 * "your session expired" to somebody sitting in a tunnel. An unrecognized
 * code answers `false`, which degrades the right way: the user keeps the
 * manual retry they have today and nothing auto-fires.
 */
export function isAuthFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && AUTH_FAILURE_CODES.has(code)
}

export default isAuthFailure
