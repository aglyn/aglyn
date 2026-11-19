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

import type { HostActivityActor } from '@aglyn/aglyn/app-utils/activity-presenter'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  isScreenGroup,
  normalizeScreenSlug,
  reservedScreenRouteMessage,
  reservedScreenRouteSegment,
  screenClaimsToBeAPage,
  screenSlugHasPathSeparator,
} from '@aglyn/aglyn/app-utils/screen-route'
import type { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { ApiErrors, apiJson } from './api-http'
import {
  type ApiV1Context,
  apiActorFields,
  claimWrite,
  readJsonBody,
  requireScope,
  requireSitePermission,
} from './api-v1-kit'
import { pageView } from './api-v1-site-settings'
import { createPageDraft, type CreatePageDraftResult } from './page-create'
import {
  applyPageRouteAction,
  applyPageUpdate,
  settlePageRouteCache,
  type PageRouteActionRefusal,
  type PageUpdateInput,
} from './page-route-actions'
import { pageTemplateDraft, readPageTemplate } from './page-templates'

/**
 * Adding, changing and removing a site's pages over the customer REST API
 * (AGL-4235):
 *
 *   POST   /v1/sites/{siteId}/pages            create a page, blank or from a template, unpublished
 *   PATCH  /v1/sites/{siteId}/pages/{pageId}   rename it, change its address, move or reorder it
 *   DELETE /v1/sites/{siteId}/pages/{pageId}   delete it
 *
 * A create is `createPageDraft` (`page-create.ts`), from a template through
 * `page-templates.ts`; an update is `applyPageUpdate` and a delete the
 * `delete` action of `applyPageRouteAction` (`page-route-actions.ts`), each
 * settled with `settlePageRouteCache`.
 *
 * WHO MAY. Every write needs `pages:write`. The person behind a connected app
 * needs what the console's rules ask of them for the same write (an API key
 * has no person, and passes): "Edit site content" (`site.edit`) to create a
 * page and to change its name or description; "Publish site content"
 * (`site.publish`) to change its address, move it, reorder it or delete it.
 * A change visitors can see needs the credential's `sites:publish` as well:
 * any change to a published page, and any change that re-addresses a
 * published page below it. That is decided from what is stored, before
 * anything is written.
 *
 * `handleSitePages` hands this those methods on those paths. The site router
 * has already admitted the site — ownership, membership, the site's lock —
 * and put it on `ctx.site`.
 */

/** What a handler may be handed instead of the real clock and cache. */
export interface ApiV1PageWritesDeps {
  now?: () => Date
  dropCache?: typeof dropPluginSiteCache
}

const CREATE_MEMBERS = ['name', 'description', 'slug', 'templateId', 'placeholders'] as const
const UPDATE_MEMBERS = ['name', 'description', 'slug', 'parentId', 'index'] as const
const NOT_WRITABLE = 'Not writable on a page'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const validationFailed = (ctx: ApiV1Context, fields: Record<string, string>, message = 'Page failed validation') =>
  ApiErrors.badRequest({ message, code: 'validation_failed', fields, headers: ctx.headers })

const noSuchPage = (ctx: ApiV1Context) => ApiErrors.notFound({ message: 'No such page', headers: ctx.headers })

/** Who the activity rows name: the connected app's person, or the key, and the credential's own name. */
function actorOf(ctx: ApiV1Context): HostActivityActor {
  return { uid: ctx.uid ?? 'api', ...apiActorFields(ctx) }
}

/** The members a body carries that the operation does not take, each named. */
function unknownMembers(body: Record<string, unknown>, allowed: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.keys(body).filter((key) => !allowed.includes(key)).map((key) => [key, NOT_WRITABLE]))
}

/** The address rules a slug is held to before anything is read: one segment, not reserved. */
function slugProblem(slug: string): string | null {
  if (screenSlugHasPathSeparator(slug)) return SCREEN_SLUG_PATH_SEPARATOR_MESSAGE
  const reserved = reservedScreenRouteSegment(normalizeScreenSlug(slug) ?? '')
  return reserved ? reservedScreenRouteMessage(reserved) : null
}

/** A refusal of the page routing writes, in the API's envelope. */
function routeRefusal(ctx: ApiV1Context, refusal: PageRouteActionRefusal): Response {
  if (refusal.status === 404) return noSuchPage(ctx)
  if (refusal.status === 409) {
    return ApiErrors.conflict({
      message: refusal.error,
      code: refusal.code ?? 'address_taken',
      ...(refusal.field ? { fields: { [refusal.field]: refusal.error } } : {}),
      headers: ctx.headers,
    })
  }
  return validationFailed(ctx, { [refusal.field ?? 'body']: refusal.error }, refusal.error)
}

/** A refusal of the page create, in the API's envelope. */
function createRefusal(ctx: ApiV1Context, refusal: Extract<CreatePageDraftResult, { ok: false }>): Response {
  switch (refusal.status) {
    case 403:
      return ApiErrors.planRequired({ message: refusal.error, code: 'page_quota', headers: ctx.headers })
    case 404:
      return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
    case 409:
      return ApiErrors.conflict({ message: refusal.error, headers: ctx.headers })
    case 413:
      return ApiErrors.payloadTooLarge({ message: 'The template’s design is too large for one page', headers: ctx.headers })
    default:
      return validationFailed(ctx, { body: refusal.error }, refusal.error)
  }
}

/** The page as it reads now, with the site's routing map as it reads now. */
async function pageAsStored(ctx: ApiV1Context, hostId: string, pageId: string): Promise<Response> {
  const hostRef = ctx.firestore.collection('hosts').doc(hostId)
  const [host, page] = await Promise.all([hostRef.get(), hostRef.collection('screens').doc(pageId).get()])
  const data = page.data() as Record<string, unknown> | undefined
  if (!page.exists || !data) return noSuchPage(ctx)
  return apiJson(pageView(pageId, data, host.get('screens')), { headers: ctx.headers })
}

/**
 * `POST …/pages`, `PATCH …/pages/{pageId}` and `DELETE …/pages/{pageId}`.
 * `segments` is the whole path under `/v1`: `['sites', siteId, 'pages', pageId?]`.
 */
export async function handlePageWrites(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  _url: URL,
  deps: ApiV1PageWritesDeps = {},
): Promise<Response> {
  if (!ctx.site) return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  const pageId = segments[3]
  const denied = requireScope(ctx, 'pages:write')
  if (denied) return denied
  if (!pageId) return createPage(request, ctx)
  if (request.method === 'PATCH') return updatePage(request, ctx, pageId, deps)
  return deletePage(ctx, pageId, deps)
}

// ── POST /v1/sites/{siteId}/pages ───────────────────────────────────────────

/**
 * Creates a page, blank or from a page template, as the console's Add page
 * and Use template do — and publishes nothing: no address is put on the
 * site, so the page answers `published: false` and `path: null` until it is
 * published. The page counts against the plan's page allowance, counted in
 * the create's own transaction.
 *
 * Replay-safe on an `Idempotency-Key`: the body is checked above the claim,
 * and every refusal after it gives the key back.
 */
async function createPage(request: Request, ctx: ApiV1Context): Promise<Response> {
  const site = ctx.site as NonNullable<ApiV1Context['site']>
  const body = await readJsonBody(request)
  const fields = unknownMembers(body, CREATE_MEMBERS)
  const name = typeof body['name'] === 'string' ? body['name'].trim() : ''
  if (!name) fields['name'] = body['name'] === undefined ? 'Required' : 'Must be a name that is not empty'
  const description = body['description']
  if (description !== undefined && description !== null && typeof description !== 'string') {
    fields['description'] = 'Must be a string, or null'
  }
  const slug = body['slug']
  if (slug !== undefined) {
    if (typeof slug !== 'string') fields['slug'] = 'Must be a string'
    else if (slugProblem(slug)) fields['slug'] = slugProblem(slug) as string
  }
  const templateId = body['templateId']
  if (templateId !== undefined && (typeof templateId !== 'string' || !templateId)) {
    fields['templateId'] = 'Must be the id of a page template'
  }
  const placeholders = body['placeholders']
  if (placeholders !== undefined) {
    if (templateId === undefined) fields['placeholders'] = 'Only with templateId'
    else if (!isObject(placeholders) || Object.values(placeholders).some((value) => typeof value !== 'string')) {
      fields['placeholders'] = 'Must be an object of placeholder names and their text'
    }
  }
  if (Object.keys(fields).length) return validationFailed(ctx, fields)
  const refused = requireSitePermission(ctx, site.snapshot, 'site.edit')
  if (refused) return refused

  let draft: { nodes?: Record<string, unknown>; description?: string; seo?: Record<string, unknown>; slug?: string } = {}
  if (typeof templateId === 'string') {
    const template = await readPageTemplate(ctx.firestore, site.id, templateId)
    if (!template) return ApiErrors.notFound({ message: 'No such template', headers: ctx.headers })
    const made = pageTemplateDraft(template, placeholders as Record<string, string> | undefined)
    if (made.ok === false) return validationFailed(ctx, made.fields)
    draft = made
  }

  const claimed = await claimWrite(ctx, site.id, request.headers.get('Idempotency-Key'), 'page-creates')
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const created = await createPageDraft(ctx.firestore, {
      hostId: site.id,
      org: ctx.org as never,
      actor: actorOf(ctx),
      displayName: name,
      ...(typeof description === 'string' ? { description: description.trim() } : draft.description ? { description: draft.description } : {}),
      ...(draft.seo ? { seo: draft.seo } : {}),
      ...(typeof slug === 'string' ? { slug } : draft.slug ? { slug: draft.slug } : {}),
      ...(draft.nodes ? { nodes: draft.nodes } : {}),
      pageId: createResourceUid(),
    })
    if (created.ok === false) {
      await claim.release()
      return createRefusal(ctx, created)
    }
    // A new page has no routing entry; the view says so from the map as read.
    const view = pageView(created.pageId, created.page, site.snapshot.get('screens'))
    // Stored as 200 so a replay is distinguishable from the fresh 201.
    await claim.record(200, view)
    return apiJson(view, { status: 201, headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

// ── PATCH /v1/sites/{siteId}/pages/{pageId} ─────────────────────────────────

/** Reads an update body into the change it asks for, or the members it gets wrong. */
function readPageUpdate(
  body: Record<string, unknown>,
): { change: Pick<PageUpdateInput, 'details' | 'slug' | 'parentId' | 'index'> } | { errors: Record<string, string> } {
  const errors = unknownMembers(body, UPDATE_MEMBERS)
  const change: Pick<PageUpdateInput, 'details' | 'slug' | 'parentId' | 'index'> = {}
  const { name, description, slug, parentId, index } = body
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) errors['name'] = 'Must be a name that is not empty'
    else change.details = { displayName: name }
  }
  if (description !== undefined) {
    if (description !== null && typeof description !== 'string') errors['description'] = 'Must be a string, or null to clear it'
    else change.details = { ...change.details, description: (description as string | null) ?? '' }
  }
  if (slug !== undefined) {
    if (typeof slug !== 'string') errors['slug'] = 'Must be a string'
    else change.slug = slug
  }
  if (parentId !== undefined) {
    if (parentId !== null && (typeof parentId !== 'string' || !parentId)) {
      errors['parentId'] = 'Must be the id of a page or folder, or null for the top level'
    } else change.parentId = parentId as string | null
  }
  if (index !== undefined) {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) errors['index'] = 'Must be a whole number, 0 or more'
    else change.index = index
  }
  if (!Object.keys(errors).length && !Object.keys(body).length) {
    errors['body'] = 'Send at least one of name, description, slug, parentId or index'
  }
  return Object.keys(errors).length ? { errors } : { change }
}

/**
 * Renames a page, changes its description or its address, or moves or
 * reorders it — every part checked before any is written, then one batch.
 * Answers the page as it reads after the change.
 */
async function updatePage(request: Request, ctx: ApiV1Context, pageId: string, deps: ApiV1PageWritesDeps): Promise<Response> {
  const site = ctx.site as NonNullable<ApiV1Context['site']>
  const read = readPageUpdate(await readJsonBody(request))
  if ('errors' in read) return validationFailed(ctx, read.errors)
  const { change } = read
  if (change.details) {
    const refused = requireSitePermission(ctx, site.snapshot, 'site.edit')
    if (refused) return refused
  }
  if (change.slug !== undefined || change.parentId !== undefined || change.index !== undefined) {
    const refused = requireSitePermission(ctx, site.snapshot, 'site.publish')
    if (refused) return refused
  }
  const mayPublish = ctx.scopes.includes('sites:publish')
  const updated = await applyPageUpdate(ctx.firestore, {
    hostId: site.id,
    hostSnapshot: site.snapshot,
    pageId,
    ...change,
    actor: actorOf(ctx),
    // What visitors would see is the credential's to publish.
    allow: (impact) => mayPublish || (!impact.published && !impact.readdresses),
  })
  if (updated.ok === false) {
    if ('held' in updated) return ApiErrors.insufficientScope('sites:publish', ctx.headers)
    return routeRefusal(ctx, updated)
  }
  await settlePageRouteCache(
    ctx.firestore,
    { hostId: site.id, livePaths: updated.livePaths, outboxId: updated.outboxId, reason: 'API changed a page' },
    { dropCache: deps.dropCache },
  )
  return pageAsStored(ctx, site.id, pageId)
}

// ── DELETE /v1/sites/{siteId}/pages/{pageId} ────────────────────────────────

/**
 * Deletes a page as the Pages list's Delete does: the page is marked deleted
 * and its address taken off the site; the pages under it stay as they are.
 * Asked again, it answers the same receipt. A folder is not a page, and is
 * not deleted here.
 */
async function deletePage(ctx: ApiV1Context, pageId: string, deps: ApiV1PageWritesDeps): Promise<Response> {
  const site = ctx.site as NonNullable<ApiV1Context['site']>
  const refused = requireSitePermission(ctx, site.snapshot, 'site.publish')
  if (refused) return refused
  const receipt = () => apiJson({ id: pageId, object: 'page', deleted: true }, { headers: ctx.headers })
  const stored = await ctx.firestore.collection('hosts').doc(site.id).collection('screens').doc(pageId).get()
  const data = stored.data() as Record<string, unknown> | undefined
  if (!stored.exists || !data) return noSuchPage(ctx)
  if (isScreenGroup(data)) {
    if (data['deletedAt'] != null) return noSuchPage(ctx)
    return ApiErrors.badRequest({
      message: 'This is a folder, not a page. A folder is dissolved from the console’s Pages list, which moves its pages up a level.',
      code: 'page_is_folder',
      headers: ctx.headers,
    })
  }
  if (!screenClaimsToBeAPage({ kind: data['kind'] as string | undefined })) return noSuchPage(ctx)
  if (data['deletedAt'] != null) return receipt()
  const published = typeof (site.snapshot.get('screens') as Record<string, unknown> | undefined)?.[pageId] === 'string'
  if (published) {
    const unscoped = requireScope(ctx, 'sites:publish')
    if (unscoped) return unscoped
  }
  const removed = await applyPageRouteAction(ctx.firestore, {
    hostId: site.id,
    hostSnapshot: site.snapshot,
    action: 'delete',
    pageId,
    actor: actorOf(ctx),
  })
  if (removed.ok === false) return routeRefusal(ctx, removed)
  await settlePageRouteCache(
    ctx.firestore,
    { hostId: site.id, livePaths: removed.livePaths, outboxId: removed.outboxId, reason: 'API deleted a page' },
    { dropCache: deps.dropCache },
  )
  return receipt()
}
