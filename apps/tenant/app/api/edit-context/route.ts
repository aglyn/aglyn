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
  buildRoute,
  findScreenIdByRoutePath,
  Route,
  SCREEN_ROOT_PATH,
} from '@aglyn/aglyn/server'
import type * as Aglyn from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  hostConverter,
  isServerReleaseFlagOnForOrg,
  screenConverter,
  verifyEditAccessToken,
} from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

const CONSOLE_ORIGIN =
  process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'

/**
 * Resolves the admin bar's edit context for the page being viewed (admin
 * edit bar, AGL-1302 follow-on).
 *
 * The caller presents the signed token the console's `/api/edit-access/token`
 * minted after verifying edit access first-party — this route trusts NOTHING
 * else about the client. It verifies the signature and expiry, re-checks the
 * release flag (the revocation lever for outstanding tokens), confirms the
 * token's host actually answers to the domain the request arrived on, and
 * only then maps the current path through the host's routing map to the
 * screen serving it — the same `hosts.screens` map the page render uses,
 * WITHOUT importing the page loader (deliberate: this is a tiny, dynamic
 * read; the loader is an ISR-cached composition keyed for a different job).
 *
 * The response is routing facts plus console deep links: nothing here is
 * content, and the screen/version ids it returns for a PUBLISHED page are
 * already derivable from the page's own HTML. The value being protected is
 * the capability signal ("you can edit this"), which the token carries.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    token?: unknown
    path?: unknown
  } | null
  const claims = verifyEditAccessToken(body?.token)
  if (!claims) {
    return Response.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostSnapshot = await firestore
      .collection('hosts')
      .withConverter(hostConverter)
      .doc(claims.hostId)
      .get()
    const host = hostSnapshot.exists
      ? (hostSnapshot.data() as Aglyn.AglynHost)
      : null
    if (!host) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const hostDoc = host as Aglyn.AglynHost & {
      orgId?: string
      subdomain?: string
      cname?: string
      displayName?: string
      screens?: Record<string, string>
    }

    // Outstanding tokens die the moment the flag flips off — this check is
    // the "trivial revocation" the scheme promises.
    if (
      !(await isServerReleaseFlagOnForOrg('release_edit_bar', hostDoc.orgId))
    ) {
      return Response.json({ error: 'Not available' }, { status: 404 })
    }

    // The token names a host; the request arrived on a domain. They must be
    // the same site, or a page could redeem a token minted for a different
    // one. Off the real domains (localhost, vercel.app previews — where the
    // host resolves via the ?tenantHost= override) the check would only
    // refuse legitimate testing, so it applies to production hostnames.
    const hostname = (request.headers.get('host') ?? '')
      .split(':')[0]
      .toLowerCase()
    const isProductionAlias =
      hostname === hostDoc.cname ||
      (hostDoc.subdomain && hostname === `${hostDoc.subdomain}.aglyn.app`)
    const isDevOrPreview =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.vercel.app') ||
      process.env.NODE_ENV !== 'production'
    if (!isProductionAlias && !isDevOrPreview) {
      return Response.json({ error: 'Wrong site' }, { status: 403 })
    }

    // Routing-map form: root is '/', everything else is slash-joined
    // segments without a leading slash (see SCREEN_ROOT_PATH).
    const rawPath = typeof body?.path === 'string' ? body.path : '/'
    const normalized =
      rawPath.split('?')[0].replace(/^\/+|\/+$/g, '') || SCREEN_ROOT_PATH
    const screenId = findScreenIdByRoutePath(hostDoc.screens, normalized)

    let screenName: string | undefined
    let versionId: string | undefined
    if (screenId) {
      const screenSnapshot = await firestore
        .collection('hosts')
        .doc(claims.hostId)
        .collection('screens')
        .withConverter(screenConverter)
        .doc(screenId)
        .get()
      if (screenSnapshot.exists) {
        const screen = screenSnapshot.data() as Aglyn.AglynScreen
        screenName = screen?.displayName
        // The screen doc's versionId is the LIVE version pointer — exactly
        // the version the visitor is looking at, so exactly where the
        // besigner should open.
        versionId = screen?.versionId
      }
    }

    // Console links need the org SLUG (buildRoute refuses to emit a route
    // without it — AGL-621) and the host SUBDOMAIN (the `[host]` segment is
    // the subdomain; HostIdProvider resolves it back to the doc id).
    let orgSlug: string | undefined
    if (hostDoc.orgId) {
      const orgSnapshot = await firestore
        .collection('orgs')
        .doc(hostDoc.orgId)
        .get()
      orgSlug = orgSnapshot.get('slug') as string | undefined
    }

    const canLink = Boolean(orgSlug && hostDoc.subdomain)
    const consoleUrl = canLink
      ? `${CONSOLE_ORIGIN}${buildRoute(Route.HOST_DASHBOARD, {
          orgSlug: orgSlug as string,
          host: hostDoc.subdomain as string,
        })}`
      : CONSOLE_ORIGIN
    const editUrl =
      canLink && screenId && versionId
        ? `${CONSOLE_ORIGIN}${buildRoute(Route.SCREEN_BESIGNER, {
            orgSlug: orgSlug as string,
            host: hostDoc.subdomain as string,
            screenId,
            versionId,
          })}`
        : null

    return Response.json(
      {
        siteName: hostDoc.displayName ?? hostDoc.subdomain,
        screenId: screenId ?? null,
        screenName: screenName ?? null,
        versionId: versionId ?? null,
        editUrl,
        consoleUrl,
        expiresAtMs: claims.exp,
      },
      // Per-visitor capability data — never cacheable.
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Could not resolve context' }, { status: 500 })
  }
}
