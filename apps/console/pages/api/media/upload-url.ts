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

import { checkEntitlement, checkQuota, createResourceUid } from '@aglyn/aglyn'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { randomUUID } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST' && req.method !== 'PATCH') {
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

    // Quota/entitlements ride the owning org's doc (AGL-238).
    const tenant = (await getOrgForHost(hostId))?.org ?? {}
    const counterRef = hostRef.collection('counters').doc('media')

    if (req.method === 'POST') {
      const contentType = String(req.body?.contentType ?? '')
      const sizeBytes = Number(req.body?.sizeBytes ?? 0)
      if (!VIDEO_TYPES.has(contentType)) {
        return res.status(415).json({
          error: 'Signed uploads are for mp4/webm/quicktime video',
        })
      }
      if (
        !Number.isFinite(sizeBytes) ||
        sizeBytes <= 0 ||
        sizeBytes > MAX_SIGNED_VIDEO_BYTES
      ) {
        return res.status(413).json({
          error: `Video uploads are capped at ${
            MAX_SIGNED_VIDEO_BYTES / 1024 / 1024
          }MB`,
        })
      }
      if (tenant['plan'] && !checkEntitlement(tenant as any, 'videoMedia')) {
        return res
          .status(403)
          .json({ error: 'Video uploads require a Pro plan' })
      }
      if (tenant['plan']) {
        const counterSnapshot = await counterRef.get()
        const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
        const usedMb = (usedBytes + sizeBytes) / (1024 * 1024)
        const quota = checkQuota(tenant as any, 'storagePerHostMb', usedMb - 1)
        if (!quota.allowed) {
          return res
            .status(403)
            .json({ error: `Storage limit reached (${quota.limit} MB)` })
        }
      }

      const mediaId = createResourceUid()
      const file = bucket.file(`hosts/${hostId}/media/${mediaId}`)
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + SIGNED_URL_TTL_MS,
        contentType,
      })
      return res.status(200).json({ mediaId, uploadUrl, contentType })
    }

    // PATCH — finalize after the client's direct PUT.
    const mediaId = String(req.body?.mediaId ?? '')
    const fileName = String(req.body?.fileName ?? 'video').slice(0, 200)
    const folderId =
      typeof req.body?.folderId === 'string' && req.body.folderId
        ? String(req.body.folderId).slice(0, 64)
        : null
    if (!mediaId) return res.status(400).json({ error: 'Missing mediaId' })
    const file = bucket.file(`hosts/${hostId}/media/${mediaId}`)
    const [exists] = await file.exists()
    if (!exists) {
      return res.status(409).json({ error: 'Upload not found — retry' })
    }
    const [metadata] = await file.getMetadata()
    const actualBytes = Number(metadata.size ?? 0)
    const contentType = String(metadata.contentType ?? '')
    if (!VIDEO_TYPES.has(contentType) || actualBytes > MAX_SIGNED_VIDEO_BYTES) {
      await file.delete().catch(() => undefined)
      return res.status(415).json({ error: 'Uploaded object rejected' })
    }
    if (tenant['plan']) {
      const counterSnapshot = await counterRef.get()
      const usedBytes = Number(counterSnapshot.get('bytes') ?? 0)
      const usedMb = (usedBytes + actualBytes) / (1024 * 1024)
      const quota = checkQuota(tenant as any, 'storagePerHostMb', usedMb - 1)
      if (!quota.allowed) {
        await file.delete().catch(() => undefined)
        return res
          .status(403)
          .json({ error: `Storage limit reached (${quota.limit} MB)` })
      }
    }

    const token = randomUUID()
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(`hosts/${hostId}/media/${mediaId}`)}` +
      `?alt=media&token=${token}`
    await hostRef.collection('media').doc(mediaId).set({
      fileName,
      contentType,
      sizeBytes: actualBytes,
      url,
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
    return res.status(200).json({ mediaId, url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Signed upload failed' })
  }
}
