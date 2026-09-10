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
 * Customer REST API v1 catch-all (AGL-617). Console middleware already
 * excludes `/api/**`, so this group carries its own API-key auth (never the
 * console session chokepoint). This file owns the pipeline (auth, entitlement,
 * rate limit, error envelope); resource handlers are wired in AGL-618.
 */
import { buildDocsUrl } from '../../../../constants/docs-links'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { ApiErrors, apiJson } from '@aglyn/tenant-data-admin'
import { authenticateApiV1 } from '../../../../utils/api-v1'
import {
  buildCustomerApiOpenApi,
  CUSTOMER_API_OPENAPI_PATH,
} from '../../../../utils/api-v1-openapi'
import { dispatchResource, handleUsage } from '../../../../utils/api-v1-resources'

// lockdown-423: via apps/console/utils/api-v1.ts — every /v1 dispatch
// authenticates there, and the verdict runs beside the org-doc read.

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ route?: string[] }> }

async function dispatch(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const { route } = await routeContext.params
  const segments = route ?? []

  /*
    The DESCRIPTION is public, and is answered ahead of `authenticateApiV1`
    (AGL-2733). A description of how to authenticate that itself requires
    authentication is useless at the only moment anyone wants it — before they
    have a key — and it carries nothing that is not already published at
    `/api` in the docs, so the gate would protect nothing and cost discovery
    everything.

    It also spends no pre-auth budget, because it reads no key and looks
    nothing up.
  */
  if (segments.length === 1 && segments[0] === 'openapi.json') {
    if (request.method !== 'GET') {
      return ApiErrors.methodNotAllowed({ headers: { Allow: 'GET' } })
    }
    const origin = new URL(request.url).origin
    return apiJson(
      buildCustomerApiOpenApi({
        origin,
        // The OPERATOR's docs and brand, not ours (AGL-2186): this is served
        // from their public API.
        documentationUrl: buildDocsUrl('/api'),
        brandName: PLATFORM_BRAND_NAME,
      }),
      {
        headers: {
          /*
            `max-age=0, must-revalidate` is LOAD-BEARING, not noise.

            `s-maxage` and `stale-while-revalidate` are CDN directives, and
            Vercel consumes them and strips them from what the client sees —
            leaving a bare `Cache-Control: public`, which licenses HEURISTIC
            caching. A browser is then free to invent a lifetime, and this
            document changes with every deploy, so an integrator could hold a
            description of an API we no longer serve with nothing telling
            either of us. Measured on production before this line existed.

            So: revalidate at the client (cheap — a 304), cache 5 minutes at
            the edge. Same client-facing shape every other `/v1` response has.
          */
          'Cache-Control':
            'public, max-age=0, must-revalidate, s-maxage=300, ' +
            'stale-while-revalidate=3600',
          // Anonymous and read-only, so a browser-based client can fetch it.
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  }

  const authenticated = await authenticateApiV1(request)
  if (authenticated instanceof Response) return authenticated
  const { context } = authenticated

  const { headers } = context

  // Root + key introspection stay here; resources dispatch to their handlers.
  // Both answer GET only, and a non-GET on either is a wrong *method*, not an
  // unknown endpoint — `dispatchResource` would 404 it, which reads as "this
  // path doesn't exist" and sends integrators hunting the wrong bug (AGL-900).
  const isServicePath =
    segments.length === 0 ||
    (segments.length === 1 && (segments[0] === 'me' || segments[0] === 'usage'))
  if (isServicePath && request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: { ...headers, Allow: 'GET' } })
  }
  if (segments.length === 0 && request.method === 'GET') {
    return apiJson(
      {
        object: 'api',
        name: `${PLATFORM_BRAND_NAME} REST API`,
        version: 'v1',
        // The operator's OWN docs, not ours (AGL-2186) — this is returned in
        // the body of THEIR public API's responses.
        documentation: buildDocsUrl('/api'),
        // The machine-readable twin (AGL-2733). A client that finds the root
        // should not have to read prose to discover the description exists.
        openapi: CUSTOMER_API_OPENAPI_PATH,
        // Only top-level resources belong here. Form submissions are a
        // sub-resource of sites (`/v1/sites/{id}/form-submissions`) and are
        // deliberately absent — advertising `forms` 404'd every client that
        // read this list (AGL-898). Orders and products (AGL-1928) are
        // site-scoped for the same reason and stay out for the same reason;
        // `media` earns its place because `/v1/media` — the ORGANIZATION
        // library — really is a top-level path. The five CRM collections
        // (AGL-2606) are org-level like contacts, and so are top-level here.
        // Leads (AGL-2627) are a site's rows, but the path is `/v1/leads`
        // with the site as a parameter, so the path is what is advertised.
        // Email templates (AGL-2658) are org-level like the other CRM rows.
        resources: [
          'datasets',
          'contacts',
          'companies',
          'pipelines',
          'deals',
          'tasks',
          'activities',
          'leads',
          'email-templates',
          'sites',
          'media',
        ],
      },
      { headers },
    )
  }
  // `/v1/usage` (AGL-2277) is a SERVICE path, beside `/v1/me` rather than in
  // `dispatchResource`: it is not a collection, has no ids, and takes no
  // scope. Keeping it here is also what gives it the right 405 — the guard
  // above answers `Allow: GET` on a non-GET, where `dispatchResource` would
  // 404 it and send an integrator hunting a path that plainly exists (AGL-900).
  if (segments.length === 1 && segments[0] === 'usage' && request.method === 'GET') {
    return handleUsage(request, context)
  }
  if (segments.length === 1 && segments[0] === 'me' && request.method === 'GET') {
    return apiJson(
      { object: 'api_key', org: context.orgId, scopes: context.scopes },
      { headers },
    )
  }

  return dispatchResource(request, context, segments)
}

/**
 * Every v1 response goes through here so an unexpected throw becomes the
 * documented error envelope instead of the framework's HTML 500 (AGL-900):
 * a client that branches on `error.type` must keep working precisely when
 * things are already failing. A missing composite index is the realistic
 * trigger — `form-submissions?form=` combines a where with an orderBy.
 */
async function safeDispatch(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  try {
    return await dispatch(request, routeContext)
  } catch (error) {
    console.error('api/v1 request failed', error)
    return ApiErrors.internal()
  }
}

export function GET(request: Request, routeContext: RouteContext) {
  return safeDispatch(request, routeContext)
}
export function POST(request: Request, routeContext: RouteContext) {
  return safeDispatch(request, routeContext)
}
export function PATCH(request: Request, routeContext: RouteContext) {
  return safeDispatch(request, routeContext)
}
export function DELETE(request: Request, routeContext: RouteContext) {
  return safeDispatch(request, routeContext)
}
/**
 * PUT has no handler anywhere in v1, so Next would answer with its own 405
 * and no JSON body — a client parsing `error.type` gets nothing to read.
 * (HEAD is left alone: Next derives it from GET, which is the useful
 * behavior. OPTIONS likewise stays with the framework — this API is
 * server-to-server and sends no CORS headers to preflight.)
 */
export function PUT() {
  return ApiErrors.methodNotAllowed({
    headers: { Allow: 'GET, POST, PATCH, DELETE' },
  })
}
