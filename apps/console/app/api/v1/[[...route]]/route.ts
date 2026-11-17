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
import { ApiErrors } from '@aglyn/tenant-data-admin'
import { authenticateApiV1 } from '../../../../utils/api-v1'
import {
  isApiDescriptionPath,
  serveApiDescription,
  serveApiV1,
} from '../../../../utils/api-v1-service'

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
    (AGL-2733) — see `serveApiDescription`. Everything else is answered by
    `serveApiV1`, the same function the MCP endpoint calls for every tool
    (AGL-4225), so a path served here is a tool that works there.
  */
  if (isApiDescriptionPath(segments)) return serveApiDescription(request)

  const authenticated = await authenticateApiV1(request)
  if (authenticated instanceof Response) return authenticated
  return serveApiV1(request, authenticated.context, segments)
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
