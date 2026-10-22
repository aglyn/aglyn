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

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  directUploadMaxBytes,
  isAllowedUploadType,
  isFontUploadType,
  mediaPickerKindOf,
  mediaUploadKind,
  normalizeUploadContentType,
  requiresFileUploadEntitlement,
  storageContentHash,
  UPLOAD_ACCEPT_ATTRIBUTE,
  uploadAcceptForKind,
} from './media-upload-limits'

describe('storageContentHash — an ETag for signed uploads (AGL-1440 follow-up)', () => {
  it('re-encodes GCS base64 md5 as a URL-safe hex segment', () => {
    // GCS returns md5 as base64; `+`, `/` and `=` are not legal in a CDN
    // path segment, so passing it through raw would produce URLs the route
    // rejects as a bad media path.
    const md5 = Buffer.from('0123456789abcdef', 'hex').toString('base64')
    expect(storageContentHash(md5)).toBe('0123456789abcdef')
  })

  it('matches the SHAPE the direct upload route writes', () => {
    // 16 hex chars, same as `createHash('sha256')…slice(0,16)` — the CDN
    // route compares this field to a URL segment, so the two producers must
    // agree or an immutable URL minted for one 404s against the other.
    const hash = storageContentHash(
      Buffer.from('ffffffffffffffffffffffffffffffff', 'hex').toString('base64'),
    )
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
  })

  it('returns undefined when GCS supplies no md5, rather than a placeholder', () => {
    // Composite objects carry no md5. An absent hash degrades to "no ETag",
    // which is today's behaviour; a WRONG one would pin stale bytes under an
    // immutable URL for a year.
    expect(storageContentHash(undefined)).toBeUndefined()
    expect(storageContentHash('')).toBeUndefined()
    expect(storageContentHash(12345)).toBeUndefined()
  })

  it('refuses a value too short to be a real md5', () => {
    expect(storageContentHash(Buffer.from('ab', 'hex').toString('base64'))).toBeUndefined()
  })
})

describe('the signed-upload finalize writes a contentHash', () => {
  // At the DECLARATION: reaching this route's behaviour needs a signed
  // bucket, a verified ID token and an App Check pass, and the bug is a
  // MISSING field — which every mock-based test passes straight over.
  const source = readFileSync(
    join(
      __dirname,
      '..',
      'app',
      'api',
      'media',
      'upload-url',
      'route.ts',
    ),
    'utf8',
  )

  it('derives the hash from the metadata it already fetched', () => {
    expect(source).toContain('storageContentHash(metadata.md5Hash)')
  })

  it('persists it on the media doc, where serveMediaCdn reads it', () => {
    expect(source).toContain('contentHash')
  })
})

describe('web fonts in the media library (AGL-3656)', () => {
  it('accepts a WOFF2 by type and by name, and nothing else of the font formats', () => {
    expect(isAllowedUploadType('font/woff2')).toBe(true)
    expect(normalizeUploadContentType('', 'Acme-700.woff2')).toBe('font/woff2')
    // The installer converts every other format before the library sees it.
    for (const type of ['font/ttf', 'font/otf', 'font/woff', 'application/font-woff']) {
      expect(isAllowedUploadType(type)).toBe(false)
    }
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('font/woff2')
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.woff2')
  })

  it('is its own family, so a replace cannot swap a font for a document', () => {
    expect(mediaUploadKind('font/woff2')).toBe('font')
    expect(isFontUploadType('font/woff2')).toBe(true)
    expect(uploadAcceptForKind('font')).toBe('font/woff2,.woff2')
    // No narrowed picker offers a font.
    expect(mediaPickerKindOf('font/woff2')).toBeUndefined()
  })

  it('needs no file-upload plan, because a theme font is on every plan', () => {
    expect(requiresFileUploadEntitlement('font/woff2')).toBe(false)
    expect(requiresFileUploadEntitlement('application/pdf')).toBe(true)
    expect(directUploadMaxBytes('font/woff2')).toBe(10 * 1024 * 1024)
  })
})
