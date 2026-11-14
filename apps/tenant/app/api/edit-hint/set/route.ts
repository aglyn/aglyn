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

// lockdown-423: exempt — the landing half of the login-time cookie bounce. It
// verifies a signed blob and plants two browser cookies on `.aglyn.app`; no
// Firestore read, no Firestore write, no org data. The hint is worthless on its
// own — it names a uid and nothing more — and is redeemed at
// `/api/edit-access/exchange`, which is where the lockdown verdict runs.

import {
  mintEditHintToken,
  verifyEditHintToken,
} from '@aglyn/tenant-data-admin'
import {
  consoleReturnTarget,
  plantEditHintCookies,
} from '../../../../utils/edit-hint-cookies'

export const dynamic = 'force-dynamic'

/**
 * The landing half of the login-time hint bounce (AGL-1842).
 *
 * The console (`app.aglyn.com`) cannot set a `.aglyn.app` cookie — different
 * registrable domain — but a TOP-LEVEL navigation through this route can:
 * the console sends the signed bounce blob here in the URL, this route
 * verifies it, plants the hint cookies first-party on `Domain=.aglyn.app`,
 * and 302s the browser straight back. The whole trip is one redirect flash,
 * paid only by signed-in console editors.
 *
 * Two cookies, two jobs:
 *
 * - `aglyn_editor=1` — the AGL-1829 marker, JS-visible, the exact signal the
 *   admin-bar stub already arms on (`hasEditorHint`); nothing in the stub
 *   changes.
 * - `aglyn_edit_hint=<signed>` — HttpOnly, so no tenant page's scripts (ours
 *   or a site author's) can read it; it travels only to the tenant's own
 *   `/api/edit-access/exchange`, which verifies it server-side and
 *   re-authorizes the uid against the specific host being viewed.
 *
 * The `return` URL is where an open redirect would live, and an open
 * redirect on an `aglyn.app` URL is a phishing primitive — so it is checked
 * against the console-origin allowlist FIRST, and an off-list target is a
 * flat 400: no redirect, no cookies, nothing to launder. A bad or expired
 * `sig`, by contrast, redirects back WITHOUT cookies: the blob lives for
 * seconds, so an editor whose bounce raced its expiry must land back on the
 * console, not on an error page — the next throttle window retries.
 *
 * Serving host: the designated bounce target is `console.aglyn.app`
 * (reserved in `RESERVED_SUBDOMAINS`, so no customer can own it; `/api/*`
 * is outside the tenant middleware's matcher, so tenant resolution never
 * interferes) — but the cookie write itself is gated on the REQUEST host
 * being inside `aglyn.app`, because a bounce arriving on a customer's
 * custom domain must plant nothing there.
 */

export async function GET(request: Request): Promise<Response> {
  const sig = new URL(request.url).searchParams.get('sig')

  // The redirect target is validated BEFORE anything else: refusing to
  // forward is the one behaviour that must survive every other branch. The
  // allowlist, and why it is a subdomain test and never a suffix test, lives
  // with `consoleReturnTarget`.
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

  const claims = verifyEditHintToken('bounce', sig)
  if (claims) {
    // Re-mint as the long-lived COOKIE kind (the bounce blob itself must
    // never live past this redirect; kind separation is the replay wall),
    // carrying the browser binding UNCHANGED. `iat` stays the bounce's own
    // mint time, so a bounce that lands after this browser signed out of the
    // console is still dated before the sign-out and the exchange refuses it.
    const { token } = mintEditHintToken(
      'cookie',
      claims.uid,
      Date.now(),
      claims.did && claims.iat ? { did: claims.did, iat: claims.iat } : undefined,
    )
    // Cookie writes only on our own apex (or a dev host): a bounce that
    // somehow arrives on a customer's custom domain forwards and plants
    // nothing there.
    plantEditHintCookies(headers, request, token)
  }

  return new Response(null, { status: 302, headers })
}
