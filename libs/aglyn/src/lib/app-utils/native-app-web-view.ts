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

import { useSyncExternalStore } from 'react'

/**
 * Whether a page is running inside the native apps' web view (AGL-3894).
 *
 * The Aglyn apps (iPhone, iPad, Mac, Android, Windows) open the Besigner in
 * an in-app web view. Inside it the app owns what a browser tab would offer:
 * its own push notifications, its own Done button, its own window title. The
 * page uses this to leave those web-only extras out.
 *
 * Two signals, either one enough:
 *
 * - **The user-agent marker.** Every app's web view appends
 *   `AglynApp/<version> (<platform>)` to its user agent (WKWebView's
 *   `applicationNameForUserAgent`, Android's `userAgentString`, WebView2's
 *   `UserAgent`). It is there from the first request, whichever page the
 *   view opens first, so it holds even for a build that predates the entry
 *   page below.
 * - **The entry page's session mark.** `/auth/besigner` marks the tab when
 *   the app opens the Besigner through it (AGL-3850). Session storage lives
 *   exactly as long as the web view and never reaches a browser tab.
 *
 * PRESENTATION ONLY. A user agent is whatever the client says it is, so this
 * decides what the page shows (a prompt, a back arrow, a title) and never
 * what anyone may do: no auth, entitlement or security decision reads it.
 */

/** The product token every app's web view adds to its user agent. */
export const NATIVE_APP_USER_AGENT_PRODUCT = 'AglynApp'

/** Set by the Besigner entry page for the life of the web view's tab. */
const NATIVE_APP_WEB_VIEW_KEY = 'aglyn:native-app-web-view'

/** `AglynApp/<version>` as its own token: not inside a longer product name. */
const USER_AGENT_MARKER = new RegExp(
  `(?:^|[\\s(;])${NATIVE_APP_USER_AGENT_PRODUCT}/[^\\s/]+`,
)

/**
 * The marker the apps append, for the native code's specs and for anyone
 * reading this file to know the exact shape: `AglynApp/1.4.0 (ios)`.
 */
export function nativeAppUserAgentMarker(
  version: string,
  platform: string,
): string {
  return `${NATIVE_APP_USER_AGENT_PRODUCT}/${version || '0'} (${platform})`
}

/** Whether a user-agent string carries the apps' marker. */
export function userAgentNamesNativeApp(
  userAgent: string | null | undefined,
): boolean {
  return typeof userAgent === 'string' && USER_AGENT_MARKER.test(userAgent)
}

/**
 * Remember, for this tab, that it is the native apps' web view. Called by the
 * Besigner entry page the apps open first.
 */
export function markNativeAppWebView(): void {
  try {
    window.sessionStorage.setItem(NATIVE_APP_WEB_VIEW_KEY, '1')
  } catch {
    // Storage refused: the user-agent marker still answers.
  }
}

/** Whether this page is inside the native apps' web view. */
export function isNativeAppWebView(): boolean {
  if (typeof window === 'undefined') return false
  if (userAgentNamesNativeApp(window.navigator?.userAgent)) return true
  try {
    return window.sessionStorage.getItem(NATIVE_APP_WEB_VIEW_KEY) === '1'
  } catch {
    return false
  }
}

const subscribeNever = (): (() => void) => () => undefined
const onServer = (): boolean => false

/**
 * `isNativeAppWebView()` for a render. The server cannot tell, so it renders
 * the browser's page and hydration agrees with it; the client then renders
 * again with the answer. Neither signal changes while a page is open, so
 * there is nothing to subscribe to.
 */
export function useIsNativeAppWebView(): boolean {
  return useSyncExternalStore(subscribeNever, isNativeAppWebView, onServer)
}
