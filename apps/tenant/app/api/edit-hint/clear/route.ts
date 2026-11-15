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

// lockdown-423: exempt — the sign-out half of the hint bounce. It only
// expires the two `.aglyn.app` hint cookies and redirects back to the console;
// no Firestore read, no Firestore write, no org data, and it can only take
// edit access away, never grant it.

import {
  clearEditHintCookies,
  consoleReturnTarget,
} from '../../../../utils/edit-hint-cookies'

export const dynamic = 'force-dynamic'

/**
 * The sign-out mirror of `/api/edit-hint/set` (AGL-1842 follow-on).
 *
 * Console sign-out cannot touch `.aglyn.app` cookies, for the same reason the
 * sign-in could not plant them: different registrable domain. So the
 * console's `/signout` page sends the browser on one top-level trip through
 * here, which expires `aglyn_edit_hint` and `aglyn_editor` first-party and
 * 302s straight back to the console's sign-in page. The sites this browser
 * visits next have no hint, so the bar never arms, and a token the bar stored
 * from the hint is dropped on the next page view.
 *
 * This trip is the tidy half, not the security half. A tab closed mid-sign-out
 * never makes it, so the sign-out itself also records the ending server-side
 * (`users/{uid}/editHintEnds/{did}`), and the exchange and `/api/edit-context`
 * refuse what it ended and clear these cookies themselves.
 *
 * Same allowlist as `set`, checked FIRST: an off-list `return` is a flat 400
 * with no redirect and no cookie change, because an open redirect on an
 * `aglyn.app` URL is a phishing primitive. No signature is asked for. All this
 * route can do is sign a browser's site edit bar out, which anyone could
 * already do by clearing their own cookies.
 */
export async function GET(request: Request): Promise<Response> {
  const destination = consoleReturnTarget(request)
  if (!destination) {
    return new Response('Invalid return target', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const headers = new Headers({
    Location: destination.toString(),
    'Cache-Control': 'no-store',
  })
  // Off the tenant apex (a customer's custom domain) this writes nothing:
  // the hint was never planted there.
  clearEditHintCookies(headers, request)
  return new Response(null, { status: 302, headers })
}
