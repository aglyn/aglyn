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
  hostCollectionKind,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'

/** Roles allowed to write host content — mirrors canWriteHostContent(). */
const HOST_WRITER_ROLES = new Set(['admin', 'editor'])

/** Keys the client may set; everything else is dropped rather than trusted. */
const CONTENT_KEYS = new Set(['displayName', 'slug'])
const CATALOG_KEYS = new Set([
  'name',
  'slug',
  'description',
  'mode',
  'productIds',
  'rules',
  'matchAll',
  'imageUrl',
  'order',
])

/**
 * Collection create/rename with a transactional slug claim (AGL-978).
 *
 * A collection's slug is its public address — `/{slug}` for content,
 * `/collections/{slug}` for catalog — and it was only ever checked in the
 * browser against the list on screen (AGL-957). Two editors naming the same
 * thing at once both won, and the loser became unreachable with no error
 * anywhere. The site subdomain has the same property and is claimed
 * server-side for the same reason (AGL-642).
 *
 * Uniqueness is per host AND per kind: the two kinds have separate URL
 * namespaces (AGL-954), so `/blog` and `/collections/blog` may coexist.
 * The read and the write share one transaction, so a concurrent create
 * cannot slip between them.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '')
  const kind = String(body?.kind ?? '')
  const data = (body?.data ?? {}) as Record<string, unknown>
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (action !== 'create' && action !== 'update') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (kind !== 'content' && kind !== 'catalog') {
    return Response.json({ error: 'Unknown collection kind' }, { status: 400 })
  }

  const slug = String(data.slug ?? '').trim().toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return Response.json({
      error: 'Slug must be lowercase letters, numbers, and dashes',
    }, { status: 400 })
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
    const hostRef = firestore.collection('hosts').doc(hostId)

    if (decoded['staff'] !== true) {
      const hostSnapshot = await hostRef.get()
      if (!hostSnapshot.exists) {
        return Response.json({ error: 'Unknown site' }, { status: 404 })
      }
      const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
      if (!HOST_WRITER_ROLES.has(String(memberRole))) {
        return Response.json({
          error: 'Editing collections requires the editor role',
        }, { status: 403 })
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      if (orgId) {
        const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
        if (orgSnapshot.get('suspendedAt')) {
          return Response.json({
            error: 'This workspace is suspended',
          }, { status: 403 })
        }
      }
    }

    const id = action === 'create' ? createResourceUid() : String(body?.id ?? '')
    if (action === 'update' && !id) {
      return Response.json({ error: 'Missing id' }, { status: 400 })
    }

    const allowed = kind === 'content' ? CONTENT_KEYS : CATALOG_KEYS
    const fields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key) && value !== undefined) fields[key] = value
    }
    fields.slug = slug
    fields.kind = kind

    const collectionsRef = hostRef.collection('collections')
    const result = await firestore.runTransaction(async (transaction) => {
      // The claim: same host, same slug, same kind, different document. Read
      // and write share the transaction, so a concurrent create that would
      // collide is retried rather than admitted.
      const sameSlug = await transaction.get(
        collectionsRef.where('slug', '==', slug).limit(10),
      )
      const clash = sameSlug.docs.find(
        (docSnapshot) =>
          docSnapshot.id !== id &&
          hostCollectionKind(docSnapshot.data()) === kind,
      )
      if (clash) return { taken: true as const }

      const docRef = collectionsRef.doc(id)
      if (action === 'create') {
        transaction.create(docRef, { ...fields, createdAt: Timestamp.now() })
      } else {
        const existing = await transaction.get(docRef)
        if (!existing.exists) return { missing: true as const }
        // A rename must not silently change what the document IS.
        if (hostCollectionKind(existing.data()) !== kind) {
          return { wrongKind: true as const }
        }
        transaction.set(
          docRef,
          { ...fields, updatedAt: Timestamp.now() },
          { merge: true },
        )
      }
      return { ok: true as const }
    })

    if ('taken' in result) {
      return Response.json({
        error:
          kind === 'content'
            ? `Another collection already serves /${slug}`
            : `Another collection already serves /collections/${slug}`,
      }, { status: 409 })
    }
    if ('missing' in result) {
      return Response.json({ error: 'Unknown collection' }, { status: 404 })
    }
    if ('wrongKind' in result) {
      return Response.json({
        error: 'That collection belongs to a different part of the console',
      }, { status: 409 })
    }
    return Response.json({ ok: true, id }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Collection save failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
