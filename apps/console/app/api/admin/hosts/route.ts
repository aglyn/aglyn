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

const PAGE_SIZE = 200

/**
 * Staff site list (AGL-929), the `hosts` counterpart to `/api/admin/orgs`.
 *
 * Exists for the same reason that one does, and the reason is worth repeating
 * because it is not obvious: a client LIST over a collection whose rule is
 * evaluated PER DOCUMENT can poison the local document cache.
 *
 * `/hosts/{hostId}` is gated on `isStaff() || memberRoles[uid] != null`. When
 * a document drops out of a query target — a rule re-evaluating, an App Check
 * token failing to mint (AGL-1143, which is live on this deployment) — the SDK
 * cannot tell "denied" from "deleted". It resolves the ambiguity with a
 * single-document listen, and when that is denied too it records a DELETION at
 * the document path. `remoteDocumentsV14` is keyed by path, not by target, so
 * that tombstone is then served to every other reader of that document, and
 * resume tokens mean the correction never arrives.
 *
 * Reading with the Admin SDK sidesteps rules and App Check entirely, so no
 * per-document verdict can flip mid-query and nothing can be tombstoned.
 *
 * Ordered by document id — a stable ordering that drops no document, where an
 * `orderBy` on a field some host docs lack would silently hide them.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const db = app.firestore()
    const after = String(query['after'] ?? '')
    const orgId = String(query['orgId'] ?? '')
    const byId = firebaseAdmin.firestore.FieldPath.documentId()
    // `orgId` narrows to one workspace's sites, for the staff org detail page.
    // Absent, it lists everything — the picker case.
    const base = orgId
      ? db.collection('hosts').where('orgId', '==', orgId)
      : db.collection('hosts')
    let ref = base.orderBy(byId).limit(PAGE_SIZE + 1)
    if (after) {
      ref = base.orderBy(byId).startAfter(after).limit(PAGE_SIZE + 1)
    }
    const snapshot = await ref.get()
    const docs = snapshot.docs
    const more = docs.length > PAGE_SIZE
    const pageDocs = more ? docs.slice(0, PAGE_SIZE) : docs
    // Identity only. A host document carries screens, layouts and directory
    // maps; projecting them into a picker would ship kilobytes per row for
    // three fields.
    const hosts = pageDocs.map((docSnap) => ({
      $id: docSnap.id,
      displayName: docSnap.get('displayName') ?? null,
      subdomain: docSnap.get('subdomain') ?? null,
      orgId: docSnap.get('orgId') ?? null,
    }))
    return Response.json(
      {
        hosts,
        hasMore: more,
        nextCursor: more ? pageDocs[pageDocs.length - 1].id : null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[admin/hosts] failed', error)
    return Response.json({ error: 'Site list failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
