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
  DATASET_IMAGE_FIELD,
  datasetImageSiteOf,
  datasetRecordPhotoSites,
  datasetRecordWithoutGonePhotos,
  isDatasetImageValue,
} from './dataset-image-field'

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

describe('the site a record’s photo lives in (AGL-3912)', () => {
  it('is the site of a site-library CDN path or reference, and none for the organization’s or a link', () => {
    expect(datasetImageSiteOf('/api/media/cdn/MEo5ZeWQB2/fdgCu-U42k')).toBe('MEo5ZeWQB2')
    expect(datasetImageSiteOf('media:nVj_-hl115/RM4pCuwtcQ@f00d')).toBe('nVj_-hl115')
    expect(datasetImageSiteOf('/api/media/cdn/org:jWmGooWE3L/abc')).toBeNull()
    expect(datasetImageSiteOf('/api/media/cdn/org:jWmGooWE3L:host-1/abc')).toBeNull()
    expect(datasetImageSiteOf('media:org:jWmGooWE3L/abc')).toBeNull()
    expect(datasetImageSiteOf('https://cdn.example.com/api/media/cdn/MEo5ZeWQB2/x')).toBeNull()
    expect(datasetImageSiteOf('Head coach')).toBeNull()
    expect(datasetImageSiteOf(4)).toBeNull()
  })

  it('reads every site a record’s photos are in, once', () => {
    expect(
      datasetRecordPhotoSites({ name: 'Head coach', image: '/api/media/cdn/MEo5ZeWQB2/a', cover: 'media:MEo5ZeWQB2/b', other: '/api/media/cdn/h2/c' }),
    ).toEqual(['MEo5ZeWQB2', 'h2'])
  })

  it('leaves out only the photos of a site that is gone, and returns a record with none as it was', () => {
    const record = { $id: 'P9vy8p2NM8', name: 'Head coach', image: '/api/media/cdn/MEo5ZeWQB2/wSWoP1kjUG', logo: '/api/media/cdn/h2/c' }
    expect(datasetRecordWithoutGonePhotos(record, new Set(['MEo5ZeWQB2']))).toEqual({ $id: 'P9vy8p2NM8', name: 'Head coach', logo: '/api/media/cdn/h2/c' })
    expect(datasetRecordWithoutGonePhotos(record, new Set(['other']))).toBe(record)
    expect(datasetRecordWithoutGonePhotos(record, new Set())).toBe(record)
  })
})
