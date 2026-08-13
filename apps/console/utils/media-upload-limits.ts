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

/**
 * ONE upload allowlist (AGL-1465).
 *
 * There were three hand-maintained lists — the library's `accept`
 * attribute, `uploadOne`'s client pre-check, and the 415 gate in
 * `/api/media/upload` — plus a fourth implicit one, the key set of
 * `SIGNED_UPLOAD_MAX_BYTES`. They had already drifted:
 * `application/x-zip-compressed` was in two of the three, and no type had
 * to justify having a ceiling. The failure modes are both silent from the
 * author's side — a drop the UI accepts and the server 415s, or a type
 * that uploads fine until it crosses 3 MB and then 413s (AGL-1454).
 *
 * So the table below is the only place a type is named. `accept`, both
 * allowlists, both ceiling lookups and the "supported uploads" copy are
 * all derived from it, and a spec asserts the derivation reaches every
 * layer. Adding a type means adding one row, and a row cannot exist
 * without a ceiling.
 *
 * Images are the one family that is NOT enumerated: `image/*` is open by
 * design (a DAM should take whatever the browser calls an image), so they
 * are matched by prefix and carry one shared ceiling.
 */
export interface UploadTypeSpec {
  /** Canonical content type — what gets stored on the asset document. */
  contentType: string
  /**
   * Extensions that resolve to this type, lower case with the dot. Two
   * jobs: the `accept` attribute's fallback for browsers that report an
   * empty type, and `normalizeUploadContentType`'s name-based inference.
   */
  extensions: string[]
  /**
   * Ceiling on the signed direct-to-storage path. **Required** — a type
   * without one takes the base64 route at every size and 413s past ~3 MB,
   * which is precisely AGL-1454. Making it a non-optional field on the
   * row is what stops the next type from repeating that.
   */
  signedMaxBytes: number
  /** Ceiling on the base64-JSON direct route (below the threshold). */
  directMaxBytes: number
  /** How the type is named in the "supported uploads" message. */
  label: string
}

/**
 * Image ceiling (AGL-1454). Images had NO entry at all, so the signed-path
 * conjunction short-circuited and every image — the most-uploaded type in a
 * media library — took the base64 route regardless of size, straight into
 * Vercel's 4.5 MB platform 413. AGL-1317's wall, still live, for the type it
 * mattered most for.
 *
 * 15 MB because that is the number the product already promises:
 * `docs/content-and-data/media/overview.md` has published "Images · 15 MB per
 * file · Every plan" the whole time, against a real ceiling of ~3.3 MB. This
 * makes the promise true rather than inventing a new one. Raising it further
 * (a print-resolution TIFF exceeds 15 MB, and the DAM takes 200 MB of video)
 * is a storage-cost decision on the highest-volume type, so it belongs to
 * whoever owns the pricing page, not to this constant.
 */
const IMAGE_MAX_BYTES = 15 * MB

/** Ceiling shared by document types — PDF's, because PDF is the precedent. */
const DOCUMENT_MAX_BYTES = 25 * MB

/**
 * Presentations get ZIP's ceiling, not PDF's. A `.pptx` IS a zip archive of
 * embedded media, and an image-heavy deck passes 25 MB routinely — the same
 * reason the brand-kit zip in AGL-1317 got 50 MB.
 */
const PRESENTATION_MAX_BYTES = 50 * MB

export const UPLOAD_TYPES: readonly UploadTypeSpec[] = [
  // Video (AGL-167).
  { contentType: 'video/mp4', extensions: ['.mp4'], signedMaxBytes: 200 * MB, directMaxBytes: 25 * MB, label: 'mp4' },
  { contentType: 'video/webm', extensions: ['.webm'], signedMaxBytes: 200 * MB, directMaxBytes: 25 * MB, label: 'webm' },
  { contentType: 'video/quicktime', extensions: ['.mov'], signedMaxBytes: 200 * MB, directMaxBytes: 25 * MB, label: 'quicktime video' },

  // PDF and archives (AGL-162, AGL-1317).
  { contentType: 'application/pdf', extensions: ['.pdf'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'PDF' },
  { contentType: 'application/zip', extensions: ['.zip'], signedMaxBytes: 50 * MB, directMaxBytes: 10 * MB, label: 'ZIP' },

  // Documents (AGL-1465). Stored and served as opaque objects, exactly like
  // ZIP — nothing on the platform opens, extracts, renders or executes them.
  { contentType: 'application/msword', extensions: ['.doc'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'Word' },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
    signedMaxBytes: DOCUMENT_MAX_BYTES,
    directMaxBytes: 10 * MB,
    label: 'Word',
  },
  { contentType: 'application/rtf', extensions: ['.rtf'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'RTF' },
  { contentType: 'application/vnd.ms-excel', extensions: ['.xls'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'Excel' },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['.xlsx'],
    signedMaxBytes: DOCUMENT_MAX_BYTES,
    directMaxBytes: 10 * MB,
    label: 'Excel',
  },
  { contentType: 'text/csv', extensions: ['.csv'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'CSV' },
  { contentType: 'application/vnd.ms-powerpoint', extensions: ['.ppt'], signedMaxBytes: PRESENTATION_MAX_BYTES, directMaxBytes: 10 * MB, label: 'PowerPoint' },
  {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['.pptx'],
    signedMaxBytes: PRESENTATION_MAX_BYTES,
    directMaxBytes: 10 * MB,
    label: 'PowerPoint',
  },
  { contentType: 'text/plain', extensions: ['.txt'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'text' },
  { contentType: 'text/markdown', extensions: ['.md'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'Markdown' },
  { contentType: 'application/json', extensions: ['.json'], signedMaxBytes: DOCUMENT_MAX_BYTES, directMaxBytes: 10 * MB, label: 'JSON' },
] as const

const UPLOAD_TYPES_BY_CONTENT_TYPE = new Map(
  UPLOAD_TYPES.map((spec) => [spec.contentType, spec]),
)

const UPLOAD_TYPES_BY_EXTENSION = new Map(
  UPLOAD_TYPES.flatMap((spec) =>
    spec.extensions.map((extension) => [extension, spec] as const),
  ),
)

export const VIDEO_TYPES = new Set(
  UPLOAD_TYPES.filter((spec) => spec.contentType.startsWith('video/')).map(
    (spec) => spec.contentType,
  ),
)

/** Windows browsers report zips as x-zip-compressed; store one canonical type. */
export const ZIP_ALIAS_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
])

/**
 * Excel claims `.csv` on Windows, so a spreadsheet export arrives labelled
 * `application/vnd.ms-excel`. Both are accepted, so this is not a gate
 * question — but the stored type decides the grid icon and the ceiling, and
 * a CSV filed as XLS is simply wrong. The file name wins for these.
 */
const EXTENSION_WINS_OVER_TYPE = new Set(['.csv', '.md', '.txt'])

function fileExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot > 0 ? lower.slice(dot) : ''
}

/**
 * Canonical content type for upload decisions: folds zip aliases to
 * `application/zip`, infers the type from the file name when the browser
 * reports an empty one (common for `.zip` on macOS drag-drop and for
 * `.md` everywhere), and corrects the handful of extensions browsers
 * habitually mislabel.
 */
export function normalizeUploadContentType(
  contentType: string,
  fileName?: string,
): string {
  if (ZIP_ALIAS_TYPES.has(contentType)) return 'application/zip'
  const extension = fileName ? fileExtension(fileName) : ''
  const byExtension = extension
    ? UPLOAD_TYPES_BY_EXTENSION.get(extension)
    : undefined
  if (byExtension) {
    if (!contentType) return byExtension.contentType
    if (EXTENSION_WINS_OVER_TYPE.has(extension)) return byExtension.contentType
  }
  return contentType
}

/** `image/*` is open by design — a DAM takes whatever the browser calls one. */
export function isImageUploadType(contentType: string): boolean {
  return contentType.startsWith('image/')
}

/** Whether a (normalized) content type may be uploaded at all. */
export function isAllowedUploadType(contentType: string): boolean {
  return (
    isImageUploadType(contentType) ||
    UPLOAD_TYPES_BY_CONTENT_TYPE.has(contentType)
  )
}

/**
 * Everything that is not an image rides the `videoMedia` entitlement —
 * AGL-162's "video & file uploads" tier gate, which documents join.
 */
export function requiresFileUploadEntitlement(contentType: string): boolean {
  return !isImageUploadType(contentType)
}

/**
 * Ceiling on the signed direct-to-storage path, or `undefined` for a type
 * that is not accepted at all.
 *
 * AGL-1454's real defect was that the caller wrote
 * `SIGNED_UPLOAD_MAX_BYTES[contentType] && size > THRESHOLD`, so a missing
 * key meant "small file" rather than "unknown type" and the upload fell
 * back to the route that 413s. Here an ACCEPTED type always resolves a
 * number — images included — so callers can route on size alone, and
 * `undefined` means exactly one thing: refuse it.
 */
export function signedUploadMaxBytes(
  contentType: string,
): number | undefined {
  if (isImageUploadType(contentType)) return IMAGE_MAX_BYTES
  return UPLOAD_TYPES_BY_CONTENT_TYPE.get(contentType)?.signedMaxBytes
}

/**
 * Per-type caps for the base64-JSON direct route (AGL-162). In production
 * the platform body cap bites first (~3.3MB); these caps are the app-level
 * truth for self-hosted deployments without the Vercel wall.
 */
export function directUploadMaxBytes(contentType: string): number | undefined {
  if (isImageUploadType(contentType)) return IMAGE_MAX_BYTES
  return UPLOAD_TYPES_BY_CONTENT_TYPE.get(contentType)?.directMaxBytes
}

/**
 * The library file input's `accept`. Extensions are listed alongside the
 * MIME types because browsers report an empty type for several of these
 * (`.zip` on macOS, `.md` almost everywhere) and would otherwise grey the
 * file out in the picker.
 */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  'image/*',
  ...UPLOAD_TYPES.map((spec) => spec.contentType),
  // Windows' zip alias — historically present in `accept` and the client
  // pre-check but NOT the server allowlist. Folded by
  // `normalizeUploadContentType`, listed here so the picker shows it.
  'application/x-zip-compressed',
  ...UPLOAD_TYPES.flatMap((spec) => spec.extensions),
].join(',')

/** One sentence, used by the client snackbar and both routes' 415s. */
export const UPLOAD_TYPES_MESSAGE =
  'Supported uploads: images, mp4/webm/quicktime video, PDF, ZIP, ' +
  'Word, Excel, PowerPoint, CSV, text, Markdown and JSON'

export const SIGNED_UPLOAD_TYPES_MESSAGE = UPLOAD_TYPES_MESSAGE

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
