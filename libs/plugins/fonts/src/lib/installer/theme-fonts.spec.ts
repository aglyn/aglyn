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

import type { HostTheme } from '@aglyn/shared-data-types'
import type { PreparedFontFace } from './constants'
import {
  clearFontRoles,
  customFontFamilies,
  fontFaceSrc,
  fontRolesOf,
  installCustomFontFace,
  planFontUpload,
  removeCustomFontFace,
  removeCustomFontFamily,
  setCustomFontRole,
} from './theme-fonts'

const METRICS = { unitsPerEm: 1000, ascent: 900, descent: -250, lineGap: 0, xWidthAvg: 470 }

const prepared = (overrides: Partial<PreparedFontFace> = {}): PreparedFontFace => ({
  family: 'Acme Sans',
  subfamily: 'Regular',
  weight: 400,
  style: 'normal',
  category: 'sans-serif',
  metrics: METRICS,
  axes: [],
  license: { embedding: 'installable', fsType: 0, noSubsetting: false },
  scripts: ['latin'],
  unicodeRange: 'U+0000-00FF',
  bytesIn: 9000,
  bytesOut: 3000,
  sourceFormat: 'truetype',
  contentHash: '0123456789abcdef',
  fileName: 'Acme-Sans-400.woff2',
  warnings: [],
  ...overrides,
})

describe('installing an uploaded font into a theme (AGL-3656)', () => {
  it('adds the family with its metrics, category and a versioned media face', () => {
    const theme = installCustomFontFace({}, prepared(), { src: 'media:h1/m1', version: 'aaaa' })
    expect(theme.fonts).toEqual([
      {
        family: 'Acme Sans',
        source: 'custom',
        category: 'sans-serif',
        metrics: METRICS,
        faces: [{ weight: 400, style: 'normal', src: 'media:h1/m1', version: 'aaaa', unicodeRange: 'U+0000-00FF' }],
      },
    ])
  })

  it('merges faces of one family, in weight order, and keeps every other font', () => {
    let theme: HostTheme = { fonts: [{ family: 'Inter', source: 'google' }] }
    theme = installCustomFontFace(theme, prepared({ weight: 700 }), { src: 'media:h1/m2', version: 'bbbb' })
    theme = installCustomFontFace(theme, prepared({ family: 'acme sans', style: 'italic' }), {
      src: 'media:h1/m3',
      version: 'cccc',
    })
    theme = installCustomFontFace(theme, prepared(), { src: 'media:h1/m1', version: 'aaaa' })
    expect(theme.fonts?.[0]).toEqual({ family: 'Inter', source: 'google' })
    expect(customFontFamilies(theme)).toHaveLength(1)
    expect(customFontFamilies(theme)[0].faces?.map((face) => [face.weight, face.style])).toEqual([
      [400, 'normal'],
      [400, 'italic'],
      [700, 'normal'],
    ])
  })

  it('replaces the face in the same slot with the new file version', () => {
    let theme = installCustomFontFace({}, prepared(), { src: 'media:h1/m1', version: 'aaaa' })
    theme = installCustomFontFace(theme, prepared(), { src: 'media:h1/m1', version: 'ffff' })
    expect(customFontFamilies(theme)[0].faces).toEqual([
      expect.objectContaining({ src: 'media:h1/m1', version: 'ffff' }),
    ])
  })

  it('keeps one variable face per style, over its weight range', () => {
    let theme = installCustomFontFace({}, prepared({ weight: 100, weightMax: 900 }), {
      src: 'media:h1/v1',
      version: 'aaaa',
    })
    theme = installCustomFontFace(theme, prepared({ weight: 200, weightMax: 800 }), {
      src: 'media:h1/v1',
      version: 'bbbb',
    })
    expect(customFontFamilies(theme)[0].faces).toEqual([
      expect.objectContaining({ weight: 200, weightMax: 800, version: 'bbbb' }),
    ])
  })
})

describe('replace in place (AGL-3656)', () => {
  const installed = installCustomFontFace({}, prepared(), { src: fontFaceSrc('h1', 'm1') as string, version: 'aaaa' })

  it('replaces the library file a face in the same slot already uses', () => {
    expect(planFontUpload(installed, prepared(), 'h1')).toEqual({ mode: 'replace', mediaId: 'm1', scope: 'h1' })
  })

  it('uploads a new file for a new weight, style or family', () => {
    expect(planFontUpload(installed, prepared({ weight: 700 }), 'h1')).toEqual({ mode: 'upload' })
    expect(planFontUpload(installed, prepared({ style: 'italic' }), 'h1')).toEqual({ mode: 'upload' })
    expect(planFontUpload(installed, prepared({ family: 'Other' }), 'h1')).toEqual({ mode: 'upload' })
  })

  it("never replaces a file in another site's library", () => {
    expect(planFontUpload(installed, prepared(), 'h2')).toEqual({ mode: 'upload' })
  })
})

describe('roles and removal (AGL-3656)', () => {
  const base = installCustomFontFace({}, prepared(), { src: 'media:h1/m1', version: 'aaaa' })

  it('sets the family as the body or the headings font', () => {
    const body = setCustomFontRole(base, 'Acme Sans', 'body')
    expect(body.typography?.fontFamily).toBe('"Acme Sans", sans-serif')
    expect(fontRolesOf(body, 'Acme Sans')).toEqual(['body'])
    const headings = setCustomFontRole(body, 'Acme Sans', 'headings')
    expect(headings.typography?.variants?.h1?.fontFamily).toBe('"Acme Sans", sans-serif')
    expect(headings.typography?.variants?.displayXl?.fontFamily).toBe('"Acme Sans", sans-serif')
    expect(fontRolesOf(headings, 'Acme Sans')).toEqual(['body', 'headings'])
  })

  it('ignores a family that is not installed', () => {
    expect(setCustomFontRole(base, 'Nope', 'body')).toBe(base)
  })

  it('removes a face, and the family with its last face, putting its text styles back', () => {
    let theme = installCustomFontFace(base, prepared({ weight: 700 }), { src: 'media:h1/m2', version: 'bbbb' })
    theme = setCustomFontRole(setCustomFontRole(theme, 'Acme Sans', 'body'), 'Acme Sans', 'headings')
    theme = {
      ...theme,
      typography: {
        ...theme.typography,
        variants: { ...theme.typography?.variants, h1: { ...theme.typography?.variants?.h1, fontWeight: 800 } },
      },
    }
    theme = removeCustomFontFace(theme, 'Acme Sans', { weight: 700, style: 'normal' })
    expect(customFontFamilies(theme)[0].faces).toHaveLength(1)
    theme = removeCustomFontFace(theme, 'Acme Sans', { weight: 400, style: 'normal' })
    expect(theme.fonts).toBeUndefined()
    expect(theme.typography?.fontFamily).toBeUndefined()
    // The weight a person set on h1 stays; only the family goes.
    expect(theme.typography?.variants).toEqual({ h1: { fontWeight: 800 } })
  })

  it('leaves text styles drawn with another family alone', () => {
    const theme: HostTheme = {
      ...base,
      typography: { fontFamily: '"Inter", sans-serif', variants: { h2: { fontFamily: '"Acme Sans", serif' } } },
    }
    expect(clearFontRoles(theme, 'Acme Sans').typography).toEqual({ fontFamily: '"Inter", sans-serif' })
    expect(removeCustomFontFamily(theme, 'Acme Sans').fonts).toBeUndefined()
  })
})
