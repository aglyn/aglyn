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
 * The image content types media ingress accepts (AGL-1476).
 *
 * Every upload surface used to answer "is this an image?" with
 * `contentType.startsWith('image/')`, against a string the CALLER chooses.
 * Three separate decisions hang off that answer, and an open prefix gets all
 * three wrong for a type nobody has ever heard of:
 *
 * - **Entitlement.** Everything that is not an image rides the `videoMedia`
 *   gate, so `image/x-anything` is how arbitrary bytes reach a workspace
 *   whose plan does not include file uploads.
 * - **Ceilings.** An unrecognised `image/…` resolves the image ceiling
 *   rather than the (much smaller) one its real format would get.
 * - **Structure.** `inspectUploadBytes` only matches magic numbers for types
 *   it knows, so an unrecognised label means no signature check runs at all
 *   — the executable and macro checks still apply, but "these bytes are not
 *   the format you declared" cannot be asked.
 *
 * The set below is exactly the image half of that module's signature table,
 * plus SVG, which is text and has no magic number. A spec pins the two
 * together so a format added to one cannot go missing from the other.
 */
export const IMAGE_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  // A document wearing an image label. Accepted, sanitized at every ingress,
  // and served under a sandboxing CSP — see `sanitize-svg`.
  'image/svg+xml',
])

/**
 * Labels browsers and older tools emit for a format that already has a
 * canonical type. Folded rather than added to the set above, so that one
 * format is one stored type: the CDN's active-document check, the signature
 * table and the SVG sanitizer all key off the type, and a second spelling is
 * a second thing each of them has to remember.
 */
const IMAGE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/x-ms-bmp': 'image/bmp',
  'image/x-bmp': 'image/bmp',
  'image/x-tiff': 'image/tiff',
  'image/ico': 'image/x-icon',
  'image/x-icon+xml': 'image/x-icon',
  'image/svg': 'image/svg+xml',
}

/** A content type reduced to its bare type: no parameters, lower case. */
export function bareContentType(contentType: unknown): string {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

/**
 * The canonical type for an image label, or the bare label unchanged when it
 * is not one this platform recognises. Never widens: a type that was not an
 * accepted image before does not become one here.
 */
export function normalizeImageContentType(contentType: unknown): string {
  const bare = bareContentType(contentType)
  return IMAGE_TYPE_ALIASES[bare] ?? bare
}

/** Whether media ingress treats this content type as an image. */
export function isImageUploadContentType(contentType: unknown): boolean {
  return IMAGE_UPLOAD_TYPES.has(normalizeImageContentType(contentType))
}
