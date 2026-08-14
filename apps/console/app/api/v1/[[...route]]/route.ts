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
import { ApiErrors, apiJson } from '@aglyn/tenant-data-admin'
import { authenticateApiV1 } from '../../../../utils/api-v1'
import { dispatchResource } from '../../../../utils/api-v1-resources'

// lockdown-423: via apps/console/utils/api-v1.ts — every /v1 dispatch
// authenticates there, and the verdict runs beside the org-doc read.

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ route?: string[] }> }

async function dispatch(
  request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const authenticated = await authenticateApiV1(request)
  if (authenticated instanceof Response) return authenticated
  const { context } = authenticated

  const { route } = await routeContext.params
  const segments = route ?? []
  const { headers } = context

  // Root + key introspection stay here; resources dispatch to their handlers.
  // Both answer GET only, and a non-GET on either is a wrong *method*, not an
  // unknown endpoint — `dispatchResource` would 404 it, which reads as "this
  // path doesn't exist" and sends integrators hunting the wrong bug (AGL-900).
  const isServicePath =
    segments.length === 0 || (segments.length === 1 && segments[0] === 'me')
  if (isServicePath && request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: { ...headers, Allow: 'GET' } })
  }
  if (segments.length === 0 && request.method === 'GET') {
    return apiJson(
      {
        object: 'api',
        name: 'Aglyn REST API',
        version: 'v1',
        documentation: 'https://docs.aglyn.com/api',
        // Only top-level resources belong here. Form submissions are a
        // sub-resource of sites (`/v1/sites/{id}/form-submissions`) and are
        // deliberately absent — advertising `forms` 404'd every client that
        // read this list (AGL-898).
        resources: ['datasets', 'contacts', 'sites'],
      },
      { headers },
    )
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
