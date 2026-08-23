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

import {
  ACTIVITY_COOKIE,
  ACTIVITY_COOKIE_MAX_AGE_S,
  encodeActivity,
  parseActivity,
} from './session-activity'
// Shared, not a local copy: an empty duplicate cookie at another scope used to
// shadow the real heartbeat here, which reads as `at: 0` and quietly disables
// the AGL-697 idle-logout control (AGL-1259 fixed the session route only).
import { readCookie, requestIsHttps } from '../read-cookie'
import { sameOriginRefusal } from '../../_lib/same-origin'

// lockdown-423: exempt — account-scoped read of the caller's own auth activity; no org
// context. The session mint/exchange carry the lockdown gate for auth.

export const dynamic = 'force-dynamic'

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

/**
 * Server-authoritative last-activity for idle expiry (AGL-697). `POST`
 * records a heartbeat — every signed-in tab on any `.aglyn.com` origin beats
 * here on real user input, so the HttpOnly parent-domain cookie set below is
 * a session-wide "last-seen" no single tab could otherwise observe. `GET`
 * reports it, so a tab that believes itself idle can confirm the WHOLE
 * session is idle before retiring the shared `__session` cookie for every
 * subdomain — the global sign-out AGL-697 is about.
 *
 * The cookie is HttpOnly (a foreign origin can neither read nor forge it)
 * and mirrors the session cookie's scope: `Domain=.aglyn.com` only on a
 * workspace host, so localhost dev still works.
 *
 * `Secure` is a SEPARATE question from `Domain`, and answering both with one
 * ternary was a bug (AGL-1881). A white-label console on
 * `console.acme-agency.com` (AGL-1099) is not a workspace host, so it took
 * neither branch and this cookie went out over HTTPS unmarked. It carries no
 * credential — it is a timestamp — but it is the ONLY input to the AGL-697
 * idle-logout control, and `POST` here is deliberately authless, so a
 * non-`Secure` cookie is one a network attacker can plant over plaintext to
 * hold a victim's idle window open indefinitely, or slam it shut.
 *
 * This is the same defect the session route fixed for `__session` (AGL-1353
 * D6) and the second time this file has trailed it, which is why
 * `requestIsHttps` is now imported rather than re-derived — see the note on
 * it in `../read-cookie`.
 */
function activityCookie(request: Request, valueMs: number): string {
  const host = String(request.headers.get('host') ?? '').split(':')[0]
  const onWorkspaceDomain =
    host === WORKSPACE_DOMAIN || host.endsWith(`.${WORKSPACE_DOMAIN}`)
  return [
    `${ACTIVITY_COOKIE}=${encodeActivity(valueMs)}`,
    'Path=/',
    `Max-Age=${ACTIVITY_COOKIE_MAX_AGE_S}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`] : []),
    ...(requestIsHttps(request) ? ['Secure'] : []),
  ].join('; ')
}

async function handler(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    // SELF-SCOPED IS NOT THE SAME AS SAFE (AGL-1881).
    //
    // This stayed authless on the reasoning that "an unauthenticated beat sets
    // a cookie that governs nothing", which is true of the CALLER's session
    // and false of the VICTIM's. A cross-site auto-submitting form POST is a
    // top-level navigation to our origin, so the `Set-Cookie` below lands in
    // the victim's browser as a first-party cookie for the whole parent
    // domain — and this cookie is the only input to the AGL-697 idle-logout
    // decision (`use-idle-logout` reads it, `isSessionIdle` compares against
    // it). One visit to an attacker's page therefore holds a signed-in
    // victim's idle window open, which is precisely the unattended-machine
    // threat the control exists for.
    //
    // Auth is still the wrong gate here, for the reason the original note
    // gives: in dev the cross-subdomain `__session` cookie is never minted.
    // The right gate is the one that distinguishes our own page from a
    // foreign one, and it already existed — `sameOriginRefusal`, fail-closed
    // on a missing `Origin`, wired until now to exactly one route. The
    // heartbeat is a same-origin `fetch`, which always sends `Origin` on a
    // POST, so nothing legitimate is refused.
    const refused = sameOriginRefusal(request)
    if (refused) return refused

    const now = Date.now()
    const response = Response.json({ ok: true, at: now }, { status: 200 })
    response.headers.set('Set-Cookie', activityCookie(request, now))
    return response
  }

  if (request.method === 'GET') {
    const at = parseActivity(readCookie(request, ACTIVITY_COOKIE))
    return Response.json({ at }, { status: 200 })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}

export { handler as GET, handler as POST }
