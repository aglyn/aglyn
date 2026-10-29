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
import {
  isMediaCdnPath,
  MEDIA_CDN_ROUTE,
  mediaRefFromStorageUrl,
  parseMediaRef,
} from '@aglyn/aglyn/app-utils/media-ref'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/*==========================================
 * READING A SITE'S IMAGE ON THE SERVER: a logo or a picked picture, for the
 * card reader's start-up screen and a quote's or invoice's PDF.
 *
 * A media value is read from STORAGE, never fetched, when it names this
 * site's library or its org's: the document must be live, not private,
 * visible to this site, its scope not locked and the asset not quarantined,
 * and the object path inside the scope's media prefix (the rules the media
 * CDN serves by). An https address outside the libraries is fetched only from
 * a public address, pinned against DNS rebinding, with no redirects, a
 * timeout and a size cap. Each caller names its own cap.
 *
 * The media CDN's block, the storage path and the pinned fetch load only when
 * an image is read, by relative path (`pos-reader-splash-server.ts` says why).
 *=========================================*/

const firestore = () => firebaseAdmin.app().firestore()

function mediaBucket() {
  return firebaseAdmin
    .app()
    .storage()
    .bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined)
}

const cleanString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export interface LocatedImageAsset {
  kind: 'asset'
  scope: MediaCdnScope
  scopeSegment: string
  mediaId: string
  doc: Record<string, unknown>
  /** What changes when the asset's bytes do. */
  version: string
}

export interface LocatedImageUrl {
  kind: 'url'
  url: string
  version: string
}

export type LocatedImageSource = LocatedImageAsset | LocatedImageUrl

/** A media library image this site may show, or null; one larger than `maxBytes` is refused. */
export async function locateMediaImage(
  scopeSegment: string,
  mediaId: string,
  hostId: string,
  orgId: string,
  maxBytes: number,
): Promise<LocatedImageAsset | null> {
  const scope = parseMediaCdnScope(scopeSegment)
  if (!scope || !/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) return null
  const owned = scope.isOrg ? scope.scopeId === orgId : scope.scopeId === hostId
  if (!owned) return null
  const snapshot = await firestore()
    .collection(scope.isOrg ? 'orgs' : 'hosts')
    .doc(scope.scopeId)
    .collection('media')
    .doc(mediaId)
    .get()
  const doc = (snapshot.exists ? snapshot.data() : null) as Record<string, unknown> | null
  if (!doc || doc['deletedAt'] || doc['private']) return null
  if (scope.isOrg && !visibleToHost(doc['visibleTo'] as string[] | undefined, hostId)) return null
  if (!/^image\//.test(String(doc['contentType'] ?? ''))) return null
  if (typeof doc['sizeBytes'] === 'number' && doc['sizeBytes'] > maxBytes) return null
  const version =
    cleanString(doc['contentSha256']) ||
    cleanString(doc['contentHash']) ||
    String(doc['updatedAtMs'] ?? doc['sizeBytes'] ?? '')
  return { kind: 'asset', scope, scopeSegment, mediaId, doc, version }
}

/** Where a stored logo or image value lives, or null when it cannot be read. */
export async function locateImageSource(
  value: string,
  hostId: string,
  orgId: string,
  maxBytes: number,
): Promise<LocatedImageSource | null> {
  const stored = parseMediaRef(value) ? value : mediaRefFromStorageUrl(value)
  const ref = stored ? parseMediaRef(stored) : null
  if (ref) return locateMediaImage(ref.scope, ref.mediaId, hostId, orgId, maxBytes)
  if (isMediaCdnPath(value)) {
    const rest = value.slice(`${MEDIA_CDN_ROUTE}/`.length).split('?')[0]
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    return locateMediaImage(rest.slice(0, slash), rest.slice(slash + 1), hostId, orgId, maxBytes)
  }
  // `isMediaCdnPath` narrows a string it refuses to `never`; the value is still the string.
  const address: string = value as string
  if (/^https:\/\//.test(address) && address.length <= 2000) return { kind: 'url', url: address, version: address }
  return null
}

async function readAssetBytes(asset: LocatedImageAsset, maxBytes: number): Promise<Buffer | null> {
  const { mediaCdnServeBlock, mediaStoragePathInScope } = await import('./pos-reader-splash-server')
  const blocked = await mediaCdnServeBlock(asset.scope, {
    contentSha256: typeof asset.doc['contentSha256'] === 'string' ? (asset.doc['contentSha256'] as string) : undefined,
    contentHash: typeof asset.doc['contentHash'] === 'string' ? (asset.doc['contentHash'] as string) : undefined,
    scopeSegment: asset.scopeSegment,
    mediaId: asset.mediaId,
  })
  if (blocked) return null
  const objectPath = mediaStoragePathInScope({
    storagePath: asset.doc['storagePath'],
    base: `${asset.scope.isOrg ? 'orgs' : 'hosts'}/${asset.scope.scopeId}`,
    mediaId: asset.mediaId,
  })
  const [buffer] = (await mediaBucket().file(objectPath).download()) as [Buffer]
  return buffer.length > maxBytes ? null : buffer
}

const FETCH_TIMEOUT_MS = 8000

async function fetchPublicImage(url: string, maxBytes: number): Promise<Buffer | null> {
  const { createPinnedDispatcher, resolvePublicIp } = await import('./pos-reader-splash-server')
  const pinnedIp = await resolvePublicIp(new URL(url).hostname)
  if (!pinnedIp) return null
  const dispatcher = createPinnedDispatcher(pinnedIp)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const init = { redirect: 'error' as const, signal: controller.signal, dispatcher }
    const response = await fetch(url, init as RequestInit)
    if (!response.ok) return null
    if (!/^image\//.test(response.headers.get('content-type') ?? '')) return null
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > maxBytes) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.length > maxBytes ? null : buffer
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    ;(dispatcher as { close?: () => Promise<void> }).close?.().catch(() => undefined)
  }
}

/** The bytes of a located image, or null when it is blocked, gone, unreachable or over `maxBytes`. */
export async function readImageSourceBytes(source: LocatedImageSource, maxBytes: number): Promise<Buffer | null> {
  return source.kind === 'asset' ? readAssetBytes(source, maxBytes) : fetchPublicImage(source.url, maxBytes)
}
