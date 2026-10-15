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
import { setAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { POST as notifyOwner } from '../erasure-request/route'

/**
 * Request an organization's erasure, or cancel the request, for a client that
 * cannot make the console's writes itself (the native staff screens).
 *
 * The staff organization page does this in the browser: one batch holding the
 * org's `erasureRequestedAt` flag and its `adminAudit` row, then a call to
 * `/api/admin/erasure-request` to tell the owner. A native client has no
 * atomic batch and cannot build the audit row's index fields, so this route
 * makes the same writes with the Admin SDK, in one batch, and tells the owner
 * the same way. Nothing is deleted now: after the 7-day hold the erasure job
 * runs.
 *
 * `POST { orgId, action: 'request' | 'cancel' }`, staff only. Asking for what
 * already holds changes nothing and says so.
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
  const orgId = String(payload?.orgId ?? '').trim()
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
  const action = String(payload?.action ?? '')
  if (action !== 'request' && action !== 'cancel') {
    return Response.json(
      { error: 'action must be request or cancel' },
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
    const orgRef = firestore.collection('orgs').doc(orgId)
    const snapshot = await orgRef.get()
    if (!snapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const requested = Boolean(snapshot.get('erasureRequestedAt'))
    const requesting = action === 'request'
    if (requested === requesting) {
      return Response.json({ ok: true, changed: false, requested })
    }

    const { FieldValue } = firebaseAdmin.firestore
    const batch = firestore.batch()
    batch.set(
      orgRef,
      {
        erasureRequestedAt: requesting
          ? FieldValue.serverTimestamp()
          : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    setAdminAudit(batch, firestore, {
      actorUid: decoded.uid,
      action: requesting ? 'org.erasureRequested' : 'org.erasureCanceled',
      target: `orgs/${orgId}`,
      before: { erasureRequested: !requesting },
      after: { erasureRequested: requesting },
      at: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    // Telling the owner is best effort, as it is on the page: the request
    // stands whether or not the email goes.
    let emailed: boolean | null = null
    if (requesting) {
      emailed = await notifyOwner(
        new Request(request.url.replace('/org-erasure', '/erasure-request'), {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ orgId }),
        }),
      )
        .then(async (response) => Boolean((await response.json())?.emailed))
        .catch(() => false)
    }
    return Response.json({ ok: true, changed: true, requested: requesting, emailed })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/org-erasure] failed', error)
    return Response.json(
      { error: 'Nothing was written. The flag and its audit row commit together, so the request is unchanged. Safe to retry.' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
