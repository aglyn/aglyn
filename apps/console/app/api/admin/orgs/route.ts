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

const PAGE_SIZE = 25

/**
 * Staff organization list (AGL-878). The page used to read `collection('orgs')`
 * from the client, but that list is gated by the `isStaff() || isOrgMember()`
 * rule and rides App Check — and in practice returned a non-deterministic
 * subset (orgs flickered in and out). Reading it here via the Admin SDK
 * bypasses both, so staff reliably see EVERY org. Ordered by document id — a
 * stable ordering that drops no doc (an `orderBy` on a field some org docs lack
 * would silently hide them). Cursor pagination: `?after=<lastDocId>`.
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
    const byId = firebaseAdmin.firestore.FieldPath.documentId()
    // One extra row tells us whether a next page exists.
    let ref = db.collection('orgs').orderBy(byId).limit(PAGE_SIZE + 1)
    if (after) {
      ref = db
        .collection('orgs')
        .orderBy(byId)
        .startAfter(after)
        .limit(PAGE_SIZE + 1)
    }
    const snapshot = await ref.get()
    const docs = snapshot.docs
    const more = docs.length > PAGE_SIZE
    const pageDocs = more ? docs.slice(0, PAGE_SIZE) : docs
    // Serialize timestamps to the `{ seconds }` shape the page reads.
    const ts = (value: unknown) =>
      value && typeof (value as { seconds?: unknown }).seconds === 'number'
        ? { seconds: (value as { seconds: number }).seconds }
        : null
    const orgs = pageDocs.map((docSnap) => {
      const data = docSnap.data()
      return {
        $id: docSnap.id,
        name: data['name'] ?? null,
        slug: data['slug'] ?? null,
        plan: data['plan'] ?? null,
        entitlements: data['entitlements'] ?? null,
        subscription: data['subscription']
          ? { status: data['subscription']?.status ?? null }
          : null,
        createdAt: ts(data['createdAt']),
        suspendedAt: ts(data['suspendedAt']),
        suspendedReason: data['suspendedReason'] ?? null,
        erasureRequestedAt: ts(data['erasureRequestedAt']),
      }
    })
    return Response.json(
      {
        orgs,
        hasMore: more,
        nextCursor: more ? pageDocs[pageDocs.length - 1].id : null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Organization list failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
