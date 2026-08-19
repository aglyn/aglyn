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
  inheritedMediaAlt,
  MEDIA_ALT_MAX_LENGTH,
  MEDIA_TAG_MAX_COUNT,
  normalizeMediaTags,
  readImageDimensions,
} from './media-metadata'

describe('normalizeMediaTags', () => {
  it('trims, lowercases, and dedupes', () => {
    expect(normalizeMediaTags(' Hero, hero , Product ')).toEqual([
      'hero',
      'product',
    ])
    expect(normalizeMediaTags(['A', 'a', ' b '])).toEqual(['a', 'b'])
  })

  it('drops empty/oversized tags and caps the count', () => {
    expect(normalizeMediaTags(['', 'x'.repeat(41)])).toEqual([])
    const many = Array.from({ length: 30 }, (_, index) => `tag${index}`)
    expect(normalizeMediaTags(many)).toHaveLength(MEDIA_TAG_MAX_COUNT)
  })
})

describe('readImageDimensions', () => {
  it('reads PNG IHDR dimensions', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    png.set([0x00, 0x00, 0x02, 0x80], 16) // width 640
    png.set([0x00, 0x00, 0x01, 0xe0], 20) // height 480
    expect(readImageDimensions(png)).toEqual({ width: 640, height: 480 })
  })

  it('reads GIF little-endian dimensions', () => {
    const gif = new Uint8Array(24)
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    gif.set([0x20, 0x00, 0x10, 0x00], 6) // 32 x 16
    expect(readImageDimensions(gif)).toEqual({ width: 32, height: 16 })
  })

  it('reads JPEG SOF0 dimensions', () => {
    // SOI, APP0 (16 bytes), SOF0 with height 480 width 640.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x01, 0xe0, 0x02, 0x80, 0x03,
    ])
    expect(readImageDimensions(jpeg)).toEqual({ width: 640, height: 480 })
  })

  it('returns null for unknown or truncated data', () => {
    expect(readImageDimensions(new Uint8Array(4))).toBeNull()
    expect(readImageDimensions(new Uint8Array(32))).toBeNull()
  })
})

/**
 * AGL-1896. The DAM has stored `alt` since AGL-173 and NOTHING read it back,
 * so every placement asked the author to type it again — the same logo on
 * eight pages needed its alt typed eight times, and in practice shipped
 * blank on the customer's published site.
 *
 * This is the one rule every placement surface calls. The assertions below
 * are deliberately about what it REFUSES to do, because a helper that
 * happily returns the asset's alt is trivial and useless — the whole risk is
 * that it overwrites something better, or invents something that was never
 * true of the image.
 */
describe('inheritedMediaAlt', () => {
  it('defaults a blank placement from the asset', () => {
    expect(
      inheritedMediaAlt({ placementAlt: '', assetAlt: 'Blue kettle on a hob' }),
    ).toBe('Blue kettle on a hob')
    expect(inheritedMediaAlt({ assetAlt: 'Blue kettle on a hob' })).toBe(
      'Blue kettle on a hob',
    )
    // Whitespace is blank. A field the author tabbed through is not an
    // override, and treating it as one is how this feature would quietly
    // do nothing for the people who most need it.
    expect(
      inheritedMediaAlt({ placementAlt: '   ', assetAlt: 'Blue kettle' }),
    ).toBe('Blue kettle')
  })

  /**
   * The override half of "default, with a per-placement override". Getting
   * this wrong is worse than not shipping the feature: the author's sentence
   * about THIS placement is better than the asset's generic one by
   * construction, and clobbering it destroys work with no undo.
   */
  it('never overwrites an alt the placement already has', () => {
    expect(
      inheritedMediaAlt({
        placementAlt: 'Our founder holding the first kettle',
        assetAlt: 'Blue kettle on a hob',
      }),
    ).toBeUndefined()
  })

  /**
   * `decorative` is the field AGL-1305 added to record "screen readers
   * should skip this", and `image.tsx` forces `alt=""` over any alt text
   * when it is on. Inheriting into such a node would put text on a node
   * whose renderer discards it — invisible in the output, and misleading to
   * the next author who opens the panel.
   */
  it('refuses when the placement has declared itself decorative', () => {
    expect(
      inheritedMediaAlt({
        placementAlt: '',
        decorative: true,
        assetAlt: 'Blue kettle on a hob',
      }),
    ).toBeUndefined()
    // Only an explicit true. `undefined` is "no opinion", not "decorative",
    // and a falsy check would have been the same bug in the other direction.
    expect(
      inheritedMediaAlt({ decorative: false, assetAlt: 'Blue kettle' }),
    ).toBe('Blue kettle')
    expect(
      inheritedMediaAlt({ decorative: undefined, assetAlt: 'Blue kettle' }),
    ).toBe('Blue kettle')
  })

  /**
   * Never a fabricated default — the standing rule for this whole change.
   * Nothing here has seen the image, so there is no honest description to
   * synthesise, and a file name is the tempting wrong answer: "IMG_4021.jpg"
   * announced by a screen reader is worse than the silence it replaced.
   */
  it('yields nothing for an asset with no alt of its own', () => {
    expect(inheritedMediaAlt({ assetAlt: undefined })).toBeUndefined()
    expect(inheritedMediaAlt({ assetAlt: '' })).toBeUndefined()
    expect(inheritedMediaAlt({ assetAlt: '   ' })).toBeUndefined()
    expect(inheritedMediaAlt({})).toBeUndefined()
  })

  /**
   * `undefined`, not `''`. The distinction is the reason every call site can
   * spread the result: on a besigner node `alt: ''` is itself an authored
   * value (a preset ships one), so a helper that returned `''` would have
   * callers writing "explicitly no alt" onto placements nobody had decided
   * about.
   *
   * Asserted on `Object.keys` rather than with `toEqual`, which treats an
   * undefined-valued property as absent and would pass against a spread that
   * writes `alt: undefined` into the node.
   */
  it('lets a caller omit the key entirely', () => {
    const props: Record<string, unknown> = { src: 'media:host-1/m-1' }
    const inherited = inheritedMediaAlt({ assetAlt: '' })
    const next = { ...props, ...(inherited ? { alt: inherited } : {}) }
    expect(Object.keys(next)).toEqual(['src'])
  })

  it('caps at the length the media library saves through', () => {
    const long = 'x'.repeat(MEDIA_ALT_MAX_LENGTH + 50)
    expect(inheritedMediaAlt({ assetAlt: long })).toHaveLength(
      MEDIA_ALT_MAX_LENGTH,
    )
  })

  it('ignores non-string inputs rather than stringifying them', () => {
    expect(inheritedMediaAlt({ assetAlt: 42 })).toBeUndefined()
    expect(inheritedMediaAlt({ assetAlt: null })).toBeUndefined()
    // A non-string placement value is not an override either, so the asset
    // still wins — the alternative is a numeric leftover silently blocking
    // every inherit on that node.
    expect(inheritedMediaAlt({ placementAlt: 0, assetAlt: 'Kettle' })).toBe(
      'Kettle',
    )
  })
})
