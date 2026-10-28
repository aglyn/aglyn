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

import * as Aglyn from '@aglyn/aglyn/server'
import { getSiteLockdown } from '@aglyn/tenant-data-admin'
import { serverPluginLoader } from '../../../utils/server-plugin-loader'
import { getHost } from '../../../utils/get-host'
import { getOrgBilling } from '../../../utils/get-org-billing'

export const dynamic = 'force-dynamic'

/**
 * Does this path on this site redirect? The middleware's proxy for site
 * redirect rules, so a redirect can keep the visitor's query string.
 *
 * The page loader already applies the rules, but from an ISR-cached render
 * keyed on the PATH: it never sees the query, so a visitor who arrived at a
 * short link with parameters of their own (`/booth?ref=flyer`) lost them at the
 * redirect. The edge middleware does see the query, but cannot read Firestore,
 * so for a request that carries one it asks this Node route — the same
 * fetch-a-verdict pattern as `/api/lockdown-verdict` — and builds the redirect
 * itself with `withVisitorQuery`. A request with no query never comes here; the
 * loader's redirect serves it exactly as before.
 *
 * The answer comes from the SAME resolver the loader calls
 * (`Aglyn.resolveSiteRedirect`), so the paid gate, the phishing hold on an
 * off-site rule and the rule cache all apply unchanged; this route only moves
 * where the answer is turned into a response.
 *
 * Unauthenticated by design: a redirect is observable by loading the address,
 * and the body carries only the destination the site would send anyone to.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = url.searchParams.get('host') ?? ''
  const path = url.searchParams.get('path') ?? ''
  if (!host || host.includes('/') || !path.startsWith('/')) {
    return Response.json({ error: 'Missing host or path' }, { status: 400 })
  }
  try {
    const hostRes = await getHost({ host })
    const hostId = hostRes.host?.$id as string | undefined
    if (!hostId) return noRedirect()
    // A locked site redirects nowhere. The middleware asks only after its own
    // lockdown verdict has let the request through, so this is the direct
    // `/api` request's guard and the two agree.
    if (await siteLocked(hostId)) return noRedirect()
    const orgRes = await getOrgBilling({ hostId })
    // The redirect hook registers through the server manifest, as it does for
    // the page loader.
    await serverPluginLoader.ensureAll(['tenantApi'])
    const slugSegments = path
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment)
        } catch {
          return segment
        }
      })
    const rule = await Aglyn.resolveSiteRedirect({
      hostId,
      host: hostRes.host,
      org: orgRes.org,
      path: slugSegments.length ? slugSegments.join('/') : Aglyn.SCREEN_ROOT_PATH,
      slugSegments,
    })
    if (!rule) return noRedirect()
    return Response.json(
      { destination: rule.destination, statusCode: rule.statusCode },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // Fail toward the page: no verdict means the request is rewritten to the
    // page as before, and the loader's own redirect (without the query) still
    // fires — a rule is never lost, only the pass-through for one request.
    console.error('redirect verdict failed', error)
    return noRedirect()
  }
}

function noRedirect(): Response {
  return Response.json(
    { destination: null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Is this site under an active lock? */
async function siteLocked(hostId: string): Promise<boolean> {
  return (await getSiteLockdown(hostId)) !== null
}
