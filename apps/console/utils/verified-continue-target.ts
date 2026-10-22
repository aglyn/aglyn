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

import { isSafeContinueUrl } from '@aglyn/shared-util-next'

/**
 * Every route in the console's `(auth)` group. A `continue` pointing at one of
 * these is never a destination for a freshly verified account: they are the
 * wall, not what is behind it. `/verify-email` in particular is an address-bar
 * loop — the page re-mounts, reads the same `continue`, and hard-navigates to
 * itself forever — and `/signout` would sign the account straight back out of
 * the session it just finished verifying.
 */
const AUTH_ROUTE_PREFIXES = [
  '/account-recovery',
  '/reset-password',
  '/signin',
  '/signout',
  '/signup',
  '/sso',
  '/verify-email',
]

/** The path part of a continue value, absolute same-site URLs included. */
const pathOf = (url: string): string => {
  if (/^https?:\/\//.test(url)) {
    try {
      return new URL(url).pathname
    } catch {
      return ''
    }
  }
  return url.split(/[?#]/)[0]
}

/**
 * Where a just-verified account should land (AGL-1730) — or `null` when the
 * only correct answer is "nowhere in particular", which the caller reads as
 * the app root.
 *
 * This returns null far more often than it returns a path, which is the point:
 * the caller hard-navigates, so every wrong answer here is either an open
 * redirect or a loop the user cannot get out of without editing the URL.
 *
 * - no `continue`, or one the shared safety predicate rejects (absolute
 *   off-site, protocol-relative `//host`, anything not rooted at `/`) → null;
 * - a `continue` pointing back into the auth wall → null;
 * - anything else → the value, query string and fragment intact.
 */
export function verifiedContinueTarget(
  continueUrl: string | null | undefined,
): string | null {
  if (!continueUrl) return null
  if (!isSafeContinueUrl(continueUrl)) return null
  const path = pathOf(continueUrl)
  if (!path) return null
  if (
    AUTH_ROUTE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  )
    return null
  return continueUrl
}

export default verifiedContinueTarget
