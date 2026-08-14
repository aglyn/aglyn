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

import { runLegacyHandler } from '@aglyn/aglyn/server'
import { servePluginFetch } from '@aglyn/tenant-data-admin'

// lockdown-423: exempt — marketplace catalog/bundle fetch; no org scope at this surface —
// plugin EXECUTION is gated by the dispatcher and org enablement.

export const dynamic = 'force-dynamic'

/**
 * Host-mediated plugin fetch (AGL-191), console side (editor/preview).
 * Shared node-style handler mounted in both apps; runs through the App
 * Router adapter unchanged. Allowlist-gated; see `servePluginFetch`.
 */
export async function POST(request: Request): Promise<Response> {
  return runLegacyHandler(servePluginFetch, request)
}
