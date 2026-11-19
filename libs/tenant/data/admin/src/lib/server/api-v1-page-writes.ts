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
 * Adding, changing and removing a site's pages over the customer REST API
 * (AGL-4235):
 *
 *   POST   /v1/sites/{siteId}/pages            create a page, blank or from a template, unpublished
 *   PATCH  /v1/sites/{siteId}/pages/{pageId}   rename, change its address, move or reorder it
 *   DELETE /v1/sites/{siteId}/pages/{pageId}   delete it
 *
 * A create is `createPageDraft` (`page-create.ts`); an address change, a move
 * and a delete are `applyPageRouteAction` (`page-route-actions.ts`), the
 * native apps' own implementation, settled with `settlePageRouteCache`.
 *
 * `handleSitePages` hands this those methods on those paths. The site router
 * has already admitted the site and put it on `ctx.site`.
 *
 * NOT BUILT YET: every operation answers `501`, and its description
 * (`api-v1-page-writes-description.ts`) lists no operation, so no tool is
 * generated for them until they work.
 */

/** What a handler may be handed instead of the real clock and cache. */
export interface ApiV1PageWritesDeps {
  now?: () => Date
  dropCache?: typeof dropPluginSiteCache
}

/**
 * `POST …/pages`, `PATCH …/pages/{pageId}` and `DELETE …/pages/{pageId}`.
 * `segments` is the whole path under `/v1`: `['sites', siteId, 'pages', pageId?]`.
 */
export async function handlePageWrites(
  _request: Request,
  ctx: ApiV1Context,
  _segments: string[],
  _url: URL,
  _deps?: ApiV1PageWritesDeps,
): Promise<Response> {
  return ApiErrors.notImplemented({ headers: ctx.headers })
}
