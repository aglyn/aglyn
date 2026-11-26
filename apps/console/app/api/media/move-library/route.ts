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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  mediaUseRewriter,
  orgToSiteRefusal,
  type MediaLibraryDirection,
  type MediaLibraryMove,
} from '@aglyn/aglyn/app-utils/media-library-move'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
  scopeAllows,
} from '../../../../utils/server/media-scope'
import { moveAssetsWithinBudget } from '../../../../utils/server/media-move'
import {
  MoveRefusal,
  destinationFolders,
  moveOneAcrossLibraries,
  rewriteMovedUses,
  usesOf,
  walkMoveCorpus,
} from '../../../../utils/server/media-library-move'
import {
  removeAssetDeliveryCopies,
  scheduleMediaDeliveryCopies,
} from '../../../../utils/server/media-delivery-copies'
import { revalidateEntireHost } from '../../../../utils/server/tenant-revalidate'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/** Files one request may name. The client sends the rest in the next one. */
const MAX_IDS = 500

/**
 * Moves files between a site's library and the organization library.
 *
 * Body: `{ orgId, hostId, direction: 'to-site' | 'to-org', mediaIds, preview? }`.
 *
 * A file's address names its library, so a move rewrites every stored use of
 * it: pages, layouts, components and email templates (every version, drafts
 * included, compressed or not), content entries, products and their variants,
 * collections, categories, SEO images, site settings, forms and the plugins'
 * records. The old address forwards to the new one, so a page cached before
 * the move or an email already sent keeps showing the file.
 *
 * `to-site` is refused, per file, when anything outside that one site uses
 * it: another site, the workspace's settings or logo, or the CRM. `to-org` is
 * always allowed. `preview: true` answers what would move and what would stay,
 * and writes nothing.
 *
 * The caller needs both keys: editing the workspace library and editing the
 * site. Partial results are reported the way a folder move reports them: what
 * moved, what did not and why, and what is left for the next request.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String(body?.orgId ?? '')
  const hostId = String(body?.hostId ?? '')
  const direction = String(body?.direction ?? '') as MediaLibraryDirection
  const preview = body?.preview === true
  const requested = Array.isArray(body?.mediaIds)
    ? [...new Set((body.mediaIds as unknown[]).map(String).filter(Boolean))]
    : []
  if (!orgId || !hostId) {
    return Response.json({ error: 'Missing orgId or hostId' }, { status: 400 })
  }
  if (direction !== 'to-site' && direction !== 'to-org') {
    return Response.json({ error: 'Unknown direction' }, { status: 400 })
  }
  if (!requested.length) {
    return Response.json({ error: 'Missing mediaIds' }, { status: 400 })
  }
  const mediaIds = requested.slice(0, MAX_IDS)
  const overflowIds = requested.slice(MAX_IDS)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const intent = preview ? 'read' : 'write'
    const staff = decoded['staff'] === true
    // Both libraries, each through the same door every media route uses —
    // the permission, the lockdown verdict and the scope come with it.
    const [orgSide, hostSide] = await Promise.all([
      resolveMediaScope({ orgId }, {}, decoded.uid, { staff, intent }),
      resolveMediaScope({ hostId }, {}, decoded.uid, { staff, intent }),
    ])
    for (const side of [orgSide, hostSide]) {
      if (!side.scope) {
        return (
          side.error?.response ??
          Response.json(
            { error: side.error?.message ?? 'Bad request' },
            { status: side.error?.status ?? 400 },
          )
        )
      }
    }
    const orgScope = orgSide.scope as NonNullable<typeof orgSide.scope>
    const hostScope = hostSide.scope as NonNullable<typeof hostSide.scope>
    if (hostScope.orgId !== orgId) {
      return Response.json({ error: 'That site is not in this workspace' }, { status: 400 })
    }
    const from = direction === 'to-site' ? orgScope : hostScope
    const to = direction === 'to-site' ? hostScope : orgScope

    const firestore = firebaseAdmin.app().firestore()
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    // What is being moved, and the uses of it the walk will look for.
    const sources = await Promise.all(
      mediaIds.map((id) => from.scopeRef.collection('media').doc(id).get()),
    )
    const unknownIds: string[] = []
    const plan: MediaLibraryMove[] = []
    const names: Record<string, string> = {}
    for (const snapshot of sources) {
      if (
        !snapshot.exists ||
        snapshot.get('deletedAt') ||
        !scopeAllows(from, snapshot.get('visibleTo'))
      ) {
        unknownIds.push(snapshot.id)
        continue
      }
      names[snapshot.id] = String(snapshot.get('fileName') ?? snapshot.get('name') ?? snapshot.id)
      plan.push({
        mediaId: snapshot.id,
        fromScope: from.cdnScope,
        toScope: to.cdnScope,
        // A stand-in destination: the walk only needs to recognise the old
        // storage path, and the real one is known once the folder is.
        fromObjectPath: mediaObjectPath(snapshot, from.base),
        toObjectPath: `${to.base}/media/${snapshot.id}`,
      })
    }

    // Org → site has to see every site, to know whether another one uses the
    // file. Site → org only has the one site to rewrite.
    let hostIds = [hostId]
    const siteNames: Record<string, string> = {}
    if (direction === 'to-site') {
      const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).get()
      hostIds = hosts.docs.map((host) => host.id)
      for (const host of hosts.docs) {
        siteNames[host.id] = String(host.get('displayName') ?? host.get('subdomain') ?? host.id)
      }
    }
    const walk = await walkMoveCorpus({
      firestore,
      orgId,
      hostIds,
      mediaIds: plan.map((move) => move.mediaId),
      rewriter: mediaUseRewriter(plan),
    })
    if (!walk.complete) {
      // A move whose uses could not all be found would leave pages pointing
      // at the old address. Refused whole, before anything is written.
      return Response.json(
        {
          error:
            'This workspace has too many pages and records to check in one move. Contact support to move these files.',
        },
        { status: 422 },
      )
    }

    const refused: Array<{ mediaId: string; name: string; reason: string }> = []
    const movable: string[] = []
    for (const move of plan) {
      const uses = usesOf(walk.hits, move.mediaId)
      const reason =
        direction === 'to-site' ? orgToSiteRefusal(uses, hostId, siteNames) : null
      if (reason) refused.push({ mediaId: move.mediaId, name: names[move.mediaId], reason })
      else movable.push(move.mediaId)
    }
    const usesFound = (ids: readonly string[]) =>
      walk.hits
        .filter((hit) => hit.rewritable && hit.mediaIds.some((id) => ids.includes(id)))
        .length

    if (preview) {
      return Response.json(
        {
          ok: true,
          movable,
          refused,
          unknownIds,
          documents: usesFound(movable),
        },
        { status: 200 },
      )
    }

    const folderFor = destinationFolders({ from, to })
    const done: MediaLibraryMove[] = []
    const failures: Record<string, string> = {}
    const { movedIds, failedIds, remainingIds } = await moveAssetsWithinBudget({
      mediaIds: movable,
      moveOne: async (mediaId) => {
        const moved = await moveOneAcrossLibraries({
          firestore,
          bucket,
          from,
          to,
          mediaId,
          uid: decoded.uid,
          folderFor,
        })
        done.push(moved)
      },
      onFailure: (mediaId, error) => {
        failures[mediaId] =
          error instanceof MoveRefusal ? error.message : 'Could not be moved'
        console.error('media library move failed', mediaId, error)
      },
    })

    const rewriter = mediaUseRewriter(done)
    const rewrite = await rewriteMovedUses({
      hits: walk.hits,
      movedIds: new Set(movedIds),
      rewriter,
      hostIds: new Set([hostId]),
    })
    const uses = [...rewriter.counts.values()].reduce((sum, count) => sum + count, 0)

    // Delivery copies follow the file to its new address.
    for (const move of done) {
      await removeAssetDeliveryCopies({
        collection: from.collection,
        scopeId: from.scopeId,
        mediaId: move.mediaId,
      }).catch(() => null)
      scheduleMediaDeliveryCopies({ scope: to, mediaId: move.mediaId })
    }

    // What is published shows the new addresses at the next request rather
    // than at the next daily refresh.
    let republished = false
    if (movedIds.length) {
      const result = await revalidateEntireHost(firestore, hostId, {
        plugins: 'host',
        durable: { reason: 'media files moved between libraries' },
      }).catch(() => null)
      republished = result?.reason === 'ok'
    }

    return Response.json(
      {
        ok: true,
        moved: movedIds.length,
        movedIds,
        failed: failedIds.map((mediaId) => ({
          mediaId,
          name: names[mediaId] ?? mediaId,
          reason: failures[mediaId] ?? 'Could not be moved',
        })),
        refused,
        unknownIds,
        remainingIds: [...remainingIds, ...overflowIds],
        done: remainingIds.length === 0 && overflowIds.length === 0,
        rewrote: { uses, documents: rewrite.documents, failed: rewrite.failed },
        republished,
      },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('media library move failed', error)
    return Response.json({ error: 'Move failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
/**
 * The walk reads every page version of the site (and, for a move to a site,
 * every other site's), then each file is copied with its derived objects.
 * `MOVE_BUDGET_MS` stops the copies early enough to answer; the rest come back
 * as `remainingIds`.
 */
export const maxDuration = 120
export { handler as POST }
