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
import { Timestamp } from 'firebase-admin/firestore'
import materializeStarterTemplate, {
  type SeedFirestore,
} from '../../../../utils/server/seed-starter-templates'

/**
 * Copies ONE first-party starter into a host's template library (AGL-687).
 *
 * Called only when the user uses or edits that starter. Nothing is written
 * on host creation or when the gallery opens — starters stay virtual, served
 * from the code definitions, until somebody commits to one, so untouched
 * starters keep receiving upstream improvements.
 *
 * Idempotent: ids are derived from the starter and screen, so a double-click
 * or a use-after-edit addresses the same documents and leaves existing ones
 * untouched.
 *
 * Server-side because Firestore rules deny client `create` on `templates`
 * (AGL-473) and `source` is server-managed — a client that could write it
 * could forge provenance. No quota is charged: platform-authored content
 * must not spend the user's `templatesPerHost` allowance.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  // Required: this endpoint materializes one named starter, never the set.
  const starterId = String(body?.starterId ?? '')
  if (!starterId) {
    return Response.json({ error: 'Missing starterId' }, { status: 400 })
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
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    // Same role model as every other content write (canWriteHostContent):
    // seeding adds library documents to somebody's site.
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return Response.json({ error: 'Editing requires the editor role' }, { status: 403 })
    }
    const result = await materializeStarterTemplate(
      firestore as unknown as SeedFirestore,
      hostId,
      starterId,
      { now: Timestamp.now() },
    )
    return Response.json({ ok: true, ...result }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Adding the starter failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
