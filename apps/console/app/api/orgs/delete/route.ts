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
  logOrgActivity,
} from '@aglyn/tenant-data-admin'

/**
 * Self-serve organization deletion (AGL-485). This route only sets/clears
 * `orgs/{orgId}.erasureRequestedAt` — the same flag staff set in the admin
 * console. Nothing is deleted here: after a 7-day hold the erasure runs via
 * `tools/scripts/erase-tenant.mjs --org <orgId>` (final export, then hard
 * delete of the org, its sites, files, Storage, and Stripe customer). The
 * request is reversible until the hold elapses, so an owner can cancel.
 *
 * Owner-only — deleting an organization is more consequential than admin
 * management, so only the org's `ownerUid` may request or cancel it.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(body?.orgId ?? '')
  const action = String(body?.action ?? '')
  if (!orgId || (action !== 'request' && action !== 'cancel')) {
    return Response.json({ error: 'Missing orgId or action' }, { status: 400 })
  }

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
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    if (!orgSnapshot.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    // Owner-only (deleting an org is beyond admin management). Staff can
    // still use the admin console; this self-serve path is the owner's.
    if (orgSnapshot.get('ownerUid') !== decoded.uid) {
      return Response.json({
        error: 'Only the organization owner can delete it',
      }, { status: 403 })
    }

    const requesting = action === 'request'
    await orgRef.set(
      {
        erasureRequestedAt: requesting
          ? firebaseAdmin.firestore.FieldValue.serverTimestamp()
          : firebaseAdmin.firestore.FieldValue.delete(),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    void logOrgActivity(
      orgId,
      { uid: decoded.uid, email: decoded.email },
      requesting
        ? 'Requested organization deletion'
        : 'Canceled organization deletion',
      { type: 'org', id: orgId },
    )
    return Response.json({ ok: true, erasureRequested: requesting }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Deletion request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
