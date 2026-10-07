/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 */
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
 * The gate an AI illustration passes before it is stored (AGL-3602): one
 * static, self-contained SVG in the shape asked for, under the size cap, that
 * the upload route's sanitizer would leave exactly as it is.
 */

import { checkAiMediaSvgAnswer } from '../server/ai-media-svg'
import { AI_SVG_MAX_BYTES, aiSvgThemePalette, checkAiSvgMarkup, isAiSvgColor } from './ai-svg'

const NS = 'xmlns="http://www.w3.org/2000/svg"'
const svg = (inner: string, attributes = `${NS} viewBox="0 0 512 512"`) =>
  `<svg ${attributes}>${inner}</svg>`
const SQUARE = svg('<rect x="10" y="10" width="200" height="200" fill="#1a73e8"/><circle cx="300" cy="300" r="80" fill="#fbbc04"></circle>')
const codes = (markup: string, ratio: '1:1' | '16:9' = '1:1', style: 'icon' | 'logo' = 'icon') =>
  checkAiSvgMarkup(markup, ratio, style).problems.map((problem) => problem.code)

describe('a picture that passes', () => {
  it('is stored as written', () => {
    expect(checkAiSvgMarkup(SQUARE, '1:1', 'icon')).toEqual({ svg: SQUARE, problems: [] })
  })

  it('may carry an XML declaration, which is dropped, and in-document references', () => {
    const withRefs = svg(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/>',
    )
    expect(checkAiSvgMarkup(`<?xml version="1.0"?>\n${withRefs}`, '1:1', 'icon').svg).toBe(withRefs)
  })
})

describe('what it refuses', () => {
  it.each([
    ['a script', svg('<script>alert(1)</script>'), 'script'],
    ['an onload handler', svg('<rect width="1" height="1"/>', `${NS} viewBox="0 0 512 512" onload="alert(1)"`), 'event-handler'],
    ['an external href', svg('<use href="https://evil.example/x.svg#a"/>'), 'external-ref'],
    ['an external url()', svg('<rect width="1" height="1" fill="url(https://evil.example/p)"/>'), 'external-url'],
    ['a foreignObject', svg('<foreignObject><div>hi</div></foreignObject>'), 'foreign-object'],
    ['an embedded raster', svg('<image href="data:image/png;base64,AAAA" width="1" height="1"/>'), 'image'],
    ['a link', svg('<a href="#x"><rect width="1" height="1"/></a>'), 'link'],
    ['an animation', svg('<rect width="1" height="1"><animate attributeName="x" to="5"/></rect>'), 'animation'],
    ['a web font', svg('<style>@font-face{font-family:x}</style>'), 'external-css'],
  ])('refuses %s', (_label, markup, code) => {
    expect(codes(markup)).toContain(code)
  })

  it('refuses a document with no viewBox, or one of the wrong shape', () => {
    expect(codes(svg('<rect width="1" height="1"/>', NS))).toContain('viewbox')
    expect(codes(SQUARE, '16:9')).toContain('viewbox-shape')
  })

  it('refuses a missing namespace, a second root, and unbalanced tags', () => {
    expect(codes(svg('<rect/>', 'viewBox="0 0 512 512"'))).toContain('namespace')
    expect(codes(`${SQUARE}<svg></svg>`)).toContain('malformed')
    expect(codes(svg('<g><rect/>'))).toContain('malformed')
    expect(codes('<div>not an svg</div>')).toContain('root')
  })

  it('refuses a document over the size cap', () => {
    const big = svg(`<path d="${'M0 0L1 1'.repeat(AI_SVG_MAX_BYTES / 8)}"/>`)
    expect(codes(big)).toContain('too-large')
  })

  it('refuses lettering in a logo mark, and only there', () => {
    const lettered = svg('<text x="10" y="10" font-family="sans-serif">AB</text>')
    expect(codes(lettered, '1:1', 'logo')).toContain('wordmark')
    expect(codes(lettered, '1:1', 'icon')).not.toContain('wordmark')
  })

  it('refuses anything the upload route’s sanitizer would change', () => {
    // A `data:` SVG nested in a fill is no external host and no `<image>`,
    // and the sanitizer still strips it.
    expect(codes(svg('<rect width="1" height="1" style="fill:url(data:image/svg+xml;base64,AAAA)"/>'))).toEqual([
      'external-url',
    ])
  })
})

describe('the answer the model submits', () => {
  it('passes a clean picture with its alt text', () => {
    expect(checkAiMediaSvgAnswer({ svg: SQUARE, alt: 'A blue square', declined: '' }, '1:1', 'icon')).toEqual({
      value: { svg: SQUARE, alt: 'A blue square' },
      violations: [],
    })
  })

  it('reads a decline as a decline, not a fault', () => {
    expect(
      checkAiMediaSvgAnswer({ svg: '', alt: '', declined: 'That is a real company’s logo.' }, '1:1', 'logo').value,
    ).toEqual({ declined: 'That is a real company’s logo.' })
  })

  it('sends each problem back for the re-ask', () => {
    const result = checkAiMediaSvgAnswer({ svg: svg('<script/>'), alt: 'x', declined: '' }, '1:1', 'icon')
    expect(result.violations.map((violation) => violation.code)).toContain('svg-script')
    expect(result.violations[0].detail).toMatch(/script/)
  })
})

describe('colors', () => {
  it('accepts hex colors only', () => {
    expect(isAiSvgColor('#1a73e8')).toBe(true)
    expect(isAiSvgColor('#fff')).toBe(true)
    expect(isAiSvgColor('red')).toBe(false)
    expect(isAiSvgColor('url(x)')).toBe(false)
  })

  it('reads a theme’s palette primary first, hex only, without repeats', () => {
    expect(
      aiSvgThemePalette({
        'text.primary': '#111111',
        'secondary.main': '#FBBC04',
        'primary.main': '#1a73e8',
        'background.default': '#ffffff',
        'action.hover': 'rgba(0,0,0,0.04)',
        'primary.light': '#1A73E8',
      }),
    ).toEqual(['#1a73e8', '#fbbc04', '#ffffff', '#111111'])
    expect(aiSvgThemePalette(null)).toEqual([])
  })
})
