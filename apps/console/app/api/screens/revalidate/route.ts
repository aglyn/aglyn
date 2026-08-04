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
import {
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
} from '../../../../utils/server/scan-artifact-usage'
import { readUsageCandidates } from '../../../../utils/server/read-usage-candidates'

export const dynamic = 'force-dynamic'

/** Roles that may publish, and therefore may bust a cache. */
const EDITORS = new Set(['admin', 'editor'])

/**
 * Every live screen that renders inside `layoutId`, however deep (AGL-1150).
 *
 * Layouts NEST — a screen points at a layout, and that layout can point at a
 * parent layout, which `compose-screen-nodes` walks when composing. So the
 * dependents of a published layout are not just the screens bound directly to
 * it: a screen three levels down renders its chrome too, and shows stale
 * chrome for the whole revalidate window if it is missed.
 *
 * The walk itself is `screenIdsUsingLayoutDeep`, kept pure and tested next to
 * `scanLayoutUsage`; this only does the Firestore read it needs.
 */
async function screenIdsUsingLayout(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  layoutId: string,
): Promise<string[]> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  // Read each collection ONCE and walk in memory. The alternative — a query
  // per level — multiplies round trips by the nesting depth on a path that
  // runs while someone waits for a publish to feel instant.
  const [screenDocs, layoutDocs] = await Promise.all([
    hostRef.collection('screens').get(),
    hostRef.collection('layouts').get(),
  ])
  const toCandidate = (doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
    id: doc.id,
    displayName: doc.get('displayName'),
    name: doc.get('name'),
    deletedAt: doc.get('deletedAt'),
    layoutId: doc.get('layoutId'),
    versionId: doc.get('versionId'),
  })
  return screenIdsUsingLayoutDeep(
    layoutId,
    screenDocs.docs.map(toCandidate),
    layoutDocs.docs.map(toCandidate),
  )
}

/**
 * Every live screen whose output contains `componentId` (AGL-1161).
 *
 * Unlike the layout walk, which matches a `layoutId` POINTER on small docs,
 * this searches node trees — so it has to load the published version body of
 * every screen and layout on the site. That is the cost the issue flagged, and
 * why the caller fires this without awaiting: nobody is staring at one URL
 * waiting for a component publish the way they are for a screen publish.
 *
 * The walk itself is `screenIdsUsingComponentDeep`, kept pure and tested; this
 * only does the Firestore read it needs, through the same reader
 * `/api/hosts/where-used` uses so there is one node-decode implementation.
 */
async function screenIdsUsingComponent(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  componentId: string,
): Promise<{ screenIds: string[]; truncated: boolean }> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  // Each collection ONCE, walked in memory — a query per level would multiply
  // round trips by the nesting depth of the component graph.
  const [screens, layouts, components] = await Promise.all([
    readUsageCandidates(hostRef, 'screens', { withNodes: true, limit: SCAN_LIMIT }),
    readUsageCandidates(hostRef, 'layouts', { withNodes: true, limit: SCAN_LIMIT }),
    readUsageCandidates(hostRef, 'components', {
      withNodes: true,
      limit: SCAN_LIMIT,
    }),
  ])
  return {
    screenIds: screenIdsUsingComponentDeep(componentId, {
      screens: screens.candidates,
      layouts: layouts.candidates,
      components: components.candidates,
    }),
    truncated: screens.truncated || layouts.truncated || components.truncated,
  }
}

/**
 * How many documents per collection the component scan will read (AGL-1161).
 *
 * Far above the 200 `/api/hosts/where-used` uses, because the two are asked
 * different questions. That endpoint is advisory — a partial "what would I
 * break" is still useful. This one decides which caches get dropped, so a
 * prefix scan reports a successful publish and leaves real pages serving the
 * old component for the full revalidate window.
 *
 * Still bounded, because unbounded is its own failure: a site with tens of
 * thousands of screens would hold the request open reading version bodies.
 * When the bound bites we SAY so rather than quietly returning a short list —
 * the same choice `4b1120649` made for the tenant route's path cap.
 */
const SCAN_LIMIT = 2000

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
    // Publishing a LAYOUT changes every screen rendered inside it (AGL-1150).
    // The caller names what it published; working out which URLs that affects
    // is this route's job, because it is the only side holding both the
    // layout→screen graph and the tenant's cache keys.
    const layoutId = String((payload as { layoutId?: unknown })?.layoutId ?? '')
    // Publishing a COMPONENT changes every screen that renders it, directly,
    // nested inside another component, or through a layout (AGL-1161).
    const componentId = String(
      (payload as { componentId?: unknown })?.componentId ?? '',
    )
    if (!hostId || (!screenId && !layoutId && !componentId)) {
      return Response.json(
        {
          error:
            'Missing hostId, and one of screenId, layoutId or componentId',
        },
        { status: 400 },
      )
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

    let scanTruncated = false
    let affectedScreenIds: string[]
    if (componentId) {
      const scan = await screenIdsUsingComponent(firestore, hostId, componentId)
      affectedScreenIds = scan.screenIds
      scanTruncated = scan.truncated
    } else if (layoutId) {
      affectedScreenIds = await screenIdsUsingLayout(firestore, hostId, layoutId)
    } else {
      affectedScreenIds = [screenId]
    }

    const routePaths = affectedScreenIds
      .map((id) => screens[id])
      .filter((path): path is string => Boolean(path))

    if (scanTruncated) {
      // Say it, in the log and in the response. A publish that scanned a
      // prefix of the site and reported success is the failure this whole
      // arc exists to remove — it looks identical to a complete drop, and
      // the pages it missed sit stale for the full window with nothing
      // anywhere recording that they were skipped.
      console.warn(
        JSON.stringify({
          tag: 'AGL-1161:component-scan-truncated',
          hostId,
          componentId,
          limit: SCAN_LIMIT,
        }),
      )
    }

    if (!routePaths.length) {
      // A layout no live screen renders inside, an unused component, or an
      // unrouted screen. Nothing to invalidate is a success, not an error.
      return Response.json(
        { revalidated: [], reason: 'not-routed', truncated: scanTruncated },
        { status: 200 },
      )
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
        paths: routePaths.map((path) => screenRoutePathToUrl(path)),
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
      {
        revalidated: result?.revalidated ?? [],
        reason: 'ok',
        // Carried through so a caller can tell a complete drop from one that
        // only covered part of the site.
        truncated: scanTruncated,
        // The tenant route caps paths too, and says when it drops some
        // (AGL-1161). Pass that on rather than absorbing it here.
        ...(result?.truncated ? { pathsDropped: result.truncated } : {}),
      },
      { status: 200 },
    )
  } catch (error) {
    // Never a 5xx to the editor. The publish already succeeded.
    console.error('[screens/revalidate] failed', error)
    return Response.json({ revalidated: [], reason: 'error' }, { status: 200 })
  }
}
