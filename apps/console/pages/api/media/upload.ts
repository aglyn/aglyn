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
  createResourceUid,
  readImageDimensions,
} from '@aglyn/aglyn'
import {
  firebaseAdmin,
  getOrgForHost,
  MEDIA_CDN_VARIANT_WIDTHS,
} from '@aglyn/tenant-data-admin'
import { createHash, randomUUID } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

// Base64 JSON payloads: ~25MB of media encodes to ~34MB of body.
export const config = { api: { bodyParser: { sizeLimit: '34mb' } } }

// Per-type caps (AGL-162). Large-video signed-URL uploads come later.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_VIDEO_BYTES = 25 * 1024 * 1024
const MAX_PDF_BYTES = 10 * 1024 * 1024
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

/**
 * Authenticated media upload/delete (AGL-85): Storage rules deny client
 * writes entirely, so every mutation passes this route's checks — Firebase
 * ID token, host-admin membership, image-only content types, and the
 * server-enforced storage quota (client-side checks are advisory). Files
 * land at `hosts/{hostId}/media/{mediaId}` with a download-token URL; the
 * Firestore metadata mirror and bytes counter are written here too.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

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
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin' })
    }
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)

    if (req.method === 'DELETE') {
      const mediaId = String(req.body?.mediaId ?? '')
      if (!mediaId) return res.status(400).json({ error: 'Missing mediaId' })
      const mediaRef = hostRef.collection('media').doc(mediaId)
      const mediaSnapshot = await mediaRef.get()
      // Object may already be gone; still remove the metadata.
      await bucket
        .file(`hosts/${hostId}/media/${mediaId}`)
        .delete()
        .catch(() => undefined)
      // CDN variants (AGL-175) ride along.
      const variantWidths: number[] = mediaSnapshot.get('variants') ?? []
      await Promise.all(
        variantWidths.map((width) =>
          bucket
            .file(`hosts/${hostId}/media/${mediaId}__w${width}.webp`)
            .delete()
            .catch(() => undefined),
        ),
      )
      if (mediaSnapshot.exists) {
        const sizeBytes = Number(mediaSnapshot.get('sizeBytes') ?? 0)
        await mediaRef.delete()
        await hostRef
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
      return res.status(200).json({ deleted: true })
    }

    const fileName = String(req.body?.fileName ?? 'upload').slice(0, 200)
    const contentType = String(req.body?.contentType ?? '')
    const data = String(req.body?.data ?? '')
    // Destination folder (AGL-172): uploads land in the library's open
    // folder. Id only — existence is the client's concern; a stale id
    // just files the asset at root in the UI.
    const folderId =
      typeof req.body?.folderId === 'string' && req.body.folderId
        ? String(req.body.folderId).slice(0, 64)
        : null
    // Media-type allowlist (AGL-162): images for everyone; video and PDF
    // by tier (videoMedia flag; dark-launch tenants uncapped as usual).
    const isImage = contentType.startsWith('image/')
    const isVideo = VIDEO_TYPES.has(contentType)
    const isPdf = contentType === 'application/pdf'
    if (!isImage && !isVideo && !isPdf) {
      return res
        .status(415)
        .json({ error: 'Supported uploads: images, mp4/webm video, PDF' })
    }
    const buffer = Buffer.from(data, 'base64')
    const maxBytes = isVideo
      ? MAX_VIDEO_BYTES
      : isPdf
        ? MAX_PDF_BYTES
        : MAX_IMAGE_BYTES
    if (!buffer.length || buffer.length > maxBytes) {
      return res.status(413).json({
        error: `File is empty or too large (${Math.round(maxBytes / 1024 / 1024)}MB max)`,
      })
    }

    // Server-side quota: counter bytes + this file against the plan limit
    // (no enforcement until the tenant has an explicit plan — AGL-38 gate).
    const counterSnapshot = await hostRef
      .collection('counters')
      .doc('media')
      .get()
    const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
    // Quota/entitlements ride the owning org's doc (AGL-238).
    const tenant = (await getOrgForHost(hostId))?.org ?? {}
    if ((isVideo || isPdf) && tenant['plan'] && !checkEntitlement(tenant, 'videoMedia')) {
      return res.status(403).json({
        error: 'Video and file uploads require a Pro plan',
      })
    }
    if (tenant['plan']) {
      const usedMb = (usedBytes + buffer.length) / (1024 * 1024)
      const quota = checkQuota(tenant, 'storagePerHostMb', usedMb - 1)
      if (!quota.allowed) {
        return res.status(403).json({
          error: `Storage limit reached (${quota.limit} MB)`,
        })
      }
    }

    const mediaId = createResourceUid()
    const token = randomUUID()
    const file = bucket.file(`hosts/${hostId}/media/${mediaId}`)
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
      `${encodeURIComponent(`hosts/${hostId}/media/${mediaId}`)}` +
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
    // Paid gate (AGL-175 pricing): free tenants serve raw storage URLs;
    // dark-launch tenants (no explicit plan) pass as usual.
    const cdnAllowed = !tenant['plan'] || checkEntitlement(tenant, 'mediaCdn')
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
        // Variants are an optimization — never fail the upload for them.
        console.error('media variant generation failed', mediaId, error)
      }
    }

    await hostRef.collection('media').doc(mediaId).set({
      fileName,
      contentType,
      sizeBytes: buffer.length,
      url,
      folderId,
      ...(dimensions ?? {}),
      uploadedBy: decoded.uid,
      contentHash,
      variants,
      ...(cdnAllowed
        ? { cdnPath: `/api/media/cdn/${hostId}/${mediaId}/${contentHash}` }
        : {}),
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    await hostRef
      .collection('counters')
      .doc('media')
      .set(
        {
          bytes: firebaseAdmin.firestore.FieldValue.increment(buffer.length),
          count: firebaseAdmin.firestore.FieldValue.increment(1),
        },
        { merge: true },
      )

    return res.status(200).json({ mediaId, url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Upload failed' })
  }
}
