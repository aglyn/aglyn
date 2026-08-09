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
  MB,
  normalizeUploadContentType,
  SIGNED_UPLOAD_MAX_BYTES,
  SIGNED_UPLOAD_THRESHOLD_BYTES,
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
    expect(SIGNED_UPLOAD_MAX_BYTES['application/pdf']).toBeGreaterThanOrEqual(
      Math.ceil(3.67 * MB),
    )
    expect(SIGNED_UPLOAD_MAX_BYTES['application/zip']).toBeGreaterThanOrEqual(
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

  it('keeps the file input, direct route, and signed route in agreement on zip', () => {
    const read = (relative: string) =>
      readFileSync(join(__dirname, '..', relative), 'utf8')
    const component = read('components/media/media-library.component.tsx')
    // The DAM picker advertises zip (mime + extension fallback for
    // browsers that report an empty type).
    expect(component).toContain('application/zip')
    expect(component).toMatch(/accept="[^"]*\.zip/)
    // Both routes validate through the shared limits module, so their
    // allowlists cannot drift from the client's.
    for (const route of [
      'app/api/media/upload/route.ts',
      'app/api/media/upload-url/route.ts',
    ]) {
      expect(read(route)).toContain("utils/media-upload-limits'")
      expect(read(route)).toContain('normalizeUploadContentType')
    }
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
