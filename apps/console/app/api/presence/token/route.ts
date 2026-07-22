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

/**
 * Mint a Realtime Database token scoped to one org, for presence (AGL-675).
 *
 * RTDB rules **cannot read Firestore**, and the ordinary console token
 * carries only `staff`/`staffRole` — no org membership for rules to check.
 * Left there, presence would have to be readable by any signed-in user who
 * knew a host id.
 *
 * So membership is verified HERE, server-side, and the answer is baked into
 * a separate short-lived token as a `presenceOrg` claim that the RTDB rules
 * can check with a simple equality. This is the same shape as the media
 * upload-URL route, which exists because Storage rules have the identical
 * limitation — and it is what `docs/MULTI_TENANT_FIRESTORE.md` §7 already
 * specified for RTDB.
 *
 * One org per token deliberately: the claim stays a single string rather
 * than a membership map, so it cannot drift toward the 1000-byte claim
 * ceiling, and switching orgs mints a new one.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

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

    // Membership is proven against the host the caller claims to be
    // editing — not against an orgId they supply, which would let anyone
    // mint a token for any org.
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const orgId = host.get('orgId') as string | undefined
    if (!orgId) {
      return Response.json({ error: 'Site has no organization' }, { status: 409 })
    }
    const membership = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('members')
      .doc(decoded.uid)
      .get()
    if (!membership.exists) {
      return Response.json({ error: 'Not a member of this site' }, { status: 403 })
    }

    // Presence is a read/write of your own name and selection — every role
    // that can open the editor can be seen in it, viewers included.
    const token = await firebaseAdmin
      .app()
      .auth()
      .createCustomToken(decoded.uid, { presenceOrg: orgId })

    return Response.json({ token, orgId }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Could not start presence' }, { status: 500 })
  }
}

export const POST = handler
