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
 * Ask the tenant runtime to drop one screen's cached HTML (AGL-1150).
 *
 * Publishing is a CLIENT write — the editor sets `screens/{id}.versionId`
 * directly — so there is no server step to hang this off. The browser cannot
 * call the tenant itself either: that route is secret-authenticated, and a
 * secret in a browser is not a secret. So the chain is
 *
 *     browser  →  here (the user's ID token, membership checked)
 *              →  tenant /api/revalidate (service secret)
 *
 * This route is the only place that holds both facts: who the caller is, and
 * what the tenant's cache key for that screen looks like.
 *
 * BEST EFFORT, ALWAYS. A publish has already succeeded by the time this is
 * called — the pointer is written and the page is live-but-stale. Failing here
 * must never make a successful publish look failed; the old 60-second window
 * is still underneath as the backstop, so the worst outcome is the behaviour
 * we had before.
 */

import { pluginRequestFromWeb, screenRoutePathToUrl } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

/** Roles that may publish, and therefore may bust a cache. */
const EDITORS = new Set(['admin', 'editor'])

const TENANT_DOMAIN =
  process.env['NEXT_PUBLIC_TENANT_DOMAIN'] ?? 'aglyn.app'

/** A publish should feel instant; a slow tenant must not hold the editor. */
const TIMEOUT_MS = 5000

export async function POST(request: Request): Promise<Response> {
  const { body: payload, headers: rawHeaders } = await pluginRequestFromWeb(request)
  // The same narrowing every other Bearer route here uses —
  // `pluginRequestFromWeb` types header values as `string | string[]`.
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = app.firestore()

    const hostId = String((payload as { hostId?: unknown })?.hostId ?? '')
    const screenId = String((payload as { screenId?: unknown })?.screenId ?? '')
    if (!hostId || !screenId) {
      return Response.json({ error: 'Missing hostId or screenId' }, { status: 400 })
    }

    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }

    // Re-checked here rather than trusted from the client. The Admin SDK
    // bypasses rules, so this route has to re-derive the same membership the
    // rules would have enforced — the standing pattern for every Admin-SDK
    // path in this app.
    const isStaff = Boolean(decoded['staff'])
    const role = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!isStaff && !EDITORS.has(String(role))) {
      // 404 rather than 403: a caller who cannot edit this site should not
      // learn that it exists.
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }

    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
    if (!subdomain) {
      return Response.json({ error: 'Site has no subdomain' }, { status: 409 })
    }

    // The routing map is `screenId → path`, and a screen not in it is not
    // routable — nothing to invalidate, which is a success, not an error.
    const screens = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
    const routePath = screens[screenId]
    if (!routePath) {
      return Response.json({ revalidated: [], reason: 'not-routed' }, { status: 200 })
    }

    const secret = process.env['REVALIDATE_SECRET']
    if (!secret) {
      // Say so rather than pretending. Without this the editor would report a
      // fast publish and the page would still take a minute, which is the
      // confusing half of the original bug.
      return Response.json(
        { revalidated: [], reason: 'not-configured' },
        { status: 200 },
      )
    }

    const url = `https://${subdomain}.${TENANT_DOMAIN}/api/revalidate`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': secret,
      },
      body: JSON.stringify({
        host: subdomain,
        paths: [screenRoutePathToUrl(routePath)],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('[screens/revalidate] tenant refused', response.status, result)
      return Response.json(
        { revalidated: [], reason: `tenant-${response.status}` },
        { status: 200 },
      )
    }
    return Response.json(
      { revalidated: result?.revalidated ?? [], reason: 'ok' },
      { status: 200 },
    )
  } catch (error) {
    // Never a 5xx to the editor. The publish already succeeded.
    console.error('[screens/revalidate] failed', error)
    return Response.json({ revalidated: [], reason: 'error' }, { status: 200 })
  }
}
