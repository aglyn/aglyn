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

import { createResourceUid, orgRoleAtLeast } from '@aglyn/aglyn'
import { firebaseAdmin, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { randomUUID } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } }

const MAX_BYTES = 10 * 1024 * 1024

/**
 * Org media library (AGL-237): assets shareable with any host in the
 * org, distinct from host media (which stays private to its host).
 * Upload/delete are API-only so the Storage object and the Firestore doc
 * never drift; editors and up may write, and the client reads the org
 * media collection directly through rules.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const orgId = String(req.body?.orgId ?? '')
  const action = String(req.body?.action ?? '')
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const canWrite =
      decoded['staff'] === true ||
      (membership && orgRoleAtLeast(membership.member.role, 'editor'))
    if (!canWrite) {
      return res
        .status(403)
        .json({ error: 'Org media requires the editor role' })
    }
    const firestore = firebaseAdmin.app().firestore()
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const mediaRef = firestore.collection('orgs').doc(orgId).collection('media')

    if (action === 'upload') {
      const fileName = String(req.body?.fileName ?? 'file').slice(0, 200)
      const contentType = String(req.body?.contentType ?? '')
      const dataBase64 = String(req.body?.dataBase64 ?? '')
      if (!contentType || !dataBase64) {
        return res.status(400).json({ error: 'Missing file payload' })
      }
      const buffer = Buffer.from(dataBase64, 'base64')
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
        return res.status(413).json({
          error: `Org media uploads are capped at ${MAX_BYTES / 1024 / 1024}MB`,
        })
      }
      const mediaId = createResourceUid()
      const objectPath = `orgs/${orgId}/media/${mediaId}`
      const token = randomUUID()
      await bucket.file(objectPath).save(buffer, {
        contentType,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      })
      const url =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
        `${encodeURIComponent(objectPath)}?alt=media&token=${token}`
      await mediaRef.doc(mediaId).set({
        fileName,
        contentType,
        sizeBytes: buffer.byteLength,
        url,
        uploadedBy: decoded.uid,
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return res.status(200).json({ mediaId, url })
    }

    if (action === 'delete') {
      const mediaId = String(req.body?.mediaId ?? '')
      if (!mediaId) return res.status(400).json({ error: 'Missing mediaId' })
      await bucket
        .file(`orgs/${orgId}/media/${mediaId}`)
        .delete()
        .catch(() => undefined)
      await mediaRef.doc(mediaId).delete()
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Org media operation failed' })
  }
}
