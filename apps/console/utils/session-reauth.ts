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
 * In-place re-authentication request (AGL-664).
 *
 * When the session dies, the console used to hard-bounce to `/signin` —
 * losing the page and any unsaved state with it. This store is the signal
 * that a session was lost and the "Sign in again to verify your device"
 * dialog should be shown OVER the current route instead.
 *
 * A module-level store rather than context, deliberately mirroring
 * `session-health`: the places that know the session died — the
 * `useSessionCookie` restore branch, the idle-logout timer, the
 * session-health watcher — are hooks and plain handlers, not a component
 * tree with a shared provider.
 *
 * ## Who may call `requestSessionReauth`
 *
 * ONLY the console's own auth-state machinery. The reason for each request
 * is a verdict the app itself reached (a 401 from our session route, our
 * idle timer, our denied-read heuristic) — never anything read out of
 * fetched content. Nothing in this module inspects a response body to
 * decide to prompt; callers pass a reason they derived themselves.
 *
 * ## Revoked stays revoked
 *
 * The store carries no credentials and can revive nothing by itself. Every
 * trigger site that maps to a deliberately-dead session (AGL-462 tombstone,
 * revocation) signs the local user out BEFORE or AS it requests the prompt,
 * and the dialog's only success paths are real credential sign-ins
 * (password / provider popup). "Expired, prove it's you" heals silently in
 * `useSessionCookie` and never reaches this store at all.
 *
 * Module state resets on a page load, so a fresh unauthenticated load (deep
 * link, cleared storage) still routes to `/signin` exactly as before — the
 * in-place prompt exists only for a session lost mid-use.
 */

/**
 * `unstable` (AGL-2486) is the loop breaker's verdict, not a diagnosis: the
 * app ↔ `/signin` round trip ran its full budget (`SIGNIN_BOUNCE_LIMIT` in
 * `signin-bounce.ts`) without settling. It carries `requiresSignIn`, like every
 * reason but `stale`, because the console genuinely does not have a session
 * it can use — the redirect it replaces was on its way to ask for exactly
 * the same credentials.
 */
export type SessionReauthReason =
  | 'revoked'
  | 'signed-out'
  | 'idle'
  | 'stale'
  | 'unstable'

/**
 * What we still know about who was signed in — captured from the live user
 * BEFORE any sign-out, because afterwards there is nobody left to ask.
 */
export interface SessionReauthIdentity {
  email: string | null
  /** True when the account has a password provider (inline re-auth form). */
  hasPassword: boolean
  /** First federated provider id (`google.com`, `saml.*`, `oidc.*`), if any. */
  providerId: string | null
}

export interface SessionReauthState {
  /** Why the prompt is up; `null` = no prompt. */
  reason: SessionReauthReason | null
  /**
   * True when the local Firebase user was signed out with the request
   * (revoked / signed-out / idle) — success means a full sign-in landed.
   * False for the `stale` heuristic, where the user is still locally
   * signed in until they choose to re-authenticate.
   */
  requiresSignIn: boolean
  /** "Not now": the dialog is closed, the degraded state persists. */
  dismissed: boolean
  identity: SessionReauthIdentity
}

const EMPTY_IDENTITY: SessionReauthIdentity = {
  email: null,
  hasPassword: false,
  providerId: null,
}

const IDLE_STATE: SessionReauthState = {
  reason: null,
  requiresSignIn: false,
  dismissed: false,
  identity: EMPTY_IDENTITY,
}

let state: SessionReauthState = IDLE_STATE
const listeners = new Set<(state: SessionReauthState) => void>()

function publish(): void {
  for (const listener of listeners) listener(state)
}

export function getSessionReauth(): SessionReauthState {
  return state
}

/**
 * Reads what the dialog will need off the live user before it is gone.
 * Tolerant of partial shapes on purpose — strictNullChecks is off and the
 * caller may hold a reactfire user, a raw SDK user, or nothing.
 */
export function captureReauthIdentity(
  user?: {
    email?: string | null
    providerData?: Array<
      { providerId?: string | null; email?: string | null } | null
    >
  } | null,
): SessionReauthIdentity {
  const providers = user?.providerData ?? []
  const hasPassword = providers.some(
    (entry) => entry?.providerId === 'password',
  )
  const federated =
    providers.find(
      (entry) => entry?.providerId && entry.providerId !== 'password',
    )?.providerId ?? null
  const email =
    user?.email ??
    providers.find((entry) => entry?.email)?.email ??
    null
  return { email, hasPassword, providerId: federated }
}

/**
 * Ask for the in-place re-auth prompt.
 *
 * First evidence wins: a second request while one is pending keeps the
 * original reason and identity — but always RE-OPENS a dismissed dialog.
 *
 * That re-open is safe only because of what the callers are, and one of
 * them stopped being obvious with AGL-2486. The auth-machinery triggers are
 * one-shot per page load or an explicit user click. The `stale` trigger is
 * a HEURISTIC that keeps firing for as long as the session stays dead, so
 * it would nag on exactly the dismissal it must respect — the watcher
 * therefore latches on `session-health`'s `serverReads` and calls this at
 * most once per episode. A new automatic caller needs the same latch, or
 * this function needs to stop re-opening.
 */
export function requestSessionReauth(
  reason: SessionReauthReason,
  identity?: SessionReauthIdentity,
): void {
  if (state.reason === null) {
    state = {
      reason,
      // The stale heuristic leaves the local user signed in; every other
      // trigger signs them out alongside this request.
      requiresSignIn: reason !== 'stale',
      dismissed: false,
      identity: identity ?? EMPTY_IDENTITY,
    }
  } else {
    state = { ...state, dismissed: false }
  }
  publish()
}

/** "Not now" — hide the dialog, keep the degraded state (and the route). */
export function dismissSessionReauth(): void {
  if (state.reason === null || state.dismissed) return
  state = { ...state, dismissed: true }
  publish()
}

/**
 * Bring a dismissed dialog back — the signed-out banner's "Sign in", and
 * (AGL-2486) the "Sign in again" a degraded list offers once a `stale`
 * prompt has been dismissed. Both are user clicks; nothing calls this on a
 * timer or off a failed read.
 */
export function reopenSessionReauth(): void {
  if (state.reason === null || !state.dismissed) return
  state = { ...state, dismissed: false }
  publish()
}

/** Re-auth landed (or the session came back another way) — stand down. */
export function clearSessionReauth(): void {
  clearSessionReauthRedirect()
  if (state.reason === null) return
  state = IDLE_STATE
  publish()
}

/*==========================================
 * SURVIVING AN OAUTH REDIRECT (AGL-2486)
 *
 * The store above is module state, and that is deliberate: a genuinely fresh
 * unauthenticated load — a deep link, cleared storage — must still bounce to
 * `/signin` exactly as before, and module state resetting on load is what
 * guarantees it.
 *
 * It also breaks the one flow that leaves the page on purpose. The dialog
 * signs the user out BEFORE the credential ceremony (a stale session's denied
 * reads survive an in-place token refresh, AGL-1062), and on a browser that
 * takes the redirect path — `isMobileBrowser`, which is true for any Mac
 * reporting touch points, not only phones — the ceremony is a full
 * navigation. So the tab comes back signed out, with the prompt that was
 * holding the page erased by the reload, while Firebase is still resolving
 * the redirect result. The layout sees "not signed in, nothing pending" and
 * sends the reader to `/signin` — all the way back, from a dialog whose whole
 * promise is that they will stay where they are.
 *
 * A `sessionStorage` breadcrumb is the narrowest thing that fixes it. It is
 * per-TAB, so it cannot leak the hold into a sibling tab or a new one; it
 * exists only when this console started a ceremony, so a fresh load still
 * bounces; and it carries a stamp, so a tab resumed hours later from
 * bfcache is not held open by a ceremony nobody is running.
 *=========================================*/

const REDIRECT_KEY = 'aglyn.session-reauth.redirect'

/**
 * How long a started ceremony stays believable. Longer than any real trip to
 * a provider and back, short enough that a forgotten tab is not held hostage.
 */
const REDIRECT_TTL_MS = 15 * 60 * 1000

/** Remember the prompt across the navigation the ceremony is about to make. */
export function markSessionReauthRedirect(): void {
  if (state.reason === null) return
  try {
    sessionStorage.setItem(
      REDIRECT_KEY,
      JSON.stringify({
        reason: state.reason,
        identity: state.identity,
        atMs: Date.now(),
      }),
    )
  } catch {
    // Private mode, or storage denied. The redirect still works; the tab
    // just lands on /signin as it did before, which is the old behaviour
    // rather than a new failure.
  }
}

/** The ceremony settled — or never started. Drop the breadcrumb. */
export function clearSessionReauthRedirect(): void {
  try {
    sessionStorage.removeItem(REDIRECT_KEY)
  } catch {
    /* nothing to clean up if it could not be written either */
  }
}

/**
 * Re-raise the prompt a redirect ceremony left behind, if there is one.
 *
 * Returns whether it did, so the caller can hold its redirect on the same
 * tick rather than waiting for the subscription to come back around.
 */
export function restoreSessionReauthRedirect(): boolean {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(REDIRECT_KEY)
  } catch {
    return false
  }
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as {
      reason?: SessionReauthReason
      identity?: SessionReauthIdentity
      atMs?: number
    }
    if (!parsed?.reason || Date.now() - (parsed.atMs ?? 0) > REDIRECT_TTL_MS) {
      clearSessionReauthRedirect()
      return false
    }
    requestSessionReauth(parsed.reason, parsed.identity)
    return true
  } catch {
    clearSessionReauthRedirect()
    return false
  }
}

export function subscribeSessionReauth(
  listener: (state: SessionReauthState) => void,
): () => void {
  listeners.add(listener)
  listener(state)
  return () => void listeners.delete(listener)
}

/** Test seam. */
export function __resetSessionReauth(): void {
  state = IDLE_STATE
}

export default getSessionReauth
