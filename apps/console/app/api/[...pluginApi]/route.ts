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
  lockdownFeaturesForPluginApiPath,
  pluginIdForRegisteredApiPath,
  resolveHostEnabledPlugins,
  resolvePluginApiRoute,
  runLegacyHandler,
} from '@aglyn/aglyn/server'
import {
  featureLockdownRefusal,
  filterEnabledPluginsByReleaseFlags,
  firebaseAdmin,
  getHostDisabledPlugins,
  getHostDocAdmin,
  getOrgForHost,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { ensureRemoteServerBundles } from '../../../utils/remote-server-bundles'
import { serverPluginLoader as loader } from '../../../utils/server-plugin-loader'

export const dynamic = 'force-dynamic'

/**
 * Console plugin API dispatcher (AGL-396/410/417). Named `app/api/*` routes
 * win over it; unregistered paths 404 — and so do paths of a plugin the
 * target host's org has switched OFF (org.enabledPlugins, AGL-416): a
 * disabled plugin's API surface does not exist for that workspace.
 */
async function dispatch(
  request: Request,
  { params }: { params: Promise<{ pluginApi?: string[] }> },
): Promise<Response> {
  await loader.ensureAll(['consoleApi'])
  // Remote server bundles (AGL-420): no-op unless PLUGIN_REMOTE_SERVER is
  // explicitly enabled; signed + allowlisted bundles register alongside the
  // first-party handlers above.
  await ensureRemoteServerBundles()
  const { pluginApi } = await params
  const path = Array.isArray(pluginApi) ? pluginApi.join('/') : ''

  // Per-request org gate: owning plugin from the path prefix; target host
  // from query `hostId`, else the JSON body read off a clone so the handler
  // still receives the untouched stream.
  // Exact ownership recorded at registration time; the manifest prefix map
  // is only the fallback for paths registered outside the loader.
  const pluginId =
    pluginIdForRegisteredApiPath(path) ?? loader.pluginIdForApiPath(path)
  let lockdownOrg: Record<string, unknown> | undefined
  let lockdownHost: Record<string, unknown> | undefined
  if (pluginId) {
    const url = new URL(request.url)
    let hostId = url.searchParams.get('hostId') ?? ''
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
      // it, exactly like an org-disabled one. The host doc ride-along is
      // request-cached with the deny-list read (one get, AGL-1506).
      const [resolved, disabledPlugins, hostDoc] = await Promise.all([
        getOrgForHost(hostId),
        getHostDisabledPlugins(hostId),
        getHostDocAdmin(hostId),
      ])
      orgId = resolved?.orgId ?? null
      lockdownOrg = resolved?.org as Record<string, unknown> | undefined
      lockdownHost = hostDoc ?? undefined
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
    // bearer tokens (preview).
    //
    // It used to live inside `if (hostId)` alongside the per-site enablement
    // check, which made the platform-wide kill switch opt-in from the
    // CALLER's side: omit `?hostId=`, or post a non-JSON body so the parse
    // above falls through, and the flagged-off handler ran. Per-site
    // enablement genuinely needs a site and stays where it is; a release flag
    // does not. The two questions were nested together because they were
    // written together, not because they share a precondition.
    //
    // `orgId` is null when no host resolved, and `filterEnabledPluginsByReleaseFlags`
    // treats a subject-less request as eligible for the fully-enabled flags
    // only — never a partial rollout (AGL-1656). So a hostId-less request to a
    // half-rolled-out plugin is refused rather than guessed at, which is the
    // conservative direction for a kill switch and matches what that helper's
    // docstring already promised every other caller.
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

  // Lockdown verdict (AGL-1506) for the whole plugin API surface, with
  // whatever scope the dispatch resolved: org+host docs when the request
  // named a hostId (already read above — no extra get), platform always
  // (TTL-cached). Staff bypass mirrors the release-flag filter's bearer
  // decode; anonymous callers (tenant form posts) carry no uid, so the
  // per-call user-lockdown read is only paid by signed-in console callers.
  let staff = false
  let uid: string | null = null
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    try {
      const decoded = await firebaseAdmin
        .app()
        .auth()
        .verifyIdToken(authorization.slice('Bearer '.length))
      staff = decoded['staff'] === true
      uid = decoded.uid
    } catch {
      // Not a Firebase token (plugin key / anonymous) — no bypass, no uid.
    }
  }
  const locked = await lockdownRefusal({
    request,
    staff,
    uid,
    org: lockdownOrg,
    host: lockdownHost,
  })
  if (locked) return locked

  // Feature lockdown (AGL-1510) for the paths this dispatcher owns:
  // `ai/assist` → ai-assist (gated even while the handler 501s without an
  // API key — the switch predates the key), `marketplace/install*` and
  // `update-artifact` → marketplace-installs (installs-as-a-class), and
  // `marketplace/checkout` → checkout AND marketplace-installs (AGL-1545:
  // a paid purchase is a new Stripe session and the front door of an
  // install — either incident stops it). Staff bypass follows
  // LOCKDOWN_FEATURE_STAFF_BYPASS per key: granted for installs/ai-assist
  // (staff reproduce and verify during the incident), refused for
  // checkout (a staff session still charges a real card).
  for (const feature of lockdownFeaturesForPluginApiPath(path)) {
    const featureLocked = await featureLockdownRefusal({ feature, staff })
    if (featureLocked) return featureLocked
  }

  const route = resolvePluginApiRoute(path)
  if (!route) return Response.json({ error: 'Not found' }, { status: 404 })
  return runLegacyHandler(route, request, { pluginApi: pluginApi ?? [] })
}

export {
  dispatch as GET,
  dispatch as POST,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE,
}
