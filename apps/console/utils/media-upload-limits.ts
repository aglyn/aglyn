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

/**
 * Shared media upload size limits (AGL-1317).
 *
 * Two upload paths exist and their split point is a PLATFORM constraint,
 * not an app choice: `/api/media/upload` carries the file as base64 inside
 * a JSON body, and Vercel rejects any serverless request body over 4.5MB
 * with a 413 **before our code runs** — no config raises it. Base64
 * inflates by 4/3, so the direct path's real-world ceiling is ~3.3MB of
 * raw file. Anything bigger must go direct-to-storage via the signed-URL
 * path (`/api/media/upload-url`), which PUTs the bytes straight to GCS.
 */

export const MB = 1024 * 1024

/**
 * Client-side routing threshold: files above this go through the
 * signed-URL path. 3MB × 4/3 ≈ 4MB of body, safely under Vercel's 4.5MB
 * platform cap (which fires as an opaque 413 our handler never sees).
 */
export const SIGNED_UPLOAD_THRESHOLD_BYTES = 3 * MB

export const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

/** Windows browsers report zips as x-zip-compressed; store one canonical type. */
export const ZIP_ALIAS_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
])

/**
 * Canonical content type for upload decisions: folds zip aliases to
 * `application/zip` and infers pdf/zip from the file name when the
 * browser reports an empty type (common for .zip on macOS drag-drop).
 */
export function normalizeUploadContentType(
  contentType: string,
  fileName?: string,
): string {
  if (ZIP_ALIAS_TYPES.has(contentType)) return 'application/zip'
  if (!contentType && fileName) {
    const lower = fileName.toLowerCase()
    if (lower.endsWith('.zip')) return 'application/zip'
    if (lower.endsWith('.pdf')) return 'application/pdf'
  }
  return contentType
}

/**
 * Per-type caps for the base64-JSON direct route (AGL-162). In production
 * the platform body cap bites first (~3.3MB); these caps are the app-level
 * truth for self-hosted deployments without the Vercel wall.
 */
export const DIRECT_UPLOAD_MAX_BYTES = {
  image: 15 * MB,
  video: 25 * MB,
  pdf: 10 * MB,
  zip: 10 * MB,
} as const

/**
 * Per-type caps for the signed-URL direct-to-storage path (AGL-167,
 * extended beyond video by AGL-1317). Storage quota is enforced
 * separately on both mint and finalize.
 */
export const SIGNED_UPLOAD_MAX_BYTES: Record<string, number> = {
  'video/mp4': 200 * MB,
  'video/webm': 200 * MB,
  'video/quicktime': 200 * MB,
  'application/pdf': 25 * MB,
  'application/zip': 50 * MB,
}

export const SIGNED_UPLOAD_TYPES_MESSAGE =
  'Signed uploads support mp4/webm/quicktime video, PDF, and ZIP'

/**
 * A `contentHash` for an object GCS already hashed for us.
 *
 * The signed-upload route wrote no `contentHash` at all, because the bytes
 * never pass through the server — they go client → bucket, and hashing them
 * afterwards would mean downloading up to 200 MB back into the function just
 * to digest it. So the field was simply omitted, and `serveMediaCdn` reads
 * it in two places: it is the ETag, and it is what the immutable
 * content-hashed URL must match.
 *
 * With no `contentHash` there is **no ETag**, so a conditional request can
 * never be answered 304 — every edge revalidation re-streams the whole
 * object out of Cloud Storage and back out to the client. That is the worst
 * possible place for it to be missing: this route is the one carrying the
 * 200 MB videos.
 *
 * The hash is already in hand and costs nothing: `getMetadata()` — which
 * finalize calls anyway to check the real size and type — returns GCS's own
 * `md5Hash`. It is base64, and a CDN path segment is `[A-Za-z0-9_-]{1,64}`,
 * so it is re-encoded as hex and cut to the same 16 characters the direct
 * upload route's sha256 produces. Same shape, same length, same field.
 *
 * Returns `undefined` rather than a placeholder when GCS gives us nothing
 * (composite objects have no md5) — an absent hash is the status quo and
 * degrades to "no ETag", where a WRONG one would pin stale bytes under an
 * immutable URL for a year.
 */
export function storageContentHash(md5Hash: unknown): string | undefined {
  const raw = typeof md5Hash === 'string' ? md5Hash : ''
  if (!raw) return undefined
  try {
    const hex = Buffer.from(raw, 'base64').toString('hex')
    // A truncated or non-base64 value decodes to something too short to be
    // an md5; treat it as absent rather than emitting a weak hash.
    return hex.length >= 16 ? hex.slice(0, 16) : undefined
  } catch {
    return undefined
  }
}
