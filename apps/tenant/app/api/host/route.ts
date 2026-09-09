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

/**
 * `GET /api/host?host=` — the SEGMENTLESS spelling of the lookup (AGL-2716).
 *
 * The handler has always lived at `/api/host/[hostId]`, and the segment is
 * read by nothing: the site is named by the `host` QUERY parameter, so the
 * path segment is a leftover that every caller has to invent a value for.
 * `/api/host/x?host=acme.com` is not an address anybody can be asked to
 * publish in a spec, and it was the only reason this endpoint could not be
 * described in `/openapi.json`.
 *
 * Re-exported rather than moved. The segmented path is what the SEO toolkit
 * and any customer integration already call, and a route file is the cheapest
 * possible alias — one module, one handler, two paths, no branch to keep in
 * step.
 */
export { GET } from './[hostId]/route'

/**
 * DECLARED HERE, never re-exported.
 *
 * `export { dynamic } from './[hostId]/route'` is refused at runtime — "Next.js
 * can't recognize the exported `dynamic` field in route. It mustn't be
 * reexported" — and the refusal is a 500 on the route rather than a build
 * error, so it ships. Route segment config is read statically from the module,
 * so a re-export is a name Next cannot follow.
 */
export const dynamic = 'force-dynamic'
