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

import { verifiedContinueTarget } from './verified-continue-target'

/**
 * The page the native apps open the Besigner through (AGL-3850).
 *
 * The apps sign their web view in by minting the console's `__session`
 * cookie from their own ID token (`/api/auth/session`). A web view that has
 * never run the console holds no Firebase user, so a Besigner page loaded
 * straight from that cookie reaches the authenticated layout signed out and
 * is sent to `/signin` before anything adopts the cookie: inside the app the
 * person was shown a web sign-in page instead of the editor. This page adopts
 * the cookie FIRST, then moves on to the Besigner.
 */
export const BESIGNER_ENTRY_PATH = '/auth/besigner'

/**
 * Where the entry page may go next: a same-origin path, never an absolute
 * URL, a protocol-relative `//host` or a page of the sign-in wall. Anything
 * else is `null`, and the page stops rather than navigating.
 */
export function besignerEntryTarget(
  continueUrl: string | null | undefined,
): string | null {
  const target = verifiedContinueTarget(continueUrl)
  if (!target || !target.startsWith('/') || target.startsWith('//')) return null
  if (target.includes('\\')) return null
  return target
}

/**
 * Whether the web view must sign in from the cookie's custom token: it holds
 * nobody yet, or somebody other than the account the app just minted the
 * cookie for (the app switched accounts since the web view last ran).
 */
export function besignerEntryNeedsSignIn(
  payload: { uid?: unknown; tenantId?: unknown } | null | undefined,
  user: { uid: string; tenantId?: string | null } | null,
): boolean {
  if (!user) return true
  // The same test as \`sessionNamesAnotherAccount\` in the session hook,
  // repeated here so this module stays free of the hook's imports: a uid is
  // unique only within its pool (AGL-1993), so the pool is compared as well.
  const uid = payload?.uid
  if (typeof uid !== 'string' || !uid) return false
  const pool = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  return uid !== user.uid || pool !== (user.tenantId ?? null)
}

/** Set by the entry page for the life of the web view's tab. */
const NATIVE_APP_WEB_VIEW_KEY = 'aglyn:native-app-web-view'

/**
 * Remember, for this tab, that it is the native apps' web view. Session
 * storage lives exactly as long as the web view does and never reaches a
 * browser tab, which is what keeps the mark from leaking.
 */
export function markNativeAppWebView(): void {
  try {
    window.sessionStorage.setItem(NATIVE_APP_WEB_VIEW_KEY, '1')
  } catch {
    // Storage refused: the page still works, it only offers web-only extras.
  }
}

/**
 * Whether this tab is the Besigner inside the native apps. The app owns
 * notifications there (its own push), so web-only offers stay out of it.
 */
export function isNativeAppWebView(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(NATIVE_APP_WEB_VIEW_KEY) === '1'
  } catch {
    return false
  }
}
