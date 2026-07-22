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

export const dynamic = 'force-dynamic'

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Server-authoritative last-activity for idle expiry (AGL-697). `POST`
 * records a heartbeat — every signed-in tab on any `.aglyn.io` origin beats
 * here on real user input, so the HttpOnly parent-domain cookie set below is
 * a session-wide "last-seen" no single tab could otherwise observe. `GET`
 * reports it, so a tab that believes itself idle can confirm the WHOLE
 * session is idle before retiring the shared `__session` cookie for every
 * subdomain — the global sign-out AGL-697 is about.
 *
 * The cookie is HttpOnly (a foreign origin can neither read nor forge it)
 * and mirrors the session cookie's scope: `Domain=.aglyn.io` + `Secure`
 * only on the real deployment, so localhost dev still works.
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
    ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`, 'Secure'] : []),
  ].join('; ')
}

function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get('cookie')
  if (!raw) return undefined
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).trim() === name) {
      return pair.slice(index + 1).trim()
    }
  }
  return undefined
}

async function handler(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    // The activity cookie only ever extends the caller's OWN idle window, so
    // recording a heartbeat is self-scoped and needs no auth check — an
    // unauthenticated beat sets a cookie that governs nothing (the idle hook
    // is armed only while signed in). Keeping it authless also means dev,
    // where the cross-subdomain `__session` cookie is never minted, behaves
    // the same as the real deployment.
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
