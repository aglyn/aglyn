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

import type { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { ApiErrors } from './api-http'
import type { ApiV1Context } from './api-v1-kit'

/**
 * What is on a page, over the customer REST API (AGL-4235):
 *
 *   GET  /v1/sites/{siteId}/pages/{pageId}/content         the page's elements
 *   POST /v1/sites/{siteId}/pages/{pageId}/content/edits   edits to its draft
 *
 * Every edit lands in the page's DRAFT, never in what is live; a draft goes
 * live through `publishSite`. The reading and editing is the page editor's,
 * reached through the core's `core.page-content` contract
 * (`@aglyn/aglyn/plugin-manager/plugin-page-content`), which a plugin
 * answers; with none registered the operations are not available.
 *
 * `handleSitePages` hands this every request under `…/pages/{pageId}/content`.
 * The site router has already admitted the site and put it on `ctx.site`.
 *
 * NOT BUILT YET: both operations answer `501`, and its description
 * (`api-v1-page-content-description.ts`) lists no operation, so no tool is
 * generated for them until they work.
 */

/** What a handler may be handed instead of the real clock and cache. */
export interface ApiV1PageContentDeps {
  now?: () => Date
  dropCache?: typeof dropPluginSiteCache
}

/**
 * `GET …/pages/{pageId}/content` and `POST …/pages/{pageId}/content/edits`.
 * `segments` is the whole path under `/v1`:
 * `['sites', siteId, 'pages', pageId, 'content', …]`.
 */
export async function handlePageContent(
  _request: Request,
  ctx: ApiV1Context,
  _segments: string[],
  _url: URL,
  _deps?: ApiV1PageContentDeps,
): Promise<Response> {
  return ApiErrors.notImplemented({ headers: ctx.headers })
}
