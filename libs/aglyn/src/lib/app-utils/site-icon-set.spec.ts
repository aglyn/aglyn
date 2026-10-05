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
  APPLE_TOUCH_ICON_SIZES,
  FAVICON_PNG_SIZES,
  formatSiteIconSpec,
  MANIFEST_ICON_SIZES,
  MANIFEST_MASKABLE_ICON_SIZES,
  maskableMarkSize,
  MASKABLE_SAFE_ZONE,
  normalizeSiteIconBackground,
  parseSiteIconSpec,
  siteAppleTouchIconLinks,
  siteFaviconLinks,
  siteIconDerivable,
  siteIconSrc,
  siteManifestIcons,
  type SiteIconSpec,
} from './site-icon-set'

/**
 * The grammar of a site's derived icon set (AGL-3484): which sizes exist, how
 * each is addressed, and which links and manifest entries describe them.
 */

const SRC = '/api/media/cdn/org:Ok7uFGMCC-:ZG22ootbN-/o0-uaWHCNA'

describe('the derived sizes', () => {
  it('are the sizes the issue names, for every surface', () => {
    expect(FAVICON_PNG_SIZES).toEqual([16, 32, 48])
    expect(APPLE_TOUCH_ICON_SIZES).toEqual([180, 167, 152])
    expect(MANIFEST_ICON_SIZES).toEqual([
      48, 72, 96, 128, 144, 152, 192, 256, 384, 512,
    ])
    expect(MANIFEST_MASKABLE_ICON_SIZES).toEqual([192, 512])
  })

  it('round-trip through the `icon` parameter', () => {
    const specs: SiteIconSpec[] = [
      { plate: 'ico' },
      ...FAVICON_PNG_SIZES.map((size) => ({ plate: 'transparent' as const, size })),
      ...MANIFEST_ICON_SIZES.map((size) => ({ plate: 'transparent' as const, size })),
      ...APPLE_TOUCH_ICON_SIZES.map((size) => ({ plate: 'flat' as const, size })),
      ...MANIFEST_MASKABLE_ICON_SIZES.map((size) => ({
        plate: 'maskable' as const,
        size,
      })),
    ]
    for (const spec of specs) {
      expect(parseSiteIconSpec(formatSiteIconSpec(spec))).toEqual(spec)
    }
  })

  it('refuse anything outside the lists, so nobody can order a 20000px tile', () => {
    for (const value of [
      'png-20000',
      'png-17',
      'flat-512', // a touch icon is never 512
      'maskable-48',
      'webp-32',
      'ico-16',
      '',
      undefined,
      ['png-32', 'png-48'].join(','),
    ]) {
      expect(parseSiteIconSpec(value)).toBeNull()
    }
    // A repeated parameter reads its first value, as the CDN reads `w`.
    expect(parseSiteIconSpec(['png-32', 'png-48'])).toEqual({
      plate: 'transparent',
      size: 32,
    })
  })
})

describe('the maskable safe zone', () => {
  it('fits the mark in the square inscribed in the 80% circle', () => {
    expect(MASKABLE_SAFE_ZONE).toBe(0.8)
    for (const size of MANIFEST_MASKABLE_ICON_SIZES) {
      const box = maskableMarkSize(size)
      // Half the box's diagonal — its farthest corner from the center — is
      // inside the safe circle's radius, so no mask can reach the mark.
      expect((box * Math.SQRT2) / 2).toBeLessThanOrEqual((size * 0.8) / 2)
    }
    expect(maskableMarkSize(512)).toBe(289)
  })
})

describe('the plate color', () => {
  it('reads the CSS forms a theme background takes', () => {
    expect(normalizeSiteIconBackground('#FFF')).toBe('ffffff')
    expect(normalizeSiteIconBackground('#FAFAF9')).toBe('fafaf9')
    expect(normalizeSiteIconBackground('fafaf9')).toBe('fafaf9')
    expect(normalizeSiteIconBackground('#11223380')).toBe('112233')
    expect(normalizeSiteIconBackground('rgb(250, 250, 249)')).toBe('fafaf9')
    expect(normalizeSiteIconBackground('rgba(0 0 0 / 0.5)')).toBe('000000')
  })

  it('reads nothing that is not a plain color, rather than guessing', () => {
    for (const value of [
      'linear-gradient(#fff, #000)',
      'var(--bg)',
      'white',
      'rgb(300, 0, 0)',
      '',
      undefined,
      42,
    ]) {
      expect(normalizeSiteIconBackground(value)).toBeUndefined()
    }
  })
})

describe('addressing a derived icon', () => {
  it('appends icon, plate color and version in one fixed order', () => {
    expect(
      siteIconSrc(SRC, { plate: 'flat', size: 180 }, { background: '#FFF', version: 'abc' }),
    ).toBe(`${SRC}?icon=flat-180&bg=ffffff&v=abc`)
    // A transparent plate has no color to carry.
    expect(
      siteIconSrc(SRC, { plate: 'transparent', size: 32 }, { background: '#000' }),
    ).toBe(`${SRC}?icon=png-32`)
  })

  it('keys the URL on the content hash, so a Replace names a new one', () => {
    const before = siteIconSrc(SRC, { plate: 'ico' }, { version: 'hashA' })
    const after = siteIconSrc(SRC, { plate: 'ico' }, { version: 'hashB' })
    expect(before).not.toBe(after)
  })

  it('merges into a signed asset’s query, and drops a malformed version', () => {
    expect(
      siteIconSrc(`${SRC}?exp=1&sig=x`, { plate: 'transparent', size: 16 }, {
        version: 'not a/hash',
      }),
    ).toBe(`${SRC}?exp=1&sig=x&icon=png-16`)
  })

  it('names nothing for a source with no renderer behind it', () => {
    expect(
      siteIconSrc('https://cdn.example.com/icon.png', { plate: 'ico' }),
    ).toBeUndefined()
    expect(siteIconSrc(undefined, { plate: 'ico' })).toBeUndefined()
  })
})

describe('which sources are drawn from', () => {
  it('any CDN image but an ICO; unknown facts derive and let the CDN decide', () => {
    expect(siteIconDerivable(SRC, { contentType: 'image/png' })).toBe(true)
    expect(siteIconDerivable(SRC, { contentType: 'image/svg+xml' })).toBe(true)
    expect(siteIconDerivable(SRC, { contentType: 'image/jpeg' })).toBe(true)
    expect(siteIconDerivable(SRC, null)).toBe(true)
    expect(siteIconDerivable(SRC, { contentType: 'image/x-icon' })).toBe(false)
    expect(siteIconDerivable(SRC, { contentType: 'video/mp4' })).toBe(false)
    expect(siteIconDerivable('https://cdn.example.com/a.png', null)).toBe(false)
    expect(siteIconDerivable('data:,', null)).toBe(false)
  })
})

describe('the links and entries that describe the set', () => {
  const PNG = { contentType: 'image/png', contentHash: 'h1' }
  const SVG = { contentType: 'image/svg+xml', contentHash: 'h1' }

  it('a favicon is a typed, sized PNG per tab size', () => {
    expect(siteFaviconLinks(SRC, PNG)).toEqual(
      [16, 32, 48].map((size) => ({
        rel: 'icon',
        href: `${SRC}?icon=png-${size}&v=h1`,
        type: 'image/png',
        sizes: `${size}x${size}`,
      })),
    )
  })

  it('an SVG favicon passes through as `sizes="any"`, last', () => {
    const links = siteFaviconLinks(SRC, SVG)
    expect(links.at(-1)).toEqual({
      rel: 'icon',
      href: SRC,
      type: 'image/svg+xml',
      sizes: 'any',
    })
    expect(links).toHaveLength(4)
  })

  it('a hotlinked SVG is recognized by its extension', () => {
    expect(siteFaviconLinks('https://cdn.example.com/mark.svg?v=2')).toEqual([
      {
        rel: 'icon',
        href: 'https://cdn.example.com/mark.svg?v=2',
        type: 'image/svg+xml',
        sizes: 'any',
      },
    ])
  })

  it('every touch icon is flattened onto the plate color', () => {
    const links = siteAppleTouchIconLinks(SRC, PNG, 'fafaf9')
    expect(links.map(({ sizes }) => sizes)).toEqual([
      '180x180',
      '167x167',
      '152x152',
    ])
    for (const { href } of links) expect(href).toMatch(/icon=flat-\d+&bg=fafaf9&v=h1$/)
  })

  it('the manifest set: ten `any`, then two maskable, then the SVG', () => {
    const icons = siteManifestIcons(`https://a.test${SRC}`, SVG, 'fafaf9')
    expect(icons.filter(({ purpose }) => purpose === 'any')).toHaveLength(11)
    expect(
      icons
        .filter(({ purpose }) => purpose === 'maskable')
        .map(({ src, sizes }) => ({ src, sizes })),
    ).toEqual([
      {
        src: `https://a.test${SRC}?icon=maskable-192&bg=fafaf9&v=h1`,
        sizes: '192x192',
      },
      {
        src: `https://a.test${SRC}?icon=maskable-512&bg=fafaf9&v=h1`,
        sizes: '512x512',
      },
    ])
    expect(icons.at(-1)).toMatchObject({ sizes: 'any', type: 'image/svg+xml' })
  })

  it('nothing at all for no source', () => {
    expect(siteFaviconLinks(undefined)).toEqual([])
    expect(siteAppleTouchIconLinks('')).toEqual([])
    expect(siteManifestIcons(null)).toEqual([])
  })
})
