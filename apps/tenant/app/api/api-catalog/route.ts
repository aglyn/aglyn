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
  API_CATALOG_MEDIA_TYPE,
  buildAgentApiCatalog,
  hostPublicOrigin,
  isSearchDiscouraged,
} from '@aglyn/aglyn/server'
import { visitorContentRefusal } from '@aglyn/tenant-data-admin'
import getHost from '../../../utils/get-host'
import { publicReadApiGate, withPublicReadHeaders } from '../_public-read-api'

export const dynamic = 'force-dynamic'

/*
  The operator's own console and docs, with Aglyn's as the default.

  Same shape and same two variables as `api/edit-context/route.ts` and the
  middleware's console redirect, deliberately: a self-hoster who has already
  pointed those at their own deployment does not have to discover a third name
  to keep this document honest. The literals are the fallback for Aglyn's own
  cloud, where neither variable is set on the tenant project.
*/
const CONSOLE_ORIGIN = (
  process.env.NEXT_PUBLIC_CONSOLE_URL || 'https://app.aglyn.com'
).replace(/\/+$/, '')
const DOCS_ORIGIN = (
  process.env.NEXT_PUBLIC_DOCS_ORIGIN ||
  process.env.NEXT_PUBLIC_AGLYN_DOCS_URL ||
  'https://docs.aglyn.com'
).replace(/\/+$/, '')

/**
 * The site's API catalog (RFC 9727), served at `/.well-known/api-catalog`.
 *
 * Two APIs answer for a site's data and they are not interchangeable. This
 * site's own `/openapi.json` describes what the SITE serves — its pages, feeds
 * and sitemap — and is anonymous and read-only. The platform's `/api/v1`
 * describes the same customer's records as typed JSON, takes an API key, and
 * writes. An agent that finds only the first concludes there is no write API;
 * an agent that finds only the second cannot read the pages. The catalog is
 * the one document that names both.
 *
 * Gated exactly like `/api/openapi`, and for the same reason: a site that has
 * asked not to be indexed, or that is under a full lockdown, must not publish
 * an index of its own endpoints through the refusal.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = publicReadApiGate(request)
  if (gate.refusal) return gate.refusal

  const url = new URL(request.url)
  const requestHost = request.headers.get('host') ?? ''
  const tenantHost = String(
    request.headers.get('x-aglyn-tenant-host') ?? url.searchParams.get('host') ?? '',
  )
  if (!tenantHost) return new Response('Missing host', { status: 400 })

  const { host, error } = await getHost({ host: tenantHost })
  if (error || !host) return new Response('Not found', { status: 404 })
  if (isSearchDiscouraged(host)) return new Response('Not found', { status: 404 })

  const down = await visitorContentRefusal({ hostId: host.$id })
  if (down) return down

  const origin =
    hostPublicOrigin(host) ?? (requestHost ? `https://${requestHost}` : '')
  if (!origin) return new Response('Not found', { status: 404 })

  const document = buildAgentApiCatalog({
    origin,
    apis: [
      {
        url: `${origin}/`,
        title: host.seo?.title || host.displayName || 'This site',
        specUrl: `${origin}/openapi.json`,
        // `/llms.txt` is this site's documentation for a reader that is not a
        // person: it is prose, it is the file an agent already looks for, and
        // there is no human handbook for one customer's site to point at.
        docsUrl: `${origin}/llms.txt`,
        docsType: 'text/markdown',
        statusUrl: `${origin}/api/health`,
      },
      {
        url: `${CONSOLE_ORIGIN}/api/v1`,
        title: 'Aglyn platform API',
        specUrl: `${CONSOLE_ORIGIN}/api/v1/openapi.json`,
        docsUrl: `${DOCS_ORIGIN}/api`,
      },
    ],
  })

  return withPublicReadHeaders(
    new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        'Content-Type': `${API_CATALOG_MEDIA_TYPE}; charset=utf-8`,
        'Cache-Control': 's-maxage=300, stale-while-revalidate=3600',
        // Anonymous, read-only, and read cross-origin by nature — see the same
        // note on `/api/openapi`.
        'Access-Control-Allow-Origin': '*',
      },
    }),
    gate.headers,
  )
}
