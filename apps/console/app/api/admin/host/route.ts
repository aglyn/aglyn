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
import { isBlockedSubdomain, SUBDOMAIN_PATTERN } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Staff host management (AGL-390): retarget a host's subdomain (validated,
 * unique, not reserved) from the staff console. Super-staff only; audited
 * to adminAudit.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '')
  if (!hostId || action !== 'set-subdomain') {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return Response.json({ error: 'Staff only' }, { status: 403 })
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }

    const subdomain = String(body?.subdomain ?? '')
      .trim()
      .toLowerCase()
    if (!SUBDOMAIN_PATTERN.test(subdomain) || isBlockedSubdomain(subdomain)) {
      return Response.json({ error: 'Invalid or reserved subdomain' }, { status: 400 })
    }

    const firestore = firebaseAdmin.app().firestore()
    // Uniqueness: no other host may hold this subdomain.
    const taken = await firestore
      .collection('hosts')
      .where('subdomain', '==', subdomain)
      .limit(1)
      .get()
    if (!taken.empty && taken.docs[0].id !== hostId) {
      return Response.json({ error: 'That subdomain is taken' }, { status: 409 })
    }

    const hostRef = firestore.collection('hosts').doc(hostId)
    const before = (await hostRef.get()).get('subdomain') ?? null
    await hostRef.set(
      { subdomain, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    // Keep the routing mirror in step (AGL-628). `registerOrgHost` seeds
    // hostIndex.subdomain on create and /api/hosts/rename maintains it, but
    // this staff path never did — leaving a stale subdomain behind that
    // cross-org host resolution would then follow to the wrong site.
    await firestore
      .collection('hostIndex')
      .doc(hostId)
      .set({ subdomain }, { merge: true })
    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      action: 'host.set-subdomain',
      target: `hosts/${hostId}`,
      before: { subdomain: before },
      after: { subdomain },
      at: FieldValue.serverTimestamp(),
    })
    return Response.json({ ok: true, subdomain }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Host update failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
