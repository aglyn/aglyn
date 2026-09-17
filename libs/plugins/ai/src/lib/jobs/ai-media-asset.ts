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

import { parseMediaCdnScope, type MediaCdnScope } from '@aglyn/aglyn/app-utils/media-cdn-scope'
import { isMediaCdnPath, MEDIA_CDN_ROUTE, parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'

/**
 * One asset of a site's media library, read the way the media CDN would serve
 * it (AGL-2938, AGL-2916): what a job reads when it looks at a
 * picture a customer already keeps, a theme's logo or a product's photo.
 *
 * A job never fetches a URL for this. It reads the asset from storage, and
 * only when the reference names this site's own library or its org's, the
 * document is live and not private, an org asset is visible to the site, the
 * scope is not locked and the asset not quarantined, and the object path sits
 * inside the scope's own media prefix. Anything else is no asset at all.
 */

export interface AiMediaAssetLocation {
  scope: MediaCdnScope
  /** The CDN scope segment, which is also a quarantine key. */
  scopeSegment: string
  mediaId: string
}

/**
 * Where a stored media value lives in a media library: a media reference or
 * a CDN path naming this site's library, or its org's. An external URL, a raw
 * storage URL, or an asset of some other site or org has no location.
 */
export function aiMediaAssetLocation(
  value: unknown,
  hostId: string,
  orgId: string,
): AiMediaAssetLocation | null {
  let scopeSegment: string
  let mediaId: string
  const ref = parseMediaRef(value)
  if (ref) {
    scopeSegment = ref.scope
    mediaId = ref.mediaId
  } else if (isMediaCdnPath(value)) {
    const rest = value.slice(`${MEDIA_CDN_ROUTE}/`.length)
    const slash = rest.indexOf('/')
    scopeSegment = rest.slice(0, slash)
    mediaId = rest.slice(slash + 1)
  } else {
    return null
  }
  const scope = parseMediaCdnScope(scopeSegment)
  if (!scope) return null
  const owned = scope.isOrg ? scope.scopeId === orgId : scope.scopeId === hostId
  return owned ? { scope, scopeSegment, mediaId } : null
}

export interface AiMediaAssetBytes {
  buffer: Buffer
  /** The content type the media document records. */
  contentType: string
}

export interface AiMediaAssetReadOptions {
  /** The largest asset read, by the size its document records and by what storage returns. */
  maxBytes: number
  /** The content types read; any other asset is not read at all. */
  types: RegExp
}

/**
 * An asset's bytes, or `null` when any condition in the module note does not
 * hold. The storage read and the CDN's block are loaded only when a document
 * passes every check that needs no network.
 */
export async function readAiMediaAssetBytes(
  firestore: FirebaseFirestore.Firestore,
  location: AiMediaAssetLocation,
  hostId: string,
  options: AiMediaAssetReadOptions,
): Promise<AiMediaAssetBytes | null> {
  const { scope, mediaId } = location
  const snapshot = await firestore
    .collection(scope.isOrg ? 'orgs' : 'hosts')
    .doc(scope.scopeId)
    .collection('media')
    .doc(mediaId)
    .get()
  const media = (snapshot.exists ? snapshot.data() : null) as Record<string, unknown> | null
  if (!media || media['deletedAt'] || media['private']) return null
  if (scope.isOrg && !visibleToHost(media['visibleTo'] as string[] | undefined, hostId)) return null
  const contentType = String(media['contentType'] ?? '')
  if (!options.types.test(contentType)) return null
  if (typeof media['sizeBytes'] === 'number' && media['sizeBytes'] > options.maxBytes) return null
  const { mediaCdnServeBlock, mediaStoragePathInScope, firebaseAdmin } = await import(
    './ai-media-asset-server'
  )
  const blocked = await mediaCdnServeBlock(scope, {
    contentSha256: typeof media['contentSha256'] === 'string' ? media['contentSha256'] : undefined,
    contentHash: typeof media['contentHash'] === 'string' ? media['contentHash'] : undefined,
    scopeSegment: location.scopeSegment,
    mediaId,
  })
  if (blocked) return null
  const objectPath = mediaStoragePathInScope({
    storagePath: media['storagePath'],
    base: `${scope.isOrg ? 'orgs' : 'hosts'}/${scope.scopeId}`,
    mediaId,
  })
  const [buffer] = (await firebaseAdmin
    .app()
    .storage()
    .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined)
    .file(objectPath)
    .download()) as [Buffer]
  if (buffer.length > options.maxBytes) return null
  return { buffer, contentType }
}

/** `sharp`, as far as a job that decodes an asset uses it. */
export async function loadAiMediaSharp(): Promise<unknown> {
  const { loadSharp } = await import('./ai-media-asset-server')
  return loadSharp()
}
