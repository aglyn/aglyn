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

import { resolvePluginApiRoute, runLegacyHandler } from '@aglyn/aglyn/server'
// Populate the plugin API registry before resolving (AGL-396). The plugin
// `/server` entries are context-free (they import `@aglyn/aglyn/server`, not
// the barrel), so this static side-effect import is safe in a route handler's
// module graph.
import '../../../utils/register-plugin-apis'

export const dynamic = 'force-dynamic'

/**
 * Tenant plugin API dispatcher (AGL-396/408): the App Router counterpart to
 * the Pages Router catch-all. Named `app/api/*` routes win over it, so it
 * only serves paths a plugin has registered; unregistered paths 404. Plugin
 * handlers keep their framework-light `(req,res)` contract and run through
 * `runLegacyHandler` unchanged — the seam that keeps plugins decoupled from
 * the app router.
 */
async function dispatch(
  request: Request,
  { params }: { params: Promise<{ pluginApi?: string[] }> },
): Promise<Response> {
  const { pluginApi } = await params
  const path = Array.isArray(pluginApi) ? pluginApi.join('/') : ''
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
