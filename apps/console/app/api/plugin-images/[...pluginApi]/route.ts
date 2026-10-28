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

// lockdown-423: exempt — server-internal machine calls only (each route verifies its own signed caller), no user
// caller; each draws images that a gated door or a lockdown-gated sweep already decided on, and nothing else.

import { isPluginImagesRoute } from '@aglyn/aglyn/app-utils/api-plugins'
import {
  resolvePluginApiMatch,
  runLegacyHandler,
  runPluginApiMatch,
} from '@aglyn/aglyn/server'
import { serverPluginLoader } from '../../../../utils/server-plugin-loader'

/**
 * THE PLUGINS' IMAGE FUNCTION (AGL-4048).
 *
 * Drawing an image takes `sharp`, and `sharp` takes libvips, a 17 MB native
 * library. `next.config.js` ships it beside THIS route alone, rather than
 * beside the plugin dispatcher, whose cold start every plugin door pays. A
 * plugin route registered with `images: true` (and `machine: true`) is
 * served here at `/api/plugin-images/{path}` and nowhere else: the
 * dispatcher answers 404 for it. A plugin's own doors, jobs and event
 * handlers that need such a picture drawn ask this route over HTTP.
 *
 * Nothing here gates: each such route is a machine's door that verifies its
 * caller before it reads a thing, as the AI jobs beat's does. Anything else
 * is not served.
 */
async function handler(
  request: Request,
  { params }: { params: Promise<{ pluginApi?: string[] }> },
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const { pluginApi } = await params
  const segments = Array.isArray(pluginApi) ? pluginApi : []
  const path = segments.join('/')
  await serverPluginLoader.ensureAll(['consoleApi'])
  const match = isPluginImagesRoute(path) ? resolvePluginApiMatch(path) : undefined
  if (!match) return Response.json({ error: 'Not found' }, { status: 404 })
  return runPluginApiMatch(match, request, { pluginApi: segments }, runLegacyHandler)
}

export const dynamic = 'force-dynamic'

/** A few screens drawn and uploaded fit well inside a door's minute. */
export const maxDuration = 60

export { handler as POST }
