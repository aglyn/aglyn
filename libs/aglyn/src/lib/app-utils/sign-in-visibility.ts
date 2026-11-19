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

import { NODE_SHOW_TO_PROP } from './reusable-component-keys'

/**
 * SHOW AN ELEMENT TO SIGNED-IN OR SIGNED-OUT VISITORS (AGL-4231).
 *
 * A site with accounts wants "Sign in" in its header for visitors and
 * "Account" for members, a "Join" banner only for people who have not, a
 * "Welcome back" only for those who have. Any element can say which of the two
 * it is for, with its `showTo` setting.
 *
 * A published page is ONE cached page for every visitor, so the server cannot
 * decide this. The browser does, before the first paint, and nothing moves:
 *
 * - the renderer writes the setting onto the element as {@link SHOW_TO_ATTRIBUTE};
 * - signing in sets a second, readable cookie beside the member session
 *   ({@link signedInHintCookieName}: a `1`, nothing more — the session itself
 *   stays HttpOnly);
 * - a page that uses the setting carries a tiny inline script that marks
 *   `<html>` with {@link SIGNED_IN_ROOT_ATTRIBUTE} when that cookie is there, and
 *   a style rule that hides each element from the visitors it is not for.
 *
 * It decides what shows, never what anyone may see: the hint is a cookie any
 * visitor can set. Content for members only belongs on a members-only page,
 * and the Attributes panel says so.
 */

export { NODE_SHOW_TO_PROP }

/** Shown to every visitor: the setting's "nothing chosen". */
export const SHOW_TO_EVERYONE = 'everyone'
/** Shown only to a visitor signed in to the site's account. */
export const SHOW_TO_SIGNED_IN = 'signedIn'
/** Shown only to a visitor who is not signed in. */
export const SHOW_TO_SIGNED_OUT = 'signedOut'

export type ShowToAudience = typeof SHOW_TO_SIGNED_IN | typeof SHOW_TO_SIGNED_OUT

/** The attribute the renderer writes on an element that is not for everyone. */
export const SHOW_TO_ATTRIBUTE = 'data-aglyn-show-to'

/** The attribute on `<html>` while the visitor is signed in. */
export const SIGNED_IN_ROOT_ATTRIBUTE = 'data-aglyn-signed-in'

// The cookie names, and the middleware's repair of a missing or stale hint,
// live in a module with no imports so the tenant middleware can take it whole.
export {
  MEMBER_SESSION_COOKIE_PREFIX,
  memberSessionCookieName,
  SIGNED_IN_HINT_COOKIE_PREFIX,
  SIGNED_IN_HINT_MAX_AGE_SECONDS,
  signedInHintCookieName,
  signedInHintCorrections,
} from './sign-in-hint-cookie'
import { SIGNED_IN_HINT_COOKIE_PREFIX } from './sign-in-hint-cookie'

/** A stored `showTo` as one of the two audiences, or `undefined` for everyone. */
export function resolveShowTo(value: unknown): ShowToAudience | undefined {
  return value === SHOW_TO_SIGNED_IN || value === SHOW_TO_SIGNED_OUT ? value : undefined
}

/** Whether any element of a page is shown to one audience only. */
export function nodesUseShowTo(nodes: Record<string, unknown> | null | undefined): boolean {
  for (const node of Object.values(nodes ?? {})) {
    const props = (node as { props?: Record<string, unknown> } | null)?.props
    if (props && resolveShowTo(props[NODE_SHOW_TO_PROP])) return true
  }
  return false
}

/**
 * The style a page that uses the setting carries. `!important` because an
 * element's own `display` (a flex row, a grid) is an author's style and must
 * not decide whether a signed-out visitor sees "Account".
 */
export const SIGN_IN_VISIBILITY_STYLE =
  `html:not([${SIGNED_IN_ROOT_ATTRIBUTE}]) [${SHOW_TO_ATTRIBUTE}="${SHOW_TO_SIGNED_IN}"]{display:none!important}` +
  `html[${SIGNED_IN_ROOT_ATTRIBUTE}] [${SHOW_TO_ATTRIBUTE}="${SHOW_TO_SIGNED_OUT}"]{display:none!important}`

/**
 * The inline script, run before the first paint. A constant of ours: no
 * author input reaches it. The cookie is any site's hint, because a page
 * is only ever read with its own site's cookies.
 */
export const SIGN_IN_VISIBILITY_SCRIPT =
  `try{if(/(?:^|;\\s*)${SIGNED_IN_HINT_COOKIE_PREFIX}[A-Za-z0-9_-]+=1(?:;|$)/.test(document.cookie))` +
  `document.documentElement.setAttribute('${SIGNED_IN_ROOT_ATTRIBUTE}','')}catch(e){}`

/**
 * Flips the page to signed in or out without a reload: called where a visitor
 * signs in, signs up or signs out, and where the account page learns the
 * session was gone all along. A no-op outside a browser.
 */
export function markSignedIn(signedIn: boolean): void {
  if (typeof document === 'undefined') return
  if (signedIn) document.documentElement.setAttribute(SIGNED_IN_ROOT_ATTRIBUTE, '')
  else document.documentElement.removeAttribute(SIGNED_IN_ROOT_ATTRIBUTE)
}
