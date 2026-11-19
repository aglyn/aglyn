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
import { artifactCreateListKeys } from '@aglyn/aglyn/app-utils/artifact-list-keys'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { draftScreenSlug } from '@aglyn/aglyn/app-utils/draft-screen-slug'
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  normalizeScreenSlug,
  reservedScreenRouteMessage,
  reservedScreenRouteSegment,
  screenSlugHasPathSeparator,
} from '@aglyn/aglyn/app-utils/screen-route'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { billableScreenIds, readScreenSources } from './billable-screens'
import { hostActivityEntry } from './host-activity-entry'

/*
 * A NEW PAGE, CREATED ON THE SERVER (AGL-4235).
 *
 * The console creates a page in two requests — the page document through
 * `POST /api/hosts/resources` (`resource: 'screen'`, under the plan's page
 * allowance) and its first version through `POST /api/hosts/versions` — from
 * `createScreenDraft`. This is that create as ONE transaction, for a server
 * caller (the public API): the same plan gate counted from the same scan,
 * the page document stored exactly as the resources route stores it, its
 * first version (the empty canvas, or the nodes a template supplies), and the
 * same activity row, which here rides the transaction rather than following
 * it.
 *
 * It publishes NOTHING (AGL-3021): no routing entry, no `publishedAt`, no
 * `parentId`. The address is stored on the page, so a later publish opens
 * with it, and it is one no live page keeps or the routing map serves.
 *
 * Who is asking, whether they may edit the site, and the site's lock stay
 * with the caller, as they do for the routes.
 */

/** Firestore's own document ceiling, the versions route's limit for a seeded tree. */
const MAX_NODES_BYTES = 1024 * 1024

export interface CreatePageDraftInput {
  hostId: string
  /** The site's owning organization, whose plan the page allowance is read from. */
  org: Parameters<typeof checkQuota>[0]
  /** Who the page and the activity row are attributed to: a person, or `'api'` and the key or app's name. */
  actor: HostActivityActor
  displayName: string
  description?: string
  /** The page's search listing, stored on the page as the console's template installers store it. */
  seo?: Record<string, unknown>
  /**
   * The page's own address segment. Refused with a path separator in it or
   * when reserved; otherwise made unique against every live page's slug and
   * every routed address. From the name when absent.
   */
  slug?: string
  /** The first version's node map — a template's design. The empty canvas when absent. */
  nodes?: Record<string, unknown>
  /** The node `nodes` hangs from, when it is not the canvas root. */
  rootId?: string
  /**
   * Ids the caller chose, so a replay finds the page it made instead of a
   * second one. Minted when absent.
   */
  pageId?: string
  versionId?: string
}

export type CreatePageDraftResult =
  | {
      ok: true
      pageId: string
      versionId: string
      /** True when the page already existed from this same create, and nothing was written. */
      replayed: boolean
      /** The page document as stored (server timestamps as written). */
      page: Record<string, unknown>
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413; error: string }

/** The empty canvas a new page's first version opens into, as `createScreenDraft` seeds it. */
export function blankPageNodes(): Record<string, unknown> {
  return {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      nodes: [],
    },
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Creates an unpublished page and its first version in one transaction. */
export async function createPageDraft(firestore: Firestore, input: CreatePageDraftInput): Promise<CreatePageDraftResult> {
  const displayName = String(input.displayName ?? '').trim()
  if (!displayName) return { ok: false, status: 400, error: 'Give the page a name' }
  const typed = typeof input.slug === 'string' ? input.slug : ''
  if (screenSlugHasPathSeparator(typed)) return { ok: false, status: 400, error: SCREEN_SLUG_PATH_SEPARATOR_MESSAGE }
  const reserved = reservedScreenRouteSegment(normalizeScreenSlug(typed))
  if (reserved) return { ok: false, status: 400, error: reservedScreenRouteMessage(reserved) }
  if (input.nodes !== undefined && !isObject(input.nodes)) {
    return { ok: false, status: 400, error: 'A page’s design must be a map of its elements' }
  }
  const nodes = input.nodes ?? blankPageNodes()
  if (JSON.stringify(nodes).length > MAX_NODES_BYTES) return { ok: false, status: 413, error: 'Payload too large' }

  const pageId = input.pageId ? String(input.pageId).slice(0, 64) : createResourceUid()
  const versionId = input.versionId ? String(input.versionId).slice(0, 64) : createResourceUid()
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const pageRef = hostRef.collection('screens').doc(pageId)
  const versionRef = pageRef.collection('versions').doc(versionId)
  const packed = encodeStoredNodes(nodes)

  return firestore.runTransaction(async (tx): Promise<CreatePageDraftResult> => {
    const [host, existing, rows] = await Promise.all([
      tx.get(hostRef),
      tx.get(pageRef),
      // ONE scan, two answers: the plan's page allowance, and the addresses
      // a new page may not take.
      readScreenSources(hostRef as never, (query) => tx.get(query as never) as never, ['slug']),
    ])
    if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
    if (existing.exists) {
      const stored = existing.data() as Record<string, unknown>
      if (stored['versionId'] === versionId && stored['createdBy'] === input.actor.uid) {
        return { ok: true, pageId, versionId, replayed: true, page: stored }
      }
      return { ok: false, status: 409, error: 'That id already exists' }
    }

    // The resources route's gate for a page, counted from the same rule.
    const routingMap = host.get('screens') as Record<string, unknown> | undefined
    const quota = checkQuota(input.org, 'screensPerHost', billableScreenIds(rows, routingMap as never).size)
    if (!quota.allowed) {
      return {
        ok: false,
        status: 403,
        error: `Your plan includes ${quota.limit} ${quota.limit === 1 ? 'page' : 'pages'} — upgrade in Billing for more`,
      }
    }

    const slug = draftScreenSlug(
      typed || null,
      displayName,
      rows.map((row) => ({
        id: row.id,
        slug: typeof row.fields?.['slug'] === 'string' ? (row.fields['slug'] as string) : '',
        deleted: row.deletedAt != null,
      })),
      routingMap,
      host.get('defaultHomeScreenId') as string | undefined,
    )
    // The fields the resources route keeps for a page, in its order.
    const doc: Record<string, unknown> = { displayName }
    if (input.description !== undefined) doc['description'] = input.description
    doc['slug'] = slug
    if (input.seo !== undefined) doc['seo'] = input.seo
    doc['versionId'] = versionId
    const now = Timestamp.now()
    const page: Record<string, unknown> = {
      ...doc,
      ...artifactCreateListKeys('screens', doc),
      createdAt: now,
      updatedAt: now,
      createdBy: input.actor.uid,
    }
    tx.create(pageRef, page)
    tx.create(versionRef, {
      screenId: pageId,
      nodes: packed ? Buffer.from(packed) : nodes,
      ...(input.rootId ? { rootId: input.rootId } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: input.actor.uid,
    })
    tx.set(
      hostRef.collection('activity').doc(createResourceUid()),
      hostActivityEntry(input.actor, 'Created screen', { type: 'screen', id: pageId, name: displayName }, FieldValue.serverTimestamp()),
    )
    return { ok: true, pageId, versionId, replayed: false, page }
  })
}
