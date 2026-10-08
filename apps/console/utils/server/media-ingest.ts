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
  inspectUploadBytes,
  readImageDimensions,
} from '@aglyn/aglyn/server'
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
import { mediaCdnPathUpdate, resolveMediaScope } from './media-scope'

/**
 * This app's implementation of `core.media-ingest` (AGL-3660): a picture a
 * server process holds, stored in a site's own media library as the member
 * named, with no browser request behind it.
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
 * once per site.
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

  const { scope, error } = await resolveMediaScope({ hostId: request.hostId }, {}, request.uid, {
    feature: 'uploads',
  })
  if (!scope) return refuse(error?.status ?? 400, error?.message ?? 'The site could not be resolved')

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
  // The library's root, the way the upload route files an asset with no folder.
  const objectPath = `${scope.base}/media/${mediaId}`
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
    folderId: null,
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
 * names, or null. Read by the Admin SDK on the site's own library alone.
 */
export async function findStockPhotoMedia(input: {
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
    .where('stockPhoto.key', '==', input.sourceKey)
    .limit(5)
    .get()
  for (const doc of snapshot.docs) {
    const media = doc.data() as Record<string, unknown>
    if (media['deletedAt'] || media['private'] === true) continue
    if (!RASTER_TYPES.has(String(media['contentType'] ?? ''))) continue
    const asset = assetOf(doc.id, media)
    if (asset) return asset
  }
  return null
}

export const consoleMediaIngest: PluginMediaIngest = {
  ingest: ingestMedia,
  findStockPhoto: findStockPhotoMedia,
}
