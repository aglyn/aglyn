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
  googleFontSheetUrl,
  isSelfHostedFontPath,
  mergeSharedFiles,
  metricFallbackFontFaceCss,
  offeredWeights,
  parseGoogleFontFaces,
  selfHostedFontFaceCss,
  selfHostedFontPreloads,
  siteFontFaceCss,
  siteFontPreloads,
  themeFontNeeds,
  withMetricFallbacks,
} from './self-hosted-fonts'

/** Google's CSS2 answer to a WOFF2 browser, trimmed to three subsets. */
const GOOGLE_CSS = `
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/cyr400.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/lat400.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/lat700.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 400 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/playfairdisplay/v37/pfvar.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Evil';
  font-style: normal;
  font-weight: 400;
  src: url(https://evil.example/s/evil/v1/x.woff2) format('woff2');
}
`

describe('self-hosted theme fonts (AGL-3485)', () => {
  const faces = parseGoogleFontFaces(GOOGLE_CSS)

  it("reads Google's rules, dropping one whose file is not Google's", () => {
    expect(faces.map((face) => face.path)).toEqual([
      'inter/v18/cyr400.woff2',
      'inter/v18/lat400.woff2',
      'inter/v18/lat700.woff2',
      'playfairdisplay/v37/pfvar.woff2',
    ])
    expect(faces[0]).toMatchObject({
      family: 'Inter',
      style: 'normal',
      weight: '400',
      subset: 'cyrillic',
      unicodeRange: 'U+0301, U+0400-045F',
    })
    expect(faces[3].weight).toBe('400 900')
  })

  it('accepts only a versioned woff2 path below a family', () => {
    expect(isSelfHostedFontPath('inter/v18/abc_DEF-1.woff2')).toBe(true)
    expect(isSelfHostedFontPath('../etc/passwd')).toBe(false)
    expect(isSelfHostedFontPath('inter/v18/a.ttf')).toBe(false)
    expect(isSelfHostedFontPath('inter/a.woff2')).toBe(false)
    expect(isSelfHostedFontPath('https://evil/x.woff2')).toBe(false)
  })

  it('writes every rule on the site origin, swapping, with its range', () => {
    const css = selfHostedFontFaceCss(faces)
    expect(css).not.toContain('gstatic')
    expect(css).toContain(
      "src:url(/api/fonts/inter/v18/lat400.woff2) format('woff2');",
    )
    expect(css.match(/font-display:swap/g)).toHaveLength(4)
    expect(css).toContain('unicode-range:U+0301, U+0400-045F;')
    expect(css).toContain("font-family:'Playfair Display';")
  })

  it('cannot be made to write anything but a rule', () => {
    const css = selfHostedFontFaceCss([
      {
        family: "X'}body{color:red",
        style: 'normal',
        weight: '400',
        path: 'x/v1/a.woff2',
      },
    ])
    expect(css).toBe(
      "@font-face{font-family:'X}body{color:red';font-style:normal;" +
        "font-weight:400;font-display:swap;" +
        "src:url(/api/fonts/x/v1/a.woff2) format('woff2');}",
    )
  })

  it('preloads the Latin body face and the headline face', () => {
    expect(
      selfHostedFontPreloads(
        {
          fonts: [{ family: 'Inter' }, { family: 'Playfair Display' }],
          typography: {
            fontFamily: '"Inter", sans-serif',
            variants: { h1: { fontFamily: 'Playfair Display, serif' } },
          },
        },
        faces,
      ),
    ).toEqual([
      '/api/fonts/inter/v18/lat400.woff2',
      '/api/fonts/playfairdisplay/v37/pfvar.woff2',
    ])
  })

  it('preloads one family at two weights, or once for a variable file', () => {
    expect(
      selfHostedFontPreloads({ fonts: [{ family: 'Inter' }] }, faces),
    ).toEqual([
      '/api/fonts/inter/v18/lat400.woff2',
      '/api/fonts/inter/v18/lat700.woff2',
    ])
    expect(
      selfHostedFontPreloads({ fonts: [{ family: 'Playfair Display' }] }, faces),
    ).toEqual(['/api/fonts/playfairdisplay/v37/pfvar.woff2'])
  })

  it('preloads nothing for a theme that loads no Google font', () => {
    expect(selfHostedFontPreloads(undefined, faces)).toEqual([])
    expect(
      selfHostedFontPreloads(
        { fonts: [{ family: 'Inter', source: 'system' }] },
        faces,
      ),
    ).toEqual([])
  })
})

describe('the font loader (AGL-3656)', () => {
  const face = (weight: string, url: string, range = 'U+0000-00FF') => ({
    family: 'Inter',
    style: 'normal' as const,
    weight,
    url,
    subset: 'latin',
    unicodeRange: range,
  })

  it('folds the rules Google writes per weight for one variable file into a range', () => {
    const merged = mergeSharedFiles([
      face('400', '/api/fonts/inter/v20/var.woff2'),
      face('600', '/api/fonts/inter/v20/var.woff2'),
      face('900', '/api/fonts/inter/v20/var.woff2'),
      face('400', '/api/fonts/inter/v20/var.woff2', 'U+0100-024F'),
      face('700', '/api/fonts/inter/v20/b700.woff2'),
    ])
    expect(merged.map((entry) => [entry.weight, entry.url, entry.unicodeRange])).toEqual([
      ['400 900', '/api/fonts/inter/v20/var.woff2', 'U+0000-00FF'],
      ['400', '/api/fonts/inter/v20/var.woff2', 'U+0100-024F'],
      ['700', '/api/fonts/inter/v20/b700.woff2', 'U+0000-00FF'],
    ])
  })

  it('writes only rules on the site origin, dropping a URL that could escape url()', () => {
    const css = siteFontFaceCss([
      face('400 700', '/api/fonts/inter/v20/var.woff2'),
      face('400', '/api/media/cdn/org:o1:h1/m1?v=abc123'),
      face('400', 'https://evil.example/x.woff2'),
      face('400', '/api/fonts/x) ;}body{color:red'),
    ])
    expect(css.match(/@font-face/g)).toHaveLength(2)
    expect(css).toContain('font-weight:400 700;')
    expect(css).toContain("src:url(/api/media/cdn/org:o1:h1/m1?v=abc123) format('woff2');")
    expect(css).not.toContain('evil')
    expect(css).not.toContain('color:red')
  })

  it('sizes a fallback to the font: Inter over Arial', () => {
    const css = metricFallbackFontFaceCss(
      'Inter',
      { unitsPerEm: 2048, ascent: 1984, descent: -494, lineGap: 0, xWidthAvg: 967 },
      'sans-serif',
    )
    // 967/2048 over 901/2048.
    expect(css).toContain("font-family:'Inter Fallback';")
    expect(css).toContain("src:local('Arial'),local('ArialMT');")
    expect(css).toContain('size-adjust:107.33%;')
    expect(css).toContain('ascent-override:90.26%;')
    expect(css).toContain('descent-override:22.47%;')
    expect(css).toContain('line-gap-override:0%;')
  })

  it('draws a serif from Times New Roman and a monospace from Courier New', () => {
    const metrics = { unitsPerEm: 1000, ascent: 900, descent: -250, lineGap: 0, xWidthAvg: 450 }
    expect(metricFallbackFontFaceCss('Lora', metrics, 'serif')).toContain("local('Times New Roman')")
    expect(metricFallbackFontFaceCss('Mono', metrics, 'monospace')).toContain("local('Courier New')")
    expect(metricFallbackFontFaceCss('Play', metrics, 'display')).toContain("local('Arial')")
  })

  it('writes no fallback from metrics that are missing or not numbers', () => {
    expect(metricFallbackFontFaceCss('Inter', undefined)).toBe('')
    expect(
      metricFallbackFontFaceCss('Inter', {
        unitsPerEm: 0,
        ascent: 1,
        descent: -1,
        lineGap: 0,
        xWidthAvg: 1,
      }),
    ).toBe('')
  })

  it('names each loaded family’s fallback right after it, once', () => {
    const stack = '"Inter", "Playfair Display", system-ui, sans-serif'
    const once = withMetricFallbacks(stack, ['Inter', 'Playfair Display'])
    expect(once).toBe(
      '"Inter", "Inter Fallback", "Playfair Display", "Playfair Display Fallback", system-ui, sans-serif',
    )
    expect(withMetricFallbacks(once, ['Inter', 'Playfair Display'])).toBe(once)
    expect(withMetricFallbacks('system-ui, sans-serif', ['Inter'])).toBe('system-ui, sans-serif')
  })

  it('loads every weight the text styles draw with, not only the ones listed', () => {
    const needs = themeFontNeeds(
      {
        fonts: [{ family: 'Inter', weights: [400, 500, 700], source: 'google' }],
        typography: { fontFamily: '"Inter", sans-serif', variants: { h3: { fontWeight: 600 } } },
      },
      { h1: { fontWeight: 900 }, h2: { fontWeight: 800 }, h3: { fontWeight: 700 }, body1: { fontWeight: 400 } },
    )
    expect(needs).toEqual([
      {
        family: 'Inter',
        weights: [300, 400, 500, 600, 700, 800, 900],
        textWeights: [400, 500, 600, 700, 800, 900],
        italics: [400],
      },
    ])
  })

  it('gives a headline family only the weights its own styles use', () => {
    const [body, display] = themeFontNeeds(
      {
        fonts: [
          { family: 'Inter', source: 'google' },
          { family: 'Playfair Display', source: 'google' },
        ],
        typography: {
          fontFamily: 'Inter, sans-serif',
          variants: { h1: { fontFamily: '"Playfair Display", serif', fontWeight: 700 } },
        },
      },
      { h1: { fontWeight: 900 }, body1: { fontWeight: 400 } },
    )
    expect(display).toEqual({ family: 'Playfair Display', weights: [700], textWeights: [700], italics: [] })
    expect(body.weights).toEqual([300, 400, 500, 700])
  })

  it('needs nothing for a theme on system fonts', () => {
    expect(themeFontNeeds({ fonts: [{ family: 'Arial', source: 'system' }] }, {})).toEqual([])
    expect(themeFontNeeds(undefined, { h1: { fontWeight: 900 } })).toEqual([])
  })

  it('maps each wanted weight to the nearest one a family offers', () => {
    expect(offeredWeights([300, 400, 800, 900], [400, 700])).toEqual([400, 700])
    expect(offeredWeights([500, 400], undefined)).toEqual([400, 500])
  })

  it('asks Google for faces as sorted ital,wght tuples', () => {
    expect(googleFontSheetUrl('Open Sans', [{ weight: 400, style: 'normal' }])).toBe(
      'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400&display=swap',
    )
    expect(
      googleFontSheetUrl('Inter', [
        { weight: 700, style: 'normal' },
        { weight: 400, style: 'italic' },
        { weight: 400, style: 'normal' },
      ]),
    ).toBe('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700;1,400&display=swap')
    expect(googleFontSheetUrl('Bad&family=X', [{ weight: 400, style: 'normal' }])).toBeUndefined()
  })

  it('preloads the body and headline faces from the base when the theme sets neither', () => {
    const faces = [
      face('400', '/api/fonts/robotoflex/v30/r400.woff2'),
      face('500 1000', '/api/fonts/robotoflex/v30/var.woff2'),
    ].map((entry) => ({ ...entry, family: 'Roboto Flex' }))
    expect(
      siteFontPreloads({ fonts: [{ family: 'Roboto Flex' }] }, faces, {
        fontFamily: '"Roboto Flex", -apple-system',
        h1: { fontWeight: 900 },
        body1: { fontWeight: 400 },
      }),
    ).toEqual(['/api/fonts/robotoflex/v30/r400.woff2', '/api/fonts/robotoflex/v30/var.woff2'])
  })

  it('accepts the long file ids of a many-axis variable family', () => {
    expect(isSelfHostedFontPath(`robotoflex/v30/${'N'.repeat(250)}.woff2`)).toBe(true)
    expect(isSelfHostedFontPath(`robotoflex/v30/${'N'.repeat(401)}.woff2`)).toBe(false)
  })
})
