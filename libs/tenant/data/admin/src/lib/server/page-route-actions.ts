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
import { PUBLISH_OUTBOX_COLLECTION } from '@aglyn/aglyn/app-utils/publish-outbox'
import {
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  blockingRouteOwner,
  buildScreenRouteEntries,
  composeScreenRoutePath,
  isScreenGroup,
  normalizeScreenSlug,
  reservedScreenRouteMessage,
  reservedScreenRouteSegment,
  screenGroupDissolveMoves,
  screenRoutePathToUrl,
  screenSlugHasPathSeparator,
  toScreenRouteNode,
  wouldCreateScreenCycle,
  type ScreenRouteNode,
} from '@aglyn/aglyn/app-utils/screen-route'
import { planScreenRouteWrite, type ScreenRouteState } from '@aglyn/aglyn/app-utils/screen-route-plan'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore'
import { hostActivityEntry } from './host-activity-entry'

/*
 * A PAGE'S ROUTING WRITES, ON THE SERVER (AGL-3668, lifted for AGL-4235).
 *
 * Publish, unpublish, delete and move a page, and dissolve a page group: the
 * writes the console's Pages hub makes from the browser in one batch — the
 * host's routing map, the page, the placeholder home page it may replace, the
 * publish outbox entry, and the activity row. The derived parts (the composed
 * address, the conflict check, the placeholder release, the addresses to
 * announce) are the console's own pure code (`screen-route.ts`,
 * `screen-route-plan.ts`), run here over the Admin SDK.
 *
 * One implementation, two callers: the native apps' `POST /api/hosts/pages`
 * and the public API's page writes. Who is asking, whether they may, and the
 * site's lock stay with each caller; this does the reads, every refusal and
 * the batch, and answers what the caller needs to settle the cache: the
 * changed live addresses and the outbox entry that names them.
 */

/** The most screens the tree is read for: the hub's own window and more. */
const SCREENS_READ_LIMIT = 2000

export type PageRouteAction = 'publish' | 'unpublish' | 'delete' | 'move' | 'delete-group'
export const PAGE_ROUTE_ACTIONS: readonly PageRouteAction[] = ['publish', 'unpublish', 'delete', 'move', 'delete-group']

export interface PageRouteActionInput {
  hostId: string
  /**
   * The host document as the caller already read it, so the routing map the
   * write is planned against is the one the caller's checks saw. Read here
   * when absent; a missing site then answers 404.
   */
  hostSnapshot?: DocumentSnapshot
  action: PageRouteAction
  /** The page (or, for `delete-group`, the group). */
  pageId: string
  /** `publish`: the page's own address segment, as typed (`/` for the home page). */
  slug?: unknown
  /** `move`: the new parent's id, or null/empty for the top level. */
  parentId?: unknown
  /** `move`: the position among the new siblings; the end when absent. */
  index?: unknown
  /**
   * `publish` only, default off: publish the way the page editor's Publish
   * does, re-addressing the page's attached live descendants under its new
   * address (`buildScreenRouteEntries` with `publish: true`), with the
   * reserved-address and other-owner checks applied to every entry. Off, a
   * publish writes the one page's entry, as the native apps' route does.
   */
  cascade?: boolean
  /** Who the activity row is attributed to: a person's uid and address, or `'api'` and the key or app's name. */
  actor: HostActivityActor
}

export type PageRouteActionRefusal = { ok: false; status: 400 | 404 | 409; error: string }

export interface PageRouteActionSuccess {
  ok: true
  action: PageRouteAction
  pageId: string
  /** What the native route answers: `{ ok, path }` for a publish, `{ ok, moved }` for a move, else `{ ok }`. */
  answer: { ok: true; path?: string; moved?: number }
  /** The routing entries the write set (a path) or removed (`null`). */
  entries: Record<string, string | null>
  /** The site addresses whose cached copy the write changed (`/`, `/pricing`). */
  livePaths: string[]
  /** The publish outbox entry naming `livePaths`, or `null` when nothing live changed. */
  outboxId: string | null
  /** The host document the write was planned against. */
  hostSnapshot: DocumentSnapshot
}

export type PageRouteActionResult = PageRouteActionSuccess | PageRouteActionRefusal

interface ScreenRow extends ScreenRouteNode {
  id: string
  order?: number
  createdAtSeconds?: number
  displayName?: string
}

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message)
  }
}

/** Siblings in the hub's order: `order`, then created, then id. */
function compareSiblings(a: ScreenRow, b: ScreenRow): number {
  const order = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  if (order) return order
  const created = (a.createdAtSeconds ?? 0) - (b.createdAtSeconds ?? 0)
  if (created) return created
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Refuses an entry set any of whose addresses is reserved or served by a page the write does not move. */
function assertEntriesFree(entries: Record<string, string | null>, state: ScreenRouteState): void {
  for (const [id, path] of Object.entries(entries)) {
    const reserved = reservedScreenRouteSegment(path as string)
    if (reserved) throw new Refusal(reservedScreenRouteMessage(reserved), 400)
    const owner = blockingRouteOwner(state.screens, path as string, state.defaultHomeScreenId)
    if (owner && owner !== id && !(owner in entries)) {
      throw new Refusal(`Another page is already published at ${screenRoutePathToUrl(path as string)}`)
    }
  }
}

/**
 * Publishes, unpublishes, deletes or moves a page, or dissolves a group, in
 * one batch. Refusals are answered, never thrown; any other failure throws.
 */
export async function applyPageRouteAction(
  firestore: Firestore,
  input: PageRouteActionInput,
): Promise<PageRouteActionResult> {
  const { hostId, action, pageId: screenId } = input
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = input.hostSnapshot ?? (await hostRef.get())
  if (!hostSnapshot.exists) return { ok: false, status: 404, error: 'Unknown site' }

  const screensSnapshot = await hostRef.collection('screens').limit(SCREENS_READ_LIMIT).get()
  const rows: ScreenRow[] = []
  for (const doc of screensSnapshot.docs) {
    const data = doc.data()
    if (data['deletedAt'] || data['kind'] === 'email') continue
    const created = data['createdAt'] as { seconds?: number } | undefined
    rows.push({
      id: doc.id,
      ...toScreenRouteNode(data),
      order: typeof data['order'] === 'number' ? data['order'] : undefined,
      createdAtSeconds: created?.seconds,
      displayName: typeof data['displayName'] === 'string' ? data['displayName'] : undefined,
    })
  }
  const byId: Record<string, ScreenRow> = Object.fromEntries(rows.map((row) => [row.id, row]))
  const screen = byId[screenId]
  if (!screen) return { ok: false, status: 404, error: 'That page was not found' }

  const state: ScreenRouteState = {
    screens: (hostSnapshot.get('screens') ?? {}) as Record<string, string>,
    defaultHomeScreenId: hostSnapshot.get('defaultHomeScreenId') as string | undefined,
  }
  const screenRef = hostRef.collection('screens').doc(screenId)
  const batch = firestore.batch()
  const hostUpdates: Record<string, unknown> = {}
  let entries: Record<string, string | null> = {}
  let published: string | undefined
  let answer: PageRouteActionSuccess['answer'] = { ok: true }
  let activity: string | null = null

  try {
    if (action === 'publish') {
      if (isScreenGroup(screen)) throw new Refusal('A group has no address of its own', 400)
      const typed = String(input.slug ?? '')
      if (screenSlugHasPathSeparator(typed)) throw new Refusal(SCREEN_SLUG_PATH_SEPARATOR_MESSAGE, 400)
      const slug = normalizeScreenSlug(typed)
      if (!slug) throw new Refusal('Enter a slug ("/" for the home page)', 400)
      const candidate: Record<string, ScreenRouteNode> = { ...byId, [screenId]: { ...screen, slug } }
      const composed = composeScreenRoutePath(screenId, candidate)
      const reserved = reservedScreenRouteSegment(composed ?? slug)
      if (reserved) throw new Refusal(reservedScreenRouteMessage(reserved), 400)
      const path = composed ?? slug
      const owner = composed ? blockingRouteOwner(state.screens, composed, state.defaultHomeScreenId) : undefined
      if (owner && owner !== screenId) {
        throw new Refusal(`Another page is already published at ${screenRoutePathToUrl(path)}`)
      }
      if (input.cascade) {
        // The page editor's Publish: the page and the live pages attached
        // below it, re-addressed together, every one of them checked.
        entries = {
          ...buildScreenRouteEntries(screenId, candidate, state.screens, { publish: true, currentById: byId }),
          [screenId]: path,
        }
        assertEntriesFree(entries, state)
      } else {
        entries = { [screenId]: path }
      }
      published = screenId
      batch.set(screenRef, { slug, publishedAt: Timestamp.now() }, { merge: true })
      answer = { ok: true, path: screenRoutePathToUrl(path) }
      activity = `Published route ${screenRoutePathToUrl(path)}`
    } else if (action === 'unpublish' || action === 'delete') {
      if (isScreenGroup(screen)) throw new Refusal('Use delete-group for a group', 400)
      entries = { [screenId]: null }
      batch.set(screenRef, { publishedAt: FieldValue.delete() }, { merge: true })
      if (action === 'delete') batch.update(screenRef, { deletedAt: Timestamp.now() })
      activity = action === 'delete' ? 'Deleted screen' : 'Unpublished screen'
    } else if (action === 'move') {
      const rawParent = input.parentId
      const parentId = typeof rawParent === 'string' && rawParent ? rawParent : undefined
      if (parentId && !byId[parentId]) throw new Refusal('That parent page was not found', 404)
      if (wouldCreateScreenCycle(screenId, parentId, byId)) throw new Refusal('A page cannot move inside itself')
      const siblings = rows
        .filter((row) => row.id !== screenId && (row.parentId ?? undefined) === parentId)
        .sort(compareSiblings)
      const index = Math.max(0, Math.min(siblings.length, Math.floor(Number(input.index ?? siblings.length))))
      siblings.splice(index, 0, screen)
      const candidate: Record<string, ScreenRouteNode> = { ...byId, [screenId]: { ...screen, parentId } }
      // Only what is already live is re-addressed; a move never publishes.
      entries = buildScreenRouteEntries(screenId, candidate, state.screens, { publish: false, currentById: byId })
      assertEntriesFree(entries, state)
      siblings.forEach((row, at) => {
        const ref = hostRef.collection('screens').doc(row.id)
        if (row.id === screenId) {
          batch.update(ref, { parentId: parentId ?? FieldValue.delete(), order: at, updatedAt: Timestamp.now() })
        } else if (row.order !== at) {
          batch.update(ref, { order: at })
        }
      })
      answer = { ok: true, moved: Object.keys(entries).length }
    } else {
      if (!isScreenGroup(screen)) throw new Refusal('Only a group can be dissolved', 400)
      const moves = screenGroupDissolveMoves(screenId, byId)
      const candidate: Record<string, ScreenRouteNode> = { ...byId }
      for (const [id, parent] of Object.entries(moves)) candidate[id] = { ...byId[id], parentId: parent }
      for (const id of Object.keys(moves)) {
        const live = state.screens[id]
        if (live && composeScreenRoutePath(id, candidate) !== live) {
          throw new Refusal('Deleting this group would change a live page’s address. Move its pages first.')
        }
      }
      const groupParent = screen.parentId
      const outer = rows
        .filter((row) => row.id !== screenId && (row.parentId ?? undefined) === groupParent)
        .sort(compareSiblings)
      const inner = rows.filter((row) => row.parentId === screenId).sort(compareSiblings)
      const at = Math.max(
        0,
        rows
          .filter((row) => (row.parentId ?? undefined) === groupParent)
          .sort(compareSiblings)
          .findIndex((row) => row.id === screenId),
      )
      const ordered = [...outer.slice(0, at), ...inner, ...outer.slice(at)]
      ordered.forEach((row, index) => {
        const ref = hostRef.collection('screens').doc(row.id)
        if (row.parentId === screenId) {
          batch.update(ref, { parentId: groupParent ?? FieldValue.delete(), order: index, updatedAt: Timestamp.now() })
        } else if (row.order !== index) {
          batch.update(ref, { order: index })
        }
      })
      batch.update(screenRef, { deletedAt: Timestamp.now() })
      activity = 'Deleted group'
    }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, status: error.status, error: error.message }
    throw error
  }

  const plan = planScreenRouteWrite(state, entries, published)
  for (const [id, path] of Object.entries(entries)) {
    hostUpdates[`screens.${id}`] = path === null ? FieldValue.delete() : path
  }
  for (const field of plan.hostDeletes) hostUpdates[field] = FieldValue.delete()
  if (plan.placeholderUnpublished) {
    batch.set(
      hostRef.collection('screens').doc(plan.placeholderUnpublished),
      { publishedAt: FieldValue.delete() },
      { merge: true },
    )
  }
  if (Object.keys(hostUpdates).length) batch.update(hostRef, hostUpdates)
  const outboxRef = plan.paths.length ? firestore.collection(PUBLISH_OUTBOX_COLLECTION).doc(createResourceUid()) : null
  if (outboxRef) {
    batch.set(outboxRef, { hostId, paths: plan.paths, createdAt: FieldValue.serverTimestamp(), attempts: 0 })
  }
  if (activity) {
    const target = {
      type: isScreenGroup(screen) ? 'group' : 'screen',
      id: screenId,
      ...(screen.displayName ? { name: screen.displayName } : {}),
    }
    batch.set(
      hostRef.collection('activity').doc(createResourceUid()),
      hostActivityEntry(input.actor, activity, target, Timestamp.now()),
    )
  }
  await batch.commit()

  return {
    ok: true,
    action,
    pageId: screenId,
    answer,
    entries,
    livePaths: plan.paths,
    outboxId: outboxRef?.id ?? null,
    hostSnapshot,
  }
}

/**
 * Drops the cached copies of the addresses a page routing write changed, and
 * releases its outbox entry only when the drop certainly happened — for a
 * caller that settles through `dropPluginSiteCache`, as
 * `settlePageSeoCache` does. Never throws: the write has landed, and an entry
 * left behind is the drain's.
 */
export async function settlePageRouteCache(
  firestore: Firestore,
  input: { hostId: string; livePaths: string[]; outboxId: string | null },
  deps: { dropCache?: typeof dropPluginSiteCache } = {},
): Promise<boolean> {
  if (!input.outboxId || !input.livePaths.length) return false
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  const dropped = await dropCache({
    hostIds: [input.hostId],
    reason: 'API changed a page’s address',
    paths: { [input.hostId]: input.livePaths },
  }).catch(() => ({ complete: false }))
  if (!dropped.complete) return false
  await firestore
    .collection(PUBLISH_OUTBOX_COLLECTION)
    .doc(input.outboxId)
    .delete()
    .catch(() => undefined)
  return true
}
