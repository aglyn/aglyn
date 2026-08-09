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
 * session-health banner — are hooks and plain handlers, not a component
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

export type SessionReauthReason = 'revoked' | 'signed-out' | 'idle' | 'stale'

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
 * original reason and identity — but always RE-OPENS a dismissed dialog,
 * because every trigger site is either one-shot per load or an explicit
 * user click, never a poll that could nag.
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

/** Bring a dismissed dialog back (the degraded banner's "Sign in"). */
export function reopenSessionReauth(): void {
  if (state.reason === null || !state.dismissed) return
  state = { ...state, dismissed: false }
  publish()
}

/** Re-auth landed (or the session came back another way) — stand down. */
export function clearSessionReauth(): void {
  if (state.reason === null) return
  state = IDLE_STATE
  publish()
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
