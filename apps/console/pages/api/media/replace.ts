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

import {
  checkEntitlement,
  checkQuota,
  readImageDimensions,
} from '@aglyn/aglyn'
import {
  firebaseAdmin,
  MEDIA_CDN_VARIANT_WIDTHS,
} from '@aglyn/tenant-data-admin'
import { createHash, randomUUID } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

// Base64 JSON payloads encode ~34MB for a 25MB source.
export const config = { api: { bodyParser: { sizeLimit: '34mb' } } }

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const mediaId = String(req.body?.mediaId ?? '')
  const contentType = String(req.body?.contentType ?? '')
  const data = String(req.body?.data ?? '')
  const expectedUpdatedAtMs = req.body?.expectedUpdatedAtMs
    ? Number(req.body.expectedUpdatedAtMs)
    : undefined
  if (!hostId || !mediaId || !data) {
    return res
      .status(400)
      .json({ error: 'Missing hostId, mediaId, or data' })
  }
  if (!contentType.startsWith('image/')) {
    return res.status(415).json({ error: 'Only images can be replaced' })
  }

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown host' })
    }
    const admins = hostSnapshot.get('admins') ?? {}
    if (!admins[decoded.uid]) {
      return res.status(403).json({ error: 'Not a host admin' })
    }

    const mediaRef = hostRef.collection('media').doc(mediaId)
    const mediaSnapshot = await mediaRef.get()
    if (!mediaSnapshot.exists || mediaSnapshot.get('deletedAt')) {
      return res.status(404).json({ error: 'Unknown media' })
    }
    // Concurrent-edit guard: the client passes the doc's updatedAt it saw.
    if (expectedUpdatedAtMs != null) {
      const currentMs =
        Number(mediaSnapshot.get('updatedAt')?.toMillis?.() ?? 0) ||
        Number(mediaSnapshot.get('createdAt')?.toMillis?.() ?? 0)
      if (currentMs && currentMs > expectedUpdatedAtMs) {
        return res
          .status(409)
          .json({ error: 'This asset was changed elsewhere — reload first' })
      }
    }

    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({
        error: `Image is empty or too large (${MAX_IMAGE_BYTES / 1024 / 1024}MB max)`,
      })
    }

    const previousBytes = Number(mediaSnapshot.get('sizeBytes') ?? 0)
    const tenant =
      (
        await firestore.collection('tenants').doc(decoded.uid).get()
      ).data() ?? {}
    if (tenant['plan']) {
      const counterSnapshot = await hostRef
        .collection('counters')
        .doc('media')
        .get()
      const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
      // Quota against the NEW total (swap the old bytes for the new).
      const projected = usedBytes - previousBytes + buffer.length
      const usedMb = projected / (1024 * 1024)
      const quota = checkQuota(tenant as any, 'storagePerHostMb', usedMb - 1)
      if (!quota.allowed) {
        return res
          .status(403)
          .json({ error: `Storage limit reached (${quota.limit} MB)` })
      }
    }

    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'])

    // Drop the previous CDN variants — they belong to the old content.
    const previousVariants: number[] = mediaSnapshot.get('variants') ?? []
    await Promise.all(
      previousVariants.map((width) =>
        bucket
          .file(`hosts/${hostId}/media/${mediaId}__w${width}.webp`)
          .delete()
          .catch(() => undefined),
      ),
    )

    const token = randomUUID()
    const file = bucket.file(`hosts/${hostId}/media/${mediaId}`)
    await file.save(buffer, {
      contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(`hosts/${hostId}/media/${mediaId}`)}` +
      `?alt=media&token=${token}`

    const dimensions = readImageDimensions(new Uint8Array(buffer))
    const contentHash = createHash('sha256')
      .update(new Uint8Array(buffer))
      .digest('hex')
      .slice(0, 16)
    const cdnAllowed = !tenant['plan'] || checkEntitlement(tenant, 'mediaCdn')
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
            .file(`hosts/${hostId}/media/${mediaId}__w${width}.webp`)
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
          ? { cdnPath: `/api/media/cdn/${hostId}/${mediaId}/${contentHash}` }
          : { cdnPath: firebaseAdmin.firestore.FieldValue.delete() }),
        replacedBy: decoded.uid,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    // Adjust the storage counter by the byte delta (count unchanged).
    await hostRef
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

    return res.status(200).json({ replaced: true, url, contentHash })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Replace failed' })
  }
}
