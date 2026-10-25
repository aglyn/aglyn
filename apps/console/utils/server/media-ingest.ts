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

import type {
  PluginMediaAsset,
  PluginMediaIngest,
  PluginMediaIngestRequest,
  PluginMediaIngestResult,
} from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { mediaFilterKeys } from '@aglyn/aglyn/app-utils/media-metadata'
import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'
import { mediaNodeSrc } from '@aglyn/aglyn/app-utils/media-ref'
import {
  checkEntitlement,
  createResourceUid,
  defaultMediaScopeOf,
  defaultScopeForNewResource,
  inspectUploadBytes,
  readImageDimensions,
} from '@aglyn/aglyn/server'
import { hostScopeToken, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  firebaseAdmin,
  generateMediaVariants,
  getMediaQuarantine,
  mediaVariantDocFields,
} from '@aglyn/tenant-data-admin'
import { createHash, randomUUID } from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { directUploadMaxBytes, normalizeUploadContentType } from '../media-upload-limits'
import { mediaStorageGate, scopeBillsStorageOverage } from '../storage-overage'
import { embeddedMetadataAtIngress } from './media-embedded'
import { resolveOrgMediaBand } from './media-storage-band'
import { folderStoragePath, mediaCdnPathUpdate, resolveMediaScope } from './media-scope'
import { resolveUploadSite } from './media-upload-site'

/**
 * This app's implementation of `core.media-ingest` (AGL-3660): a picture a
 * server process holds, stored in a site's own media library as the member
 * named, with no browser request behind it — an AI job copying a stock
 * photo, or a site photo link storing what a phone sent (AGL-3957).
 *
 * The same checks, in the same order, as the console's direct upload route
 * (`app/api/media/upload/route.ts`) and the v1 API's create
 * (`utils/api-v1-resources.ts`), through the same helpers — never a second
 * copy of any rule:
 *
 * - **The member and the site**: `resolveMediaScope` as the member, with the
 *   `uploads` feature gate, so a member who lost the site, or a site or
 *   workspace under lockdown, stores nothing.
 * - **Raster images only**: a server-held SVG, video or document has no
 *   caller, so none is accepted rather than half-handled.
 * - **Size**: `directUploadMaxBytes` for the type, on the bytes held.
 * - **Structure**: `inspectUploadBytes`, so bytes that are not the image
 *   they claim are refused.
 * - **Takedowns**: `getMediaQuarantine` on the full SHA-256.
 * - **The money**: the org's one storage band (`resolveOrgMediaBand`,
 *   `mediaStorageGate`), and the same counter increment.
 * - **Delivery**: the CDN path and WebP variants by the plan, as an upload
 *   gets them.
 *
 * A stock photo's credit rides the document as `stockPhoto`, and
 * `findStockPhoto` reads it back by its source key so one photo is stored
 * once per site; a picture a site import brought in rides it as
 * `importedFrom`, read back the same way by `findImportedPhoto` (AGL-3976).
 */

const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const refuse = (status: number, reason: string): PluginMediaIngestResult => ({ ok: false, status, reason })

/** What a page names an asset by, from its stored document. */
function assetOf(mediaId: string, media: Record<string, unknown>): PluginMediaAsset | null {
  const src = mediaNodeSrc({
    url: typeof media['url'] === 'string' ? media['url'] : null,
    cdnPath: typeof media['cdnPath'] === 'string' ? media['cdnPath'] : null,
    private: media['private'] === true,
  })
  if (!src) return null
  return {
    mediaId,
    src,
    ...(typeof media['width'] === 'number' ? { width: media['width'] } : {}),
    ...(typeof media['height'] === 'number' ? { height: media['height'] } : {}),
  }
}

export async function ingestMedia(request: PluginMediaIngestRequest): Promise<PluginMediaIngestResult> {
  const contentType = normalizeUploadContentType(request.contentType, request.fileName)
  if (!RASTER_TYPES.has(contentType)) return refuse(415, 'Only photos can be stored this way')
  const buffer = Buffer.from(request.bytes)
  const maxBytes = Number(directUploadMaxBytes(contentType) ?? 0)
  if (!buffer.length || !maxBytes || buffer.length > maxBytes) return refuse(413, 'The photo is too large')
  const fileName = request.fileName.slice(0, 200)
  {
    const refusal = inspectUploadBytes({ bytes: buffer, contentType, fileName })
    if (refusal) return refuse(415, refusal.message)
  }

  // The workspace's shared library when one is named (AGL-4066), with the
  // site on screen as the upload route's `forHostId`; the site's own otherwise.
  const target = request.orgId
    ? { orgId: request.orgId, ...(request.hostId ? { forHostId: request.hostId } : {}) }
    : { hostId: request.hostId }
  const { scope, error } = await resolveMediaScope(target, {}, request.uid, {
    feature: 'uploads',
  })
  if (!scope) return refuse(error?.status ?? 400, error?.message ?? 'The site could not be resolved')
  // Shared as the workspace's Default sharing decides, as an upload is: a
  // workspace asset with no `visibleTo` matches no scoped read at all.
  let visibleTo: string[] | null = null
  if (scope.collection === 'orgs') {
    const site = await resolveUploadSite(scope, target)
    if ('error' in site) return refuse(site.error.status, site.error.message)
    visibleTo = defaultScopeForNewResource({
      defaultResourceScope: defaultMediaScopeOf(scope.billing as Parameters<typeof defaultMediaScopeOf>[0]),
      hostId: site.hostId,
    })
  }

  const contentSha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex')
  const contentHash = contentSha256.slice(0, 16)
  if (await getMediaQuarantine({ contentSha256, contentHash })) {
    return refuse(451, 'The photo is not accepted here')
  }

  const org = scope.billing
  const band = await resolveOrgMediaBand({
    firestore: scope.scopeRef.firestore,
    orgId: scope.orgId,
    org: org as never,
    currentHostId: scope.scopeId,
  })
  const gate = mediaStorageGate({
    org: org as never,
    usedMb: (band.usedBytes + buffer.length) / (1024 * 1024),
    allowanceMb: band.allowanceMb,
    billsOverage: scopeBillsStorageOverage(scope.collection),
  })
  if (!gate.allowed) return refuse(gate.status, gate.error ?? `Storage limit reached (${gate.limitMb} MB)`)

  const mediaId = createResourceUid()
  const token = randomUUID()
  // Inside the folder's Storage prefix, the way an upload is, so the bucket
  // tree mirrors the library tree; a stale or absent folder files the asset
  // at the root, as the upload route does.
  const folderId = request.folderId ?? null
  const folderPath = await folderStoragePath(scope.scopeRef, folderId)
  const objectPath = `${scope.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId
  const bucket = firebaseAdmin.app().storage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
  await bucket.file(objectPath).save(buffer, {
    contentType,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  })
  const url =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
    `${encodeURIComponent(objectPath)}?alt=media&token=${token}`

  const dimensions = readImageDimensions(new Uint8Array(buffer)) ?? null
  const cdnAllowed = checkEntitlement(org as never, 'mediaCdn')
  const variants = cdnAllowed
    ? await generateMediaVariants({
        buffer,
        contentType,
        sourceWidth: dimensions?.width,
        objectPath,
        display: true,
        saveVariant: (path, bytes, type) =>
          bucket.file(path).save(bytes, {
            contentType: type,
            metadata: { cacheControl: 'public, max-age=31536000, immutable' },
          }),
      }).catch(() => null)
    : null
  const embeddedMetadata = await embeddedMetadataAtIngress({
    contentType,
    bytes: new Uint8Array(buffer),
    contentSha256,
  })
  const alt = String(request.alt ?? '').trim().slice(0, MEDIA_ALT_MAX_LENGTH)
  const description = String(request.description ?? '').trim().slice(0, 500)
  const cdnPath = mediaCdnPathUpdate({
    billing: org,
    cdnScope: scope.cdnScope,
    mediaId,
    isPrivate: false,
  })

  await scope.scopeRef.collection('media').doc(mediaId).create({
    fileName,
    contentType,
    sizeBytes: buffer.length,
    url,
    storagePath: objectPath,
    folderId,
    ...(dimensions ?? {}),
    ...(alt ? { alt } : {}),
    ...(description ? { description } : {}),
    ...mediaFilterKeys({
      fileName,
      contentType,
      alt,
      ...(dimensions ?? {}),
      embeddedMetadata,
      contentSha256,
    }),
    uploadedBy: request.uid,
    contentHash,
    contentSha256,
    ...(variants ? mediaVariantDocFields(variants) : { variants: [] as number[] }),
    ...(variants?.error ? { variantsError: variants.error } : {}),
    ...(embeddedMetadata ? { embeddedMetadata } : {}),
    ...(request.stockPhoto ? { stockPhoto: { ...request.stockPhoto, importedAt: Timestamp.now() } } : {}),
    ...(visibleTo ? { visibleTo } : {}),
    // The business's own photo (AGL-3957): `true` and never false, so the
    // owner-photo read below is one equality query with no index of its own.
    ...(request.ownerPhotoLinkId ? { ownerPhoto: true, photoLinkId: request.ownerPhotoLinkId } : {}),
    // Brought in by a site import (AGL-3976): read back by its key so the
    // same picture is stored once however many pages show it.
    ...(request.importedFrom?.key
      ? {
          importedFrom: {
            key: String(request.importedFrom.key).slice(0, 120),
            url: String(request.importedFrom.url ?? '').slice(0, 2048),
            domain: String(request.importedFrom.domain ?? '').slice(0, 253),
            importedAt: Timestamp.now(),
          },
        }
      : {}),
    cdnPath,
    createdAt: Timestamp.now(),
  })
  await scope.scopeRef
    .collection('counters')
    .doc('media')
    .set(
      {
        bytes: firebaseAdmin.firestore.FieldValue.increment(buffer.length),
        count: firebaseAdmin.firestore.FieldValue.increment(1),
        ...(variants?.error ? { variantFailures: firebaseAdmin.firestore.FieldValue.increment(1) } : {}),
      },
      { merge: true },
    )

  const asset = assetOf(mediaId, {
    url,
    ...(typeof cdnPath === 'string' ? { cdnPath } : {}),
    ...(dimensions ?? {}),
  })
  return asset ? { ok: true, ...asset } : refuse(500, 'The photo was stored without an address')
}

/**
 * The site's live, public raster asset copied from the stock photo `sourceKey`
 * names, or null. Read by the Admin SDK on the site's own library alone; or,
 * with `orgId` (AGL-4066), on the workspace's shared library, where an asset
 * counts only if it is shared with every site, or with `hostId`'s when one is
 * named: a copy narrowed to other sites is one this member may not see.
 */
export async function findStockPhotoMedia(input: {
  hostId: string
  sourceKey: string
  orgId?: string
}): Promise<PluginMediaAsset | null> {
  const library = input.orgId ? { collection: 'orgs', id: input.orgId } : { collection: 'hosts', id: input.hostId }
  if (!library.id || !input.sourceKey) return null
  const reachable = new Set<string>([ORG_SCOPE_TOKEN, ...(input.hostId ? [hostScopeToken(input.hostId)] : [])])
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection(library.collection)
    .doc(library.id)
    .collection('media')
    .where('stockPhoto.key', '==', input.sourceKey)
    .limit(5)
    .get()
  for (const doc of snapshot.docs) {
    const media = doc.data() as Record<string, unknown>
    if (media['deletedAt'] || media['private'] === true) continue
    if (!RASTER_TYPES.has(String(media['contentType'] ?? ''))) continue
    if (input.orgId) {
      const shared = Array.isArray(media['visibleTo']) ? (media['visibleTo'] as unknown[]) : []
      if (!shared.some((token) => typeof token === 'string' && reachable.has(token))) continue
    }
    const asset = assetOf(doc.id, media)
    if (asset) return asset
  }
  return null
}

/**
 * The site's live, public raster asset a site import brought in under
 * `sourceKey` (AGL-3976), or null. Read by the Admin SDK on the site's own
 * library alone, by one equality, as `findStockPhotoMedia` reads a stock key.
 */
export async function findImportedPhotoMedia(input: {
  hostId: string
  sourceKey: string
}): Promise<PluginMediaAsset | null> {
  if (!input.hostId || !input.sourceKey) return null
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(input.hostId)
    .collection('media')
    .where('importedFrom.key', '==', input.sourceKey)
    .limit(5)
    .get()
  for (const doc of snapshot.docs) {
    const media = doc.data() as Record<string, unknown>
    if (media['deletedAt'] || media['private'] === true) continue
    if (!RASTER_TYPES.has(String(media['contentType'] ?? ''))) continue
    const asset = assetOf(doc.id, media)
    if (!asset) continue
    const alt = typeof media['alt'] === 'string' ? media['alt'].trim() : ''
    return alt ? { ...asset, alt } : asset
  }
  return null
}

/** The most owner photos read for one site before the newest are kept. */
const OWNER_PHOTOS_READ = 200

/**
 * The site's live, public photos of the business itself (AGL-3957), newest
 * first: what came through a site photo link. Read by the Admin SDK on the
 * site's own library alone. Ordered here rather than by the query, so the
 * read needs no composite index on a field most libraries never carry.
 */
export async function listOwnerPhotoMedia(input: {
  hostId: string
  limit?: number
}): Promise<PluginMediaAsset[]> {
  if (!input.hostId) return []
  const limit = Math.max(1, Math.min(OWNER_PHOTOS_READ, input.limit ?? 60))
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(input.hostId)
    .collection('media')
    .where('ownerPhoto', '==', true)
    .limit(OWNER_PHOTOS_READ)
    .get()
  const createdMs = (value: unknown): number =>
    typeof (value as { toMillis?: () => number } | null)?.toMillis === 'function'
      ? (value as { toMillis: () => number }).toMillis()
      : 0
  const photos: Array<{ at: number; asset: PluginMediaAsset }> = []
  for (const doc of snapshot.docs) {
    const media = doc.data() as Record<string, unknown>
    if (media['deletedAt'] || media['private'] === true) continue
    if (!RASTER_TYPES.has(String(media['contentType'] ?? ''))) continue
    const asset = assetOf(doc.id, media)
    if (!asset) continue
    const alt = typeof media['alt'] === 'string' ? media['alt'].trim() : ''
    photos.push({ at: createdMs(media['createdAt']), asset: alt ? { ...asset, alt } : asset })
  }
  return photos
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((entry) => entry.asset)
}

export const consoleMediaIngest: PluginMediaIngest &
  Required<Pick<PluginMediaIngest, 'listOwnerPhotos' | 'findImportedPhoto'>> = {
  ingest: ingestMedia,
  findStockPhoto: findStockPhotoMedia,
  listOwnerPhotos: listOwnerPhotoMedia,
  findImportedPhoto: findImportedPhotoMedia,
}
