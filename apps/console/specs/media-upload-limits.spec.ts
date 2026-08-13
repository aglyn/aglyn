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
  isAllowedUploadType,
  MB,
  normalizeUploadContentType,
  signedUploadMaxBytes,
  SIGNED_UPLOAD_THRESHOLD_BYTES,
  UPLOAD_ACCEPT_ATTRIBUTE,
  UPLOAD_TYPES,
} from '../utils/media-upload-limits'

/**
 * AGL-1317: the org DAM 413'd brand-kit files because the base64-JSON
 * direct route inflates bodies past Vercel's 4.5MB PLATFORM request cap
 * (fires before our handler; no config raises it). These specs pin the
 * decisions that keep large PDFs/zips on the signed direct-to-storage
 * path instead.
 */
describe('media upload limits (AGL-1317)', () => {
  it('routes to the signed path before base64 inflation crosses the 4.5MB platform cap', () => {
    // base64 is 4/3 of raw; the JSON envelope adds a little more.
    const bodyBytesAtThreshold = (SIGNED_UPLOAD_THRESHOLD_BYTES * 4) / 3
    expect(bodyBytesAtThreshold).toBeLessThan(4.5 * MB)
  })

  it('accepts the AGL-1317 brand-kit files on the signed path', () => {
    // aglyn-brand-guidelines-v1.pdf (3.67MB) and aglyn-logo-kit-v1.zip
    // (5.29MB) — the two files the 413 blocked.
    expect(signedUploadMaxBytes('application/pdf')).toBeGreaterThanOrEqual(
      Math.ceil(3.67 * MB),
    )
    expect(signedUploadMaxBytes('application/zip')).toBeGreaterThanOrEqual(
      Math.ceil(5.29 * MB),
    )
    // And both exceed the routing threshold, so they actually take it.
    expect(3.67 * MB).toBeGreaterThan(SIGNED_UPLOAD_THRESHOLD_BYTES)
  })

  it('normalizes zip aliases and empty browser types to canonical types', () => {
    expect(
      normalizeUploadContentType('application/x-zip-compressed', 'kit.zip'),
    ).toBe('application/zip')
    expect(normalizeUploadContentType('', 'aglyn-logo-kit-v1.ZIP')).toBe(
      'application/zip',
    )
    expect(normalizeUploadContentType('', 'guidelines.pdf')).toBe(
      'application/pdf',
    )
    expect(normalizeUploadContentType('image/png', 'a.png')).toBe('image/png')
    expect(normalizeUploadContentType('', 'unknown.bin')).toBe('')
  })

  it('corrects the types browsers habitually mislabel (AGL-1465)', () => {
    // Excel claims `.csv` on Windows. Both types are accepted, so this is not
    // a gate question — but the stored type picks the grid icon and the
    // ceiling, and a CSV filed as XLS is simply wrong.
    expect(normalizeUploadContentType('application/vnd.ms-excel', 'q3.csv')).toBe(
      'text/csv',
    )
    // A real .xls keeps its type.
    expect(normalizeUploadContentType('application/vnd.ms-excel', 'q3.xls')).toBe(
      'application/vnd.ms-excel',
    )
    // Markdown arrives typeless almost everywhere.
    expect(normalizeUploadContentType('', 'README.md')).toBe('text/markdown')
    expect(normalizeUploadContentType('', 'notes.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })
})

/**
 * AGL-1465: the accept list had THREE hand-maintained copies — the `accept`
 * attribute, `uploadOne`'s client pre-check and the 415 gate in
 * `/api/media/upload` — and they had already drifted
 * (`application/x-zip-compressed` was in two of the three). The drift is the
 * defect: a type in the UI's list and not the server's is a drop that gets
 * accepted, uploaded, and then refused, which reads to the author as a
 * platform fault.
 *
 * These pin the derivation rather than re-listing the types, because a spec
 * that keeps its own fourth copy of the list is the same bug wearing a
 * test's clothes.
 */
describe('one upload allowlist, three layers (AGL-1465)', () => {
  const read = (relative: string) =>
    readFileSync(join(__dirname, '..', relative), 'utf8')
  const component = read('components/media/media-library.component.tsx')
  const directRoute = read('app/api/media/upload/route.ts')
  const signedRoute = read('app/api/media/upload-url/route.ts')

  /** The four Zach named, plus the siblings that ship alongside them. */
  const REQUIRED = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/rtf',
    'text/plain',
    'text/markdown',
    'application/json',
  ]

  it.each(REQUIRED)('%s is in the one table every layer reads', (type) => {
    expect(UPLOAD_TYPES.map((spec) => spec.contentType)).toContain(type)
  })

  it.each(REQUIRED)('%s passes the predicate the client AND server both call', (type) => {
    expect(isAllowedUploadType(type)).toBe(true)
  })

  it.each(REQUIRED)('%s reaches the file picker via the derived accept', (type) => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE.split(',')).toContain(type)
  })

  it('offers every type its extension too, for browsers that report no type', () => {
    const accepted = UPLOAD_ACCEPT_ATTRIBUTE.split(',')
    for (const spec of UPLOAD_TYPES) {
      for (const extension of spec.extensions) {
        expect(accepted).toContain(extension)
      }
    }
  })

  describe('no layer keeps its own copy any more', () => {
    it('the file input renders the derived attribute, not a literal', () => {
      expect(component).toContain('accept={UPLOAD_ACCEPT_ATTRIBUTE}')
      // The old literal listed mime types inline; any return of that shape
      // is a fourth list being born.
      expect(component).not.toMatch(/accept="[^"]*application\//)
    })

    it('the client pre-check calls the shared predicate', () => {
      expect(component).toContain('isAllowedUploadType(contentType)')
      // The hand-rolled disjunction this replaced.
      expect(component).not.toContain("contentType === 'application/pdf'")
    })

    it('the server 415 gate calls the same predicate', () => {
      expect(directRoute).toContain('isAllowedUploadType(contentType)')
      expect(directRoute).not.toContain("contentType === 'application/zip'")
    })

    it('both routes still resolve types and ceilings through the shared module', () => {
      for (const route of [directRoute, signedRoute]) {
        expect(route).toContain("utils/media-upload-limits'")
        expect(route).toContain('normalizeUploadContentType')
      }
      expect(signedRoute).toContain('signedUploadMaxBytes(contentType)')
    })
  })

  describe('every accepted type has a ceiling — AGL-1454’s trap', () => {
    it('resolves one for IMAGES, which had none at all', () => {
      // The bug: `SIGNED_UPLOAD_MAX_BYTES[contentType] && size > THRESHOLD`
      // short-circuited on the missing key, so every image took the base64
      // route regardless of size and 413'd past ~3 MB — AGL-1317's wall,
      // still live, on a media library's most-uploaded type.
      for (const type of ['image/png', 'image/jpeg', 'image/tiff', 'image/webp']) {
        expect(signedUploadMaxBytes(type)).toBeGreaterThan(
          SIGNED_UPLOAD_THRESHOLD_BYTES,
        )
      }
    })

    it('honours the 15 MB the docs have promised for images all along', () => {
      // `docs/content-and-data/media/overview.md` publishes "Images · 15 MB
      // per file · Every plan" against a real ceiling of ~3.3 MB. The
      // constant now makes the promise true rather than restating it.
      expect(signedUploadMaxBytes('image/png')).toBe(15 * MB)
    })

    it('resolves one for every type in the table', () => {
      for (const spec of UPLOAD_TYPES) {
        expect(signedUploadMaxBytes(spec.contentType)).toBeGreaterThan(
          SIGNED_UPLOAD_THRESHOLD_BYTES,
        )
      }
    })

    it('gives presentations ZIP’s ceiling, not PDF’s', () => {
      // A .pptx IS a zip of embedded media and an image-heavy deck passes
      // 25 MB routinely — the same reason AGL-1317's brand-kit zip got 50.
      expect(
        signedUploadMaxBytes(
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ),
      ).toBe(signedUploadMaxBytes('application/zip'))
    })

    it('returns undefined ONLY for a type that is refused outright', () => {
      // The distinction the old shape could not make: a missing key meant
      // "small file", so the failure was a silent fallback instead of a 415.
      expect(signedUploadMaxBytes('application/x-msdownload')).toBeUndefined()
      expect(isAllowedUploadType('application/x-msdownload')).toBe(false)
    })

    it('routes on size alone now that the ceiling is guaranteed', () => {
      expect(component).toContain('file.size > SIGNED_UPLOAD_THRESHOLD_BYTES')
      expect(component).not.toContain('SIGNED_UPLOAD_MAX_BYTES[contentType] &&')
    })
  })

  it('reports the cap in the 413 message', () => {
    const read = (relative: string) =>
      readFileSync(join(__dirname, '..', relative), 'utf8')
    for (const route of [
      'app/api/media/upload/route.ts',
      'app/api/media/upload-url/route.ts',
    ]) {
      expect(read(route)).toContain('File is empty or too large')
    }
  })
})
