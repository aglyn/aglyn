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
import { apiJson } from '@aglyn/tenant-data-admin'
import { authenticateApiV1 } from '../../../../utils/api-v1'
import { dispatchResource } from '../../../../utils/api-v1-resources'

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
  if (segments.length === 0 && request.method === 'GET') {
    return apiJson(
      {
        object: 'api',
        name: 'Aglyn REST API',
        version: 'v1',
        documentation: 'https://docs.aglyn.com/api',
        resources: ['datasets', 'contacts', 'sites', 'forms'],
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

export function GET(request: Request, routeContext: RouteContext) {
  return dispatch(request, routeContext)
}
export function POST(request: Request, routeContext: RouteContext) {
  return dispatch(request, routeContext)
}
export function PATCH(request: Request, routeContext: RouteContext) {
  return dispatch(request, routeContext)
}
export function DELETE(request: Request, routeContext: RouteContext) {
  return dispatch(request, routeContext)
}
