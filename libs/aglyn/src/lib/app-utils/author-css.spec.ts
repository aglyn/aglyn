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
  INERT_CSS_URL,
  isRefusedAuthorCssUrl,
  sanitizeAuthorCss,
  sanitizeAuthorSx,
} from './author-css'

describe('isRefusedAuthorCssUrl (AGL-1725)', () => {
  it('refuses http:, the mixed-content case with no defensible use', () => {
    expect(isRefusedAuthorCssUrl('http://attacker.example/beacon.png')).toBe(
      true,
    )
    expect(isRefusedAuthorCssUrl('HTTP://attacker.example/b.png')).toBe(true)
    expect(isRefusedAuthorCssUrl('  http://attacker.example/b.png  ')).toBe(
      true,
    )
  })

  it('allows an arbitrary https host — the site owner is the controller', () => {
    // The deliberate non-decision. See the module header: restricting the
    // host here is AGL-1701's remedy applied to a different actor pair.
    expect(isRefusedAuthorCssUrl('https://images.example/bg.jpg')).toBe(false)
    expect(isRefusedAuthorCssUrl('https://cdn.customer-owned.example/a.png')).toBe(
      false,
    )
  })

  it('allows inert and same-document forms', () => {
    expect(isRefusedAuthorCssUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isRefusedAuthorCssUrl('blob:https://site.example/abc')).toBe(false)
    expect(isRefusedAuthorCssUrl('/api/media/cdn/site/abc')).toBe(false)
    expect(isRefusedAuthorCssUrl('./local.png')).toBe(false)
    expect(isRefusedAuthorCssUrl('../up.png')).toBe(false)
    expect(isRefusedAuthorCssUrl('#gradient-def')).toBe(false)
    expect(isRefusedAuthorCssUrl('plain-relative.png')).toBe(false)
    expect(isRefusedAuthorCssUrl('')).toBe(false)
  })

  it('allows protocol-relative — it inherits the page https, never http', () => {
    expect(isRefusedAuthorCssUrl('//images.example/bg.jpg')).toBe(false)
  })

  it('refuses every other scheme, so the allowlist fails closed', () => {
    expect(isRefusedAuthorCssUrl('javascript:alert(1)')).toBe(true)
    expect(isRefusedAuthorCssUrl('ftp://files.example/a.png')).toBe(true)
    expect(isRefusedAuthorCssUrl('file:///etc/passwd')).toBe(true)
    // A CSS-escaped scheme is not decoded, so it lands on the refused side.
    expect(isRefusedAuthorCssUrl('\\68 ttp://attacker.example/b.png')).toBe(true)
  })

  it('does not read a relative path containing a colon as a scheme', () => {
    expect(isRefusedAuthorCssUrl('/a:b/c.png')).toBe(false)
  })
})

describe('sanitizeAuthorCss (AGL-1725)', () => {
  it('neutralises an http background-image and keeps the CSS well formed', () => {
    expect(
      sanitizeAuthorCss(
        '.hero{background: url(http://attacker.example/b.png) no-repeat}',
      ),
    ).toBe(`.hero{background: url(${INERT_CSS_URL}) no-repeat}`)
  })

  it('handles both quoting styles and extra whitespace', () => {
    expect(
      sanitizeAuthorCss('a{background-image:url( "http://x.example/b.png" )}'),
    ).toBe(`a{background-image:url(${INERT_CSS_URL})}`)
    expect(
      sanitizeAuthorCss("a{background-image:url('http://x.example/b.png')}"),
    ).toBe(`a{background-image:url(${INERT_CSS_URL})}`)
  })

  it('reaches every url() position, not only background-image', () => {
    const css = [
      '@import url(http://x.example/s.css);',
      '@font-face{src:url(http://x.example/f.woff2)}',
      'li{list-style-image:url(http://x.example/d.png)}',
      'b{cursor:url(http://x.example/c.cur),auto}',
      'i{background-image:image-set(url(http://x.example/i.png) 1x)}',
    ].join('\n')
    expect(sanitizeAuthorCss(css)).not.toContain('http://x.example')
    expect(sanitizeAuthorCss(css).match(/about:invalid/g)).toHaveLength(5)
  })

  it('leaves an https stylesheet byte-identical, and BY IDENTITY', () => {
    const css = '.hero{background-image:url(https://images.example/bg.jpg)}'
    expect(sanitizeAuthorCss(css)).toBe(css)
    // Identity, so a render path can skip work on the common case.
    expect(sanitizeAuthorCss(css)).toBe(css)
    const noUrls = '.hero{color:red}'
    expect(sanitizeAuthorCss(noUrls)).toBe(noUrls)
  })

  it('rewrites only the refused url in a mixed stylesheet', () => {
    expect(
      sanitizeAuthorCss(
        '.a{background:url(https://ok.example/a.png)}' +
          '.b{background:url(http://bad.example/b.png)}',
      ),
    ).toBe(
      '.a{background:url(https://ok.example/a.png)}' +
        `.b{background:url(${INERT_CSS_URL})}`,
    )
  })
})

describe('sanitizeAuthorSx (AGL-1725)', () => {
  it('scrubs backgroundImage from the Styles panel', () => {
    expect(
      sanitizeAuthorSx({
        backgroundImage: 'url(http://attacker.example/b.png)',
        color: 'red',
      }),
    ).toEqual({
      backgroundImage: `url(${INERT_CSS_URL})`,
      color: 'red',
    })
  })

  it('reaches nested selectors, media queries and array composition', () => {
    const scrubbed = sanitizeAuthorSx([
      { color: 'red' },
      {
        '&:hover': { background: 'url(http://attacker.example/h.png)' },
        '@media (max-width:599.95px)': {
          backgroundImage: 'url(http://attacker.example/m.png)',
        },
      },
    ]) as any
    expect(scrubbed[1]['&:hover'].background).toBe(`url(${INERT_CSS_URL})`)
    expect(
      scrubbed[1]['@media (max-width:599.95px)'].backgroundImage,
    ).toBe(`url(${INERT_CSS_URL})`)
  })

  it('scrubs a breakpoint-keyed responsive array value', () => {
    const scrubbed = sanitizeAuthorSx({
      backgroundImage: [
        'url(https://ok.example/a.png)',
        'url(http://bad.example/b.png)',
      ],
    }) as any
    expect(scrubbed.backgroundImage[0]).toBe('url(https://ok.example/a.png)')
    expect(scrubbed.backgroundImage[1]).toBe(`url(${INERT_CSS_URL})`)
  })

  it('returns the SAME object when nothing is refused', () => {
    const sx = { backgroundImage: 'url(https://ok.example/a.png)', p: 3 }
    expect(sanitizeAuthorSx(sx)).toBe(sx)
    const nested = { '&:hover': { color: 'red' } }
    expect(sanitizeAuthorSx(nested)).toBe(nested)
  })

  it('passes non-string leaves through untouched', () => {
    const fn = () => ({ color: 'red' })
    const sx = { p: 3, m: null, fn }
    const out = sanitizeAuthorSx(sx) as any
    expect(out).toBe(sx)
    expect(out.fn).toBe(fn)
  })

  it('tolerates undefined and null', () => {
    expect(sanitizeAuthorSx(undefined)).toBe(undefined)
    expect(sanitizeAuthorSx(null)).toBe(null)
  })
})
