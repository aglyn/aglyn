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
import {
  bindingTokenNeedsDeep,
  rewriteBindingTokensDeep,
  type BindingDocRef,
} from '@aglyn/aglyn/app-utils/binding-tokens'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { formsOffPublishViolation } from '@aglyn/aglyn/app-utils/form-contract'
import { hasConcurrentWrite, versionStamp } from '@aglyn/aglyn/app-utils/guarded-version-save'
import {
  extractLayoutStyleOverrides,
  normalizeLayoutStyleOverrides,
  replaceUnderMerge,
} from '@aglyn/aglyn/app-utils/layout-style-overrides'
import { formatBytes, measureNodeMap, NODE_MAP_MAX_BYTES } from '@aglyn/aglyn/app-utils/measure-node-map'
import { PUBLISH_OUTBOX_COLLECTION } from '@aglyn/aglyn/app-utils/publish-outbox'
import {
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  blockingRouteOwner,
  buildScreenRouteEntries,
  composeScreenRoutePath,
  normalizeScreenSlug,
  ownScreenSlugFromRoutePath,
  reservedScreenRouteMessage,
  reservedScreenRouteSegment,
  screenClaimsToBeAPage,
  screenRoutePathToUrl,
  screenSlugHasPathSeparator,
  toScreenRouteNode,
  type ScreenRouteNode,
} from '@aglyn/aglyn/app-utils/screen-route'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { VERSION_DRAFT_COLLECTION, VERSION_DRAFT_DOC_ID } from '@aglyn/aglyn/app-utils/version-draft'
import { FORMS_PLUGIN_ID, isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import type { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
} from 'firebase-admin/firestore'
import { clearCoeditMirror, type CoeditMirrorRoom } from './coedit-mirror'
import { hostActivityEntry } from './host-activity-entry'
import { applyPageRouteAction, settlePageRouteCache } from './page-route-actions'
import { pageRoutePath } from './page-seo-write'

/*
 * ONE PAGE'S DRAFT GOES LIVE, ON THE SERVER (AGL-4235).
 *
 * The page editor's Publish (`saveAndPromote` in the Besigner's page route)
 * puts the canvas into the version the page points at and, for a page with
 * no address yet, publishes its address after it. On the live version the
 * canvas's unsaved work is the version's WORKING DRAFT
 * (`…/versions/{versionId}/draft/current`, one per version, shared by
 * everyone), so on the server "publish the page" means: take that draft, do
 * to it what the editor's save does, store it in the version, delete the
 * draft, and give a new page its address.
 *
 * What the editor's save does to the canvas, and what happens here:
 *
 * - `normalizeCanvasBindingTokens`: a typed `{{name}}` / `{{fn:name(…)}}`
 *   becomes its id form against the site's variables and functions. The
 *   same pure rewrite (`rewriteBindingTokensDeep`) runs here over each
 *   node's `props`, against the same two lists the editor reads
 *   (`hosts/{h}/variables` and `…/functions`, 100 each, deleted and unnamed
 *   ones left out, keyed by name and then by id). The editor also lists the
 *   variables a plugin connection gives the site, which this cannot read
 *   from core; it needs no such list, because a connection variable can
 *   never be what a typed token resolves to (its name always holds `: `,
 *   which a typed name cannot, and its id always holds `-`).
 * - `recordCanvasRenderedWidths`: measures what the browser rendered. There
 *   is no rendering here, so the widths stored on the nodes stay as they are.
 * - `extractLayoutStyleOverrides` / `replaceUnderMerge`: exactly as
 *   `saveScreenVersion`. A draft whose root carries no overrides over a
 *   version that stores some is REFUSED: the editor would read that as the
 *   author clearing them, but a draft written by something other than a
 *   canvas (an AI edit) never carries them, and nothing here can tell the
 *   two apart. That page is published from the editor.
 * - `measureNodeMap` against `NODE_MAP_MAX_BYTES`, and
 *   `formsOffPublishViolation` with the site's enabled plugins, as the
 *   editor's `refuseFormsOff` reads them.
 *
 * The staleness rule is the editor's: a draft taken against a version that
 * has been saved since (`hasConcurrentWrite(baseStamp, versionStamp(updatedAt))`)
 * is not offered there, and is refused here.
 *
 * Split in two so a caller can check every page before writing any:
 * {@link precheckPagePublish} reads and validates and writes nothing;
 * {@link commitPagePublish} re-reads and re-validates inside one
 * transaction before it writes, then publishes a new page's address through
 * `applyPageRouteAction` (a batch of its own, which re-checks the address).
 *
 * Never: moves `versionId`, touches `publishedAt` on a page that is already
 * live (the placeholder home page aside, which the editor republishes
 * through the route seam), publishes a layout's or a component's draft, or
 * changes a page it was not given.
 */

/** The most screens the address check reads: what `applyPageRouteAction` reads. */
const SCREENS_READ_LIMIT = 2000

/** How many variables and functions the editor's binding lookups list (`useHostBindingDocs`). */
const BINDING_DOCS_LIMIT = 100

export type PagePublishStatus = 400 | 404 | 409 | 413

/** Why a page cannot be published. `code` is stable for a client to branch on. */
export interface PagePublishRefusal {
  ok: false
  pageId: string
  status: PagePublishStatus
  code: string
  message: string
  /**
   * `commitPagePublish` only: the draft was stored in the page's version
   * before its address was refused. The page has no address, so no visitor
   * sees it.
   */
  draftSaved?: boolean
}

/**
 * What publishing one page will do:
 * - `live`: the page has an address; its draft goes into its version.
 * - `placeholder`: the site's placeholder home page (`defaultHomeScreenId`);
 *   its draft goes in, and its address is republished as the owner's.
 * - `first`: the page has no address; its draft (if any) goes in, then its
 *   address is published, with the live pages below it.
 */
export type PagePublishCase = 'live' | 'placeholder' | 'first'

export interface PagePublishPlan {
  ok: true
  pageId: string
  case: PagePublishCase
  versionId: string
  /** Whether a usable draft will be stored in the version. */
  saveDraft: boolean
  /** The page's routing path once published (`/` for home, `company/about`). */
  path: string
  /** The address a publish of the route writes; absent for a `live` page. */
  slug?: string
}

export type PagePublishPrecheck = PagePublishPlan | PagePublishRefusal

export interface PagePublishSuccess {
  ok: true
  pageId: string
  /** The page's address as a visitor types it (`/`, `/company/about`). */
  path: string
  /** `unchanged`: a live page with no draft, so nothing was written. */
  status: 'published' | 'unchanged'
}

export type PagePublishResult = PagePublishSuccess | PagePublishRefusal

export interface PagePublishInput {
  hostId: string
  /** The workspace that owns the site: the co-edit mirror room is under it. */
  orgId: string
  pageId: string
  /**
   * The workspace document, for whether Forms runs on the site
   * (`isHostPluginEnabled`). Absent, the forms check refuses nothing, as the
   * editor's does when it cannot tell.
   */
  org?: { enabledPlugins?: string[] } | null
}

export interface PagePublishCommitInput extends PagePublishInput {
  /** Who the activity rows are attributed to. */
  actor: HostActivityActor
}

export interface PagePublishDeps {
  dropCache?: typeof dropPluginSiteCache
  clearMirror?: (room: CoeditMirrorRoom) => Promise<unknown>
}

type GetDoc = (ref: DocumentReference) => Promise<DocumentSnapshot>
type GetQuery = (query: Query) => Promise<QuerySnapshot>

type Nodes = Record<string, { props?: Record<string, unknown>; componentId?: string } | undefined>

class Refused extends Error {
  constructor(
    readonly status: PagePublishStatus,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function refusal(pageId: string, error: Refused): PagePublishRefusal {
  return { ok: false, pageId, status: error.status, code: error.code, message: error.message }
}

function refs(firestore: Firestore, hostId: string, pageId: string, versionId?: string) {
  const host = firestore.collection('hosts').doc(hostId)
  const page = host.collection('screens').doc(pageId)
  const version = versionId ? page.collection('versions').doc(versionId) : null
  return {
    host,
    page,
    version,
    draft: version ? version.collection(VERSION_DRAFT_COLLECTION).doc(VERSION_DRAFT_DOC_ID) : null,
    variables: host.collection('variables').limit(BINDING_DOCS_LIMIT),
    functions: host.collection('functions').limit(BINDING_DOCS_LIMIT),
  }
}

/**
 * The binding lookups the editor converts typed names against, from the two
 * lists it reads: deleted and unnamed documents left out, keyed by name and
 * then by id, so an id key wins a collision (`bindingLookupsFromDocs`).
 */
function bindingLookups(snapshot: QuerySnapshot): Record<string, BindingDocRef> {
  const live = snapshot.docs
    .map((doc) => ({ ...(doc.data() as Record<string, unknown>), $id: doc.id }))
    .filter((doc) => !doc['deletedAt'] && typeof doc['name'] === 'string' && doc['name'])
  const map: Record<string, BindingDocRef> = {}
  for (const doc of live) map[doc['name'] as string] = doc as BindingDocRef
  for (const doc of live) map[doc.$id] = doc as BindingDocRef
  return map
}

/** The draft as the editor would offer it, or why it would not. */
type DraftState = { kind: 'none' } | { kind: 'stale' } | { kind: 'usable'; nodes: Nodes }

function draftState(draft: DocumentSnapshot | null, version: DocumentSnapshot): DraftState {
  if (!draft?.exists) return { kind: 'none' }
  const nodes = decodeStoredNodes<Nodes>(draft.get('nodes'))
  if (!nodes || !Object.keys(nodes).length) return { kind: 'none' }
  const baseStamp = typeof draft.get('baseStamp') === 'string' ? (draft.get('baseStamp') as string) : null
  if (hasConcurrentWrite(baseStamp, versionStamp(version.get('updatedAt')))) return { kind: 'stale' }
  return { kind: 'usable', nodes }
}

/** What the version write stores, after the editor's save rules. */
interface PreparedTree {
  storedNodes: Record<string, unknown>
  layoutStyleOverrides: unknown
}

/**
 * The draft's tree, put through what the editor's save does before it
 * writes. Throws {@link Refused} for a tree the editor would refuse, or one
 * this cannot prepare the way the editor would.
 */
async function prepareTree(
  nodes: Nodes,
  context: {
    host: DocumentSnapshot
    version: DocumentSnapshot
    org: PagePublishInput['org']
    lookups: () => Promise<{ variables: Record<string, BindingDocRef>; functions: Record<string, BindingDocRef> }>
  },
): Promise<PreparedTree> {
  // `refuseFormsOff`, on the tree as it stands, before anything else.
  const formsOn = context.org ? isHostPluginEnabled(context.org, context.host.data() ?? null, FORMS_PLUGIN_ID) : undefined
  const forms = formsOffPublishViolation(nodes as never, formsOn)
  if (forms) throw new Refused(409, 'forms_off_for_site', forms.message)

  // `normalizeCanvasBindingTokens`: only `props`, and only when a token needs it.
  let tree: Nodes = nodes
  const needs = bindingTokenNeedsDeep(nodes)
  if (needs.variables || needs.functions) {
    const { variables, functions } = await context.lookups()
    const next: Nodes = { ...nodes }
    let changed = false
    for (const [id, node] of Object.entries(nodes)) {
      if (!node?.props) continue
      const rewritten = rewriteBindingTokensDeep(node.props, variables, functions)
      if (!rewritten.changed) continue
      next[id] = { ...node, props: rewritten.value }
      changed = true
    }
    if (changed) tree = next
  }
  // `recordCanvasRenderedWidths` measures a rendered canvas; there is none
  // here, so the widths the nodes already store are kept as they are.

  // The size guard the editor runs on the tree it is about to save.
  const size = measureNodeMap(tree)
  if (size.tooLarge) {
    throw new Refused(
      413,
      'page_too_large',
      `This page is ${formatBytes(size.bytes)}, over the ${formatBytes(NODE_MAP_MAX_BYTES)} a page can be saved at. Move repeated sections into reusable components, or replace inlined images with uploads from the media library.`,
    )
  }

  const extracted = extractLayoutStyleOverrides(tree as Record<string, unknown>)
  const rootCarriedOverrides = extracted.nodes !== tree
  if (!rootCarriedOverrides && normalizeLayoutStyleOverrides(context.version.get('layoutStyleOverrides'))) {
    throw new Refused(
      409,
      'publish_from_editor',
      'This page’s draft does not say whether to keep the page’s layout style changes, so it has to be published from the editor.',
    )
  }
  return { storedNodes: extracted.nodes as Record<string, unknown>, layoutStyleOverrides: extracted.layoutStyleOverrides }
}

interface DocRead {
  case: PagePublishCase
  versionId: string
  routePath: string | null
  page: DocumentSnapshot
  host: DocumentSnapshot
  version: DocumentSnapshot
  versionRef: DocumentReference
  draftRef: DocumentReference
  prepared: PreparedTree | null
}

/**
 * Reads the page, its site, the version it points at and that version's
 * draft through `get`, and decides what publishing it does. Throws
 * {@link Refused}. Runs as the precheck's plain reads and as the commit's
 * transaction reads, so both apply one rule.
 */
async function readPage(
  firestore: Firestore,
  input: PagePublishInput,
  get: GetDoc,
  getQuery: GetQuery,
): Promise<DocRead> {
  const { hostId, pageId } = input
  const base = refs(firestore, hostId, pageId)
  const [host, page] = await Promise.all([get(base.host), get(base.page)])
  if (!host.exists) throw new Refused(404, 'site_not_found', 'No such site')
  const data = page.data() as Record<string, unknown> | undefined
  if (!page.exists || !data || data['deletedAt'] != null) {
    throw new Refused(404, 'page_not_found', 'No such page on this site')
  }
  if (!screenClaimsToBeAPage(data as never)) {
    throw new Refused(400, 'not_a_page', 'Only a site’s ordinary pages can be published here; this is an email design, an error page, a collection template or a page group.')
  }
  const schedule = data['publishSchedule'] as Record<string, unknown> | null | undefined
  if (schedule && schedule['status'] === 'pending') {
    throw new Refused(409, 'scheduled_publish_pending', 'This page has a scheduled publish waiting. Cancel it, or run it now, in the console first.')
  }
  const versionId = text(data['versionId'])
  if (!versionId) throw new Refused(409, 'no_version', 'This page has no saved version to publish.')
  const { version: versionRef, draft: draftRef } = refs(firestore, hostId, pageId, versionId) as {
    version: DocumentReference
    draft: DocumentReference
  }
  const [version, draft] = await Promise.all([get(versionRef), get(draftRef)])
  if (!version.exists) throw new Refused(409, 'no_version', 'This page has no saved version to publish.')

  const routePath = pageRoutePath(host.get('screens'), pageId)
  const state = draftState(draft, version)
  if (state.kind === 'stale') {
    throw new Refused(409, 'stale_draft', 'This page’s draft was started before its last save, so it is out of date. Open it in the editor to bring it up to date, then publish.')
  }
  const placeholder = routePath !== null && host.get('defaultHomeScreenId') === pageId
  const prepared =
    state.kind === 'usable'
      ? await prepareTree(state.nodes, {
          host,
          version,
          org: input.org,
          lookups: async () => {
            const [variables, functions] = await Promise.all([getQuery(base.variables), getQuery(base.functions)])
            return { variables: bindingLookups(variables), functions: bindingLookups(functions) }
          },
        })
      : null
  // A placeholder home page with nothing to save is "Already published" in
  // the editor, and changes nothing there either.
  const kind: PagePublishCase = routePath === null ? 'first' : placeholder && prepared ? 'placeholder' : 'live'
  return { case: kind, versionId, routePath, page, host, version, versionRef, draftRef, prepared }
}

/**
 * The address checks the editor makes before it publishes a page's route,
 * over the site's pages as stored now, with the pure helpers both use:
 * a slug, no path separator in it, every ancestor addressed
 * (`unpublishedAncestor`), not a reserved address, not another page's
 * (`slugConflict`), and — for a first publish, which re-addresses the live
 * pages below it — the same for each of those. Answers the slug the route
 * write takes and the path it composes.
 */
async function checkAddress(
  firestore: Firestore,
  input: { hostId: string; pageId: string; host: DocumentSnapshot; page: DocumentSnapshot; routePath: string | null; cascade: boolean },
): Promise<{ slug: string; path: string }> {
  const { pageId } = input
  const typed = text(input.page.get('slug')) || (input.routePath !== null ? (ownScreenSlugFromRoutePath(input.routePath) ?? '') : '')
  if (screenSlugHasPathSeparator(typed)) throw new Refused(400, 'slug_path_separator', SCREEN_SLUG_PATH_SEPARATOR_MESSAGE)
  const slug = normalizeScreenSlug(typed)
  if (!slug) throw new Refused(400, 'no_slug', 'This page has no address (slug) yet. Give it one before publishing it.')

  const screens = await firestore.collection('hosts').doc(input.hostId).collection('screens').limit(SCREENS_READ_LIMIT).get()
  const byId: Record<string, ScreenRouteNode> = {}
  for (const doc of screens.docs) {
    const data = doc.data()
    if (data['deletedAt'] || data['kind'] === 'email') continue
    byId[doc.id] = toScreenRouteNode(data)
  }
  const candidate: Record<string, ScreenRouteNode> = { ...byId, [pageId]: { ...(byId[pageId] ?? {}), slug } }
  const path = composeScreenRoutePath(pageId, candidate)
  if (!path) throw new Refused(409, 'unpublished_ancestor', 'Publish the parent page first.')
  const routing = (input.host.get('screens') ?? {}) as Record<string, string>
  const defaultHome = input.host.get('defaultHomeScreenId') as string | undefined
  if (input.routePath !== null && path !== input.routePath) {
    // The placeholder republishes where it is; a move is not this call's.
    throw new Refused(409, 'address_changed', `This page is live at ${screenRoutePathToUrl(input.routePath)}, and publishing it would move it to ${screenRoutePathToUrl(path)}. Publish it from the editor.`)
  }
  const entries: Record<string, string> = input.cascade
    ? { ...buildScreenRouteEntries(pageId, candidate, routing, { publish: true, currentById: byId }), [pageId]: path }
    : { [pageId]: path }
  for (const [id, entry] of Object.entries(entries)) {
    const reserved = reservedScreenRouteSegment(entry)
    if (reserved) throw new Refused(400, 'reserved_address', reservedScreenRouteMessage(reserved))
    const owner = blockingRouteOwner(routing, entry, defaultHome)
    if (owner && owner !== id && !(owner in entries)) {
      throw new Refused(409, 'address_taken', `Another page is already published at ${screenRoutePathToUrl(entry)}.`)
    }
  }
  return { slug, path }
}

const plainGet: GetDoc = (ref) => ref.get()
const plainQuery: GetQuery = (query) => query.get()

/**
 * Reads and checks one page's publish, and writes NOTHING. Answers what the
 * publish will do, or why it is refused. Refusals are answered, never
 * thrown; any other failure throws.
 */
export async function precheckPagePublish(firestore: Firestore, input: PagePublishInput): Promise<PagePublishPrecheck> {
  try {
    const read = await readPage(firestore, input, plainGet, plainQuery)
    const plan: PagePublishPlan = {
      ok: true,
      pageId: input.pageId,
      case: read.case,
      versionId: read.versionId,
      saveDraft: Boolean(read.prepared),
      path: read.routePath ?? '',
    }
    if (read.case !== 'live') {
      const address = await checkAddress(firestore, {
        hostId: input.hostId,
        pageId: input.pageId,
        host: read.host,
        page: read.page,
        routePath: read.routePath,
        cascade: read.case === 'first',
      })
      plan.slug = address.slug
      plan.path = address.path
    }
    return plan
  } catch (error) {
    if (error instanceof Refused) return refusal(input.pageId, error)
    throw error
  }
}

/**
 * Publishes one page as {@link precheckPagePublish} planned it. The draft
 * goes into the version in ONE transaction that re-reads and re-validates
 * everything first, with its outbox entry (a live page) and its activity
 * row; a page that changed shape since the precheck is refused. Then a new
 * page's address is published through `applyPageRouteAction`, whose
 * refusals are passed through. After the writes, best effort: the version's
 * co-edit mirror is cleared and the live pages' cache is settled.
 */
export async function commitPagePublish(
  firestore: Firestore,
  input: PagePublishCommitInput,
  plan: PagePublishPlan,
  deps: PagePublishDeps = {},
): Promise<PagePublishResult> {
  const { hostId, pageId } = input
  try {
    // The address is checked again before anything is written, so a page
    // whose address went to another page meanwhile writes nothing.
    if (plan.case !== 'live') {
      const [host, page] = await Promise.all([
        firestore.collection('hosts').doc(hostId).get(),
        firestore.collection('hosts').doc(hostId).collection('screens').doc(pageId).get(),
      ])
      await checkAddress(firestore, {
        hostId,
        pageId,
        host,
        page,
        routePath: plan.case === 'placeholder' ? plan.path : null,
        cascade: plan.case === 'first',
      })
    }

    const saved = await firestore.runTransaction(async (tx) => {
      const read = await readPage(
        firestore,
        input,
        (ref) => tx.get(ref),
        (query) => tx.get(query),
      )
      if (read.case !== plan.case || read.versionId !== plan.versionId || Boolean(read.prepared) !== plan.saveDraft) {
        throw new Refused(409, 'page_changed', 'This page changed while it was being published. Nothing was published; try again.')
      }
      if (!read.prepared) return { outboxId: null as string | null }
      const overridesWrite = replaceUnderMerge(read.version.get('layoutStyleOverrides'), read.prepared.layoutStyleOverrides, () =>
        FieldValue.delete(),
      )
      const packed = encodeStoredNodes(read.prepared.storedNodes)
      tx.set(
        read.versionRef,
        {
          nodes: packed ? Buffer.from(packed) : read.prepared.storedNodes,
          ...(overridesWrite === undefined ? {} : { layoutStyleOverrides: overridesWrite }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      tx.delete(read.draftRef)
      let outboxId: string | null = null
      if (read.routePath !== null) {
        const outboxRef = firestore.collection(PUBLISH_OUTBOX_COLLECTION).doc(createResourceUid())
        tx.set(outboxRef, {
          hostId,
          paths: [screenRoutePathToUrl(read.routePath)],
          createdAt: FieldValue.serverTimestamp(),
          attempts: 0,
        })
        outboxId = outboxRef.id
      }
      const name = text(read.page.get('displayName'))
      tx.set(
        firestore.collection('hosts').doc(hostId).collection('activity').doc(createResourceUid()),
        hostActivityEntry(
          input.actor,
          'Published the screen',
          { type: 'screen', id: pageId, ...(name ? { name } : {}), versionId: read.versionId },
          Timestamp.now(),
        ),
      )
      return { outboxId }
    })

    if (plan.saveDraft) {
      const clear = deps.clearMirror ?? clearCoeditMirror
      await Promise.resolve(
        clear({ orgId: input.orgId, hostId, docType: 'screen', docId: pageId, versionId: plan.versionId }),
      ).catch(() => undefined)
      if (saved.outboxId && plan.case !== 'first') {
        await settlePageRouteCache(
          firestore,
          { hostId, livePaths: [screenRoutePathToUrl(plan.path)], outboxId: saved.outboxId },
          { dropCache: deps.dropCache },
        )
      }
    }

    if (plan.case === 'live') {
      return { ok: true, pageId, path: screenRoutePathToUrl(plan.path), status: plan.saveDraft ? 'published' : 'unchanged' }
    }

    const route = await applyPageRouteAction(firestore, {
      hostId,
      action: 'publish',
      pageId,
      slug: plan.slug,
      cascade: plan.case === 'first',
      actor: input.actor,
    })
    if (route.ok === false) {
      return {
        ok: false,
        pageId,
        status: route.status,
        code: 'route_refused',
        message: route.error,
        ...(plan.saveDraft && plan.case === 'first' ? { draftSaved: true } : {}),
      }
    }
    await settlePageRouteCache(firestore, { hostId, livePaths: route.livePaths, outboxId: route.outboxId }, { dropCache: deps.dropCache })
    return { ok: true, pageId, path: route.answer.path ?? screenRoutePathToUrl(plan.path), status: 'published' }
  } catch (error) {
    if (error instanceof Refused) return refusal(pageId, error)
    throw error
  }
}

// ── A list of pages ─────────────────────────────────────────────────────────

/** One page's line in an answer about a list. */
export type PagePublishEntry =
  | { page: string; status: 'published' | 'unchanged'; path: string }
  | { page: string; status: 'refused'; code: string; message: string; draftSaved?: boolean }
  /** Not written: a page before it was refused, or after one was. */
  | { page: string; status: 'not_attempted' }

export interface PagePublishListRefusal {
  ok: false
  /** The first refused page's. */
  status: PagePublishStatus
  code: string
  message: string
  /** Every page named, in order. */
  pages: PagePublishEntry[]
}

function refusedEntry(result: PagePublishRefusal): PagePublishEntry {
  return {
    page: result.pageId,
    status: 'refused',
    code: result.code,
    message: result.message,
    ...(result.draftSaved ? { draftSaved: true } : {}),
  }
}

/**
 * Prechecks every page named, writing nothing. Any refusal refuses the
 * list; two pages that would take the same new address refuse the second.
 */
export async function precheckPagePublishes(
  firestore: Firestore,
  input: Omit<PagePublishInput, 'pageId'> & { pageIds: readonly string[] },
): Promise<{ ok: true; plans: PagePublishPlan[] } | PagePublishListRefusal> {
  const results: PagePublishPrecheck[] = []
  for (const pageId of input.pageIds) {
    results.push(await precheckPagePublish(firestore, { hostId: input.hostId, orgId: input.orgId, org: input.org, pageId }))
  }
  const claimed = new Set<string>()
  const checked = results.map((result): PagePublishPrecheck => {
    if (result.ok === false || result.case !== 'first') return result
    if (claimed.has(result.path)) {
      return {
        ok: false,
        pageId: result.pageId,
        status: 409,
        code: 'address_taken',
        message: `Another page in this request would be published at ${screenRoutePathToUrl(result.path)}.`,
      }
    }
    claimed.add(result.path)
    return result
  })
  const first = checked.find((result): result is PagePublishRefusal => result.ok === false)
  if (!first) return { ok: true, plans: checked as PagePublishPlan[] }
  return {
    ok: false,
    status: first.status,
    code: first.code,
    message: first.message,
    pages: checked.map((result) => (result.ok === false ? refusedEntry(result) : { page: result.pageId, status: 'not_attempted' })),
  }
}

/**
 * Commits prechecked pages in order, stopping at the first refusal (a race:
 * the page or the site changed after the precheck). Answers what went live,
 * and, on a refusal, every page's line, so nothing is claimed that did not
 * happen.
 */
export async function commitPagePublishes(
  firestore: Firestore,
  input: Omit<PagePublishCommitInput, 'pageId'>,
  plans: readonly PagePublishPlan[],
  deps: PagePublishDeps = {},
): Promise<{ ok: true; promoted: PagePublishEntry[] } | (PagePublishListRefusal & { promoted: PagePublishEntry[] })> {
  const promoted: PagePublishEntry[] = []
  for (const [index, plan] of plans.entries()) {
    const result = await commitPagePublish(firestore, { ...input, pageId: plan.pageId }, plan, deps)
    if (result.ok === true) {
      promoted.push({ page: result.pageId, status: result.status, path: result.path })
      continue
    }
    return {
      ok: false,
      status: result.status,
      code: result.code,
      message: result.message,
      promoted,
      pages: [
        ...promoted,
        refusedEntry(result),
        ...plans.slice(index + 1).map((rest): PagePublishEntry => ({ page: rest.pageId, status: 'not_attempted' })),
      ],
    }
  }
  return { ok: true, promoted }
}
