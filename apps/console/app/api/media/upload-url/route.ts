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
import { checkEntitlement, checkQuota, createResourceUid } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  folderStoragePath,
  resolveMediaScope,
} from '../../../../utils/server/media-scope'
import { randomUUID } from 'crypto'

/** Signed-URL cap (AGL-167): raises video past the base64 body limit. */
const MAX_SIGNED_VIDEO_BYTES = 200 * 1024 * 1024
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
const SIGNED_URL_TTL_MS = 15 * 60 * 1000

/**
 * Large-video uploads via signed URLs (AGL-167): base64-JSON bodies cap
 * practical uploads around 25MB, so large video goes direct-to-storage.
 * POST mints a v4 signed PUT URL after the same auth/entitlement/quota
 * checks as /api/media/upload (declared size is provisional); PATCH
 * finalizes — verifies the object's REAL size against the quota (deleting
 * it on violation, so a lying client gains nothing), attaches the
 * download token, and writes the Firestore doc + byte counter.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'PATCH') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const { scope, error } = await resolveMediaScope(
      body,
      query,
      decoded.uid,
    )
    if (!scope) {
      return Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
    }
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    // Quota/entitlements ride the owning org's doc (AGL-238).
    const org = scope.billing
    const counterRef = scope.scopeRef.collection('counters').doc('media')

    if (method === 'POST') {
      const contentType = String(body?.contentType ?? '')
      const sizeBytes = Number(body?.sizeBytes ?? 0)
      if (!VIDEO_TYPES.has(contentType)) {
        return Response.json({
          error: 'Signed uploads are for mp4/webm/quicktime video',
        }, { status: 415 })
      }
      if (
        !Number.isFinite(sizeBytes) ||
        sizeBytes <= 0 ||
        sizeBytes > MAX_SIGNED_VIDEO_BYTES
      ) {
        return Response.json({
          error: `Video uploads are capped at ${
            MAX_SIGNED_VIDEO_BYTES / 1024 / 1024
          }MB`,
        }, { status: 413 })
      }
      if (!checkEntitlement(org as any, 'videoMedia')) {
        return Response.json({ error: 'Video uploads require a Pro plan' }, { status: 403 })
      }
      {
        // Storage quota applies to every org; a plan-less org resolves as
        // `free` (250 MB cap), not unmetered.
        const counterSnapshot = await counterRef.get()
        const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
        const usedMb = (usedBytes + sizeBytes) / (1024 * 1024)
        // usedMb includes the incoming file; ceil-1 allows exactly up to
        // the integer MB cap and no further (AGL-471 off-by-one).
        const quota = checkQuota(
          org as any,
          'storagePerHostMb',
          Math.ceil(usedMb) - 1,
        )
        if (!quota.allowed) {
          return Response.json({ error: `Storage limit reached (${quota.limit} MB)` }, { status: 403 })
        }
      }

      // Real folders: the signed URL is path-bound, so the destination
      // folder is decided here (the finalize PATCH re-derives it).
      const folderId =
        typeof body?.folderId === 'string' && body.folderId
          ? String(body.folderId).slice(0, 64)
          : null
      const folderPath = await folderStoragePath(scope.scopeRef, folderId)
      const mediaId = createResourceUid()
      const file = bucket.file(
        `${scope.base}/media/` +
          (folderPath ? `${folderPath}/` : '') +
          mediaId,
      )
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + SIGNED_URL_TTL_MS,
        contentType,
      })
      return Response.json({ mediaId, uploadUrl, contentType }, { status: 200 })
    }

    // PATCH — finalize after the client's direct PUT.
    const mediaId = String(body?.mediaId ?? '')
    const fileName = String(body?.fileName ?? 'video').slice(0, 200)
    const folderId =
      typeof body?.folderId === 'string' && body.folderId
        ? String(body.folderId).slice(0, 64)
        : null
    if (!mediaId) return Response.json({ error: 'Missing mediaId' }, { status: 400 })
    const folderPath = await folderStoragePath(scope.scopeRef, folderId)
    const objectPath =
      `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
    const file = bucket.file(objectPath)
    const [exists] = await file.exists()
    if (!exists) {
      return Response.json({ error: 'Upload not found — retry' }, { status: 409 })
    }
    const [metadata] = await file.getMetadata()
    const actualBytes = Number(metadata.size ?? 0)
    const contentType = String(metadata.contentType ?? '')
    if (!VIDEO_TYPES.has(contentType) || actualBytes > MAX_SIGNED_VIDEO_BYTES) {
      await file.delete().catch(() => undefined)
      return Response.json({ error: 'Uploaded object rejected' }, { status: 415 })
    }
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered.
      const counterSnapshot = await counterRef.get()
      const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
      const usedMb = (usedBytes + actualBytes) / (1024 * 1024)
      // usedMb includes the finalized object; ceil-1 allows exactly up to
      // the integer MB cap and no further (AGL-471 off-by-one).
      const quota = checkQuota(
        org as any,
        'storagePerHostMb',
        Math.ceil(usedMb) - 1,
      )
      if (!quota.allowed) {
        await file.delete().catch(() => undefined)
        return Response.json({ error: `Storage limit reached (${quota.limit} MB)` }, { status: 403 })
      }
    }

    const token = randomUUID()
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`
    await scope.scopeRef.collection('media').doc(mediaId).set({
      fileName,
      contentType,
      sizeBytes: actualBytes,
      url,
      storagePath: objectPath,
      folderId,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    await counterRef.set(
      {
        bytes: firebaseAdmin.firestore.FieldValue.increment(actualBytes),
        count: firebaseAdmin.firestore.FieldValue.increment(1),
      },
      { merge: true },
    )
    return Response.json({ mediaId, url }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Signed upload failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST, handler as PATCH }
