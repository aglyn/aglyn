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
  readImageDimensions,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  MEDIA_CDN_VARIANT_WIDTHS,
} from '@aglyn/tenant-data-admin'
import {
  mediaObjectPath,
  resolveMediaScope,
} from '../../../../utils/server/media-scope'
import { createHash, randomUUID } from 'crypto'

// Base64 JSON payloads encode ~34MB for a 25MB source.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * Replaces an image asset's bytes in place (AGL-184): same mediaId, new
 * content. Images only (transforms + replace target images; video/PDF
 * replacement is out of scope). Regenerates the AGL-175 content hash, CDN
 * variants, and AGL-173 dimensions; the storage object is overwritten with
 * a fresh download token so `url` changes with the content.
 *
 * CDN-URL behavior (documented per the issue): screens that reference the
 * asset by its content-hashed `cdnPath` pick up the new bytes once the doc
 * updates (the path changes with the hash); references to the OLD raw
 * download URL keep serving the old token'd object until it's replaced —
 * which this does, so raw-URL references get the new bytes too (the token
 * changes, but the object path is stable).
 *
 * Concurrent-edit safety: an optional `expectedUpdatedAtMs` precondition
 * rejects a stale replace (409). Storage quota + type + size mirror
 * `/api/media/upload`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const mediaId = String(body?.mediaId ?? '')
  const contentType = String(body?.contentType ?? '')
  const data = String(body?.data ?? '')
  const expectedUpdatedAtMs = body?.expectedUpdatedAtMs
    ? Number(body.expectedUpdatedAtMs)
    : undefined
  if (!mediaId || !data) {
    return Response.json({ error: 'Missing mediaId or data' }, { status: 400 })
  }
  if (!contentType.startsWith('image/')) {
    return Response.json({ error: 'Only images can be replaced' }, { status: 415 })
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

    const mediaRef = scope.scopeRef.collection('media').doc(mediaId)
    const mediaSnapshot = await mediaRef.get()
    if (!mediaSnapshot.exists || mediaSnapshot.get('deletedAt')) {
      return Response.json({ error: 'Unknown media' }, { status: 404 })
    }
    // Concurrent-edit guard: the client passes the doc's updatedAt it saw.
    if (expectedUpdatedAtMs != null) {
      const currentMs =
        Number(mediaSnapshot.get('updatedAt')?.toMillis?.() ?? 0) ||
        Number(mediaSnapshot.get('createdAt')?.toMillis?.() ?? 0)
      if (currentMs && currentMs > expectedUpdatedAtMs) {
        return Response.json({ error: 'This asset was changed elsewhere — reload first' }, { status: 409 })
      }
    }

    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      return Response.json({
        error: `Image is empty or too large (${MAX_IMAGE_BYTES / 1024 / 1024}MB max)`,
      }, { status: 413 })
    }

    const previousBytes = Number(mediaSnapshot.get('sizeBytes') ?? 0)
    // Quota rides the owning org's doc (AGL-238).
    const org = scope.billing
    {
      // Storage quota applies to every org; a plan-less org resolves as
      // `free` (250 MB cap), not unmetered.
      const counterSnapshot = await scope.scopeRef
        .collection('counters')
        .doc('media')
        .get()
      const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
      // Quota against the NEW total (swap the old bytes for the new).
      const projected = usedBytes - previousBytes + buffer.length
      const usedMb = projected / (1024 * 1024)
      // usedMb includes the replacement bytes; ceil-1 allows exactly up to
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

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])

    const objectPath = mediaObjectPath(mediaSnapshot, scope.base)
    // Drop the previous CDN variants — they belong to the old content.
    const previousVariants: number[] = mediaSnapshot.get('variants') ?? []
    await Promise.all(
      previousVariants.map((width) =>
        bucket
          .file(`${objectPath}__w${width}.webp`)
          .delete()
          .catch(() => undefined),
      ),
    )

    const token = randomUUID()
    const file = bucket.file(objectPath)
    await file.save(buffer, {
      contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(objectPath)}` +
      `?alt=media&token=${token}`

    const dimensions = readImageDimensions(new Uint8Array(buffer))
    const contentHash = createHash('sha256')
      .update(new Uint8Array(buffer))
      .digest('hex')
      .slice(0, 16)
    const cdnAllowed = checkEntitlement(org, 'mediaCdn')
    const variants: number[] = []
    if (cdnAllowed && contentType !== 'image/svg+xml') {
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
        console.error('media variant regeneration failed', mediaId, error)
      }
    }

    await mediaRef.set(
      {
        contentType,
        sizeBytes: buffer.length,
        url,
        // Clear stale dimensions if the new header didn't parse.
        width: dimensions?.width ?? firebaseAdmin.firestore.FieldValue.delete(),
        height:
          dimensions?.height ?? firebaseAdmin.firestore.FieldValue.delete(),
        contentHash,
        variants,
        ...(cdnAllowed
          ? { cdnPath: `/api/media/cdn/${scope.cdnScope}/${mediaId}/${contentHash}` }
          : { cdnPath: firebaseAdmin.firestore.FieldValue.delete() }),
        replacedBy: decoded.uid,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    // Adjust the storage counter by the byte delta (count unchanged).
    await scope.scopeRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(
            buffer.length - previousBytes,
          ),
        },
        { merge: true },
      )

    return Response.json({ replaced: true, url, contentHash }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Replace failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
