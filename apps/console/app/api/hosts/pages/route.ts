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

import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'
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
import { createResourceUid, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { PUBLISH_OUTBOX_COLLECTION } from '../../../../constants/publish-outbox'
import {
  planScreenRouteWrite,
  type ScreenRouteState,
} from '../../../../constants/screen-route-plan'
import { announceLivePaths } from '../../../../utils/server/announce-live-paths'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/*
 * THE PAGES HUB'S ROUTING WRITES, FOR THE NATIVE APPS (AGL-3668).
 *
 * The console's Pages hub and a page's details make these writes from the
 * browser in one batch: the host's routing map, the page, the placeholder
 * home page it may replace, and the publish outbox entry. The derived parts
 * (the composed address, the conflict check, the placeholder release, the
 * addresses to announce) are the console's own pure code
 * (`screen-route.ts`, `screen-route-plan.ts`), and this route runs that same
 * code over the Admin SDK so an app publishes, unpublishes, moves and
 * deletes a page exactly as the console does, under the same gate: the
 * site's publishing roles, a verified email, and the lockdown verdict.
 *
 *   POST /api/hosts/pages  { hostId, action, id, … }
 *     publish        { slug }                 → { ok, path }
 *     unpublish      {}                       → { ok }
 *     delete         {}                       → { ok }   (a page; soft delete + unpublish)
 *     move           { parentId|null, index } → { ok, moved }
 *     delete-group   {}                       → { ok }   (its pages move up, addresses unchanged)
 */

const PUBLISH_ROLES = new Set(['admin', 'editor'])

/** The most screens the tree is read for: the hub's own window and more. */
const SCREENS_READ_LIMIT = 2000

type Action = 'publish' | 'unpublish' | 'delete' | 'move' | 'delete-group'
const ACTIONS: readonly Action[] = ['publish', 'unpublish', 'delete', 'move', 'delete-group']

interface ScreenRow extends ScreenRouteNode {
  id: string
  order?: number
  createdAtSeconds?: number
  displayName?: string
}

class Refusal extends Error {
  constructor(message: string, readonly status = 409) {
    super(message)
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

/** Siblings in the hub's order: `order`, then created, then id. */
function compareSiblings(a: ScreenRow, b: ScreenRow): number {
  const order = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  if (order) return order
  const created = (a.createdAtSeconds ?? 0) - (b.createdAtSeconds ?? 0)
  if (created) return created
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '') as Action
  const screenId = String(body?.id ?? '')
  if (!hostId) return json({ error: 'Missing hostId' }, 400)
  if (!ACTIONS.includes(action)) return json({ error: 'Unknown action' }, 400)
  if (!screenId) return json({ error: 'Missing id' }, 400)

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) return json({ error: 'Unknown site' }, 404)
    const isStaff = decoded['staff'] === true
    if (!isStaff) {
      const role = String((hostSnapshot.get('memberRoles') ?? {})[decoded.uid] ?? '')
      if (!PUBLISH_ROLES.has(role)) {
        return json({ error: 'Publishing pages needs a publishing role — ask an editor or admin' }, 403)
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      const org = orgId ? (await firestore.collection('orgs').doc(orgId).get()).data() : undefined
      const lockdown = await getLockdownVerdict({ request, uid: decoded.uid, org, host: hostSnapshot.data() })
      if (lockdown) return lockdownJsonResponse(lockdown)
    }

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
    if (!screen) return json({ error: 'That page was not found' }, 404)

    const state: ScreenRouteState = {
      screens: (hostSnapshot.get('screens') ?? {}) as Record<string, string>,
      defaultHomeScreenId: hostSnapshot.get('defaultHomeScreenId') as string | undefined,
    }
    const screenRef = hostRef.collection('screens').doc(screenId)
    const batch = firestore.batch()
    const hostUpdates: Record<string, unknown> = {}
    let entries: Record<string, string | null> = {}
    let published: string | undefined
    let answer: Record<string, unknown> = { ok: true }
    let activity: string | null = null

    if (action === 'publish') {
      if (isScreenGroup(screen)) throw new Refusal('A group has no address of its own', 400)
      const typed = String(body?.slug ?? '')
      if (screenSlugHasPathSeparator(typed)) throw new Refusal(SCREEN_SLUG_PATH_SEPARATOR_MESSAGE, 400)
      const slug = normalizeScreenSlug(typed)
      if (!slug) throw new Refusal('Enter a slug ("/" for the home page)', 400)
      const composed = composeScreenRoutePath(screenId, { ...byId, [screenId]: { ...screen, slug } })
      const reserved = reservedScreenRouteSegment(composed ?? slug)
      if (reserved) throw new Refusal(reservedScreenRouteMessage(reserved), 400)
      const path = composed ?? slug
      const owner = composed ? blockingRouteOwner(state.screens, composed, state.defaultHomeScreenId) : undefined
      if (owner && owner !== screenId) {
        throw new Refusal(`Another page is already published at ${screenRoutePathToUrl(path)}`)
      }
      entries = { [screenId]: path }
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
      const rawParent = body?.parentId
      const parentId = typeof rawParent === 'string' && rawParent ? rawParent : undefined
      if (parentId && !byId[parentId]) throw new Refusal('That parent page was not found', 404)
      if (wouldCreateScreenCycle(screenId, parentId, byId)) throw new Refusal('A page cannot move inside itself')
      const siblings = rows
        .filter((row) => row.id !== screenId && (row.parentId ?? undefined) === parentId)
        .sort(compareSiblings)
      const index = Math.max(0, Math.min(siblings.length, Math.floor(Number(body?.index ?? siblings.length))))
      siblings.splice(index, 0, screen)
      const candidate: Record<string, ScreenRouteNode> = { ...byId, [screenId]: { ...screen, parentId } }
      // Only what is already live is re-addressed; a move never publishes.
      entries = buildScreenRouteEntries(screenId, candidate, state.screens, { publish: false, currentById: byId })
      for (const [id, path] of Object.entries(entries)) {
        const reserved = reservedScreenRouteSegment(path as string)
        if (reserved) throw new Refusal(reservedScreenRouteMessage(reserved), 400)
        const owner = blockingRouteOwner(state.screens, path as string, state.defaultHomeScreenId)
        if (owner && owner !== id && !(owner in entries)) {
          throw new Refusal(`Another page is already published at ${screenRoutePathToUrl(path as string)}`)
        }
      }
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
      const outer = rows.filter((row) => row.id !== screenId && (row.parentId ?? undefined) === groupParent).sort(compareSiblings)
      const inner = rows.filter((row) => row.parentId === screenId).sort(compareSiblings)
      const at = Math.max(0, rows.filter((row) => (row.parentId ?? undefined) === groupParent).sort(compareSiblings).findIndex((row) => row.id === screenId))
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

    const plan = planScreenRouteWrite(state, entries, published)
    for (const [id, path] of Object.entries(entries)) {
      hostUpdates[`screens.${id}`] = path === null ? FieldValue.delete() : path
    }
    for (const field of plan.hostDeletes) hostUpdates[field] = FieldValue.delete()
    if (plan.placeholderUnpublished) {
      batch.set(hostRef.collection('screens').doc(plan.placeholderUnpublished), { publishedAt: FieldValue.delete() }, { merge: true })
    }
    if (Object.keys(hostUpdates).length) batch.update(hostRef, hostUpdates)
    const outboxRef = plan.paths.length ? firestore.collection(PUBLISH_OUTBOX_COLLECTION).doc(createResourceUid()) : null
    if (outboxRef) {
      batch.set(outboxRef, { hostId, paths: plan.paths, createdAt: FieldValue.serverTimestamp(), attempts: 0 })
    }
    if (activity) {
      const target = { type: isScreenGroup(screen) ? 'group' : 'screen', id: screenId, ...(screen.displayName ? { name: screen.displayName } : {}) }
      const actorEmail = (decoded.email as string | undefined) ?? null
      batch.set(hostRef.collection('activity').doc(createResourceUid()), {
        actorId: decoded.uid,
        actorEmail,
        action: activity,
        target,
        searchTokens: activitySearchTokens({ actorEmail, target }),
        createdAt: Timestamp.now(),
      })
    }
    await batch.commit()

    if (outboxRef) {
      // The announcement is best effort; a refused one stays in the outbox for the drain.
      const announced = await announceLivePaths({ hostSnapshot, hostId, paths: plan.paths }).catch(() => false)
      if (announced) await outboxRef.delete().catch(() => undefined)
    }
    return json(answer)
  } catch (error) {
    if (error instanceof Refusal) return json({ error: error.message }, error.status)
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return json({ error: 'That page change did not go through' }, 500)
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
