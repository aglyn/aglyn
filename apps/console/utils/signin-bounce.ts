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
 * Loop breaker for the app ↔ `/signin` round trip (AGL-2486).
 *
 * `AuthenticatedLayout` pushes `/signin` whenever the session goes away, and
 * `AuthenticatingLayout` pushes straight back the moment it returns. Each
 * half is right on its own; together they are a ping-pong that a FLAPPING
 * session drives forever, because neither side counts.
 *
 * Zach hit it on production 2026-08-22: an org page "redirected a few times
 * then asked me to sign in again, then redirected a few times from the
 * auth/signin page then brought me back to the org with no sites loaded".
 * That is this loop, and there was no exit from it inside the app — the fix
 * he found was refreshing a different tab.
 *
 * The workspace-subdomain delegation has had exactly this guard since
 * AGL-466 (`recordDelegationBounce`), and only because that loop crossed an
 * origin and was therefore visible. This is the same shape one origin in,
 * so it gets the same shape of breaker — deliberately the same limit and
 * window, so there is one number to reason about rather than two.
 *
 * ## What tripping it must NOT do
 *
 * Nothing here decides that a session is valid, and nothing here suppresses
 * a re-authentication. Tripping the breaker replaces an unbounded REDIRECT
 * with an in-place prompt that still demands a real credential sign-in — a
 * genuinely revoked or expired session is asked for credentials either way.
 * The only thing that changes is that the user can read what happened
 * instead of watching the address bar oscillate.
 *
 * ## Why `sessionStorage`, and why per tab
 *
 * The loop is per tab: it is one tab's router pushing against one tab's
 * auth state. `localStorage` would let a second tab's healthy sign-in reset
 * a first tab's stuck one, and — worse — let one stuck tab arm the breaker
 * in a tab that is working fine. `sessionStorage` is the scope of the
 * problem. It also means a new tab starts clean, which is the recovery
 * Zach performed by hand.
 */

const BOUNCE_KEY = 'aglyn:signin-bounces'

/**
 * Redirects to `/signin` allowed inside {@link SIGNIN_BOUNCE_WINDOW_MS}
 * before the console stops bouncing and explains itself instead.
 *
 * Three, matching AGL-466. A legitimate sign-out → sign-in → land is ONE
 * redirect; a mobile `signInWithRedirect` round trip is one more. Three
 * inside half a minute is already not a user doing anything, and the cost
 * of being wrong is a dialog offering the sign-in the user was about to be
 * sent to anyway.
 */
export const SIGNIN_BOUNCE_LIMIT = 3

/** @see SIGNIN_BOUNCE_LIMIT */
export const SIGNIN_BOUNCE_WINDOW_MS = 30_000

/**
 * Record one app → `/signin` redirect.
 *
 * Returns `true` while redirecting is still the right answer, `false` once
 * the cap is hit — at which point the caller must stop navigating and raise
 * the in-place prompt instead.
 *
 * Fails OPEN on unavailable storage: a browser that refuses `sessionStorage`
 * (private mode, a hardened profile) must still be able to sign in, and an
 * un-counted redirect is the behaviour that shipped for a year.
 */
export function recordSignInBounce(): boolean {
  try {
    const now = Date.now()
    const raw = window.sessionStorage.getItem(BOUNCE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { at: number; n: number }) : null
    const within = parsed && now - parsed.at < SIGNIN_BOUNCE_WINDOW_MS
    const n = (within ? parsed.n : 0) + 1
    window.sessionStorage.setItem(
      BOUNCE_KEY,
      JSON.stringify({ at: within ? parsed.at : now, n }),
    )
    return n <= SIGNIN_BOUNCE_LIMIT
  } catch {
    return true
  }
}

/**
 * Forget the bounces — a real sign-in landed.
 *
 * Called from the re-auth dialog's success path and NOT from the layout's
 * "signed in" branch, which sounds like the obvious place and is the one
 * place it must not go: in a flapping session the layout sees `signedIn`
 * true on every single cycle of the loop, so clearing there would reset the
 * counter faster than it could ever fill and the breaker would never trip.
 */
export function clearSignInBounces(): void {
  try {
    window.sessionStorage.removeItem(BOUNCE_KEY)
  } catch {
    // ignore
  }
}

export default recordSignInBounce
