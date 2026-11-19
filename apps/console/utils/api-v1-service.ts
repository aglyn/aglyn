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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { CONNECTOR_RESOURCE_PATH } from '@aglyn/aglyn/app-utils/connector-discovery'
import { ApiErrors, apiJson } from '@aglyn/tenant-data-admin'
import type { ApiV1Context } from './api-v1'
import { buildDocsUrl } from '../constants/docs-links'
import {
  buildCustomerApiOpenApi,
  CUSTOMER_API_OPENAPI_PATH,
} from './api-v1-openapi'
import {
  describePluginApiV1Resources,
  dispatchResource,
  handleUsage,
  pluginApiV1ResourceNames,
} from './api-v1-resources'

/**
 * EVERY `/v1` PATH, ONE IMPLEMENTATION, TWO TRANSPORTS (AGL-4225).
 *
 * The `/api/v1` route and the MCP endpoint both answer a `/v1` path through
 * {@link serveApiV1}. Until this existed the four SERVICE paths — the root,
 * `/me`, `/usage` and `/openapi.json` — were answered inline in the route,
 * ahead of `dispatchResource`, while MCP called `dispatchResource` directly.
 * So all four were advertised as tools and every one of them answered
 * `Unknown endpoint` when called; the first real connection found it, on the
 * very tool the Claude skill tells a model to call first.
 *
 * Nothing here authenticates. The caller hands over a context it has already
 * authenticated, metered and rate-limited, exactly as before.
 */

/** `/v1/openapi.json`. The one path that needs no key over REST. */
export function isApiDescriptionPath(segments: readonly string[]): boolean {
  return segments.length === 1 && segments[0] === 'openapi.json'
}

/**
 * The OpenAPI document as `/api/v1/openapi.json` serves it.
 *
 * Public over REST, answered there before authentication (AGL-2733): a
 * description of how to authenticate that itself required authentication would
 * be useless at the only moment anyone wants it. It spends no pre-auth budget,
 * because it reads no key and looks nothing up.
 */
export async function serveApiDescription(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: { Allow: 'GET' } })
  }
  const origin = new URL(request.url).origin
  return apiJson(
    buildCustomerApiOpenApi(
      {
        origin,
        // The OPERATOR's docs and brand, not ours (AGL-2186): this is served
        // from their public API.
        documentationUrl: buildDocsUrl('/api'),
        brandName: PLATFORM_BRAND_NAME,
      },
      // What the build's plugins serve, as each describes it (AGL-3080).
      await describePluginApiV1Resources(),
    ),
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

/**
 * Answer one authenticated `/v1` request: a service path here, everything else
 * by its resource handler.
 *
 * `segments` is what follows `/v1`, as the route's catch-all receives it and as
 * `buildToolRequest` builds it.
 */
export async function serveApiV1(
  request: Request,
  context: ApiV1Context,
  segments: readonly string[],
): Promise<Response> {
  const { headers } = context

  // Reachable here only from MCP; the route answers it before authenticating.
  // Same document either way.
  if (isApiDescriptionPath(segments)) return serveApiDescription(request)

  // Root + key introspection + usage are service paths. All answer GET only,
  // and a non-GET on one is a wrong *method*, not an unknown endpoint —
  // `dispatchResource` would 404 it, which reads as "this path doesn't exist"
  // and sends integrators hunting the wrong bug (AGL-900).
  const isServicePath =
    segments.length === 0 ||
    (segments.length === 1 && (segments[0] === 'me' || segments[0] === 'usage'))
  if (isServicePath && request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: { ...headers, Allow: 'GET' } })
  }
  if (segments.length === 0) {
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
        // The same API as MCP tools (AGL-4225), so a client that found the
        // REST root learns there is a server an agent can connect to.
        mcp: CONNECTOR_RESOURCE_PATH,
        // Only top-level resources belong here. Form submissions are a
        // sub-resource of sites (`/v1/sites/{id}/form-submissions`) and are
        // deliberately absent — advertising `forms` 404'd every client that
        // read this list (AGL-898). Orders and products (AGL-1928) are
        // site-scoped for the same reason and stay out for the same reason;
        // `media` earns its place because `/v1/media` — the ORGANIZATION
        // library — really is a top-level path. A resource a plugin serves at
        // the top level (AGL-3080) is registered under its first path segment,
        // so every one the build serves is listed — the data plugin's
        // `datasets` among them — and none it does not.
        resources: ['sites', 'media', ...(await pluginApiV1ResourceNames())],
      },
      { headers },
    )
  }
  // `/v1/usage` (AGL-2277) is a SERVICE path, beside `/v1/me` rather than in
  // `dispatchResource`: it is not a collection, has no ids, and takes no
  // scope.
  if (segments.length === 1 && segments[0] === 'usage') {
    return handleUsage(request, context)
  }
  if (segments.length === 1 && segments[0] === 'me') {
    return apiJson(
      // `name` (AGL-3643) is how an integration that holds several keys —
      // Zapier's connection label — tells them apart without the secret.
      // A connection answers as what it is (AGL-4225), with the same fields:
      // `name` is then the name the app registered under.
      {
        object: context.credential === 'connected_app' ? 'connected_app' : 'api_key',
        org: context.orgId,
        name: context.keyName,
        scopes: context.scopes,
      },
      { headers },
    )
  }

  return dispatchResource(request, context, [...segments])
}
