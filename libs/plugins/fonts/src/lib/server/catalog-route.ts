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

import catalog from '../catalog/google-fonts.catalog.json'

/**
 * `GET fonts/catalog` (AGL-3668): the Google Fonts catalog the font picker
 * browses, exactly as the console bundles it (`google-fonts.catalog.json`:
 * family, category, weights, italics, axes, subsets, popularity, metrics,
 * most used first), for the native apps, which do not carry the console's
 * bundle. Public metadata: no account is read, and it is cached for a day.
 */
export async function fontsCatalogRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } })
  }
  return Response.json(
    { families: (catalog as { families: unknown[] }).families },
    { status: 200, headers: { 'Cache-Control': 'public, max-age=86400' } },
  )
}
