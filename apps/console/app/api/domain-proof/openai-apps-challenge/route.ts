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

import { connectorDomainProofToken } from '@aglyn/aglyn/app-utils/connector-discovery'
import { hostnameOf, WORKSPACE_DOMAIN } from '../../../../constants/workspace-domain'

// lockdown-423: exempt — a public proof of domain control that a plugin
// directory fetches with no caller identity; it reads no workspace and acts
// for none.

// Read from the environment on every request: a token set after the build
// must be served without a rebuild, and a prerendered 404 must never be.
export const dynamic = 'force-dynamic'

/** Not there, and nothing about why: no body, and never cached. */
function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Was the request addressed to the auth origin? `x-forwarded-host` first, then
 * `host`: the rule `refuseOnAuthOrigin` applies for the connector's routes,
 * restated here so a file this small does not load the data layer to ask.
 */
function onAuthOrigin(request: Request): boolean {
  const forwarded = (request.headers.get('x-forwarded-host') ?? '').split(',')[0]?.trim()
  const host = forwarded || request.headers.get('host') || new URL(request.url).host
  return hostnameOf(host.toLowerCase()) === `auth.${WORKSPACE_DOMAIN}`
}

/**
 * `/.well-known/openai-apps-challenge` on the console (AGL-4225), rewritten
 * here by `middleware.ts`.
 *
 * OpenAI's plugin directory proves a domain by fetching that path on the host
 * that serves the MCP endpoint and comparing the body with the challenge token
 * it issued. The token is configuration, never source: `OPENAI_APPS_CHALLENGE`
 * in the console's environment. Unset, empty or not shaped like a token, the
 * path answers 404, as every other unserved name in the namespace does
 * (AGL-3016).
 *
 * The body is the token and nothing else, with no trailing newline, because
 * the comparison is exact. `GET` only: Next answers `HEAD` from it and 405 to
 * the rest.
 *
 * Closed on the auth origin, which serves no part of the connector (AGL-3090):
 * the middleware refuses the public path there, and `/api/*` sits outside its
 * matcher, so the handler says so for itself.
 */
export function GET(request: Request): Response {
  if (onAuthOrigin(request)) return notFound()
  const token = connectorDomainProofToken(process.env.OPENAI_APPS_CHALLENGE)
  if (!token) return notFound()
  return new Response(token, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
