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

import { ApiErrors, listResponse } from './api-http'
import { type ApiV1Context, requireScope } from './api-v1-kit'
import { listPageTemplates, type PageTemplate } from './page-templates'

/**
 * A site's templates over the customer REST API (AGL-4235):
 *
 *   GET /v1/sites/{siteId}/templates   the page templates a new page can start from
 *
 * Under `components:read`. A later step adds reusable components and layouts
 * under the same pair.
 *
 * What is listed is what the console's template gallery offers when a page
 * is made (`page-templates.ts`): the site's own page templates, then the
 * built-in starters, one template per starter page. A template's `id` is the
 * `templateId` the page create takes. Its content is not returned.
 *
 * The site router (`handleSites`) hands this every request under
 * `…/templates`, the site already admitted and on `ctx.site`.
 */

/** What a handler may be handed instead of the real clock. */
export interface ApiV1SiteTemplatesDeps {
  now?: () => Date
}

/** One page template as the API publishes it: what it is, never what is in it. */
export function templateView(template: PageTemplate) {
  return {
    id: template.id,
    object: 'template' as const,
    kind: 'page' as const,
    name: template.name,
    description: template.description,
    category: template.category,
    placeholders: template.placeholders.map((entry) => ({
      name: entry.name,
      label: typeof entry.label === 'string' && entry.label ? entry.label : null,
      defaultValue: typeof entry.defaultValue === 'string' ? entry.defaultValue : null,
    })),
    source: template.source,
  }
}

/**
 * `GET /v1/sites/{siteId}/templates`. `segments` is the whole path under
 * `/v1`: `['sites', siteId, 'templates', …]`.
 */
export async function handleSiteTemplates(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
  _deps?: ApiV1SiteTemplatesDeps,
): Promise<Response> {
  if (!ctx.site) return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  if (segments.length > 3) return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
  if (request.method !== 'GET') {
    return ApiErrors.methodNotAllowed({ headers: { ...ctx.headers, Allow: 'GET' } })
  }
  const denied = requireScope(ctx, 'components:read')
  if (denied) return denied
  const { templates, nextCursor } = await listPageTemplates(ctx.firestore, ctx.site.id, {
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor'),
  })
  return listResponse(templates.map(templateView), nextCursor, ctx.headers)
}
