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
  isSelfHostedFontPath,
  parseGoogleFontFaces,
  selfHostedFontFaceCss,
  selfHostedFontPreloads,
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
