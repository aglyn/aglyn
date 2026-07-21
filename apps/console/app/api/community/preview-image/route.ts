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
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { canActAsPublisher } from '@aglyn/plugins-community/server/publisher-profile'
import { randomUUID } from 'crypto'

// Base64 JSON payloads: 2MB of image encodes to ~2.7MB of body.
const MAX_FILE_BYTES = 2 * 1024 * 1024

/**
 * Listing preview image (AGL-95): the publisher uploads one screenshot per
 * listing, shown on browse cards and the detail page. Storage rules deny
 * client writes, so the mutation runs here — Firebase ID token, listing
 * ownership, image-only, 2MB cap. POST replaces the image and sets
 * `previewImageUrl` on the listing; DELETE removes both.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const listingId = String(body?.listingId ?? '')
  if (!listingId) return Response.json({ error: 'Missing listingId' }, { status: 400 })

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
    const firestore = firebaseAdmin.app().firestore()
    const listingRef = firestore.collection('communityListings').doc(listingId)
    const listingSnapshot = await listingRef.get()
    if (!listingSnapshot.exists) {
      return Response.json({ error: 'Unknown listing' }, { status: 404 })
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
      return Response.json({ error: 'Not your listing' }, { status: 403 })
    }
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const file = bucket.file(`communityListings/${listingId}/preview`)

    if (method === 'DELETE') {
      await file.delete().catch(() => undefined)
      await listingRef.set(
        {
          previewImageUrl: firebaseAdmin.firestore.FieldValue.delete(),
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return Response.json({ deleted: true }, { status: 200 })
    }

    const contentType = String(body?.contentType ?? '')
    const data = String(body?.data ?? '')
    if (!contentType.startsWith('image/')) {
      return Response.json({ error: 'Only image uploads are supported' }, { status: 415 })
    }
    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
      return Response.json({ error: 'File is empty or too large (2MB)' }, { status: 413 })
    }

    const token = randomUUID()
    await file.save(buffer, {
      contentType,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    })
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(`communityListings/${listingId}/preview`)}` +
      `?alt=media&token=${token}`

    await listingRef.set(
      {
        previewImageUrl: url,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return Response.json({ url }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST, handler as DELETE }
