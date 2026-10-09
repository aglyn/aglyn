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
 * The third-party origins every signed-in console load talks to before it can
 * show anything (AGL-3660), for the root layout to `preconnect` from the HTML.
 *
 * Each one is reached only after the route's JavaScript has executed, so on a
 * cold connection its DNS + TLS setup used to sit on the critical path:
 *
 * - `www.google.com` and `www.gstatic.com`: App Check's reCAPTCHA v3
 *   (`api.js`, then `recaptcha__en.js`, then the anchor iframe). Auth and
 *   Firestore requests wait for the App Check token whenever the cached one
 *   has expired.
 * - `identitytoolkit.googleapis.com`: Auth's `accounts:lookup`, which Auth
 *   awaits before it reports the persisted user at all.
 * - `firestore.googleapis.com`: the Listen channel that answers the first
 *   workspace read.
 *
 * Four, not every Google host the console uses: a preconnect that is not used
 * within seconds is closed again, and each one costs a socket and a handshake.
 * These are the ones on the path from a reload to the first painted page.
 *
 * `anonymous` for the two that the SDKs reach with CORS requests without
 * credentials, because a connection is only reused for requests in the same
 * credentials mode; the reCAPTCHA scripts are plain script loads.
 *
 * Nothing under the emulators: none of these hosts is contacted there.
 */
export interface BootPreconnect {
  href: string
  crossOrigin?: 'anonymous'
}

export function bootPreconnects(emulated: boolean): BootPreconnect[] {
  if (emulated) return []
  return [
    { href: 'https://www.google.com' },
    { href: 'https://www.gstatic.com' },
    { href: 'https://identitytoolkit.googleapis.com', crossOrigin: 'anonymous' },
    { href: 'https://firestore.googleapis.com', crossOrigin: 'anonymous' },
  ]
}
