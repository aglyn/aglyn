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

import { resolveConsoleDomain } from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — pre-session advisory resolve of a console domain; no org action.

export const dynamic = 'force-dynamic'

/**
 * May the console be served on this hostname, and for which org? — the
 * custom-domain half of the host gate in `middleware.ts` (AGL-1099c).
 *
 * The sibling of `/api/orgs/slug-verdict`, and it exists for the same measured
 * reason: **the middleware runs on the edge and must not read Firestore's REST
 * API directly.** App Check is enforced, an edge request carries no App Check
 * token, and every document comes back `403 PERMISSION_DENIED` — which the
 * AGL-1135 gate scored as "known". Arming a gate that reads from the edge makes
 * things worse, not better. Reading through the Admin SDK sidesteps both rules
 * and App Check.
 *
 * Deliberately unauthenticated, because the middleware calls it before any
 * session exists. It answers strictly less than the DNS already tells you: a
 * hostname that serves an org's console resolves to that org by construction.
 * The `orgId` is never returned — only the workspace slug, which `orgSlugs` is
 * already world-readable for.
 */
export async function GET(request: Request) {
  const host = new URL(request.url).searchParams.get('host')?.trim()
  if (!host || host.length > 253) {
    return Response.json({ error: 'invalid-host' }, { status: 400 })
  }
  try {
    const verdict = await resolveConsoleDomain(host)
    return Response.json({
      known: verdict.known,
      servable: verdict.servable,
      orgSlug: verdict.orgSlug,
      reason: verdict.reason,
      // Present only when true, matching `slug-verdict`: the middleware honours
      // a degraded verdict for one request and never caches it, so one blip
      // cannot pin a host open for the full TTL.
      ...(verdict.degraded ? { degraded: true } : {}),
    })
  } catch {
    // Fail OPEN, and say so out loud. `resolveConsoleDomain` already converts
    // its own read failures into a degraded verdict; this covers the case where
    // the Admin SDK itself is unavailable. The Vercel domain allowlist is the
    // boundary that actually decides which hostnames reach this deployment.
    return Response.json({
      known: false,
      servable: false,
      orgSlug: null,
      reason: 'degraded',
      degraded: true,
    })
  }
}
