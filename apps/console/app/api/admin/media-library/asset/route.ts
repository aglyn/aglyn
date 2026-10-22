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

import { mediaRefPattern, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  resolveUidsToPeople,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import {
  type StaffMediaAsset,
  type StaffMediaScope,
  type StaffMediaSite,
  type StaffMediaUsage,
  staffMediaScopeBase,
  staffMediaScopeFrom,
  staffRightsConfirmation,
} from '../../../../../utils/staff-media-library'
import {
  recordStaffMediaView,
  staffMediaRowFrom,
  staffMediaSrc,
  staffMediaStoragePath,
} from '../../../../../utils/server/staff-media-library'
import {
  HOSTS_PER_SCAN,
  type MediaScanHost,
  scanMediaReferences,
} from '../../../../../utils/server/scan-media-references'

type Firestore = FirebaseFirestore.Firestore

const siteName = (data: Record<string, unknown> | undefined, id: string) =>
  String(data?.['displayName'] ?? data?.['subdomain'] ?? id)

/**
 * Where an asset is used: the scan the library's own "where is this used"
 * asks (`scanMediaReferences`), over every site of the workspace for an
 * organization's asset — staff see the whole workspace — or over the one
 * site for a site's own asset. Fails soft to null: an unanswered scan must
 * read as unanswered, never as "used nowhere".
 */
async function scanUsage(
  db: Firestore,
  scope: StaffMediaScope,
  parent: FirebaseFirestore.DocumentSnapshot,
  media: FirebaseFirestore.DocumentSnapshot,
): Promise<StaffMediaAsset['usage']> {
  try {
    const needles = [
      media.get('url'),
      media.get('cdnPath'),
      staffMediaStoragePath(scope, media.id, media.get('storagePath')),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    const refPattern = mediaRefPattern(media.id)
    const isReferenced = (haystack: string) =>
      needles.some((needle) => haystack.includes(needle)) || refPattern.test(haystack)

    const hosts: MediaScanHost[] = []
    let hostsTruncated = false
    let org: { id: string; data?: Record<string, unknown> } | null = null
    if (scope.kind === 'org') {
      const orgHosts = await db
        .collection('hosts')
        .where('orgId', '==', scope.orgId)
        .limit(HOSTS_PER_SCAN + 1)
        .get()
      hostsTruncated = orgHosts.size > HOSTS_PER_SCAN
      for (const host of orgHosts.docs.slice(0, HOSTS_PER_SCAN)) {
        hosts.push({
          ref: host.ref,
          id: host.id,
          subdomain: String(host.get('subdomain') ?? host.id),
          data: host.data() as Record<string, unknown>,
        })
      }
      org = { id: scope.orgId, data: parent.data() as Record<string, unknown> }
    } else {
      hosts.push({
        ref: parent.ref,
        id: parent.id,
        subdomain: String(parent.get('subdomain') ?? parent.id),
        data: parent.data() as Record<string, unknown>,
      })
    }
    const names = new Map(hosts.map((host) => [host.id, siteName(host.data, host.id)]))
    const scan = await scanMediaReferences({ hosts, org, hostsTruncated, isReferenced })
    const references: StaffMediaUsage[] = scan.references.map((reference) => ({
      kind: reference.kind,
      name: reference.name,
      hostId: reference.hostId,
      hostName: reference.hostId ? (names.get(reference.hostId) ?? reference.hostId) : 'Organization',
      live: typeof reference.live === 'boolean' ? reference.live : null,
    }))
    return { references, coverage: scan.coverage }
  } catch (error) {
    console.error('[admin/media-library/asset] usage scan failed', media.id, error)
    return null
  }
}

/**
 * One asset of a media library, opened by staff — read-only.
 *
 * `GET ?orgId=<id>|hostId=<id>&mediaId=<id>` → `StaffMediaAsset`: the row,
 * a full-size preview (a staff-minted signed URL for a private asset), its
 * storage path, owner, visibility and where it is used. Recorded as a
 * `media.asset-viewed` access row before it is served.
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
  const scope = staffMediaScopeFrom(query ?? {})
  const mediaId = String(query?.['mediaId'] ?? '').trim()
  if (!scope || !/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) {
    return Response.json({ error: 'Name one library and one asset' }, { status: 400 })
  }

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
    const parent = db.doc(staffMediaScopeBase(scope))
    const [parentSnap, mediaSnap] = await db.getAll(parent, parent.collection('media').doc(mediaId))
    if (!parentSnap.exists || !mediaSnap.exists) {
      return Response.json({ error: 'No such asset' }, { status: 404 })
    }
    const data = (mediaSnap.data() ?? {}) as Record<string, unknown>
    const orgId = scope.kind === 'org' ? scope.orgId : String(parentSnap.get('orgId') ?? '')
    const nowMs = Date.now()
    const uploadedBy = typeof data['uploadedBy'] === 'string' ? data['uploadedBy'] : null

    const [people, usage] = await Promise.all([
      resolveUidsToPeople([uploadedBy], orgId ? { orgId } : {}).catch(() => ({}) as Record<string, never>),
      scanUsage(db, scope, parentSnap, mediaSnap),
    ])
    const person = uploadedBy
      ? (people as Record<string, { email: string | null; displayName: string | null }>)[uploadedBy]
      : undefined
    const preview = staffMediaSrc(scope, mediaId, data, nowMs)
    const row = staffMediaRowFrom(scope, mediaId, data, nowMs)
    const usedBy: StaffMediaSite[] | null = usage
      ? [
          ...new Map(
            usage.references
              .filter((reference) => reference.hostId)
              .map((reference) => [reference.hostId, { hostId: reference.hostId, name: reference.hostName }]),
          ).values(),
        ]
      : null

    const asset: StaffMediaAsset = {
      ...row,
      usedBy,
      previewSrc: preview.src,
      previewExpiresAtMs: preview.expiresAtMs,
      storagePath: staffMediaStoragePath(scope, mediaId, data['storagePath']),
      folderId: typeof data['folderId'] === 'string' ? data['folderId'] : null,
      alt: typeof data['alt'] === 'string' && data['alt'] ? data['alt'] : null,
      description: typeof data['description'] === 'string' && data['description'] ? data['description'] : null,
      uploadedBy,
      owner: uploadedBy
        ? { uid: uploadedBy, email: person?.email ?? null, displayName: person?.displayName ?? null }
        : null,
      visibleTo: Array.isArray(data['visibleTo'])
        ? (data['visibleTo'] as unknown[]).filter((token): token is string => typeof token === 'string')
        : [],
      rightsConfirmation: staffRightsConfirmation(data['rightsConfirmation']),
      usage,
    }

    // Written before the asset leaves: a read the log cannot record is not served.
    await recordStaffMediaView({
      actorUid: decoded.uid,
      scope,
      mediaId,
      note: asset.private ? 'private asset, signed preview' : 'public asset',
    })

    return Response.json(asset, {
      status: 200,
      // A private asset's preview is a signed, time-boxed capability.
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/media-library/asset] failed', error)
    return Response.json({ error: 'The asset could not be read' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
