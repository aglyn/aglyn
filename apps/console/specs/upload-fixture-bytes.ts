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
 * Upload fixtures that are the type they say they are (AGL-1475).
 *
 * Until structural inspection existed, a media spec could upload
 * `Buffer.alloc(n, 1)` labelled `application/vnd.ms-excel` and the route
 * would happily store it, so that is what the specs did. Every one of those
 * fixtures was a file the platform will now refuse — correctly, because a
 * spreadsheet whose first eight bytes are not an OLE header is not a
 * spreadsheet.
 *
 * That made a large number of green assertions quietly meaningless: they were
 * exercising metering, quota and entitlement logic with a payload no real
 * client could ever send. This module gives them a payload a real client
 * WOULD send — the correct container header for the declared type, padded to
 * whatever length the test wants to meter.
 *
 * Kept deliberately minimal. It is a header plus filler, not a document
 * generator: the routes under test hash, measure and store bytes, and none of
 * them parses a document. The one property that has to hold is the one the
 * inspector checks.
 */

const MAGIC: Readonly<Record<string, readonly number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], // %PDF-1.7
  // Every OOXML document is a ZIP, and so is a brand-kit archive.
  'application/zip': [0x50, 0x4b, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4b, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4b, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [0x50, 0x4b, 0x03, 0x04],
  // Pre-2007 Office: the OLE compound-file header.
  'application/msword': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  'application/vnd.ms-excel': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  'application/vnd.ms-powerpoint': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  'application/rtf': [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31], // {\rtf1

  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF
  'image/bmp': [0x42, 0x4d],
  'image/tiff': [0x49, 0x49, 0x2a, 0x00],

  // ISO base media: four size bytes, then `ftyp`.
  'video/mp4': [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32],
  'video/quicktime': [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20],
  'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
}

/**
 * `sizeBytes` of plausible file for `contentType`.
 *
 * Types with no container header — `text/plain`, `text/csv`,
 * `text/markdown`, `application/json`, `image/svg+xml` — get plain filler,
 * which is correct rather than a gap: those types genuinely have no magic
 * number and the inspector does not check them for one.
 *
 * The filler byte is `0x20` (a space) rather than `0x00` so that a text type
 * built this way is still valid text.
 */
export function uploadFixtureBytes(
  contentType: string,
  sizeBytes: number,
): Buffer {
  const magic = MAGIC[contentType]
  if (!magic) return Buffer.alloc(Math.max(sizeBytes, 1), 0x20)
  const header = Buffer.from(magic)
  if (sizeBytes <= header.length) return header
  return Buffer.concat([header, Buffer.alloc(sizeBytes - header.length, 0x20)])
}

/** The same fixture, base64-encoded — the shape both JSON routes take. */
export function uploadFixtureBase64(
  contentType: string,
  sizeBytes: number,
): string {
  return uploadFixtureBytes(contentType, sizeBytes).toString('base64')
}
