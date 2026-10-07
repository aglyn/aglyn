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

import type { FetchLike } from './api-client'

/*==========================================
 * A CONSOLE SESSION FOR A WEBVIEW (AGL-3618).
 *
 * The console signs a browser in with two things: the Firebase client SDK's
 * own persisted user, and the shared `__session` cookie that
 * `/api/auth/session` mints from an ID token. On a page load with no
 * persisted user the console's `useSessionCookie` restores the user from that
 * cookie, silently (AGL-543).
 *
 * So a native app that is already signed in needs no new auth path to sign
 * its WebView in: it POSTs its ID token to the SAME route the console's own
 * sign-in calls, and the cookie lands in the cookie store the WebView reads
 * (iOS: the shared `HTTPCookieStorage`, which the WebView copies with
 * `sharedCookiesEnabled`; Android: React Native's networking writes to the
 * WebView's `CookieManager` directly). Every gate that route applies to a
 * browser (email verification, revocation, lockdown, sanctions, SSO pools)
 * applies to the app unchanged, and the cookie stays `HttpOnly`: no script in
 * the WebView ever sees a credential.
 *
 * Signing out reverses it with the route's own DELETE, which writes the
 * sign-out tombstone every other console tab honors.
 *=========================================*/

export type ConsoleSessionResult = { ok: true } | { ok: false; status: number; error: string }

export async function mintConsoleSession(input: {
  origin: string
  idToken: string
  fetch?: FetchLike
}): Promise<ConsoleSessionResult> {
  const doFetch: FetchLike = input.fetch ?? ((url, init) => fetch(url, init))
  try {
    const response = await doFetch(`${input.origin.replace(/\/+$/, '')}/api/auth/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.idToken}`, Accept: 'application/json' },
      credentials: 'include',
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    return {
      ok: false,
      status: response.status,
      error:
        body?.error ??
        (response.status === 403
          ? 'Verify your email address, then sign in again.'
          : 'The console session could not be started.'),
    }
  } catch {
    return { ok: false, status: 0, error: 'Aglyn could not be reached. Check the connection.' }
  }
}

export async function endConsoleSession(input: { origin: string; fetch?: FetchLike }): Promise<void> {
  const doFetch: FetchLike = input.fetch ?? ((url, init) => fetch(url, init))
  await doFetch(`${input.origin.replace(/\/+$/, '')}/api/auth/session`, {
    method: 'DELETE',
    credentials: 'include',
  }).catch(() => undefined)
}
