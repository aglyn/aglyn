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
  isSiblingNameTaken,
  normalizeFolderName,
  normalizeVisibleTo,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { randomUUID } from 'crypto'
import {
  folderStoragePath,
  mediaObjectPath,
  resolveMediaScope,
  sanitizeCustomMetadata,
  mediaCdnPathUpdate,
  scopeCascadeSlice,
} from '../../../../utils/server/media-scope'
import { moveAssetsWithinBudget } from '../../../../utils/server/media-move'

/** Bounded per request — console-triggered admin op, not a batch job. */
const MAX_ASSETS_PER_OP = 500
/** Firestore's hard cap on writes in one batched commit. */
const FIRESTORE_BATCH_LIMIT = 500

/**
 * Folder mutations that move REAL Storage objects (org DAM work): the
 * bucket tree mirrors the library tree, so renaming or deleting a folder
 * relocates every asset underneath to its new prefix — copy (token
 * preserved), variants alongside, doc `url`/`storagePath` updated, old
 * object deleted. Legacy flat-path assets adopt real paths on their
 * first folder operation. Actions:
 *
 * - `rename` {folderId, name}
 * - `delete` {folderId} — children and assets move up to the parent
 * - `move-assets` {mediaIds, folderId|null} — the grid's move/drag
 * - `custom-metadata` {mediaId, customMetadata} — user key/value pairs,
 *   written to the Storage object (token preserved) and the doc (AGL-822)
 * - `set-scope` {folderId, visibleTo, cascade?, preview?, chunkStart?,
 *   chunkSize?} — the folder sharing cascade (AGL-1045); `preview` counts
 *   the subtree without writing, the cursor pair makes it resumable
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

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`.
    const { scope, error } = await resolveMediaScope(body, query, decoded.uid, {
      staff: decoded['staff'] === true,
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
      )
    }
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const scopeRef = scope.scopeRef
    const foldersRef = scopeRef.collection('mediaFolders')
    const mediaRef = scopeRef.collection('media')

    /** Moves one asset (object + variants) to its expected prefix. */
    const relocateAsset = async (
      mediaSnapshot: FirebaseFirestore.DocumentSnapshot,
    ) => {
      const path = await folderStoragePath(
        scopeRef,
        (mediaSnapshot.get('folderId') as string | null) ?? null,
      )
      const expectedPath =
        `${scope.base}/media/` + (path ? `${path}/` : '') + mediaSnapshot.id
      const currentPath = mediaObjectPath(mediaSnapshot, scope.base)
      if (currentPath === expectedPath) return
      const source = bucket.file(currentPath)
      const [exists] = await source.exists()
      if (!exists) {
        // Metadata-only asset (or already moved) — just track the path.
        await mediaSnapshot.ref.set(
          { storagePath: expectedPath },
          { merge: true },
        )
        return
      }
      await source.copy(bucket.file(expectedPath))
      const [metadata] = await bucket.file(expectedPath).getMetadata()
      let token = (metadata?.metadata as any)?.firebaseStorageDownloadTokens
      if (!token) {
        token = randomUUID()
        await bucket.file(expectedPath).setMetadata({
          metadata: { firebaseStorageDownloadTokens: token },
        })
      }
      const url =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
        `${encodeURIComponent(expectedPath)}` +
        `?alt=media&token=${token}`
      const variants: number[] = mediaSnapshot.get('variants') ?? []
      await Promise.all(
        variants.map(async (width) => {
          await bucket
            .file(`${currentPath}__w${width}.webp`)
            .copy(bucket.file(`${expectedPath}__w${width}.webp`))
            .catch(() => undefined)
          await bucket
            .file(`${currentPath}__w${width}.webp`)
            .delete()
            .catch(() => undefined)
        }),
      )
      await source.delete().catch(() => undefined)
      await mediaSnapshot.ref.set(
        { url, storagePath: expectedPath },
        { merge: true },
      )
    }

    /** Every asset filed in the folder or any of its descendants. */
    const subtreeAssets = async (rootFolderId: string) => {
      const folders = await foldersRef.limit(500).get()
      const childrenByParent = new Map<string | null, string[]>()
      for (const folder of folders.docs) {
        const parent = (folder.get('parentId') as string | null) ?? null
        childrenByParent.set(parent, [
          ...(childrenByParent.get(parent) ?? []),
          folder.id,
        ])
      }
      const ids = [rootFolderId]
      for (let index = 0; index < ids.length; index += 1) {
        ids.push(...(childrenByParent.get(ids[index]) ?? []))
      }
      const snapshots: FirebaseFirestore.QueryDocumentSnapshot[] = []
      for (let index = 0; index < ids.length; index += 30) {
        const chunk = ids.slice(index, index + 30)
        const page = await mediaRef.where('folderId', 'in', chunk).get()
        snapshots.push(...page.docs)
        if (snapshots.length > MAX_ASSETS_PER_OP) {
          throw new Error('Folder too large to move in one operation')
        }
      }
      return snapshots
    }

    const action = String(body?.action ?? '')

    if (action === 'rename') {
      const folderId = String(body?.folderId ?? '')
      const name = normalizeFolderName(String(body?.name ?? ''))
      if (!folderId || !name) {
        return Response.json({ error: 'Missing folderId or name' }, { status: 400 })
      }
      const folderSnapshot = await foldersRef.doc(folderId).get()
      if (!folderSnapshot.exists) {
        return Response.json({ error: 'Unknown folder' }, { status: 404 })
      }
      const siblings = await foldersRef.limit(500).get()
      if (
        isSiblingNameTaken(
          name,
          (folderSnapshot.get('parentId') as string | null) ?? null,
          siblings.docs.map((docSnapshot) => ({
            $id: docSnapshot.id,
            ...docSnapshot.data(),
          })) as any,
          folderId,
        )
      ) {
        return Response.json({ error: 'A folder with that name already exists here' }, { status: 409 })
      }
      await foldersRef.doc(folderId).update({ name })
      // The rename changed every descendant's real prefix — relocate.
      const assets = await subtreeAssets(folderId)
      for (const asset of assets) await relocateAsset(asset)
      return Response.json({ ok: true, moved: assets.length }, { status: 200 })
    }

    if (action === 'delete') {
      const folderId = String(body?.folderId ?? '')
      if (!folderId) {
        return Response.json({ error: 'Missing folderId' }, { status: 400 })
      }
      const folderSnapshot = await foldersRef.doc(folderId).get()
      if (!folderSnapshot.exists) {
        return Response.json({ error: 'Unknown folder' }, { status: 404 })
      }
      const parentId = (folderSnapshot.get('parentId') as string | null) ?? null
      // Capture the subtree BEFORE re-parenting shifts it.
      const assets = await subtreeAssets(folderId)
      const children = await foldersRef
        .where('parentId', '==', folderId)
        .get()
      const batch = firebaseAdmin.app().firestore().batch()
      for (const child of children.docs) {
        batch.update(child.ref, { parentId })
      }
      const direct = await mediaRef.where('folderId', '==', folderId).get()
      for (const asset of direct.docs) {
        batch.update(asset.ref, { folderId: parentId })
      }
      batch.delete(foldersRef.doc(folderId))
      await batch.commit()
      // Every asset that lived under the deleted segment moves up.
      for (const asset of assets) {
        await relocateAsset(await asset.ref.get())
      }
      return Response.json({ ok: true, moved: assets.length }, { status: 200 })
    }

    /**
     * The grid's move, bounded and resumable (AGL-1469).
     *
     * This used to be an unbounded serial loop with no try/catch. Moving 19
     * assets ran past the platform's function limit, so the invocation was
     * killed mid-loop: seven assets had already been copied to their new
     * prefix and deleted from the old one, the client got a gateway error
     * whose body would not parse as JSON, and its fallback string — "Move
     * failed" — reported a total failure over a partial rewrite of storage.
     *
     * `moveAssetsWithinBudget` owns the arithmetic and the reason the bound is
     * a clock rather than a count. What matters here is the ANSWER SHAPE: a
     * partial move is a 200 carrying the split, never a status the client can
     * only read as "nothing happened".
     *
     * On a failed asset the `folderId` write may already have landed while the
     * object stayed at its old prefix. That is deliberately left rather than
     * rolled back: `relocateAsset` derives both paths from stored state and
     * skips when they agree, so it is idempotent and a retry converges. The
     * asset's URL keeps working throughout, because it is the OLD url and the
     * old object is still there.
     */
    if (action === 'move-assets') {
      const requested = Array.isArray(body?.mediaIds)
        ? (body.mediaIds as unknown[]).map(String)
        : []
      const mediaIds = requested.slice(0, MAX_ASSETS_PER_OP)
      // Everything past the per-request ceiling. Returned rather than
      // dropped: the old code sliced at 100 and said nothing, so a selection
      // of 150 reported a clean "Moved 150 files" over 50 that never moved.
      const overflowIds = requested.slice(MAX_ASSETS_PER_OP)
      const folderId = body?.folderId ? String(body.folderId) : null
      if (!mediaIds.length) {
        return Response.json({ error: 'Missing mediaIds' }, { status: 400 })
      }
      const { movedIds, failedIds, remainingIds: unreached } =
        await moveAssetsWithinBudget({
          mediaIds,
          moveOne: async (mediaId) => {
            const snapshot = await mediaRef.doc(mediaId).get()
            // A document that is not there cannot be moved and cannot be
            // retried into existence — a failure, not a silent `continue`.
            if (!snapshot.exists) throw new Error('Unknown media')
            await snapshot.ref.set({ folderId }, { merge: true })
            await relocateAsset(await snapshot.ref.get())
          },
          onFailure: (mediaId, error) =>
            console.error('media move failed', mediaId, error),
        })
      const remainingIds = [...unreached, ...overflowIds]
      return Response.json(
        {
          ok: true,
          // `moved` stays the count it always was, so a caller written
          // against the old shape keeps reading the same field.
          moved: movedIds.length,
          movedIds,
          failedIds,
          remainingIds,
          done: remainingIds.length === 0,
        },
        { status: 200 },
      )
    }

    // Folder scope cascade (AGL-1045). Assets carry their OWN `visibleTo`
    // rather than inheriting a folder's at read time — the tree is five
    // levels deep, so inheritance would cost up to five gets per rule
    // evaluation (AGL-1042). Applying a folder's scope is therefore an
    // explicit, auditable WRITE over its subtree, which is what this does.
    //
    // Server-side because it is a bulk write over docs the client would
    // otherwise have to enumerate, and because the org-wide check belongs
    // next to the other privileged media operations.
    if (action === 'set-scope') {
      const folderId = String(body?.folderId ?? '')
      const visibleTo = normalizeVisibleTo(
        Array.isArray(body?.visibleTo) ? (body.visibleTo as string[]) : [],
      )
      if (!folderId || !visibleTo) {
        return Response.json(
          { error: 'Missing folderId or an unusable scope' },
          { status: 400 },
        )
      }
      // Only an org-wide member may set a scope — same rule the client-side
      // writes get from AGL-1042, enforced here because this route uses the
      // Admin SDK and never sees them.
      if (!scope.viewerOrgWide) {
        return Response.json(
          { error: 'Only an organization admin can change sharing' },
          { status: 403 },
        )
      }
      if (scope.collection !== 'orgs') {
        return Response.json(
          { error: 'A site library is private already' },
          { status: 400 },
        )
      }
      const cascade = body?.cascade !== false
      const assets = cascade ? await subtreeAssets(folderId) : []
      // The prompt has to name the number BEFORE anything is written —
      // "also apply to the 47 files in this folder and its subfolders?" is
      // a different question from "also apply to the 3 files" (AGL-1045).
      // Counting is the same subtree walk, so it is the same action with
      // the writes skipped rather than a second endpoint that could drift.
      if (body?.preview === true) {
        return Response.json(
          { ok: true, preview: true, folders: 1, assets: assets.length },
          { status: 200 },
        )
      }
      const targets: FirebaseFirestore.DocumentReference[] = [
        foldersRef.doc(folderId),
        ...assets.map((asset) => asset.ref),
      ]
      // Resumable by cursor: the client may walk the subtree in slices to
      // show progress, and picks up where it stopped after an error or a
      // reload. The cursor is an INDEX into a re-derived list, not stored
      // server state — safe because the walk is deterministic (folder ids
      // then doc ids) and because the write is idempotent, so a re-run over
      // an already-scoped slice costs writes and changes nothing. An asset
      // uploaded mid-run can shift the tail; re-running the action is the
      // fix, which is why it stays idempotent.
      const { start, next, done } = scopeCascadeSlice({
        total: targets.length,
        chunkStart: body?.chunkStart,
        chunkSize: body?.chunkSize,
        batchLimit: FIRESTORE_BATCH_LIMIT,
      })
      const slice = targets.slice(start, next)
      for (let i = 0; i < slice.length; i += FIRESTORE_BATCH_LIMIT) {
        const batch = firebaseAdmin.app().firestore().batch()
        for (const ref of slice.slice(i, i + FIRESTORE_BATCH_LIMIT)) {
          batch.set(ref, { visibleTo }, { merge: true })
        }
        await batch.commit()
      }
      return Response.json(
        {
          ok: true,
          // `folders`/`assets` describe the whole operation, not the slice,
          // so a caller that ignores the cursor reads what it always did.
          folders: 1,
          assets: assets.length,
          total: targets.length,
          written: slice.length,
          next,
          done,
        },
        { status: 200 },
      )
    }

    /**
     * Turn a single asset private, or publish it again (AGL-1051).
     *
     * Server-side because it is the CDN's own gate: `private` decides
     * whether the unauthenticated route serves the bytes, and `cdnPath`
     * has to move with it — going private DELETES the field (that is what
     * keeps the asset out of pickers and page nodes), and going public
     * mints it back. A client-side write could set one without the other
     * and leave an asset that is flagged private and still publicly
     * fetchable at its old URL, which is worse than never having offered
     * the switch.
     *
     * Org-wide members only, matching `set-scope`. Turning an asset public
     * is a publish, and a collaborator scoped to one client site has no
     * standing to publish the agency's files.
     */
    if (action === 'set-private') {
      const mediaId = String(body?.mediaId ?? '')
      const makePrivate = body?.private === true
      if (!mediaId) {
        return Response.json({ error: 'Missing mediaId' }, { status: 400 })
      }
      if (!scope.viewerOrgWide) {
        return Response.json(
          { error: 'Only an organization admin can change this' },
          { status: 403 },
        )
      }
      const snapshot = await mediaRef.doc(mediaId).get()
      if (!snapshot.exists || snapshot.get('deletedAt')) {
        return Response.json({ error: 'Unknown media' }, { status: 404 })
      }
      await snapshot.ref.set(
        {
          private: makePrivate,
          // Shared with upload and replace — publishing must not hand out a
          // CDN path the plan doesn't include, which this branch used to do.
          cdnPath: mediaCdnPathUpdate({
            billing: scope.billing,
            cdnScope: scope.cdnScope,
            mediaId,
            isPrivate: makePrivate,
          }),
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      // Anything already embedding this asset keeps its stored URL, which
      // now 404s — the same trade as deleting an asset, and the reason the
      // picker refuses private assets in the first place.
      return Response.json({ ok: true, private: makePrivate }, { status: 200 })
    }

    if (action === 'custom-metadata') {
      const mediaId = String(body?.mediaId ?? '')
      if (!mediaId) {
        return Response.json({ error: 'Missing mediaId' }, { status: 400 })
      }
      const clean = sanitizeCustomMetadata(body?.customMetadata)
      const snapshot = await mediaRef.doc(mediaId).get()
      if (!snapshot.exists) {
        return Response.json({ error: 'Unknown media' }, { status: 404 })
      }
      // Mirror onto the Storage object's customMetadata, preserving the
      // download token (setMetadata replaces the whole custom map).
      const path = mediaObjectPath(snapshot, scope.base)
      const file = bucket.file(path)
      const [exists] = await file.exists()
      if (exists) {
        const [metadata] = await file.getMetadata()
        const token = (metadata?.metadata as any)?.firebaseStorageDownloadTokens
        await file.setMetadata({
          metadata: {
            ...(token ? { firebaseStorageDownloadTokens: token } : {}),
            ...clean,
          },
        })
      }
      await snapshot.ref.set(
        {
          customMetadata: clean,
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return Response.json({ ok: true, customMetadata: clean }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('media folder operation failed', error)
    return Response.json({ error: error?.message ?? 'Folder operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
/**
 * Every action here relocates real Storage objects — a rename or a folder
 * delete walks the whole subtree, and a move copies each asset AND each of its
 * CDN variants. This route had no declared duration and therefore ran at the
 * account default, which a 19-asset move outran (AGL-1469). Sixty seconds is
 * what the other long-running routes in this app declare; it is headroom for
 * `MOVE_BUDGET_MS`, not a substitute for it — an unbounded loop is not made
 * finishable by a bigger ceiling, only by yielding.
 */
export const maxDuration = 60
export { handler as POST }
