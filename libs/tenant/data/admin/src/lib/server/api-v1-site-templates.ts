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

import { ApiErrors } from './api-http'
import type { ApiV1Context } from './api-v1-kit'

/**
 * A site's templates over the customer REST API (AGL-4235):
 *
 *   GET /v1/sites/{siteId}/templates   the page templates a new page can start from
 *
 * Under `components:read`. A later step adds reusable components and layouts
 * under the same pair.
 *
 * The site router (`handleSites`) hands this every request under
 * `…/templates`, the site already admitted and on `ctx.site`.
 *
 * NOT BUILT YET: it answers `501`, and its description
 * (`api-v1-site-templates-description.ts`) lists no operation, so no tool is
 * generated for it until it works.
 */

/** What a handler may be handed instead of the real clock. */
export interface ApiV1SiteTemplatesDeps {
  now?: () => Date
}

/**
 * `GET /v1/sites/{siteId}/templates`. `segments` is the whole path under
 * `/v1`: `['sites', siteId, 'templates', …]`.
 */
export async function handleSiteTemplates(
  _request: Request,
  ctx: ApiV1Context,
  _segments: string[],
  _url: URL,
  _deps?: ApiV1SiteTemplatesDeps,
): Promise<Response> {
  return ApiErrors.notImplemented({ headers: ctx.headers })
}
