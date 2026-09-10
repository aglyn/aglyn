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
  buildAgentOpenApi,
  hostPublicOrigin,
  isSearchDiscouraged,
  platformVersion,
} from '@aglyn/aglyn/server'
import { visitorContentRefusal } from '@aglyn/tenant-data-admin'
import getHost from '../../../utils/get-host'
import { readAgentSiteFacts } from '../_agent-site-facts'

export const dynamic = 'force-dynamic'

/**
 * Per-host `/openapi.json` (AGL-2716) — the machine-readable description of
 * what this site serves.
 *
 * Generated per site rather than checked in, for the reason `buildAgentOpenApi`
 * gives at length: `servers[0].url` has to name THIS origin, and a static file
 * would name one site's domain on every site on the platform.
 *
 * Withheld from a search-discouraged site on the same reasoning as
 * `/llms.txt` — a site that has asked automated readers to leave it alone
 * should not be handing them an index of its endpoints.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requestHost = request.headers.get('host') ?? ''
  const tenantHost = String(
    request.headers.get('x-aglyn-tenant-host') ?? url.searchParams.get('host') ?? '',
  )
  if (!tenantHost) return new Response('Missing host', { status: 400 })

  const { host, error } = await getHost({ host: tenantHost })
  if (error || !host) return new Response('Not found', { status: 404 })
  if (isSearchDiscouraged(host)) return new Response('Not found', { status: 404 })
  /*
    A LOCKED SITE MUST NOT PUBLISH THROUGH ITS OWN TAKEDOWN (AGL-2495).

    The middleware's matcher excludes `/api`, so the public path being rewritten
    to `/api/locked` protects only the public path: a direct
    `/api/openapi?host=` call reaches this handler with the lock in
    force. This route serves an index of the site’s endpoints, so it is
    wired rather than recorded as a known-open read.

    Read-only locks are untouched — `lockdownBlocks(state, 'read')` is true only
    for a full lock — so a site that is still serving still answers here.
  */
  const down = await visitorContentRefusal({ hostId: host.$id })
  if (down) return down


  const origin =
    hostPublicOrigin(host) ?? (requestHost ? `https://${requestHost}` : '')
  if (!origin) return new Response('Not found', { status: 404 })

  const facts = await readAgentSiteFacts(host)
  const document = buildAgentOpenApi({
    siteName: host.seo?.title || host.displayName || 'Site',
    origin,
    description: host.seo?.description,
    collections: facts.collections,
    hasSearch: facts.hasSearch,
    // The PLATFORM version, so two documents from different deploys are
    // distinguishable. Not a version of the site's content — a spec version
    // that moved every time an author saved a page would be noise.
    version: platformVersion(),
    contactEmail: host.seo?.entity?.email,
  })

  return new Response(JSON.stringify(document, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
      // Anonymous, read-only and cross-origin by nature: a browser-based agent
      // reading this document from another origin is the common case, and
      // there is nothing here that is not already public.
      'Access-Control-Allow-Origin': '*',
    },
  })
}
