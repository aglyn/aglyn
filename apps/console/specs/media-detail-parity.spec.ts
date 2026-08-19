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
 * AGL-2143 — the asset detail `/product/media` advertises.
 *
 * The mockup's three missing pieces: a DOWNLOAD action, tags as chips, and
 * a `CDN · variants 320 / 640 / 1280` footer. The rules behind each live in
 * `utils/media-detail.ts` because the DAM component is 4,000+ lines around
 * a live Firestore tree.
 */

import {
  addTag,
  describeMediaDelivery,
  downloadFileName,
  parseTagList,
  removeTag,
  serializeTagList,
} from '../utils/media-detail'

describe('tag editing (chips over a comma-joined string)', () => {
  it('parses the stored shape, trimming and dropping blanks', () => {
    expect(parseTagList('brand, hero ,homepage')).toEqual([
      'brand',
      'hero',
      'homepage',
    ])
    // The trailing-comma case the free-text field produced constantly.
    expect(parseTagList('brand,hero,')).toEqual(['brand', 'hero'])
    expect(parseTagList('   ')).toEqual([])
    expect(parseTagList(undefined)).toEqual([])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    // `Hero` and `hero` are one tag to a person, and were two to the
    // toolbar's filter chips — which is how a filter matched half a set.
    expect(parseTagList('Hero, hero, HERO')).toEqual(['Hero'])
  })

  it('round-trips the stored value unchanged', () => {
    expect(serializeTagList(parseTagList('brand, hero'))).toBe('brand, hero')
  })

  it('refuses to append a blank or a duplicate', () => {
    expect(addTag('brand', '')).toBe('brand')
    expect(addTag('brand', '   ')).toBe('brand')
    expect(addTag('brand', 'BRAND')).toBe('brand')
    expect(addTag('brand', 'hero')).toBe('brand, hero')
    // …and adding to nothing still yields a usable value.
    expect(addTag(undefined, 'hero')).toBe('hero')
  })

  it('removes a tag case-insensitively', () => {
    expect(removeTag('brand, hero, homepage', 'HERO')).toBe('brand, homepage')
    expect(removeTag('brand', 'missing')).toBe('brand')
  })
})

describe('describeMediaDelivery', () => {
  it('names the variants the asset actually has', () => {
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/x',
      variants: [1280, 320, 640],
      contentType: 'image/jpeg',
    })
    // Sorted, because the array is written in generation order.
    expect(delivery.label).toBe('CDN · variants 320 / 640 / 1280')
    expect(delivery.tone).toBe('success')
  })

  it('does NOT claim variants an asset has none of', () => {
    // An SVG has nothing to resize, and `?w=` on a missing variant serves
    // the original silently — so a footer naming three widths would be a
    // statement the delivery path quietly contradicts.
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/logo',
      variants: [],
      contentType: 'image/svg+xml',
    })
    expect(delivery.label).not.toContain('320')
    expect(delivery.label).toContain('original only')
    expect(delivery.tone).toBe('info')
  })

  it('says a non-image is served whole, without calling it a failure', () => {
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/deck',
      contentType: 'application/pdf',
    })
    expect(delivery.label).toBe('CDN · original only')
  })

  it('reports storage delivery for an org without the CDN', () => {
    // `cdnPath` is written only for orgs with `mediaCdn`, so its absence
    // IS the entitlement answer — no second copy of the plan check.
    const delivery = describeMediaDelivery({ contentType: 'image/png' })
    expect(delivery.label).toContain('no CDN')
    expect(delivery.tone).toBe('warning')
  })

  it('ignores a junk width rather than printing it', () => {
    const delivery = describeMediaDelivery({
      cdnPath: '/api/media/cdn/x',
      variants: [0, -1, 640, Number.NaN],
      contentType: 'image/jpeg',
    })
    expect(delivery.label).toBe('CDN · variants 640')
  })
})

describe('downloadFileName', () => {
  it('keeps the extension when the display name has lost it', () => {
    // The customer renames the file to "Homepage hero background"; without
    // this it lands on disk with no extension and opens in nothing.
    expect(
      downloadFileName({
        name: 'Homepage hero background',
        objectPath: 'orgs/o1/media/abc123.jpg',
        contentType: 'image/jpeg',
      }),
    ).toBe('Homepage hero background.jpg')
  })

  it('does not double the extension when the name already has it', () => {
    expect(
      downloadFileName({
        name: 'hero-bg.jpg',
        objectPath: 'orgs/o1/media/abc.jpg',
        contentType: 'image/jpeg',
      }),
    ).toBe('hero-bg.jpg')
    expect(
      downloadFileName({
        name: 'HERO-BG.JPG',
        objectPath: 'orgs/o1/media/abc.jpg',
      }),
    ).toBe('HERO-BG.JPG')
  })

  it('falls back to the object basename when there is no display name', () => {
    expect(downloadFileName({ objectPath: 'orgs/o1/media/abc123.png' })).toBe(
      'abc123.png',
    )
  })

  it('takes the extension from the content type when the path has none', () => {
    expect(
      downloadFileName({
        name: 'logo',
        objectPath: 'orgs/o1/media/abc123',
        contentType: 'image/svg+xml',
      }),
    ).toBe('logo.svg')
  })

  it('ignores a query string when reading the extension', () => {
    // A raw storage `url` carries `?alt=media&token=…`.
    expect(
      downloadFileName({
        name: 'photo',
        url: 'https://firebasestorage.googleapis.com/x/abc.jpg?alt=media&token=z',
      }),
    ).toBe('photo.jpg')
  })
})
