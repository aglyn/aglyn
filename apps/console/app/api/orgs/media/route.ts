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
  createResourceUid,
  ORG_SCOPE_TOKEN,
  orgRoleAtLeast,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { randomUUID } from 'crypto'

const MAX_BYTES = 10 * 1024 * 1024

/**
 * Org media library (AGL-237): assets shareable with any host in the
 * org, distinct from host media (which stays private to its host).
 * Upload/delete are API-only so the Storage object and the Firestore doc
 * never drift; editors and up may write, and the client reads the org
 * media collection directly through rules.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

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
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const canWrite =
      decoded['staff'] === true ||
      (membership && orgRoleAtLeast(membership.member.role, 'editor'))
    if (!canWrite) {
      return Response.json({ error: 'Org media requires the editor role' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const bucket = firebaseAdmin
      .app()
      .storage()
      .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    const mediaRef = firestore.collection('orgs').doc(orgId).collection('media')

    if (action === 'upload') {
      const fileName = String(body?.fileName ?? 'file').slice(0, 200)
      const contentType = String(body?.contentType ?? '')
      const dataBase64 = String(body?.dataBase64 ?? '')
      if (!contentType || !dataBase64) {
        return Response.json({ error: 'Missing file payload' }, { status: 400 })
      }
      const buffer = Buffer.from(dataBase64, 'base64')
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
        return Response.json({
          error: `Org media uploads are capped at ${MAX_BYTES / 1024 / 1024}MB`,
        }, { status: 413 })
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
        // Org-wide by default (AGL-1043/1044). Every writer of a scoped
        // collection must stamp this: `array-contains-any` matches nothing
        // on a doc without it, so an unstamped asset is invisible to every
        // scoped read rather than merely unrestricted.
        visibleTo: [ORG_SCOPE_TOKEN],
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return Response.json({ mediaId, url }, { status: 200 })
    }

    if (action === 'delete') {
      const mediaId = String(body?.mediaId ?? '')
      if (!mediaId) return Response.json({ error: 'Missing mediaId' }, { status: 400 })
      await bucket
        .file(`orgs/${orgId}/media/${mediaId}`)
        .delete()
        .catch(() => undefined)
      await mediaRef.doc(mediaId).delete()
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Org media operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
