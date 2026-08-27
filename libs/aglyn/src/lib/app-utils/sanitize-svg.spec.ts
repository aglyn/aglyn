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
 * The SVG sanitizer (AGL-1474).
 *
 * Two claims, and they pull against each other, which is the whole reason
 * this file is long:
 *
 * 1. **Script is gone**, including through the encodings and nestings people
 *    actually use to walk a sanitizer past itself.
 * 2. **A real logo still renders.** Roughly 75 brand SVGs live in the org DAM
 *    and every one of them is used through an `<img src>`. A sanitizer that
 *    strips gradients, `<use>` references or `<style>` classes would break the
 *    product far more visibly than the bug it fixes, so the honest assets are
 *    asserted to come back BYTE-IDENTICAL — not merely "still valid".
 *
 * The payload named in the issue — `<script>alert(document.domain)</script>` —
 * is the first test.
 */

import {
  isSafeSvgUrl,
  isSvgUploadType,
  sanitizeSvg,
  sanitizeSvgBuffer,
} from './sanitize-svg'

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`

const clean = (svg: string) => sanitizeSvg(svg).svg

describe('sanitizeSvg — script is dead (AGL-1474)', () => {
  it('removes the exact payload the issue names', () => {
    const source = wrap('<script>alert(document.domain)</script><rect/>')
    const result = sanitizeSvg(source)
    expect(result.svg).not.toContain('alert')
    expect(result.svg).not.toContain('script')
    expect(result.changed).toBe(true)
    expect(result.removed).toContain('script')
    // The picture survives the surgery.
    expect(result.svg).toContain('<rect/>')
  })

  it('removes a script that contains `<`, which a naive scan desynchronizes on', () => {
    // `if (a<b)` looks like the start of a tag. A scanner that treats script
    // content as markup loses its place here and can emit the rest of the
    // payload as text.
    const result = sanitizeSvg(
      wrap('<script>if (1<2) { alert(document.domain) }</script><circle/>'),
    )
    expect(result.svg).not.toContain('alert')
    expect(result.svg).toContain('<circle/>')
  })

  it('removes a namespaced script — `<html:script>` is still a script', () => {
    const result = sanitizeSvg(
      wrap('<html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>'),
    )
    expect(result.svg).not.toContain('alert')
    expect(result.removed).toContain('script')
  })

  it('removes <foreignObject> AND everything inside it', () => {
    const result = sanitizeSvg(
      wrap(
        '<foreignObject width="10" height="10">' +
          '<div xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(1)"/></div>' +
          '</foreignObject><rect/>',
      ),
    )
    expect(result.svg).not.toContain('onerror')
    expect(result.svg).not.toContain('div')
    expect(result.svg).toContain('<rect/>')
    expect(result.removed).toContain('foreignobject')
  })

  it('tracks same-name nesting so the FIRST close tag does not end the removal', () => {
    const result = sanitizeSvg(
      wrap(
        '<foreignObject><foreignObject></foreignObject>' +
          '<script>alert(1)</script></foreignObject><rect/>',
      ),
    )
    expect(result.svg).not.toContain('alert')
    expect(result.svg).toContain('<rect/>')
  })

  it.each([
    ['onload', '<svg onload="alert(1)"><rect/></svg>'],
    ['onclick', wrap('<rect onclick="alert(1)"/>')],
    ['onbegin', wrap('<animate onbegin="alert(1)" attributeName="x"/>')],
    ['ONLOAD (case)', '<svg ONLOAD="alert(1)"><rect/></svg>'],
  ])('strips the %s handler', (_name, source) => {
    const result = sanitizeSvg(source)
    expect(result.svg).not.toContain('alert')
    expect(result.removed).toContain('event handler')
  })

  it('strips a javascript: href, including entity-encoded and split forms', () => {
    for (const href of [
      'javascript:alert(1)',
      '&#106;avascript:alert(1)',
      'java&#9;script:alert(1)',
      'JaVaScRiPt:alert(1)',
      '&#x6a;avascript:alert(1)',
    ]) {
      const result = sanitizeSvg(wrap(`<a href="${href}"><rect/></a>`))
      expect(result.svg).not.toContain('alert')
      expect(result.removed).toContain('external reference')
    }
  })

  it('strips `xlink:href` under ANY namespace prefix', () => {
    const result = sanitizeSvg(
      wrap('<a xl:href="javascript:alert(1)" xmlns:xl="http://www.w3.org/1999/xlink"><rect/></a>'),
    )
    expect(result.svg).not.toContain('alert')
  })

  it('removes an animation that ANIMATES a reference into existence', () => {
    // `<set attributeName="href" to="javascript:…">` puts the URL back after
    // every attribute has been checked.
    const result = sanitizeSvg(
      wrap('<a><set attributeName="href" to="javascript:alert(1)"/><rect/></a>'),
    )
    expect(result.svg).not.toContain('alert')
    expect(result.removed).toContain('animated reference')
  })

  it('drops a DOCTYPE with an internal subset — entities expand past every check', () => {
    const result = sanitizeSvg(
      '<!DOCTYPE svg [<!ENTITY payload "<script>alert(1)</script>">]>' +
        wrap('&payload;<rect/>'),
    )
    expect(result.svg).not.toContain('ENTITY')
    expect(result.svg).not.toContain('alert')
    expect(result.removed).toContain('doctype entity subset')
  })

  it('drops <?xml-stylesheet?> — an external XSLT is a script engine', () => {
    const result = sanitizeSvg(
      '<?xml version="1.0"?><?xml-stylesheet href="https://evil.test/x.xsl" type="text/xsl"?>' +
        wrap('<rect/>'),
    )
    expect(result.svg).not.toContain('xml-stylesheet')
    // The XML declaration itself is not a processing instruction and stays.
    expect(result.svg).toContain('<?xml version="1.0"?>')
    expect(result.removed).toContain('processing instruction')
  })

  it.each(['iframe', 'embed', 'object', 'handler', 'listener', 'audio', 'video'])(
    'removes <%s> and its subtree',
    (element) => {
      const result = sanitizeSvg(
        wrap(`<${element}><script>alert(1)</script></${element}><rect/>`),
      )
      expect(result.svg).not.toContain('alert')
      expect(result.svg).not.toContain(element)
      expect(result.svg).toContain('<rect/>')
    },
  )

  it('refuses a NESTED svg data URI — that is another document', () => {
    const result = sanitizeSvg(
      wrap('<image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=="/>'),
    )
    expect(result.svg).not.toContain('data:image/svg')
  })

  it('neutralizes @import and external url() in a <style> block', () => {
    const result = sanitizeSvg(
      wrap('<style>@import url("https://evil.test/x.css"); .a{fill:url(https://evil.test/y)}</style><rect class="a"/>'),
    )
    expect(result.svg).not.toContain('@import')
    expect(result.svg).not.toContain('evil.test')
    // The class survives, so the asset still styles itself.
    expect(result.svg).toContain('.a{fill:url(#)}')
    expect(result.svg).toContain('<rect class="a"/>')
  })

  it('drops a style= attribute carrying an external url()', () => {
    const result = sanitizeSvg(
      wrap('<rect style="fill:url(https://evil.test/track)"/>'),
    )
    expect(result.svg).not.toContain('evil.test')
    expect(result.removed).toContain('external style reference')
  })
})

describe('sanitizeSvg — a real logo is untouched (AGL-1474)', () => {
  /** The shapes the ~75 brand marks in the org DAM are actually made of. */
  const HONEST = [
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 4h24v24H4z" fill="#0B5FFF"/></svg>',
    wrap(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<rect fill="url(#g)" width="24" height="24"/>',
    ),
    wrap('<defs><path id="mark" d="M0 0h4v4H0z"/></defs><use href="#mark"/><use xlink:href="#mark" x="8"/>'),
    wrap('<style>.brand{fill:#0B5FFF}</style><path class="brand" d="M0 0h4v4H0z"/>'),
    wrap('<g clip-path="url(#clip)" filter="url(#shadow)"><circle cx="12" cy="12" r="8"/></g>'),
    wrap('<image href="data:image/png;base64,iVBORw0KGgo="/>'),
    // The DOCTYPE Illustrator has emitted for twenty years — inert, and
    // rewriting every file that carries one would buy nothing.
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
      wrap('<rect/>'),
    wrap('<!-- Generated by a design tool --><title>Aglyn</title><rect/>'),
  ]

  it.each(HONEST.map((svg, index) => [index, svg]))(
    'reports NOTHING removed for honest asset #%s',
    (_index, svg) => {
      expect(sanitizeSvg(svg as string).changed).toBe(false)
      expect(sanitizeSvg(svg as string).removed).toEqual([])
    },
  )

  it('returns the ORIGINAL buffer, byte for byte, when nothing was removed', () => {
    // The buffer identity is the guarantee. Re-encoding a clean SVG would put
    // every asset in the library one charset assumption away from corruption,
    // and would change its content hash — the CDN's ETag and its immutable
    // URL both — for no reason.
    for (const svg of HONEST) {
      const original = Buffer.from(svg, 'utf8')
      const result = sanitizeSvgBuffer(original)
      expect(result.changed).toBe(false)
      expect(result.buffer).toBe(original)
      expect(result.buffer.equals(original)).toBe(true)
    }
  })

  it('keeps same-document fragment references, which is what <use> needs', () => {
    const result = clean(wrap('<use href="#mark"/>'))
    expect(result).toContain('href="#mark"')
  })

  it('keeps a raster data URI', () => {
    expect(clean(wrap('<image href="data:image/png;base64,AAAA"/>'))).toContain(
      'data:image/png',
    )
  })
})

describe('isSafeSvgUrl', () => {
  it.each(['#gradient', '#', 'data:image/png;base64,AA', 'data:image/jpeg,x', ''])(
    'accepts %s',
    (value) => expect(isSafeSvgUrl(value)).toBe(true),
  )

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    'https://evil.test/x.svg',
    'logo.png',
    '//evil.test/x',
  ])('refuses %s', (value) => expect(isSafeSvgUrl(value)).toBe(false))
})

describe('isSvgUploadType', () => {
  it.each(['image/svg+xml', 'IMAGE/SVG+XML', 'image/svg+xml; charset=utf-8', 'image/svg'])(
    'recognizes %s',
    (type) => expect(isSvgUploadType(type)).toBe(true),
  )

  it.each(['image/png', 'image/webp', 'application/pdf', '', 'text/html'])(
    'leaves %s alone',
    (type) => expect(isSvgUploadType(type)).toBe(false),
  )
})
