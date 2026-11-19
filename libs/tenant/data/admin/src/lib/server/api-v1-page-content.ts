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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { runPluginDeclarationsRepair } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import {
  PAGE_CONTENT_MAX_EDITS,
  resolvePluginPageContent,
  type PageContentEdit,
  type PageContentRefusal,
  type PageContentService,
} from '@aglyn/aglyn/plugin-manager/plugin-page-content'
import type { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { ApiErrors, apiJson } from './api-http'
import {
  type ApiV1Context,
  apiActorLabel,
  claimWrite,
  readJsonBody,
  requireScope,
  requireSitePermission,
} from './api-v1-kit'
import { pageEditorUrl } from './api-v1-page-links'

/**
 * What is on a page, over the customer REST API (AGL-4235):
 *
 *   GET  /v1/sites/{siteId}/pages/{pageId}/content         the page's elements
 *   POST /v1/sites/{siteId}/pages/{pageId}/content/edits   edits to its draft
 *
 * Every edit lands in the page's DRAFT, never in what is live; a draft goes
 * live when the page is published. The reading and editing is the page
 * editor's, reached through the core's `core.page-content` contract
 * (`@aglyn/aglyn/plugin-manager/plugin-page-content`), which a plugin
 * answers; with none registered the operations answer `501 Not available
 * yet`. These handlers are thin: the request's shape, the scopes and the
 * person's permission, replay safety, and the response. Every rule about
 * what an edit may do is the editor's.
 *
 * `handleSitePages` hands this every request under `…/pages/{pageId}/content`.
 * The site router has already admitted the site — the workspace owns it, a
 * connected app's person is on it, its lock and takedown — and put it on
 * `ctx.site`. No plan gate: a draft exists on every plan.
 */

/** What a handler may be handed instead of the real clock, cache and registry. */
export interface ApiV1PageContentDeps {
  now?: () => Date
  dropCache?: typeof dropPluginSiteCache
  /** The registered implementation, or null. */
  resolveService?: () => PageContentService | null
  /** The app's declarations step, run once when nothing is registered. */
  repairDeclarations?: () => Promise<boolean>
  /** A fresh id for one batch of edits. */
  editId?: () => string
}

/** The edit kinds this API makes, and the members each takes. */
const EDIT_MEMBERS: Readonly<Record<PageContentEdit['op'], { required: readonly string[]; optional: readonly string[] }>> = {
  updateProps: { required: ['elementId', 'props'], optional: [] },
  updateStyle: { required: ['elementId', 'style'], optional: [] },
  rename: { required: ['elementId', 'name'], optional: [] },
  insert: { required: ['parentId', 'element'], optional: ['index'] },
  move: { required: ['elementId', 'parentId', 'index'], optional: [] },
  remove: { required: ['elementId'], optional: [] },
}

export const PAGE_CONTENT_EDIT_KINDS = Object.keys(EDIT_MEMBERS) as ReadonlyArray<PageContentEdit['op']>

/** How deep an inserted element's children may nest before the request is refused as malformed. */
const MAX_ELEMENT_DEPTH = 40

const ELEMENT_MEMBERS: ReadonlySet<string> = new Set(['kind', 'props', 'style', 'name', 'children'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128

/**
 * A request body as edits, or every problem with its SHAPE named by member:
 * a member no edit takes, a required one missing, a value of the wrong type,
 * an edit kind this API does not make. Whether the edits make sense on the
 * page is the editor's question, answered after this.
 */
export function readPageContentEdits(
  body: unknown,
): { edits: PageContentEdit[]; ifRevision?: string } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!isRecord(body)) return { errors: { body: 'must be a JSON object with `edits`' } }
  for (const member of Object.keys(body)) {
    if (member !== 'edits' && member !== 'ifRevision') errors[member] = 'is not a member of this request'
  }
  const ifRevision = body['ifRevision']
  if (ifRevision !== undefined && (typeof ifRevision !== 'string' || !ifRevision)) errors['ifRevision'] = 'must be a revision from Get a page’s content'
  const raw = body['edits']
  if (!Array.isArray(raw) || !raw.length || raw.length > PAGE_CONTENT_MAX_EDITS) {
    errors['edits'] = `must be a list of 1 to ${PAGE_CONTENT_MAX_EDITS} edits`
    return { errors }
  }

  const readElement = (value: unknown, at: string, depth: number): void => {
    if (!isRecord(value)) {
      errors[at] = 'must be an object with a `kind`'
      return
    }
    for (const member of Object.keys(value)) {
      if (!ELEMENT_MEMBERS.has(member)) errors[`${at}.${member}`] = 'is not a member of a new element'
    }
    if (typeof value['kind'] !== 'string' || !value['kind']) errors[`${at}.kind`] = 'is required: the kind of element, such as `muiTypography`'
    if (value['props'] !== undefined && !isRecord(value['props'])) errors[`${at}.props`] = 'must be an object'
    if (value['style'] !== undefined && !isRecord(value['style'])) errors[`${at}.style`] = 'must be an object'
    if (value['name'] !== undefined && typeof value['name'] !== 'string') errors[`${at}.name`] = 'must be text'
    const children = value['children']
    if (children === undefined) return
    if (!Array.isArray(children)) {
      errors[`${at}.children`] = 'must be a list of new elements'
      return
    }
    if (depth >= MAX_ELEMENT_DEPTH) {
      errors[`${at}.children`] = `nests more than ${MAX_ELEMENT_DEPTH} levels deep`
      return
    }
    children.forEach((child, index) => readElement(child, `${at}.children[${index}]`, depth + 1))
  }

  raw.forEach((edit, index) => {
    const at = `edits[${index}]`
    if (!isRecord(edit)) {
      errors[at] = 'must be an object with an `op`'
      return
    }
    const op = edit['op']
    const members = typeof op === 'string' ? EDIT_MEMBERS[op as PageContentEdit['op']] : undefined
    if (!members) {
      errors[`${at}.op`] = `must be one of ${PAGE_CONTENT_EDIT_KINDS.join(', ')}`
      return
    }
    const allowed = new Set(['op', ...members.required, ...members.optional])
    for (const member of Object.keys(edit)) {
      if (!allowed.has(member)) errors[`${at}.${member}`] = `is not a member of a ${op} edit`
    }
    for (const member of members.required) {
      if (edit[member] === undefined) errors[`${at}.${member}`] = 'is required'
    }
    for (const member of ['elementId', 'parentId']) {
      if (allowed.has(member) && edit[member] !== undefined && !isId(edit[member])) errors[`${at}.${member}`] = 'must be an element id from Get a page’s content'
    }
    if (op === 'updateProps' && edit['props'] !== undefined && !isRecord(edit['props'])) errors[`${at}.props`] = 'must be an object'
    if (op === 'updateStyle' && edit['style'] !== undefined && !isRecord(edit['style'])) errors[`${at}.style`] = 'must be an object'
    if (op === 'rename' && edit['name'] !== undefined && typeof edit['name'] !== 'string') errors[`${at}.name`] = 'must be text'
    if (op === 'move' && edit['index'] !== undefined && !isIndex(edit['index'])) errors[`${at}.index`] = 'must be a whole number, 0 or more'
    if (op === 'insert') {
      if (edit['index'] !== undefined && edit['index'] !== null && !isIndex(edit['index'])) {
        errors[`${at}.index`] = 'must be a whole number, 0 or more, or left out to add it last'
      }
      if (edit['element'] !== undefined) readElement(edit['element'], `${at}.element`, 0)
    }
  })
  if (Object.keys(errors).length) return { errors }
  return {
    edits: raw as PageContentEdit[],
    ...(typeof ifRevision === 'string' ? { ifRevision } : {}),
  }
}

/** The contract's implementation, after making sure the plugins' server declarations ran. */
async function pageContentService(deps: ApiV1PageContentDeps): Promise<PageContentService | null> {
  const resolve = deps.resolveService ?? resolvePluginPageContent
  const found = resolve()
  if (found) return found
  // A process whose boot did not register the plugins' server declarations
  // repairs itself once, as the plugin resources' own lookup does.
  await (deps.repairDeclarations ?? runPluginDeclarationsRepair)().catch(() => false)
  return resolve()
}

/** The site's two media libraries, named as a `media:` reference names its scope. */
export function pageContentMediaScopes(orgId: string, hostId: string): string[] {
  // The site's own library (`{hostId}`), the workspace's (`org:{orgId}`), and
  // the workspace's as this site asks for it (`org:{orgId}:{hostId}`, the form
  // `hostQualifiedScope` writes), and no other.
  return [hostId, `org:${orgId}`, `org:${orgId}:${hostId}`]
}

/** A refusal from the editor as the response the API publishes, in its one error envelope. */
function refusalResponse(ctx: ApiV1Context, refusal: PageContentRefusal): Response {
  const init = {
    message: refusal.message,
    code: refusal.code,
    ...(refusal.fields ? { fields: refusal.fields } : {}),
    headers: ctx.headers,
  }
  switch (refusal.status) {
    case 400:
      return ApiErrors.badRequest(init)
    case 404:
      return ApiErrors.notFound(init)
    case 409:
      return ApiErrors.conflict(init)
    case 413:
      return ApiErrors.payloadTooLarge(init)
    default:
      // 422: the request is well formed and the editor refused what it asks.
      // `api-http` has no 422 helper, so the envelope is written here in its
      // shape: `{ error: { type, message, code, fields } }`.
      return Response.json(
        {
          error: {
            type: 'unprocessable_entity',
            message: refusal.message,
            code: refusal.code,
            ...(refusal.fields ? { fields: refusal.fields } : {}),
          },
        },
        { status: 422, headers: ctx.headers },
      )
  }
}

const notAllowed = (ctx: ApiV1Context, allow: string) =>
  ApiErrors.methodNotAllowed({ headers: { ...ctx.headers, Allow: allow } })

/** Where the page opens in the editor, from the workspace's slug and the site's subdomain. */
function editorUrl(ctx: ApiV1Context, pageId: string, versionId: string, draft: boolean): string | null {
  return pageEditorUrl({
    orgSlug: ctx.org.slug,
    subdomain: ctx.site?.snapshot.get('subdomain'),
    pageId,
    versionId,
    draft,
  })
}

/**
 * `GET …/pages/{pageId}/content` and `POST …/pages/{pageId}/content/edits`.
 * `segments` is the whole path under `/v1`:
 * `['sites', siteId, 'pages', pageId, 'content', …]`.
 */
export async function handlePageContent(
  request: Request,
  ctx: ApiV1Context,
  segments: string[],
  url: URL,
  deps: ApiV1PageContentDeps = {},
): Promise<Response> {
  if (!ctx.site) return ApiErrors.notFound({ message: 'No such site', headers: ctx.headers })
  const hostId = ctx.site.id
  const [, , , pageId, , action, ...rest] = segments
  if (!pageId || rest.length || (action !== undefined && action !== 'edits')) {
    return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
  }

  if (action === undefined) {
    if (request.method !== 'GET') return notAllowed(ctx, 'GET')
    const denied = requireScope(ctx, 'pages:read')
    if (denied) return denied
    const elementId = url.searchParams.get('elementId')
    if (elementId !== null && !isId(elementId)) {
      return ApiErrors.badRequest({
        message: 'Page content failed validation',
        code: 'validation_failed',
        fields: { elementId: 'must be an element id from Get a page’s content' },
        headers: ctx.headers,
      })
    }
    const service = await pageContentService(deps)
    if (!service) return ApiErrors.notImplemented({ headers: ctx.headers })
    const read = await service.read({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      hostId,
      pageId,
      ...(elementId !== null ? { elementId } : {}),
    })
    if (read.ok === false) return refusalResponse(ctx, read)
    return apiJson(
      {
        object: 'page_content',
        page: read.pageId,
        versionId: read.versionId,
        base: read.base,
        revision: read.revision,
        rootId: read.rootId,
        total: read.total,
        elements: read.elements,
        kinds: read.kinds,
        editorUrl: editorUrl(ctx, read.pageId, read.versionId, read.base === 'draft'),
      },
      { headers: ctx.headers },
    )
  }

  if (request.method !== 'POST') return notAllowed(ctx, 'POST')
  const refused = requireScope(ctx, 'pages:write') ?? requireSitePermission(ctx, ctx.site.snapshot, 'site.edit')
  if (refused) return refused
  const parsed = readPageContentEdits(await readJsonBody(request))
  if ('errors' in parsed) {
    return ApiErrors.badRequest({
      message: 'Page content edits failed validation',
      code: 'validation_failed',
      fields: parsed.errors,
      headers: ctx.headers,
    })
  }
  const service = await pageContentService(deps)
  if (!service) return ApiErrors.notImplemented({ headers: ctx.headers })

  // An insert repeated is two inserts, so a retried request replays its
  // first answer instead of editing again.
  const claimed = await claimWrite(ctx, `${hostId}:${pageId}`, request.headers.get('Idempotency-Key'), 'page-content-edits')
  if ('replay' in claimed) return claimed.replay
  const { claim } = claimed
  try {
    const result = await service.editDraft({
      firestore: ctx.firestore,
      orgId: ctx.orgId,
      hostId,
      pageId,
      edits: parsed.edits,
      ...(parsed.ifRevision !== undefined ? { ifRevision: parsed.ifRevision } : {}),
      actor: { uid: ctx.uid ?? null, label: apiActorLabel(ctx) },
      editId: (deps.editId ?? createResourceUid)(),
      mediaScopes: pageContentMediaScopes(ctx.orgId, hostId),
    })
    if (result.ok === false) {
      // Nothing was written, so the key is given back for a corrected retry.
      await claim.release()
      return refusalResponse(ctx, result)
    }
    const view = {
      object: 'page_content_edit',
      page: result.pageId,
      versionId: result.versionId,
      revision: result.revision,
      applied: result.applied,
      created: result.created,
      editorUrl: editorUrl(ctx, result.pageId, result.versionId, true),
    }
    await claim.record(200, view)
    return apiJson(view, { headers: ctx.headers })
  } catch (error) {
    await claim.release()
    throw error
  }
}

