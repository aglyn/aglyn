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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { siteLiveUrlForSlug } from '@aglyn/aglyn/app-utils/site-live-url'
import {
  SITE_PREVIEW_ENTER_PATH,
  sitePreviewReturnPath,
} from '@aglyn/aglyn/app-utils/site-preview'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { mintSitePreviewToken } from '@aglyn/tenant-data-admin/server/site-preview-token'
import { siteViewRefusal } from '@aglyn/tenant-data-admin/server/site-view-authz'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

// lockdown-423: exempt — signs a two-minute link and writes nothing. What the
// link opens is answered by the tenant, whose middleware verdict and loader
// lockdown branch both run before a site in preview renders for anyone.

/**
 * Mint the link that opens a site in preview on its own address (AGL-4086).
 *
 * A custom domain is cross-site with every console cookie, so "I am signed in,
 * show me my site" cannot be answered by a session there. What crosses is a
 * URL: `https://{the site}/api/site-preview/enter?blob=…&return=/…`, with a
 * two-minute blob bound to the site. The tenant plants a 12-hour cookie on
 * that host alone and verifies it on every request after.
 *
 * Who: the site's team — anyone the console lets open the site — or Aglyn
 * staff, by the `staff` claim on the verified ID token. The same question the
 * tenant asks of an edit hint (`siteViewRefusal`), so the two doors cannot
 * disagree about who the team is.
 *
 * The ORIGIN is the site's own public address, read from the host document,
 * never from the caller: a caller-chosen origin would put a valid blob on a
 * link pointing anywhere. The `return` path is checked to stay on that origin.
 *
 * Body: `{ hostId, path? }`. Answers `{ url, expiresAtMs }`.
 */
/** The hostname the console was reached at, which decides where its links point. */
function consoleHostname(request: Request): string | undefined {
  try {
    return new URL(request.url).hostname
  } catch {
    return undefined
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  const returnPath = sitePreviewReturnPath(
    typeof body?.path === 'string' ? body.path : '/',
  )

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const refusal = await siteViewRefusal({
      firestore,
      host,
      uid: decoded.uid,
      staff: decoded['staff'] === true,
    })
    if (refusal) {
      return Response.json({ error: 'You are not on this site’s team' }, { status: 403 })
    }
    // The site as THIS console reaches it, by the rule every "view the site"
    // link follows (`siteLiveUrlForSlug`, as the entry preview link does since
    // #2749): a deployed console links the site's public origin (the custom
    // domain first), a local console the local tenant and a preview console
    // the tenant preview deployment, each naming the site with
    // `?tenantHost=`. Built from the console host the request reached, never
    // from the body. This route used `hostPublicOrigin` alone, so a local or
    // preview console sent its team to the PRODUCTION site.
    const enterUrl = siteLiveUrlForSlug(
      {
        cname: host.get('cname') as string | undefined,
        subdomain: host.get('subdomain') as string | undefined,
      },
      SITE_PREVIEW_ENTER_PATH,
      consoleHostname(request),
    )
    if (!enterUrl) {
      return Response.json({ error: 'Site has no public address yet' }, { status: 409 })
    }
    const { token, expiresAtMs } = mintSitePreviewToken('enter', hostId)
    const url = new URL(enterUrl)
    url.searchParams.set('blob', token)
    url.searchParams.set('return', returnPath)
    return Response.json(
      { url: url.toString(), expiresAtMs },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Could not open the preview' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
