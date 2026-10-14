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

import { DATASET_IMAGE_FIELD, isDatasetImageValue } from './dataset-image-field'

describe('a record’s photo (AGL-3616)', () => {
  it('takes every media reference the library mints, the organization’s included (AGL-3763)', () => {
    for (const value of [
      'media:host-1/m-1',
      // The organization library: its scope holds a colon.
      'media:org:fiL5LrShn9/abc123',
      // …narrowed to one site.
      'media:org:fiL5LrShn9:host-1/abc123',
      // A content pin rides after `@`.
      'media:org:fiL5LrShn9/abc123@f00d',
      'media:host-1/m-1@f00d',
    ]) {
      expect(isDatasetImageValue(value)).toBe(true)
      expect(DATASET_IMAGE_FIELD.validate?.(value)).toBeNull()
    }
  })

  it('takes a CDN path and an https link', () => {
    expect(isDatasetImageValue('/api/media/cdn/org:fiL5LrShn9/abc123')).toBe(true)
    expect(isDatasetImageValue('https://images.example.com/a.jpg')).toBe(true)
  })

  it('refuses what no page can draw', () => {
    for (const value of [
      'media:',
      'media:org:/abc',
      'media:org:a:b:c/abc',
      'media:host-1/',
      'media:host 1/m-1',
      'media:host-1/m-1/extra',
      'http://example.com/a.jpg',
      '//evil.example/a.jpg',
      'javascript:alert(1)',
      'a bowl on a shelf',
      '',
      42,
    ]) {
      expect(isDatasetImageValue(value)).toBe(false)
    }
    expect(DATASET_IMAGE_FIELD.validate?.('media:org:/abc')).toBe('Use a photo from the media library or an https link')
  })
})
