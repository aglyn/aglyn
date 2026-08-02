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
  pluginIdForRegisteredApiPath,
  resolveEnabledPlugins,
  resolvePluginApiRoute,
  runLegacyHandler,
} from '@aglyn/aglyn/server'
import {
  filterEnabledPluginsByReleaseFlags,
  getOrgForHost,
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
    if (hostId) {
      const resolved = await getOrgForHost(hostId)
      if (
        resolved &&
        !resolveEnabledPlugins(resolved.org).includes(pluginId)
      ) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      // Plugin release gate (AGL-422): a flagged-off plugin's API surface
      // does not exist either — except for staff bearer tokens (preview).
      const releaseFiltered = await filterEnabledPluginsByReleaseFlags(
        [pluginId],
        {
          subjectId: resolved?.orgId ?? hostId,
          authorization: request.headers.get('authorization'),
        },
      )
      if (!releaseFiltered.length) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
    }
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
