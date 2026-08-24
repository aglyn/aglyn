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
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Staff notes on organizations (wave v5): support/billing context that
 * lives with the org but never in the tenant-visible data —
 * `orgs/{orgId}/staffNotes`, staff-claim gated on both read and write
 * (workspace members can't read the subcollection; there is no client rule for
 * it). GET lists newest-first; POST appends and audits.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(
    (method === 'GET' ? query['orgId'] : body?.orgId) ?? '',
  )
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const notesRef = firestore
      .collection('orgs')
      .doc(orgId)
      .collection('staffNotes')

    if (method === 'GET') {
      const snapshot = await notesRef
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      return Response.json({
        notes: snapshot.docs.map((doc) => ({
          $id: doc.id,
          text: doc.get('text') ?? '',
          actorUid: doc.get('actorUid') ?? null,
          actorEmail: doc.get('actorEmail') ?? null,
          createdAt: doc.get('createdAt')?.toMillis?.() ?? null,
        })),
      }, { status: 200 })
    }

    if (method === 'POST') {
      const text = String(body?.text ?? '')
        .trim()
        .slice(0, 2000)
      if (!text) return Response.json({ error: 'Empty note' }, { status: 400 })
      await notesRef.add({
        text,
        actorUid: decoded.uid,
        actorEmail: decoded.email ?? null,
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        action: 'org.note',
        target: `orgs/${orgId}`,
        before: null,
        after: { text: text.slice(0, 200) },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Notes request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
