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
  isFirstPartyHost,
  MEDIA_CDN_ROUTE,
  MEDIA_REF_PREFIX,
  parseMediaRef,
} from './media-ref'

/**
 * What a URL stored on a product's paid media names (AGL-2814).
 *
 * A members video is stored as whatever wrote it: the paid-media picker's
 * reference, an older picker's CDN path, the raw Storage download URL a
 * free-tier library hands out, or a hotlink typed into an import. Three
 * places have to agree on which ASSET that is: the stream route that signs
 * it, the console that shows the author whether it is protected, and the
 * media route that refuses to publish a file a product still sells. One
 * grammar, here, so they cannot disagree.
 *
 * Pure and environment-light: nothing here reads Firestore, Storage or a
 * secret, so the console bundle can carry it.
 */
export type PaidMediaSource =
  /** A media-library asset, named by scope segment and id. */
  | { kind: 'asset'; scope: string; mediaId: string }
  /** An object in a Storage bucket, from a download or GCS URL. */
  | { kind: 'storage-object'; bucket: string; objectPath: string }
  /** Somebody else's server. */
  | { kind: 'external'; url: string }
  /** Nothing that can be delivered, including a Storage URL we cannot read. */
  | { kind: 'malformed' }

const STORAGE_DOWNLOAD_HOST = 'firebasestorage.googleapis.com'
const GCS_HOST = 'storage.googleapis.com'

/**
 * The Storage emulator's `host:port`, whose download URLs have the same shape
 * as production's. Read per call so a test can set it.
 */
function storageEmulatorHost(): string {
  const env =
    typeof process === 'undefined' ? undefined : process.env?.['FIREBASE_STORAGE_EMULATOR_HOST']
  return String(env ?? '')
    .trim()
    .toLowerCase()
}

/** A library asset from `/api/media/cdn/{scope}/{mediaId}[/{hash}]`. */
function assetFromCdnPath(path: string): PaidMediaSource {
  const rest = path.slice(`${MEDIA_CDN_ROUTE}/`.length).split(/[?#]/)[0]
  const segments = rest.split('/')
  if (segments.length < 2 || segments.length > 3) return { kind: 'malformed' }
  let scope: string
  try {
    scope = decodeURIComponent(segments[0])
  } catch {
    return { kind: 'malformed' }
  }
  // Parsed through the reference grammar rather than a second copy of it. A
  // content pin in the path is dropped: a paid link names the asset, and the
  // stable URL always serves its current bytes.
  const ref = parseMediaRef(`${MEDIA_REF_PREFIX}${scope}/${segments[1]}`)
  return ref
    ? { kind: 'asset', scope: ref.scope, mediaId: ref.mediaId }
    : { kind: 'malformed' }
}

/** Decodes each `/`-separated piece of a path; null when one is malformed. */
function decodePath(pieces: string[]): string | null {
  try {
    return pieces.map((piece) => decodeURIComponent(piece)).join('/')
  } catch {
    return null
  }
}

/**
 * Classifies a stored value. The same input always gives the same answer, so
 * every branch is checkable without a project.
 */
export function parsePaidMediaSource(stored: unknown): PaidMediaSource {
  const value = typeof stored === 'string' ? stored.trim() : ''
  if (!value) return { kind: 'malformed' }
  if (value.startsWith(MEDIA_REF_PREFIX)) {
    const ref = parseMediaRef(value)
    return ref
      ? { kind: 'asset', scope: ref.scope, mediaId: ref.mediaId }
      : { kind: 'malformed' }
  }
  if (value.startsWith(`${MEDIA_CDN_ROUTE}/`)) return assetFromCdnPath(value)
  if (!/^https?:\/\//i.test(value)) return { kind: 'malformed' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { kind: 'malformed' }
  }
  const hostname = url.hostname.toLowerCase()
  const emulator = storageEmulatorHost()
  if (
    hostname === STORAGE_DOWNLOAD_HOST ||
    (emulator && url.host.toLowerCase() === emulator)
  ) {
    // `/v0/b/{bucket}/o/{object}`, with the object key percent-encoded as one
    // segment. A download URL in any other shape is still a token URL, so it
    // is refused rather than handed through as a hotlink.
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname)
    const bucket = match ? decodePath([match[1]]) : null
    const objectPath = match ? decodePath([match[2]]) : null
    return bucket && objectPath
      ? { kind: 'storage-object', bucket, objectPath }
      : { kind: 'malformed' }
  }
  if (hostname === GCS_HOST) {
    const [, bucketPiece, ...objectPieces] = url.pathname.split('/')
    const bucket = bucketPiece ? decodePath([bucketPiece]) : null
    const objectPath = objectPieces.length ? decodePath(objectPieces) : null
    return bucket && objectPath
      ? { kind: 'storage-object', bucket, objectPath }
      : { kind: 'malformed' }
  }
  if (
    isFirstPartyHost(hostname) &&
    url.pathname.startsWith(`${MEDIA_CDN_ROUTE}/`)
  ) {
    return assetFromCdnPath(url.pathname)
  }
  return { kind: 'external', url: value }
}

/**
 * The library asset a media object key belongs to, or null.
 *
 * Every writer keys an asset's object as `{base}/media/[folders/]{mediaId}`,
 * with `base` either `hosts/{hostId}` or `orgs/{orgId}`. So a key in that
 * shape whose last segment is id-shaped IS that asset, wherever a folder move
 * has since put it. Derived objects (`…__r720p.mp4`, `…__poster.webp`) carry
 * a dot and are no asset's key.
 *
 * This names the asset and decides nothing about access: a caller that signs
 * still has to check the bucket and that the library is its own.
 */
export function paidMediaAssetOfObject(
  objectPath: string,
): { scope: string; mediaId: string } | null {
  const segments = String(objectPath ?? '').split('/')
  if (segments.length < 4 || segments[2] !== 'media') return null
  if (segments.some((segment) => !segment || segment === '..')) return null
  const [root, scopeId] = segments
  const scope =
    root === 'hosts' ? scopeId : root === 'orgs' ? `org:${scopeId}` : null
  if (!scope) return null
  const ref = parseMediaRef(
    `${MEDIA_REF_PREFIX}${scope}/${segments[segments.length - 1]}`,
  )
  return ref ? { scope: ref.scope, mediaId: ref.mediaId } : null
}

/**
 * The library asset a stored paid-media URL names, in whichever form it was
 * written, or null for a hotlink, a malformed value, or a Storage URL that
 * names no asset. Pass `bucket` to refuse a download URL from any other
 * bucket, which is what every server-side caller should do.
 */
export function paidMediaAssetOf(
  stored: unknown,
  options?: { bucket?: string },
): { scope: string; mediaId: string } | null {
  const source = parsePaidMediaSource(stored)
  if (source.kind === 'asset') {
    return { scope: source.scope, mediaId: source.mediaId }
  }
  if (source.kind !== 'storage-object') return null
  if (options?.bucket !== undefined && source.bucket !== options.bucket) {
    return null
  }
  return paidMediaAssetOfObject(source.objectPath)
}

/**
 * Whether two scope segments name the same library: the same host, or the
 * same org whatever site either is qualified with.
 */
export function samePaidMediaLibrary(a: string, b: string): boolean {
  const library = (scope: string) =>
    scope.startsWith('org:') ? `org:${scope.slice(4).split(':')[0]}` : scope
  return library(a) === library(b)
}
