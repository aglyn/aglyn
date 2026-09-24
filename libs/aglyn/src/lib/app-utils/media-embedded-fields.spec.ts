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
  embeddedFieldDisplay,
  embeddedFieldGroup,
  embeddedFieldLabel,
  embeddedKeyWritable,
  embeddedMetadataIsCurrent,
  embeddedMetadataReadable,
  embeddedWritableKeys,
  MEDIA_EMBEDDED_CATALOG,
  MEDIA_EMBEDDED_GROUP_ORDER,
  MEDIA_EMBEDDED_MAX_LIST_ITEMS,
  MEDIA_EMBEDDED_METADATA_VERSION,
  mediaEmbeddedPublicView,
  mediaEmbeddedSearchText,
  otherEmbeddedKey,
  parseOtherEmbeddedKey,
  sanitizeEmbeddedPatch,
} from './media-embedded-fields'

describe('the embedded-metadata catalog (AGL-3331)', () => {
  it('puts every key in a group the drawer renders', () => {
    for (const entry of Object.values(MEDIA_EMBEDDED_CATALOG)) {
      expect(MEDIA_EMBEDDED_GROUP_ORDER).toContain(entry.group)
    }
  })

  it('files a document date under the document, not the camera', () => {
    expect(embeddedFieldGroup('createdAt', 'jpeg')).toBe('capture')
    expect(embeddedFieldGroup('createdAt', 'pdf')).toBe('document')
    expect(embeddedFieldGroup('pdf|Client', 'pdf')).toBe('other')
  })

  it('names a field the way the format does', () => {
    expect(embeddedFieldLabel('description', 'jpeg')).toBe('Description')
    expect(embeddedFieldLabel('description', 'pdf')).toBe('Subject')
    expect(embeddedFieldLabel('creator', 'pdf')).toBe('Author')
    expect(embeddedFieldLabel('xmp|http://ns.example/|Client', 'jpeg', 'ex:Client')).toBe(
      'ex:Client',
    )
  })
})

describe('embeddedKeyWritable', () => {
  it('lets a photo take its caption and credit, and not its exposure', () => {
    expect(embeddedKeyWritable('description', 'jpeg')).toBe(true)
    expect(embeddedKeyWritable('credit', 'png')).toBe(true)
    expect(embeddedKeyWritable('exposure', 'jpeg')).toBe(false)
  })

  it('keeps video, SVG and GIF read-only whatever the key', () => {
    for (const format of ['mp4', 'webm', 'svg', 'gif', 'heif'] as const) {
      expect(embeddedKeyWritable('title', format)).toBe(false)
    }
  })

  it('routes an other key only to the format that owns it', () => {
    const pdfKey = otherEmbeddedKey('pdf', 'Client')
    expect(embeddedKeyWritable(pdfKey, 'pdf')).toBe(true)
    expect(embeddedKeyWritable(pdfKey, 'jpeg')).toBe(false)
    expect(embeddedKeyWritable(otherEmbeddedKey('mp4', 'x'), 'mp4')).toBe(false)
  })

  it('offers PDFs only the fields a PDF has', () => {
    expect(embeddedWritableKeys('pdf')).toEqual(
      expect.arrayContaining(['title', 'description', 'creator', 'keywords']),
    )
    expect(embeddedWritableKeys('pdf')).not.toContain('copyright')
  })
})

describe('otherEmbeddedKey', () => {
  it('round-trips a namespace URI that itself contains colons', () => {
    const key = otherEmbeddedKey('xmp', 'http://ns.example.com/x/1.0/', 'Client')
    expect(parseOtherEmbeddedKey(key)).toEqual({
      namespace: 'xmp',
      parts: ['http://ns.example.com/x/1.0/', 'Client'],
    })
  })

  it('refuses a canonical key and an unknown namespace', () => {
    expect(parseOtherEmbeddedKey('title')).toBeNull()
    expect(parseOtherEmbeddedKey('evil|x')).toBeNull()
  })
})

describe('sanitizeEmbeddedPatch', () => {
  it('trims text, splits a list and turns blanks into removals', () => {
    expect(
      sanitizeEmbeddedPatch('jpeg', {
        title: '  Harbor at dusk ',
        keywords: 'boats, harbor;boats',
        credit: '   ',
        copyright: null,
      }),
    ).toEqual({
      patch: {
        title: 'Harbor at dusk',
        keywords: ['boats', 'harbor'],
        credit: null,
        copyright: null,
      },
    })
  })

  it('refuses a key the format cannot take, by its label', () => {
    expect(sanitizeEmbeddedPatch('pdf', { copyright: 'x' })).toEqual({
      error: 'Copyright cannot be written into this file.',
    })
    expect(sanitizeEmbeddedPatch('mp4', { title: 'x' })).toEqual({
      error: 'This kind of file cannot take metadata edits.',
    })
  })

  it('only ever removes a location', () => {
    expect(sanitizeEmbeddedPatch('jpeg', { gps: null })).toEqual({
      patch: { gps: null },
    })
    expect(sanitizeEmbeddedPatch('jpeg', { gps: '1,2' })).toEqual({
      error: 'GPS position can only be removed.',
    })
  })

  it('checks dates and ratings', () => {
    expect(sanitizeEmbeddedPatch('jpeg', { createdAt: '2021-05-03T10:11:12' })).toEqual({
      patch: { createdAt: '2021-05-03T10:11:12' },
    })
    expect(sanitizeEmbeddedPatch('jpeg', { createdAt: 'yesterday' })).toEqual({
      error: 'Date taken must be a date.',
    })
    expect(sanitizeEmbeddedPatch('jpeg', { rating: '7' })).toEqual({
      error: 'Rating must be between 0 and 5.',
    })
  })

  it('bounds lists and refuses non-text', () => {
    const many = Array.from({ length: MEDIA_EMBEDDED_MAX_LIST_ITEMS + 1 }, (_, i) => `k${i}`)
    expect(sanitizeEmbeddedPatch('jpeg', { keywords: many })).toHaveProperty('error')
    expect(sanitizeEmbeddedPatch('jpeg', { title: 5 })).toEqual({
      error: 'Title must be text.',
    })
    expect(sanitizeEmbeddedPatch('jpeg', {})).toEqual({ error: 'Nothing to change.' })
    expect(sanitizeEmbeddedPatch('jpeg', ['title'])).toEqual({
      error: 'Nothing to change.',
    })
  })
})

describe('embeddedFieldDisplay', () => {
  it('writes a position with hemispheres', () => {
    expect(embeddedFieldDisplay({ key: 'gps', value: '37.774929,-122.419416' })).toBe(
      '37.77493° N, 122.41942° W',
    )
  })

  it('draws a rating and names a rejection', () => {
    expect(embeddedFieldDisplay({ key: 'rating', value: '3' })).toBe('★★★☆☆')
    expect(embeddedFieldDisplay({ key: 'rating', value: '-1' })).toBe('Rejected')
  })

  it('keeps a date-only value on its own day', () => {
    expect(
      embeddedFieldDisplay({ key: 'createdAt', value: '2021-05-03' }, 'en-US'),
    ).toBe('May 3, 2021')
  })

  it('passes through what it cannot read, and joins lists', () => {
    expect(embeddedFieldDisplay({ key: 'createdAt', value: 'sometime' })).toBe(
      'sometime',
    )
    expect(embeddedFieldDisplay({ key: 'keywords', values: ['a', 'b'] })).toBe('a, b')
  })
})

describe('embeddedMetadataReadable', () => {
  it('asks the server only about formats with a reader', () => {
    expect(embeddedMetadataReadable('image/jpeg')).toBe(true)
    expect(embeddedMetadataReadable('application/pdf; charset=binary')).toBe(true)
    expect(embeddedMetadataReadable('text/csv')).toBe(false)
    expect(embeddedMetadataReadable('application/zip')).toBe(false)
    expect(embeddedMetadataReadable(undefined)).toBe(false)
  })
})

const storedRecord = (overrides: Record<string, unknown> = {}) => ({
  version: MEDIA_EMBEDDED_METADATA_VERSION,
  format: 'jpeg',
  writable: true,
  contentSha256: 'sha-1',
  fields: [
    { key: 'description', label: 'Description', group: 'description', value: 'Boats at dusk', sources: ['xmp'], editable: true },
    { key: 'gps', label: 'GPS position', group: 'location', value: '37.7,-122.4', sources: ['exif'], editable: true },
    { key: 'keywords', label: 'Keywords', group: 'description', values: ['harbor', 'sunset'], sources: ['xmp', 'iptc'], editable: true },
    { key: 'make', label: 'Camera make', group: 'capture', value: 'Canon', sources: ['exif'], editable: true },
    { key: 'title', label: 'Title', group: 'description', value: 'Harbor', sources: ['xmp'], editable: true },
    { key: 'city', label: 'City', group: 'location', value: 'Sausalito', sources: ['xmp'], editable: true },
  ],
  ...overrides,
})

describe('embeddedMetadataIsCurrent (AGL-3331)', () => {
  it('holds for a record read from these bytes', () => {
    expect(embeddedMetadataIsCurrent(storedRecord(), 'sha-1')).toBe(true)
    // An asset too large for a strong digest has none to compare.
    expect(embeddedMetadataIsCurrent(storedRecord(), undefined)).toBe(true)
  })

  it('refuses a record from replaced bytes, an old shape, or none', () => {
    expect(embeddedMetadataIsCurrent(storedRecord(), 'sha-2')).toBe(false)
    expect(embeddedMetadataIsCurrent(storedRecord({ version: 0 }), 'sha-1')).toBe(false)
    expect(embeddedMetadataIsCurrent(storedRecord({ fields: null }), 'sha-1')).toBe(false)
    expect(embeddedMetadataIsCurrent(undefined, 'sha-1')).toBe(false)
  })
})

describe('mediaEmbeddedSearchText (AGL-3339)', () => {
  it('spends the budget on what people search by, most telling first', () => {
    expect(mediaEmbeddedSearchText(storedRecord())).toBe(
      'Harbor harbor sunset Sausalito Boats at dusk',
    )
  })

  it('never offers a position or a camera to search by', () => {
    const text = mediaEmbeddedSearchText(storedRecord())
    expect(text).not.toContain('37.7')
    expect(text).not.toContain('Canon')
  })

  it('is empty for anything that is not a record', () => {
    expect(mediaEmbeddedSearchText(undefined)).toBe('')
    expect(mediaEmbeddedSearchText({ fields: 'nope' })).toBe('')
    expect(mediaEmbeddedSearchText(storedRecord({ fields: [] }))).toBe('')
  })
})

describe('mediaEmbeddedPublicView (AGL-3339)', () => {
  it('publishes a value or a list, never both, and nothing the API cannot act on', () => {
    const view = mediaEmbeddedPublicView(storedRecord(), 'sha-1')
    expect(view?.format).toBe('jpeg')
    expect(view?.truncated).toBe(false)
    expect(view?.fields.find((field) => field.key === 'title')).toEqual({
      key: 'title',
      label: 'Title',
      group: 'description',
      value: 'Harbor',
      values: null,
    })
    expect(view?.fields.find((field) => field.key === 'keywords')).toEqual({
      key: 'keywords',
      label: 'Keywords',
      group: 'description',
      value: null,
      values: ['harbor', 'sunset'],
    })
    expect(JSON.stringify(view)).not.toMatch(/sources|editable|contentSha256/)
  })

  it('is null rather than the previous file\'s details', () => {
    expect(mediaEmbeddedPublicView(storedRecord(), 'sha-2')).toBeNull()
    expect(mediaEmbeddedPublicView(undefined, 'sha-1')).toBeNull()
  })

  it('says when fields were dropped to fit', () => {
    expect(
      mediaEmbeddedPublicView(storedRecord({ truncated: true }), 'sha-1')?.truncated,
    ).toBe(true)
  })
})
