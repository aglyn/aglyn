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
  checkEntitlement,
  checkQuota,
  createResourceUid,
  readImageDimensions,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  MEDIA_CDN_VARIANT_WIDTHS,
} from '@aglyn/tenant-data-admin'
import { createHash, randomUUID } from 'crypto'
import {
  folderStoragePath,
  mediaObjectPath,
  resolveMediaScope,
} from '../../../../utils/server/media-scope'

// Base64 JSON payloads: ~25MB of media encodes to ~34MB of body.
// Per-type caps (AGL-162). Large-video signed-URL uploads come later.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_VIDEO_BYTES = 25 * 1024 * 1024
const MAX_PDF_BYTES = 10 * 1024 * 1024
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

/**
 * Authenticated media upload/delete (AGL-85): Storage rules deny client
 * writes entirely, so every mutation passes this route's checks — Firebase
 * ID token, host or org membership (org DAM parity), allowed content
 * types, and the server-enforced storage quota. Files land under the
 * scope's media prefix inside their REAL folder path
 * (`{base}/media/{folder…}/{mediaId}`) with a download-token URL; the
 * Firestore metadata mirror and bytes counter are written here too.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'DELETE') {
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
    const scopeRef = scope.scopeRef
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    if (method === 'DELETE') {
      const mediaId = String(body?.mediaId ?? '')
      if (!mediaId) return Response.json({ error: 'Missing mediaId' }, { status: 400 })
      const mediaRef = scopeRef.collection('media').doc(mediaId)
      const mediaSnapshot = await mediaRef.get()
      const objectPath = mediaObjectPath(mediaSnapshot, scope.base)
      // Object may already be gone; still remove the metadata.
      await bucket.file(objectPath).delete().catch(() => undefined)
      // CDN variants (AGL-175) ride along.
      const variantWidths: number[] = mediaSnapshot.get('variants') ?? []
      await Promise.all(
        variantWidths.map((width) =>
          bucket
            .file(`${objectPath}__w${width}.webp`)
            .delete()
            .catch(() => undefined),
        ),
      )
      if (mediaSnapshot.exists) {
        const sizeBytes = Number(mediaSnapshot.get('sizeBytes') ?? 0)
        await mediaRef.delete()
        await scopeRef
          .collection('counters')
          .doc('media')
          .set(
            {
              bytes: firebaseAdmin.firestore.FieldValue.increment(-sizeBytes),
              count: firebaseAdmin.firestore.FieldValue.increment(-1),
            },
            { merge: true },
          )
      }
      return Response.json({ deleted: true }, { status: 200 })
    }

    const fileName = String(body?.fileName ?? 'upload').slice(0, 200)
    const contentType = String(body?.contentType ?? '')
    const data = String(body?.data ?? '')
    // Destination folder (AGL-172): uploads land in the library's open
    // folder. Id only — existence is the client's concern; a stale id
    // just files the asset at root in the UI.
    const folderId =
      typeof body?.folderId === 'string' && body.folderId
        ? String(body.folderId).slice(0, 64)
        : null
    // Media-type allowlist (AGL-162): images for everyone; video and PDF
    // by tier (videoMedia flag; dark-launch workspaces uncapped as usual).
    const isImage = contentType.startsWith('image/')
    const isVideo = VIDEO_TYPES.has(contentType)
    const isPdf = contentType === 'application/pdf'
    if (!isImage && !isVideo && !isPdf) {
      return Response.json({ error: 'Supported uploads: images, mp4/webm video, PDF' }, { status: 415 })
    }
    const buffer = Buffer.from(data, 'base64')
    const maxBytes = isVideo
      ? MAX_VIDEO_BYTES
      : isPdf
        ? MAX_PDF_BYTES
        : MAX_IMAGE_BYTES
    if (!buffer.length || buffer.length > maxBytes) {
      return Response.json({
        error: `File is empty or too large (${Math.round(maxBytes / 1024 / 1024)}MB max)`,
      }, { status: 413 })
    }

    // Server-side quota: counter bytes + this file against the plan limit
    // (no enforcement until the org has an explicit plan — AGL-38 gate).
    const counterSnapshot = await scopeRef
      .collection('counters')
      .doc('media')
      .get()
    const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
    // Quota/entitlements ride the owning org's doc (AGL-238).
    const org = scope.billing
    if ((isVideo || isPdf) && !checkEntitlement(org, 'videoMedia')) {
      return Response.json({
        error: 'Video and file uploads require a Pro plan',
      }, { status: 403 })
    }
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered.
      const usedMb = (usedBytes + buffer.length) / (1024 * 1024)
      // usedMb includes the incoming file; ceil-1 allows exactly up to the
      // integer MB cap and no further (AGL-471 off-by-one).
      const quota = checkQuota(org, 'storagePerHostMb', Math.ceil(usedMb) - 1)
      if (!quota.allowed) {
        return Response.json({
          error: `Storage limit reached (${quota.limit} MB)`,
        }, { status: 403 })
      }
    }

    const mediaId = createResourceUid()
    const token = randomUUID()
    // Real folders (org DAM work): the object lives INSIDE its folder's
    // Storage prefix, so the bucket tree mirrors the library tree.
    const folderPath = await folderStoragePath(scopeRef, folderId)
    const objectPath =
      `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
    const file = bucket.file(objectPath)
    await file.save(buffer, {
      contentType,
      metadata: {
        // Immutable is safe: the CDN path embeds the content hash, and
        // raw download URLs embed the token — both change with content.
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`

    // Auto-captured metadata (AGL-173): image dimensions from the file
    // header (best-effort, never a gate) and the uploader's uid.
    const dimensions = isImage
      ? readImageDimensions(new Uint8Array(buffer))
      : null

    // CDN delivery (AGL-175): content-hashed immutable path plus WebP
    // variants for images. Variant bytes are deliberately EXCLUDED from
    // the storage counter — they're derived artifacts the platform can
    // regenerate, so hosts aren't billed for them.
    const contentHash = createHash('sha256')
      .update(new Uint8Array(buffer))
      .digest('hex')
      .slice(0, 16)
    // Paid gate (AGL-175 pricing): free workspaces serve raw storage URLs.
    // A plan-less org resolves as `free` (no CDN); overrides can still grant
    // it. `mediaCdn` is a Starter+ entitlement.
    const cdnAllowed = checkEntitlement(org, 'mediaCdn')
    const variants: number[] = []
    if (cdnAllowed && isImage && contentType !== 'image/svg+xml') {
      try {
        const sharp = (await import('sharp')).default
        for (const width of MEDIA_CDN_VARIANT_WIDTHS) {
          if (dimensions?.width && dimensions.width <= width) continue
          const webp = await sharp(buffer)
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer()
          await bucket
            .file(`${objectPath}__w${width}.webp`)
            .save(webp, {
              contentType: 'image/webp',
              metadata: {
                cacheControl: 'public, max-age=31536000, immutable',
              },
            })
          variants.push(width)
        }
      } catch (error) {
        // Variants are an optimization — never fail the upload for them.
        console.error('media variant generation failed', mediaId, error)
      }
    }

    await scopeRef.collection('media').doc(mediaId).set({
      fileName,
      contentType,
      sizeBytes: buffer.length,
      url,
      storagePath: objectPath,
      folderId,
      ...(dimensions ?? {}),
      uploadedBy: decoded.uid,
      contentHash,
      variants,
      ...(cdnAllowed
        ? {
            cdnPath: `/api/media/cdn/${scope.cdnScope}/${mediaId}/${contentHash}`,
          }
        : {}),
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    await scopeRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(buffer.length),
          count: firebaseAdmin.firestore.FieldValue.increment(1),
        },
        { merge: true },
      )

    return Response.json({ mediaId, url }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST, handler as DELETE }
