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
 * The cookie names behind "Show to" signed-in or signed-out visitors
 * (AGL-4231), and the repair the tenant middleware makes on every page
 * request. No imports, so the middleware can take it whole.
 *
 * The hint is written when a visitor signs in. A visitor who signed in BEFORE
 * the hint existed, or whose hint went missing, still holds a member session
 * and would see "Sign in" on every page. And a hint can outlive its session
 * (the session expired or was cleared by something other than sign-out). So
 * the middleware, which sees every page request before the cached page, keeps
 * the two in step: a session with no hint gets one, a hint with no session
 * loses it. The page's inline script then reads the corrected cookie, because
 * a browser applies a response's cookies before it runs the page's scripts.
 *
 * Presence of the session cookie is enough here: the hint only decides what
 * shows. Whether the session is valid is checked by every endpoint that acts
 * on it, exactly as before.
 */

/** The member session cookie's name prefix; the site's id follows. HttpOnly. */
export const MEMBER_SESSION_COOKIE_PREFIX = 'aglyn_member_'

/** The readable sign-in hint's name prefix; the site's id follows, as the session's does. */
export const SIGNED_IN_HINT_COOKIE_PREFIX = 'aglyn_signed_in_'

/** How long a hint the middleware writes lasts: a session's own lifetime. */
export const SIGNED_IN_HINT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** The suffix both cookies share for one site. */
export function siteCookieSuffix(hostId: string): string {
  return hostId.replace(/[^A-Za-z0-9_-]/g, '')
}

/** The member session cookie for one site. */
export function memberSessionCookieName(hostId: string): string {
  return `${MEMBER_SESSION_COOKIE_PREFIX}${siteCookieSuffix(hostId)}`
}

/** The readable "signed in" hint cookie for one site. */
export function signedInHintCookieName(hostId: string): string {
  return `${SIGNED_IN_HINT_COOKIE_PREFIX}${siteCookieSuffix(hostId)}`
}

/**
 * The hint cookies to write (`set`) and to clear (`clear`) so that each site's
 * hint matches whether the request carries that site's member session.
 * Empty lists for the overwhelmingly common request: no session and no hint.
 */
export function signedInHintCorrections(
  cookies: Iterable<{ name: string; value: string }>,
): { set: string[]; clear: string[] } {
  const sessions = new Set<string>()
  const hints = new Map<string, string>()
  for (const { name, value } of cookies) {
    if (name.startsWith(MEMBER_SESSION_COOKIE_PREFIX) && value) {
      sessions.add(name.slice(MEMBER_SESSION_COOKIE_PREFIX.length))
    } else if (name.startsWith(SIGNED_IN_HINT_COOKIE_PREFIX)) {
      hints.set(name.slice(SIGNED_IN_HINT_COOKIE_PREFIX.length), value)
    }
  }
  const set = [...sessions]
    .filter((suffix) => hints.get(suffix) !== '1')
    .map((suffix) => `${SIGNED_IN_HINT_COOKIE_PREFIX}${suffix}`)
  const clear = [...hints]
    .filter(([suffix, value]) => value && !sessions.has(suffix))
    .map(([suffix]) => `${SIGNED_IN_HINT_COOKIE_PREFIX}${suffix}`)
  return { set, clear }
}
