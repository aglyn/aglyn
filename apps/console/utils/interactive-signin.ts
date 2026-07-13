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
 * Interactive-sign-in marker (AGL-463). The mobile Google flow uses
 * `signInWithRedirect`, so sign-in completes on a FRESH page load after
 * returning from Google — `getRedirectResult` resolves during Firebase
 * init and the auth state's first emission is already the signed-in user.
 * That makes an interactive sign-in indistinguishable from a persistence
 * restore, so `useSessionCookie` took the validate-the-shared-cookie
 * path and, finding a leftover `signed-out` tombstone from an earlier
 * session, signed the user right back out ~seconds after login.
 *
 * Set this marker synchronously BEFORE kicking off any interactive
 * sign-in; it survives the redirect (sessionStorage persists across
 * same-tab navigations). On the next auth restore the session hook
 * consumes it and MINTS the shared cookie instead of validating. The
 * timestamp lets a failed/abandoned sign-in self-heal: a stale marker is
 * ignored, so a genuine later restore still gets normal validation.
 */
const MARKER_KEY = 'aglyn:interactive-signin-at'
const DEFAULT_MAX_AGE_MS = 120_000

export function markInteractiveSignIn(): void {
  try {
    window.sessionStorage.setItem(MARKER_KEY, String(Date.now()))
  } catch {
    // Private mode / storage disabled: the flow still works on desktop
    // (no reload), and mobile degrades to the prior behavior.
  }
}

/**
 * Reads-and-clears the marker. Returns true only when a sign-in was
 * initiated in this tab within `maxAgeMs` — i.e. this auth restore is
 * that sign-in completing, and the shared cookie should be minted.
 */
export function consumeInteractiveSignIn(
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): boolean {
  try {
    const raw = window.sessionStorage.getItem(MARKER_KEY)
    if (raw === null) return false
    window.sessionStorage.removeItem(MARKER_KEY)
    return Date.now() - Number(raw) < maxAgeMs
  } catch {
    return false
  }
}

export function clearInteractiveSignIn(): void {
  try {
    window.sessionStorage.removeItem(MARKER_KEY)
  } catch {
    // ignore
  }
}
