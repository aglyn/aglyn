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
  ADMIN_AUDIT_MEDIA_ASSET_VIEWED,
  ADMIN_AUDIT_MEDIA_LIBRARY_VIEWED,
} from '@aglyn/aglyn/app-utils/admin-audit-index'
import { mediaThumbnailSrc } from '@aglyn/aglyn/app-utils/media-src'
import {
  mediaSignatureQuery,
  mediaStoragePathInScope,
  mintMediaSignature,
} from '@aglyn/tenant-data-admin'
import { recordAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit'
import {
  type StaffMediaRow,
  type StaffMediaScope,
  staffMediaCdnScope,
  staffMediaScopeBase,
} from '../staff-media-library'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE STAFF MEDIA LIBRARY, READ ON THE ADMIN SDK.
 *
 * Staff read a workspace's or a site's media library from the staff
 * organization and site pages. Three properties hold for every read:
 *
 *  1. **Paged on the query.** One `orderBy` and a `limit` of one more than
 *     the page, continued from the last document of the previous page —
 *     never the whole library loaded and cut.
 *  2. **Private bytes go through a staff-minted signature.** Storage rules
 *     deny every client read and stay that way; a private asset's picture is
 *     a short-lived signed URL on our own CDN route (`/api/media/cdn/…`),
 *     minted here only after the route has established a staff claim. The
 *     raw storage URL of a private asset never leaves the server. Signed for
 *     the `team` audience, so a staff look is not billed to the workspace's
 *     bandwidth.
 *  3. **Every read is in the staff audit log, before it is served.** A page
 *     of the library writes `media.library-viewed`, an opened asset writes
 *     `media.asset-viewed` — both access actions (`ADMIN_AUDIT_ACCESS_ACTIONS`),
 *     so they file under "data staff looked at" rather than beside the
 *     changes. A read the log cannot record is not served.
 */

/** A stored timestamp as epoch milliseconds, or null. */
export function toMillis(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const viaDate = (value as { toDate?: () => Date }).toDate?.()
  if (viaDate instanceof Date) return viaDate.getTime()
  if (value instanceof Date) return value.getTime()
  const seconds = (value as { seconds?: unknown; _seconds?: unknown }).seconds ??
    (value as { _seconds?: unknown })._seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Whether a type has a picture a browser draws. */
const isPicture = (contentType: string) => contentType.startsWith('image/')

/**
 * A staff-only, short-lived URL for a PRIVATE asset: the same signature
 * `/api/media/sign` mints for a member, on the same CDN route, for the
 * `team` audience. Called only behind a verified staff claim.
 */
export function staffSignedMediaSrc(
  scope: StaffMediaScope,
  mediaId: string,
  nowMs: number,
): { src: string; expiresAtMs: number } {
  const cdnScope = staffMediaCdnScope(scope)
  const signature = mintMediaSignature(cdnScope, mediaId, nowMs, undefined, 'team')
  return {
    src: `/api/media/cdn/${cdnScope}/${mediaId}?${mediaSignatureQuery(signature)}`,
    expiresAtMs: signature.exp,
  }
}

/**
 * The URL that draws an asset, or null. A private asset is signed; a public
 * one is its CDN path (a thumbnail width when `width` is given), falling
 * back to its public storage URL for an asset with no CDN path.
 */
export function staffMediaSrc(
  scope: StaffMediaScope,
  mediaId: string,
  data: Record<string, unknown>,
  nowMs: number,
  width?: number,
): { src: string | null; expiresAtMs: number | null } {
  if (data['private'] === true) {
    const signed = staffSignedMediaSrc(scope, mediaId, nowMs)
    return { src: signed.src, expiresAtMs: signed.expiresAtMs }
  }
  const media = {
    url: str(data['url']) ?? undefined,
    cdnPath: str(data['cdnPath']) ?? undefined,
    private: false,
  }
  const src = width ? mediaThumbnailSrc(media, width) : (media.cdnPath ?? media.url ?? '')
  return { src: src || null, expiresAtMs: null }
}

/** One stored media document as a row of the card. */
export function staffMediaRowFrom(
  scope: StaffMediaScope,
  mediaId: string,
  data: Record<string, unknown>,
  nowMs: number,
): StaffMediaRow {
  const contentType = str(data['contentType']) ?? ''
  return {
    $id: mediaId,
    name: str(data['fileName']) ?? str(data['name']) ?? mediaId,
    contentType,
    sizeBytes: num(data['sizeBytes']),
    createdAtMs: toMillis(data['createdAt']),
    private: data['private'] === true,
    deleted: Boolean(data['deletedAt']),
    width: num(data['width']),
    height: num(data['height']),
    thumbSrc: isPicture(contentType) ? staffMediaSrc(scope, mediaId, data, nowMs, 320).src : null,
    // Known only by a scan, which the list does not pay for per row; the
    // opened asset carries it.
    usedBy: null,
  }
}

/**
 * The page query: ONE order and a limit of one more than the page — the
 * extra row only says whether a next page exists — continued after the
 * previous page's last document. Nothing else narrows it, so each order
 * rides Firestore's automatic single-field index.
 */
export function staffMediaPageQuery(
  media: FirebaseFirestore.Query,
  sort: Pick<ListQuerySort, 'path' | 'direction'>,
  pageSize: number,
  after: FirebaseFirestore.DocumentSnapshot | null,
): FirebaseFirestore.Query {
  let query = media.orderBy(sort.path, sort.direction)
  if (after) query = query.startAfter(after)
  return query.limit(pageSize + 1)
}

/** The audit target of a library, or of one asset in it. */
export function staffMediaAuditTarget(scope: StaffMediaScope, mediaId?: string): string {
  const library = `${staffMediaScopeBase(scope)}/media`
  return mediaId ? `${library}/${mediaId}` : library
}

/**
 * Record that a staff member looked at a library page or an asset. Through
 * `recordAdminAudit`, the writer the delivery-log reads use: stamped like
 * every audit row, and an immediate repeat of the same look (a re-run
 * effect, a double click) collapses onto one row with its count.
 */
export async function recordStaffMediaView(entry: {
  actorUid: string
  scope: StaffMediaScope
  mediaId?: string
  note: string
}): Promise<void> {
  await recordAdminAudit({
    actorUid: entry.actorUid,
    action: entry.mediaId ? ADMIN_AUDIT_MEDIA_ASSET_VIEWED : ADMIN_AUDIT_MEDIA_LIBRARY_VIEWED,
    target: staffMediaAuditTarget(entry.scope, entry.mediaId),
    note: entry.note,
  })
}

/** Where an asset's bytes sit, refused back to its own scope's prefix. */
export function staffMediaStoragePath(
  scope: StaffMediaScope,
  mediaId: string,
  storagePath: unknown,
): string {
  return mediaStoragePathInScope({
    storagePath,
    base: staffMediaScopeBase(scope),
    mediaId,
  })
}
