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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { randomUUID } from 'crypto'
import { canActAsPublisher } from './publisher-profile'

// Base64 JSON payloads: 2MB of image encodes to ~2.7MB of body.
const MAX_FILE_BYTES = 2 * 1024 * 1024

const PREVIEW_PATH = (listingId: string) =>
  `communityListings/${listingId}/preview`

/**
 * Listing preview image (AGL-95): the publisher uploads one screenshot per
 * listing, shown on browse cards and the detail page. Storage rules deny
 * client writes, so the mutation runs here — Firebase ID token, listing
 * ownership, image-only, 2MB cap. POST replaces the image and sets
 * `previewImageUrl` on the listing; DELETE removes both.
 *
 * Lives in the plugin, like every other `community/*` operation. It was the
 * one that didn't: it sat in the console app and imported this plugin's
 * `canActAsPublisher` across the `scope:app` → `aglyn:addons` boundary, which
 * failed lint on main. Registered at the same path, so the URL clients call
 * is unchanged — `/api/community/preview-image` reaches the plugin catch-all
 * with exactly the shape it had as a named app route.
 *
 * The email-verified gate (AGL-479) is carried over deliberately: the plugin
 * API dispatcher does NOT apply it centrally, so dropping it here would have
 * quietly widened who can write listing images.
 */
export const previewImageHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const listingId = String(req.body?.listingId ?? '')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return res.status(403).json({
        error: 'Verify your email to continue',
        reason: 'email-unverified',
      })
    }
    const firestore = firebaseAdmin.app().firestore()
    const listingRef = firestore.collection('communityListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    if (!listingSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown listing' })
    }
    // Listings are org-owned since AGL-652, so `profileId` holds an ORG id.
    // Comparing it to a uid can never be true — it silently 403'd every
    // publisher rather than erroring, which is why this survived the sweep.
    const canEdit = await canActAsPublisher(
      firestore,
      decoded.uid,
      listingSnapshot.get('profileId') as string | undefined,
    )
    if (!canEdit) {
      return res.status(403).json({ error: 'Not your listing' })
    }
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const file = bucket.file(PREVIEW_PATH(listingId))

    if (req.method === 'DELETE') {
      await file.delete().catch(() => undefined)
      await listingRef.set(
        {
          previewImageUrl: firebaseAdmin.firestore.FieldValue.delete(),
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return res.status(200).json({ deleted: true })
    }

    const contentType = String(req.body?.contentType ?? '')
    const data = String(req.body?.data ?? '')
    if (!contentType.startsWith('image/')) {
      return res
        .status(415)
        .json({ error: 'Only image uploads are supported' })
    }
    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
      return res
        .status(413)
        .json({ error: 'File is empty or too large (2MB)' })
    }

    const token = randomUUID()
    await file.save(buffer, {
      contentType,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(PREVIEW_PATH(listingId))}` +
      `?alt=media&token=${token}`

    await listingRef.set(
      {
        previewImageUrl: url,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return res.status(200).json({ url })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Upload failed' })
  }
}

export default previewImageHandler
