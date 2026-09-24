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

import { parseXml, xmlTextContent } from './ooxml'
import { readSvg, SVG_READ_MAX_BYTES } from './svg'

const svg = (text: string) => readSvg(new TextEncoder().encode(text))

const SVG_NS = 'http://www.w3.org/2000/svg'
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

describe('readSvg', () => {
  it('reads the title and description that are direct children of the root', () => {
    const read = svg(
      `<?xml version="1.0"?>\n<svg xmlns="${SVG_NS}" viewBox="0 0 10 10">\n` +
        '  <title>\n    Company   logo &amp; mark\n  </title>\n' +
        '  <desc>Two lines:\n  one, two.</desc>\n' +
        '  <g><title>A group, not the file</title></g>\n' +
        '  <title>A second title is ignored</title>\n' +
        '  <rect width="10" height="10"/>\n</svg>\n',
    )
    expect(read).toEqual({
      candidates: [
        { key: 'title', value: 'Company logo & mark', source: 'svg' },
        { key: 'description', value: 'Two lines:\n  one, two.', source: 'svg' },
      ],
      xmp: null,
    })
  })

  it('takes the first non-empty title, and reads CDATA inside it', () => {
    const read = svg(
      `<svg xmlns="${SVG_NS}"><title/><title><![CDATA[R&D <draft>]]></title></svg>`,
    )
    expect(read?.candidates).toEqual([
      { key: 'title', value: 'R&D <draft>', source: 'svg' },
    ])
  })

  it('accepts an SVG with no namespace, and ignores title and desc in another one', () => {
    expect(svg('<svg><title>Bare</title></svg>')?.candidates[0]?.value).toBe(
      'Bare',
    )
    const foreign = svg(
      `<svg xmlns="${SVG_NS}" xmlns:x="urn:x"><x:title>Not SVG</x:title></svg>`,
    )
    expect(foreign?.candidates).toEqual([])
  })

  it('returns the rdf:RDF in metadata as a standalone XMP packet', () => {
    // Inkscape binds rdf, cc and dc on the root, not where they are used.
    const text =
      `<svg xmlns="${SVG_NS}" xmlns:rdf="${RDF_NS}" xmlns:dc="http://purl.org/dc/elements/1.1/"` +
      ' xmlns:cc="http://creativecommons.org/ns#" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">' +
      '<metadata id="metadata7"><rdf:RDF><cc:Work rdf:about="">' +
      '<dc:format>image/svg+xml</dc:format><dc:title>Inkscape title</dc:title>' +
      '</cc:Work></rdf:RDF></metadata><path d="M0 0"/></svg>'
    const read = svg(text)
    const xmp = read?.xmp
    if (!xmp) throw new Error('no xmp')
    expect(xmp.startsWith('<rdf:RDF xmlns=')).toBe(true)
    expect(xmp.endsWith('</rdf:RDF>')).toBe(true)
    // It parses on its own, with the bindings it borrowed.
    const root = parseXml(xmp)
    expect(root?.ns).toBe(RDF_NS)
    const work = root?.children[0]
    expect(work?.ns).toBe('http://creativecommons.org/ns#')
    const title = work?.children.find((child) => child.local === 'title')
    expect(title?.ns).toBe('http://purl.org/dc/elements/1.1/')
    expect(title && xmlTextContent(title)).toBe('Inkscape title')
  })

  it('returns an x:xmpmeta wrapper whole, and skips metadata without RDF', () => {
    const packet =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
      `<rdf:RDF xmlns:rdf="${RDF_NS}"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      '<dc:rights>CC-BY</dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>'
    const read = svg(
      `<svg xmlns="${SVG_NS}"><metadata><sfw xmlns="urn:x"/></metadata><metadata>${packet}</metadata></svg>`,
    )
    expect(read?.xmp).toBe(
      packet.replace('<x:xmpmeta ', `<x:xmpmeta xmlns="${SVG_NS}" `),
    )
  })

  it('ignores metadata nested below the root', () => {
    const read = svg(
      `<svg xmlns="${SVG_NS}"><g><metadata><rdf:RDF xmlns:rdf="${RDF_NS}"/></metadata></g></svg>`,
    )
    expect(read?.xmp).toBeNull()
  })

  it('tolerates an inert external DOCTYPE and refuses an internal subset', () => {
    const illustrator =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!-- Generator: Adobe Illustrator 27.0.0 -->\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      `<svg version="1.1" xmlns="${SVG_NS}"><title>Illustrated</title></svg>`
    expect(svg(illustrator)?.candidates[0]?.value).toBe('Illustrated')
    const laughs =
      '<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>' +
      `<svg xmlns="${SVG_NS}"><title>&lol2;</title></svg>`
    expect(svg(laughs)).toBeNull()
    expect(
      svg(
        `<svg xmlns="${SVG_NS}"><title>x</title><!ENTITY e SYSTEM "file:///etc/passwd"></svg>`,
      ),
    ).toBeNull()
  })

  it('leaves undeclared entities unexpanded', () => {
    const read = svg(
      `<svg xmlns="${SVG_NS}"><title>&xxe; &amp; &#x41;</title></svg>`,
    )
    expect(read?.candidates[0]?.value).toBe('&xxe; & A')
  })

  it('decodes UTF-16 and a UTF-8 byte-order mark', () => {
    const text = `<svg xmlns="${SVG_NS}"><title>Ünïcödé</title></svg>`
    const utf16 = new Uint8Array(2 + text.length * 2)
    utf16.set([0xfe, 0xff])
    for (let index = 0; index < text.length; index++) {
      utf16[2 + index * 2] = text.charCodeAt(index) >> 8
      utf16[3 + index * 2] = text.charCodeAt(index) & 0xff
    }
    expect(readSvg(utf16)?.candidates[0]?.value).toBe('Ünïcödé')
    const bom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(text),
    ])
    expect(readSvg(bom)?.candidates[0]?.value).toBe('Ünïcödé')
  })

  it('is null for what is not a well-formed SVG', () => {
    expect(svg('<html><title>page</title></html>')).toBeNull()
    expect(svg(`<svg xmlns="urn:not-svg"><title>x</title></svg>`)).toBeNull()
    expect(svg(`<svg xmlns="${SVG_NS}"><title>unclosed</svg>`)).toBeNull()
    expect(svg('')).toBeNull()
    expect(readSvg(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0]))).toBeNull()
  })

  it('refuses a file over the size bound without reading it', () => {
    const big = new Uint8Array(SVG_READ_MAX_BYTES + 1)
    expect(readSvg(big)).toBeNull()
  })

  it('streams a large drawing', () => {
    const paths = '<path d="M0 0L1 1"/>'.repeat(200_000)
    const read = svg(
      `<svg xmlns="${SVG_NS}">${paths}<title>At the end</title></svg>`,
    )
    expect(read?.candidates[0]?.value).toBe('At the end')
  })

  it('never throws on mutated input', () => {
    const base = new TextEncoder().encode(
      `<svg xmlns="${SVG_NS}" xmlns:rdf="${RDF_NS}"><title>T</title><desc>D</desc>` +
        '<metadata><rdf:RDF><rdf:Description rdf:about=""/></rdf:RDF></metadata></svg>',
    )
    let seed = 3
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 500; round++) {
      const bytes = base.slice(
        0,
        round % 4 === 0 ? random() % base.length : base.length,
      )
      for (let flips = 0; flips < 1 + (round % 4); flips++) {
        if (bytes.length) bytes[random() % bytes.length] = random() & 0xff
      }
      expect(() => readSvg(bytes)).not.toThrow()
    }
  })
})
