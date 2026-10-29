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
  checkVisitorUploadRequest,
  checkVisitorUploadSelection,
  describeVisitorUploadTypes,
  mediaLibraryBytes,
  resolveVisitorUploadType,
  safeVisitorUploadName,
  visitorUploadFinalPath,
  visitorUploadCounterBytes,
  visitorUploadFileView,
  visitorUploadIsInline,
  visitorUploadPendingPath,
  VISITOR_UPLOAD_COUNTER_BYTES,
  VISITOR_UPLOAD_COUNTER_FILES,
  VISITOR_UPLOAD_MAX_BYTES,
  VISITOR_UPLOAD_PENDING_PREFIX,
  VISITOR_UPLOAD_TYPES,
} from './visitor-upload'

/**
 * The policy for files a site's visitor sends a business (AGL-4096): which
 * files, how big, what their type is taken as, and where they live.
 */

describe('which files are taken', () => {
  it('takes exactly the image, PDF and design formats, by name', () => {
    expect(VISITOR_UPLOAD_TYPES.map((type) => type.label)).toEqual([
      'PNG',
      'JPEG',
      'WebP',
      'GIF',
      'PDF',
      'SVG',
      'AI',
      'EPS',
      'PSD',
      'TIFF',
    ])
    expect(describeVisitorUploadTypes()).toBe('PNG, JPEG, WebP, GIF, PDF, SVG, AI, EPS, PSD or TIFF')
  })

  it.each([
    ['logo.png', 'image/png', 'image/png'],
    ['photo.JPG', 'image/jpeg', 'image/jpeg'],
    ['photo.jpeg', '', 'image/jpeg'],
    ['art.ai', 'application/postscript', 'application/illustrator'],
    ['art.ai', 'application/pdf', 'application/illustrator'],
    ['art.ai', 'application/octet-stream', 'application/illustrator'],
    ['badge.eps', 'image/x-eps', 'application/postscript'],
    ['layers.psd', 'image/vnd.adobe.photoshop', 'image/vnd.adobe.photoshop'],
    ['layers.psd', 'application/x-photoshop', 'image/vnd.adobe.photoshop'],
    ['scan.tif', 'image/tiff', 'image/tiff'],
    ['mark.svg', 'image/svg+xml', 'image/svg+xml'],
  ])('%s reported as "%s" is taken as %s', (name, reported, expected) => {
    expect(resolveVisitorUploadType(name, reported)?.contentType).toBe(expected)
  })

  it.each([
    ['setup.exe', 'application/octet-stream'],
    ['page.html', 'text/html'],
    ['logo.png', 'text/html'],
    ['logo', 'image/png'],
    ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['clip.mp4', 'video/mp4'],
  ])('refuses %s reported as "%s"', (name, reported) => {
    expect(resolveVisitorUploadType(name, reported)).toBeNull()
  })

  it('draws only raster images a browser cannot run anything in; SVG and the rest download', () => {
    expect(['image/png', 'image/jpeg', 'image/webp', 'image/gif'].every(visitorUploadIsInline)).toBe(true)
    for (const type of ['image/svg+xml', 'application/pdf', 'application/illustrator', 'image/tiff', 'text/html']) {
      expect(visitorUploadIsInline(type)).toBe(false)
    }
  })
})

describe('checking a request before it is signed', () => {
  it('takes a file up to 25 MB, with a safe name and its extension in lower case', () => {
    const checked = checkVisitorUploadRequest({ name: 'C:\\art\\Logo "final".PNG', contentType: 'image/png', size: VISITOR_UPLOAD_MAX_BYTES })
    expect(checked).toEqual({
      ok: true,
      upload: { name: 'Logo final.png', type: expect.objectContaining({ contentType: 'image/png' }), size: VISITOR_UPLOAD_MAX_BYTES },
    })
  })

  it('refuses one byte over, an empty file and a type it does not take, naming the file', () => {
    expect(checkVisitorUploadRequest({ name: 'big.pdf', contentType: 'application/pdf', size: VISITOR_UPLOAD_MAX_BYTES + 1 })).toEqual({
      ok: false,
      code: 'size',
      error: 'big.pdf is 25 MB. Files can be up to 25 MB.',
    })
    expect(checkVisitorUploadRequest({ name: 'empty.pdf', contentType: 'application/pdf', size: 0 })).toMatchObject({ code: 'empty' })
    expect(checkVisitorUploadRequest({ name: 'run.exe', contentType: '', size: 10 })).toEqual({
      ok: false,
      code: 'type',
      error: 'run.exe can\'t be sent. Send a PNG, JPEG, WebP, GIF, PDF, SVG, AI, EPS, PSD or TIFF file.',
    })
  })

  it('lets a route narrow the ceiling, never widen it', () => {
    expect(checkVisitorUploadRequest({ name: 'a.png', contentType: 'image/png', size: 2_000 }, { maxBytes: 1_000 })).toMatchObject({ code: 'size' })
    expect(
      checkVisitorUploadRequest({ name: 'a.png', contentType: 'image/png', size: VISITOR_UPLOAD_MAX_BYTES + 1 }, { maxBytes: VISITOR_UPLOAD_MAX_BYTES * 2 }),
    ).toMatchObject({ code: 'size' })
  })

  it('checks a selection for the count as well as each file', () => {
    const file = { name: 'a.png', type: 'image/png', size: 10 }
    expect(checkVisitorUploadSelection([file, file], 8)).toBeNull()
    expect(checkVisitorUploadSelection([file, file, file], 8)).toBe('Send up to 10 files at a time.')
    expect(checkVisitorUploadSelection([{ name: 'a.txt', type: 'text/plain', size: 1 }])).toMatch(/can't be sent/)
  })
})

describe('names and paths', () => {
  const PNG = VISITOR_UPLOAD_TYPES[0]

  it('keeps no folders, control characters or header characters, and ends in the type’s extension', () => {
    expect(safeVisitorUploadName('../../etc/passwd', PNG)).toBe('passwd.png')
    expect(safeVisitorUploadName('a\u0000b\r\n"c";.png', PNG)).toBe('abc.png')
    expect(safeVisitorUploadName('', PNG)).toBe('file.png')
    expect(safeVisitorUploadName(`${'x'.repeat(300)}.png`, PNG)).toHaveLength(118)
  })

  it('waits under the top-level pending prefix and is kept under the site’s private folder', () => {
    const scope = { hostId: 'site1', purpose: 'quote-artwork', purposeId: 'q-1' }
    expect(VISITOR_UPLOAD_PENDING_PREFIX).toBe('visitor-uploads-pending/')
    expect(visitorUploadPendingPath(scope, 'u1')).toBe('visitor-uploads-pending/site1/quote-artwork/q-1/u1')
    expect(visitorUploadFinalPath(scope, 'u1')).toBe('hosts/site1/private/uploads/quote-artwork/q-1/u1')
  })

  it('never hands a visitor the storage path', () => {
    expect(
      visitorUploadFileView({ id: 'u1', name: 'a.png', contentType: 'image/png', size: 3, path: 'hosts/x/private/uploads/p/r/u1', uploadedAtMs: 5 }),
    ).toEqual({ id: 'u1', name: 'a.png', contentType: 'image/png', size: 3, uploadedAtMs: 5 })
  })
})

describe('a kept file’s share of the site’s storage counter', () => {
  it('is counted beside the library’s bytes, under its own two fields', () => {
    expect([VISITOR_UPLOAD_COUNTER_BYTES, VISITOR_UPLOAD_COUNTER_FILES]).toEqual(['uploadBytes', 'uploadCount'])
  })

  it('leaves the library its own files’ bytes', () => {
    const counter = { bytes: 900, count: 4, uploadBytes: 300, uploadCount: 2 }
    expect(visitorUploadCounterBytes(counter)).toBe(300)
    expect(mediaLibraryBytes(counter)).toBe(600)
  })

  it('reads a counter with no kept files, a missing one and a corrupt one as safely as the band does', () => {
    expect(mediaLibraryBytes({ bytes: 500, count: 2 })).toBe(500)
    expect(mediaLibraryBytes(null)).toBe(0)
    expect(mediaLibraryBytes({ bytes: -20, uploadBytes: 5 })).toBe(0)
    // Never more kept-file bytes than the counter holds, so the library never reads below zero.
    expect(visitorUploadCounterBytes({ bytes: 100, uploadBytes: 400 })).toBe(100)
    expect(mediaLibraryBytes({ bytes: 100, uploadBytes: 400 })).toBe(0)
    expect(mediaLibraryBytes({ bytes: 100, uploadBytes: Number.NaN })).toBe(100)
  })
})
