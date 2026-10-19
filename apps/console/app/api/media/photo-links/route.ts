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

import { createResourceUid, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { newMediaFolderDoc, normalizeFolderName } from '@aglyn/aglyn/app-utils/media-folders'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  createPhotoLink,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listLivePhotoLinks,
  PHOTO_LINK_FOLDER_NAME,
  photoLinkUrl,
  revokePhotoLink,
} from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { resolveMediaScope } from '../../../../utils/server/media-scope'

/**
 * A SITE'S PHOTO LINKS, FOR ITS MEMBERS (AGL-3957).
 *
 * `{hostId, action: 'list' | 'create' | 'revoke', linkId?}`, as the member
 * whose token signs the request. A link is minted for a SITE library only
 * (the organization library takes no phone photos), by a member who may
 * upload to it — the same `resolveMediaScope` the upload route runs, with
 * the `uploads` feature gate, so a locked site mints no link. The link's
 * uploads are later stored as this member (`media/photo-links/public`).
 *
 * - `list`: the site's links that still take photos, newest first. A read.
 * - `create`: files the link's photos in the site's "From the owner" folder,
 *   made at the root the first time, and answers the one-time token's full
 *   address. The address is never stored; a lost one is minted again.
 * - `revoke`: stops a link at once. Idempotent.
 *
 * A staff member's mint or revoke is also an Audit Log row, so a booth
 * build's photos can be traced to the link they came through.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const action = String(body?.['action'] ?? '')
    if (action !== 'list' && action !== 'create' && action !== 'revoke') {
      return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
    const hostId = String(body?.['hostId'] ?? '')
    if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
    // lockdown-423: via apps/console/utils/server/media-scope.ts — the scope
    // resolver runs the verdict on the org/host docs it already reads and
    // hands the 423 refusal back as `error.response`, so a locked workspace
    // neither lists nor mints a link.
    // The site library alone: neither the body's nor the query's `orgId`
    // reaches the resolver, so the organization library cannot be named.
    const { scope, error } = await resolveMediaScope({ hostId }, {}, decoded.uid, {
      staff,
      feature: 'uploads',
      ...(action === 'list' ? { intent: 'read' as const } : {}),
    })
    if (!scope) {
      return (
        error?.response ??
        Response.json({ error: error?.message ?? 'Bad request' }, { status: error?.status ?? 400 })
      )
    }
    const firestore = scope.scopeRef.firestore

    if (action === 'list') {
      return Response.json({ links: await listLivePhotoLinks(firestore, hostId) }, { status: 200 })
    }

    if (action === 'revoke') {
      const linkId = String(body?.['linkId'] ?? '')
      if (!linkId) return Response.json({ error: 'Missing linkId' }, { status: 400 })
      const revoked = await revokePhotoLink(firestore, { hostId, linkId, uid: decoded.uid })
      if (!revoked) return Response.json({ error: 'Unknown link' }, { status: 404 })
      if (staff) {
        await addAdminAudit(firestore, {
          actorUid: decoded.uid,
          action: 'media.photo-link-revoked',
          target: `hosts/${hostId}`,
          after: { linkId },
          at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        })
      }
      return Response.json({ ok: true }, { status: 200 })
    }

    const folderId = await ownerFolderId(scope.scopeRef)
    const link = await createPhotoLink(firestore, { hostId, uid: decoded.uid, folderId })
    if (staff) {
      await addAdminAudit(firestore, {
        actorUid: decoded.uid,
        action: 'media.photo-link-created',
        target: `hosts/${hostId}`,
        after: { linkId: link.linkId, expiresAt: link.expiresAt },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
    }
    return Response.json(
      {
        linkId: link.linkId,
        url: photoLinkUrl(platformConsoleOrigin(), link.linkId, link.secret),
        expiresAt: link.expiresAt,
        folderId,
      },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Photo link failed' }, { status: 500 })
  }
}

/**
 * The site's "From the owner" folder at the library's root, made the first
 * time a link is minted. Matched by its normalized name among the root
 * folders, the way the library refuses a second sibling of one name, so a
 * folder a member renamed back by hand is found rather than doubled.
 */
async function ownerFolderId(scopeRef: FirebaseFirestore.DocumentReference): Promise<string | null> {
  const wanted = normalizeFolderName(PHOTO_LINK_FOLDER_NAME)
  if (!wanted) return null
  const foldersRef = scopeRef.collection('mediaFolders')
  const roots = await foldersRef.where('parentId', '==', null).limit(500).get()
  for (const folder of roots.docs) {
    if (normalizeFolderName(String(folder.get('name') ?? ''))?.toLowerCase() === wanted.toLowerCase()) {
      return folder.id
    }
  }
  const ref = foldersRef.doc(createResourceUid())
  await ref.set(
    newMediaFolderDoc({
      name: wanted,
      parentId: null,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    } as Parameters<typeof newMediaFolderDoc>[0]),
  )
  return ref.id
}

export const dynamic = 'force-dynamic'
export { handler as POST }
