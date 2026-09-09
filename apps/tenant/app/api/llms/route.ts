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
  MARKDOWN_CONTENT_TYPE,
  buildLlmsTxt,
  hostPublicOrigin,
  isSearchDiscouraged,
} from '@aglyn/aglyn/server'
import { visitorContentRefusal } from '@aglyn/tenant-data-admin'
import getHost from '../../../utils/get-host'
import { readAgentSiteFacts } from '../_agent-site-facts'

export const dynamic = 'force-dynamic'

/**
 * Per-host `/llms.txt` (AGL-2716) — the first file an agent reads.
 *
 * The middleware rewrites `{tenant-site}/llms.txt` here with the resolved
 * tenant host, exactly as it does for `robots.txt` and `sitemap.xml`.
 *
 * ## Search-discouraged sites publish nothing here
 *
 * A site with "discourage search engines" on is telling automated readers to
 * leave it alone, and an agent is an automated reader. Serving it a curated
 * guide to the content would contradict the `Disallow: /` sitting in
 * `robots.txt` one file over — the exact self-contradiction `search-indexing`
 * exists to prevent. It answers 404 rather than an empty guide: an empty
 * `/llms.txt` is a file that exists and says the site has nothing, which an
 * agent may cache as a fact about the site rather than about its settings.
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
    `/api/llms?host=` call reaches this handler with the lock in
    force. This route serves a curated guide to the site’s content, so it is
    wired rather than recorded as a known-open read.

    Read-only locks are untouched — `lockdownBlocks(state, 'read')` is true only
    for a full lock — so a site that is still serving still answers here.
  */
  const down = await visitorContentRefusal({ hostId: host.$id })
  if (down) return down


  // The site's PUBLIC origin, never the domain this request arrived on
  // (AGL-1160): a site reachable on both its custom domain and `.aglyn.app`
  // must publish one answer about where it lives, and a cache keys on the URL
  // rather than the header — so a header-derived origin would let one cached
  // body advertise the wrong domain to everybody.
  const origin =
    hostPublicOrigin(host) ?? (requestHost ? `https://${requestHost}` : '')
  if (!origin) return new Response('Not found', { status: 404 })

  const facts = await readAgentSiteFacts(host)
  const body = buildLlmsTxt({
    siteName: host.seo?.title || host.displayName || 'Site',
    origin,
    description: host.seo?.description,
    agent: host.seo?.agent,
    pages: facts.pages,
    collections: facts.collections,
    hasSearch: facts.hasSearch,
    contactEmail: host.seo?.entity?.email,
  })

  return new Response(body, {
    status: 200,
    headers: {
      // `text/markdown`, because that is what the file IS — llmstxt.org
      // specifies a markdown document, and a reader that trusts the header
      // parses it rather than treating headings as literal hashes.
      'Content-Type': MARKDOWN_CONTENT_TYPE,
      'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
    },
  })
}
