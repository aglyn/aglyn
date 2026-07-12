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
import { serveMediaCdn } from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

/**
 * CDN media delivery (AGL-175). `serveMediaCdn` is a shared node-style
 * handler that streams a read stream into `res` and is also mounted in the
 * console (Pages Router) — so it stays `(req,res)` and runs here through the
 * App Router adapter (`runLegacyHandler`) rather than being rewritten. See
 * `serveMediaCdn` for the caching contract.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params
  return runLegacyHandler(serveMediaCdn, request, { path })
}

export const HEAD = GET
