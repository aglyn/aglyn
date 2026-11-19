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

import { screenRoutePathToUrl } from '@aglyn/aglyn/app-utils/screen-route'
import type { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { ApiErrors, apiJson, listResponse } from './api-http'
import {
  type ApiV1Context,
  paginate,
  readJsonBody,
  requireScope,
  requireSitePermission,
  serialize,
} from './api-v1-kit'
import type { ApiScope } from './api-keys'
import { businessDetailsView, readBusinessDetailsPatch, writeBusinessDetails } from './business-details-write'
import { isApiV1Page, pageRoutePath, readPageSeoPatch, settlePageSeoCache, writePageSeo } from './page-seo-write'
import { readSiteSeoPatch, siteSeoView, writeSiteSeo } from './site-seo-write'
import { settleSiteSettingsCache, type SiteSettingsWrite } from './site-settings-write'
import { handlePageContent } from './api-v1-page-content'
import { handlePageWrites } from './api-v1-page-writes'

/**
 * The platform's three settings resources under a site on the customer REST
 * API (AGL-4235): its search listing (`/seo`), its pages and each page's
 * search listing (`/pages`), and its business details (`/business`).
 *
 * The site router (`handleSites` in the console) has already decided
 * everything that names the site — the workspace owns it, a connected app's
 * person is a member, the site's lock — and hands these the site document it
 * read on `ctx.site`. Each handler asks only its own questions: the method,
 * its scope, and for a write the person's `site.edit` on the site, the
 * permission the console's own settings cards need.
 *
 * Every write is live on save. These settings have no draft in the console
 * either: the tenant renders them straight off the site and page documents,
 * so each save drops the cached pages it changed.
 */

/** What a handler may be handed instead of the real clock and cache. */
export interface ApiV1SiteSettingsDeps {
  now?: () => Date
  dropCache?: typeof dropPluginSiteCache
}

const validationFailed = (ctx: ApiV1Context, noun: string, fields: Record<string, string>) =>
  ApiErrors.badRequest({
    message: `${noun} failed validation`,
    code: 'validation_failed',
    fields,
    headers: ctx.headers,
  })

const notAllowed = (ctx: ApiV1Context, allow: string) =>
  ApiErrors.methodNotAllowed({ headers: { ...ctx.headers, Allow: allow } })

const noSuchSite = (ctx: ApiV1Context) => ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })

/** The site the router read, as data. */
function siteData(ctx: ApiV1Context): Record<string, unknown> {
  return (ctx.site?.snapshot.data() ?? {}) as Record<string, unknown>
}

/**
 * A write's gate, in order: the method's scope, then the person's `site.edit`
 * on the site — an API key has no person and is not asked.
 */
function writeGate(ctx: ApiV1Context, scope: ApiScope): Response | null {
  return requireScope(ctx, scope) ?? requireSitePermission(ctx, ctx.site?.snapshot, 'site.edit')
}

/** A settings write's answer, after the cache drop it owes. */
async function settled(
  ctx: ApiV1Context,
  written: SiteSettingsWrite<never>,
  reason: string,
  view: (host: Record<string, unknown>) => unknown,
  deps: ApiV1SiteSettingsDeps,
): Promise<Response> {
  if (!written.ok) return noSuchSite(ctx)
  if (written.outboxId && ctx.site) {
    await settleSiteSettingsCache(
      ctx.firestore,
      { hostId: ctx.site.id, outboxId: written.outboxId, reason },
      { dropCache: deps.dropCache },
    )
  }
  return apiJson(view(written.host), { headers: ctx.headers })
}

// ── /v1/sites/{siteId}/seo ──────────────────────────────────────────────────

/** `GET` and `PATCH /v1/sites/{siteId}/seo`: the site's search listing. */
export async function handleSiteSeo(
  request: Request,
  ctx: ApiV1Context,
  deps: ApiV1SiteSettingsDeps = {},
): Promise<Response> {
  if (!ctx.site) return noSuchSite(ctx)
  const hostId = ctx.site.id
  if (request.method === 'GET') {
    return requireScope(ctx, 'seo:read') ?? apiJson(siteSeoView(hostId, siteData(ctx)), { headers: ctx.headers })
  }
  if (request.method !== 'PATCH') return notAllowed(ctx, 'GET, PATCH')
  const refused = writeGate(ctx, 'seo:write')
  if (refused) return refused
  const read = readSiteSeoPatch(await readJsonBody(request))
  if ('errors' in read) return validationFailed(ctx, 'Search listing', read.errors)
  const written = await writeSiteSeo(ctx.firestore, { hostId, patch: read.patch, now: (deps.now ?? (() => new Date()))() })
  return settled(ctx, written, 'API changed the site’s search listing', (host) => siteSeoView(hostId, host), deps)
}

// ── /v1/sites/{siteId}/business ─────────────────────────────────────────────

/** `GET` and `PATCH /v1/sites/{siteId}/business`: the site's business details. */
export async function handleSiteBusiness(
  request: Request,
  ctx: ApiV1Context,
  deps: ApiV1SiteSettingsDeps = {},
): Promise<Response> {
  if (!ctx.site) return noSuchSite(ctx)
  const hostId = ctx.site.id
  if (request.method === 'GET') {
    return requireScope(ctx, 'business:read') ?? apiJson(businessDetailsView(hostId, siteData(ctx)), { headers: ctx.headers })
  }
  if (request.method !== 'PATCH') return notAllowed(ctx, 'GET, PATCH')
  const refused = writeGate(ctx, 'business:write')
  if (refused) return refused
  const read = readBusinessDetailsPatch(await readJsonBody(request))
  if ('errors' in read) return validationFailed(ctx, 'Business details', read.errors)
  const written = await writeBusinessDetails(ctx.firestore, { hostId, patch: read.patch, now: (deps.now ?? (() => new Date()))() })
  return settled(ctx, written, 'API changed the site’s business details', (host) => businessDetailsView(hostId, host), deps)
}

// ── /v1/sites/{siteId}/pages ────────────────────────────────────────────────

/** The methods `handlePageWrites` answers on `…/pages`, and on `…/pages/{pageId}`. */
const PAGES_WRITE_METHODS: ReadonlySet<string> = new Set(['POST'])
const PAGE_WRITE_METHODS: ReadonlySet<string> = new Set(['PATCH', 'DELETE'])

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/**
 * One page as the API publishes it: what it is called, where it sits, its
 * public address, and its search listing. Never its content.
 */
export function pageView(pageId: string, data: Record<string, unknown>, routingMap: unknown) {
  const routePath = pageRoutePath(routingMap, pageId)
  const seo = (data['seo'] && typeof data['seo'] === 'object' ? data['seo'] : {}) as Record<string, unknown>
  return {
    id: pageId,
    object: 'page' as const,
    name: text(data['displayName']),
    kind: typeof data['kind'] === 'string' && data['kind'] ? data['kind'] : 'page',
    parentId: text(data['parentId']),
    order: typeof data['order'] === 'number' ? data['order'] : null,
    path: routePath === null ? null : screenRoutePathToUrl(routePath),
    published: routePath !== null,
    seo: {
      title: text(seo['title']),
      description: text(seo['description']),
      breadcrumb: text(seo['breadcrumb']),
      image: text(seo['image']),
      imageAlt: text(seo['imageAlt']),
    },
    created: serialize(data['createdAt']) ?? null,
    updated: serialize(data['updatedAt']) ?? null,
  }
}

/**
 * `GET /v1/sites/{siteId}/pages`, `GET …/pages/{pageId}` and
 * `PATCH …/pages/{pageId}/seo`. `segments` is the whole path under `/v1`.
 *
 * The rest of `/pages` is dispatched from here (AGL-4235): what is on a page
 * (`…/pages/{pageId}/content`, `…/content/edits`) to `handlePageContent`, and
 * adding (`POST …/pages`), changing (`PATCH …/pages/{pageId}`) and deleting
 * (`DELETE …/pages/{pageId}`) a page to `handlePageWrites`.
 */
export async function handleSitePages(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
  deps: ApiV1SiteSettingsDeps = {},
): Promise<Response> {
  if (!ctx.site) return noSuchSite(ctx)
  const hostId = ctx.site.id
  const [, , , pageId, sub, ...rest] = segments
  if (pageId && sub === 'content') return handlePageContent(request, ctx, segments, url, deps)
  if (!sub && !rest.length && (pageId ? PAGE_WRITE_METHODS : PAGES_WRITE_METHODS).has(request.method)) {
    return handlePageWrites(request, ctx, segments, url, deps)
  }
  if (rest.length || (sub && sub !== 'seo')) {
    return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
  }
  const pages = ctx.firestore.collection('hosts').doc(hostId).collection('screens')
  const routingMap = ctx.site.snapshot.get('screens')

  if (sub === 'seo') {
    if (request.method !== 'PATCH') return notAllowed(ctx, 'PATCH')
    const refused = writeGate(ctx, 'seo:write')
    if (refused) return refused
    const read = readPageSeoPatch(await readJsonBody(request))
    if ('errors' in read) return validationFailed(ctx, 'Search listing', read.errors)
    const written = await writePageSeo(ctx.firestore, {
      hostId,
      pageId,
      edits: read.edits,
      now: (deps.now ?? (() => new Date()))(),
    })
    if (!written.ok) return ApiErrors.notFound({ message: 'No such page', headers: ctx.headers })
    if (written.outboxId && written.routePath !== null) {
      await settlePageSeoCache(
        ctx.firestore,
        { hostId, routePath: written.routePath, outboxId: written.outboxId },
        { dropCache: deps.dropCache },
      )
    }
    const routed = written.routePath === null ? {} : { [pageId]: written.routePath }
    return apiJson(pageView(pageId, written.page, routed), { headers: ctx.headers })
  }

  if (request.method !== 'GET') return notAllowed(ctx, pageId ? 'GET, PATCH, DELETE' : 'GET, POST')
  const denied = requireScope(ctx, 'pages:read')
  if (denied) return denied

  if (pageId) {
    const snapshot = await pages.doc(pageId).get()
    const data = snapshot.data() as Record<string, unknown> | undefined
    if (!snapshot.exists || !data || !isApiV1Page(data)) {
      return ApiErrors.notFound({ message: 'No such page', headers: ctx.headers })
    }
    return apiJson(pageView(pageId, data, routingMap), { headers: ctx.headers })
  }

  const { docs, nextCursor } = await paginate(pages, url)
  const data = docs
    .filter((doc) => isApiV1Page(doc.data()))
    .map((doc) => pageView(doc.id, doc.data(), routingMap))
  return listResponse(data, nextCursor, ctx.headers)
}
