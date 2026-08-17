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
  lockdownPausedSurfaceForPluginApiPath,
  pluginIdForRegisteredApiPath,
  resolveHostEnabledPlugins,
  resolvePluginApiRoute,
  runLegacyHandler,
} from '@aglyn/aglyn/server'
import {
  filterEnabledPluginsByReleaseFlags,
  getHostDisabledPlugins,
  getOrgForHost,
  visitorWriteRateLimitRefusal,
  visitorWriteRefusal,
} from '@aglyn/tenant-data-admin'
import { ensureRemoteServerBundles } from '../../../utils/remote-server-bundles'
import { serverPluginLoader as loader } from '../../../utils/server-plugin-loader'

export const dynamic = 'force-dynamic'

/**
 * Tenant plugin API dispatcher (AGL-396/408/417). Named `app/api/*` routes
 * win over it; unregistered paths 404. Requests to a plugin the target
 * host's org has switched OFF (org.enabledPlugins, AGL-416) 404 exactly
 * like an unregistered path — a disabled plugin's API surface does not
 * exist for that workspace.
 */
async function dispatch(
  request: Request,
  { params }: { params: Promise<{ pluginApi?: string[] }> },
): Promise<Response> {
  await loader.ensureAll(['tenantApi'])
  // Remote server bundles (AGL-420): no-op unless PLUGIN_REMOTE_SERVER is
  // explicitly enabled; signed + allowlisted bundles register alongside the
  // first-party handlers above.
  await ensureRemoteServerBundles()
  const { pluginApi } = await params
  const path = Array.isArray(pluginApi) ? pluginApi.join('/') : ''

  // Per-request org gate: resolve the owning plugin from the path prefix
  // and the target host from the request (query `hostId`, else JSON body —
  // read off a clone so the handler still gets the untouched stream).
  // Exact ownership recorded at registration time; the manifest prefix map
  // is only the fallback for paths registered outside the loader.
  const pluginId =
    pluginIdForRegisteredApiPath(path) ?? loader.pluginIdForApiPath(path)
  // Declared out here so the lockdown gate below reads the SAME resolved
  // host the enablement gate used, rather than parsing the body a second
  // time (a request body can only be cloned so many times, and two
  // resolutions of "which site is this" is one too many).
  let hostId = ''
  if (pluginId) {
    const url = new URL(request.url)
    hostId = url.searchParams.get('hostId') ?? ''
    if (!hostId && request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        const body = (await request.clone().json()) as { hostId?: unknown }
        hostId = String(body?.hostId ?? '')
      } catch {
        // Non-JSON body — fall through to handler self-gating.
      }
    }
    let orgId: string | null = null
    if (hostId) {
      // Per-site enablement (AGL-1014): the org set minus the host's
      // deny-list — a plugin disabled for THIS site has no API surface for
      // it, exactly like an org-disabled one.
      const [resolved, disabledPlugins] = await Promise.all([
        getOrgForHost(hostId),
        getHostDisabledPlugins(hostId),
      ])
      orgId = resolved?.orgId ?? null
      if (
        resolved &&
        !resolveHostEnabledPlugins(resolved.org, { disabledPlugins }).includes(
          pluginId,
        )
      ) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
    }
    // Plugin release gate (AGL-422), UNCONDITIONAL since AGL-1689: a
    // flagged-off plugin's API surface does not exist — except for staff
    // bearer tokens (preview). See the console dispatcher for the full
    // argument; in one line, nesting this inside `if (hostId)` let any caller
    // skip the platform-wide kill switch by declining to name a site, and a
    // release flag — unlike per-site enablement — never needed one.
    //
    // This dispatcher is the visitor-facing half, so the hostId-less case is
    // the more reachable of the two: a public form or cart POST is authored by
    // whoever is on the page.
    const releaseFiltered = await filterEnabledPluginsByReleaseFlags(
      [pluginId],
      {
        orgId,
        authorization: request.headers.get('authorization'),
      },
    )
    if (!releaseFiltered.length) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
  }

  // Lockdown (AGL-1511). This dispatcher is the umbrella over every
  // visitor-facing plugin write on a live site — cart, checkout, reserve,
  // reviews, newsletter, membership registration, bookings — and `/api` sits
  // OUTSIDE the tenant middleware matcher, so it is the only lockdown
  // enforcement any of them meet.
  //
  // Gated by METHOD rather than by a path list, for the same reason
  // `useSiteFetch` draws the Preview boundary that way: a per-path list means
  // thirteen handlers each remembering and the fourteenth silently not. The
  // read paths this dispatcher also serves leave before any Firestore read.
  //
  // `hostId` is the one the enablement gate above already resolved; when a
  // handler self-gates and none was found, there is no site to evaluate and
  // the handler's own checks stand — a caller who can hide the target from
  // this gate can also be refused by nothing else here, and inventing a
  // guess would be worse than saying so.
  if (hostId) {
    const paused = await visitorWriteRefusal({
      hostId,
      request,
      surface: lockdownPausedSurfaceForPluginApiPath(path),
    })
    if (paused) return paused
  }

  const route = resolvePluginApiRoute(path)
  if (!route) return Response.json({ error: 'Not found' }, { status: 404 })

  // Visitor-write rate limit (AGL-1770). Until this, the dispatcher applied
  // NO rate limit of any kind to any visitor-facing write, so an
  // unauthenticated `POST /api/commerce/cart` minted a Firestore document per
  // request in the merchant's own data with nothing stopping a loop. AGL-1769
  // closed the shape of that write and was explicit that it did not bound the
  // quantity; this is the other half.
  //
  // Placed AFTER route resolution on purpose. Limiting earlier would make an
  // unregistered path — which 404s for free today — cost a Firestore
  // transaction, handing an attacker a cheaper amplification than the one
  // being closed. It follows the lockdown gate for the same reason: a paused
  // site is refused without spending a transaction.
  //
  // Deliberately NOT nested in `if (hostId)`. The enablement gate's
  // `if (resolved && …)` was named in AGL-1769 as an existing hole, and a
  // limiter a caller disables by declining to name a site is not a limiter;
  // host-less writes share one bucket per IP instead. Reads, machine
  // surfaces, the ceiling and the key are all argued at the policy module.
  const limited = await visitorWriteRateLimitRefusal({
    path,
    hostId,
    request,
  })
  if (limited) return limited

  return runLegacyHandler(route, request, { pluginApi: pluginApi ?? [] })
}

export {
  dispatch as GET,
  dispatch as POST,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE,
}
