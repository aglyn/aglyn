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
  createResourceUid,
  encodeStoredNodes,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
  isSystemEmailEditable,
  SYSTEM_EMAIL_COLLECTION,
} from '@aglyn/shared-util-email'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'

/**
 * Opens a system email for designing: answers the version the Besigner edits,
 * creating the first one from the built-in copy when staff have never designed
 * the email (the same two writes the staff Emails page makes in the browser,
 * `utils/open-system-email-version.ts`, here for a client that cannot encode the
 * stored nodes: the native staff screens).
 *
 * Staff only. An email that is already designed answers its version and writes
 * nothing. Only an email Aglyn itself sends has a body to design.
 */
async function handler(request: Request): Promise<Response> {
  const {
    method,
    body: payload,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const templateKey = String(payload?.templateKey ?? '')
  const definition = getSystemEmailTemplate(templateKey)
  if (!definition || !isSystemEmailEditable(definition)) {
    return Response.json(
      { error: 'Unknown or non-editable template' },
      { status: 400 },
    )
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const templateRef = firestore
      .collection(SYSTEM_EMAIL_COLLECTION)
      .doc(templateKey)
    const snapshot = await templateRef.get()
    const existing = snapshot.exists
      ? (snapshot.get('versionId') as string | undefined)
      : undefined
    if (existing) {
      return Response.json({ versionId: existing, created: false })
    }

    const encoded = encodeStoredNodes(buildDefaultEmailNodeMap(definition))
    if (!encoded) {
      return Response.json(
        { error: 'The built-in copy could not be encoded' },
        { status: 500 },
      )
    }
    const versionId = createResourceUid()
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
    const batch = firestore.batch()
    batch.set(templateRef.collection('versions').doc(versionId), {
      templateKey,
      createdAt: now,
      updatedAt: now,
      nodes: Buffer.from(encoded),
    })
    batch.set(
      templateRef,
      {
        subject: snapshot.get('subject') ?? definition.defaultSubject,
        versionId,
        updatedAt: now,
      },
      { merge: true },
    )
    await batch.commit()

    await addAdminAudit(firestore, {
      actorUid: decoded.uid,
      action: 'systemEmail.openVersion',
      target: `systemEmailTemplates/${templateKey}`,
      before: null,
      after: { versionId },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })

    return Response.json({ versionId, created: true })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/emails/open-version] failed', error)
    return Response.json({ error: 'Could not open the email' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
