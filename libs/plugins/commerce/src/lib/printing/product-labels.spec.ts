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

import { barcodeSvg, encodeBarcode } from '../barcode/barcode-encode'
import { decodeLumaRow } from '../barcode/barcode-decode'
import { MAX_LABEL_COPIES, productLabelsHtml, productLabelsZpl, zplText } from './product-labels'

/** A clean scanline of the modules, three pixels each, with quiet zones. */
function scan(modules: string): Float32Array {
  const pitch = 3
  const margin = 40
  const out = new Float32Array(modules.length * pitch + margin * 2).fill(220)
  for (let index = 0; index < modules.length; index += 1) {
    if (modules[index] !== '1') continue
    out.fill(35, margin + index * pitch, margin + (index + 1) * pitch)
  }
  return out
}

describe('label barcodes read back with the register’s own reader (AGL-3619)', () => {
  it.each([
    ['4006381333931', 'ean_13'],
    ['036000291452', 'upc_a'],
    ['96385074', 'ean_8'],
    ['SKU-TEE-L', 'code_128'],
    ['123456', 'code_128'],
  ])('%s prints as %s and scans back as itself', (value, format) => {
    const encoded = encodeBarcode(value)!
    expect(encoded.format).toBe(format)
    expect(decodeLumaRow(scan(encoded.modules))?.text).toBe(value)
  })

  it('prints a code with a bad check digit as Code 128, not as a broken EAN', () => {
    expect(encodeBarcode('4006381333932')?.format).toBe('code_128')
  })

  it('has nothing to print for an empty code', () => {
    expect(encodeBarcode('  ')).toBeNull()
    expect(encodeBarcode(undefined)).toBeNull()
  })

  it('draws bars as one SVG path', () => {
    const svg = barcodeSvg(encodeBarcode('96385074')!)
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 87 50"/)
    expect(svg.match(/<path /g)).toHaveLength(1)
  })
})

const TEE = { name: 'Tee <b>shirt</b>', detail: 'Large / Blue', priceCents: 2500, code: '4006381333931', copies: 2 }

describe('the printable label page', () => {
  it('sizes the page to the label, prints each copy, and escapes merchant text', () => {
    const html = productLabelsHtml([TEE], '2x1')
    expect(html).toContain('@page{size:2in 1in;margin:0}')
    expect(html.match(/<section class="label">/g)).toHaveLength(2)
    expect(html).toContain('Tee &lt;b&gt;shirt&lt;/b&gt;')
    expect(html).not.toContain('<b>shirt')
    expect(html).toContain('$25.00')
    expect(html).toContain('4006381333931')
  })

  it('caps a print run', () => {
    const html = productLabelsHtml([{ ...TEE, copies: 100_000 }])
    expect(html.match(/<section class="label">/g)).toHaveLength(MAX_LABEL_COPIES)
    expect(productLabelsHtml([{ ...TEE, copies: 0 }])).not.toContain('<section')
  })
})

describe('ZPL for Zebra printers', () => {
  it('writes one format per product with its copies, size and barcode', () => {
    const zpl = productLabelsZpl([TEE, { name: 'Mug', code: 'MUG-1', copies: 1 }], '2.25x1.25')
    const formats = zpl.split('\n')
    expect(formats).toHaveLength(2)
    expect(formats[0]).toMatch(/^\^XA\^CI0\^PW457\^LL254/)
    expect(formats[0]).toContain('^BEN,')
    expect(formats[0]).toContain('^FD400638133393^FS')
    expect(formats[0]).toContain('^PQ2,0,1,Y^XZ')
    expect(formats[1]).toContain('^BCN,')
    expect(formats[1]).toContain('^FDMUG-1^FS')
    expect(formats[1]).not.toContain('$')
  })

  it('scales to a 300 dpi printer', () => {
    expect(productLabelsZpl([TEE], '2x1', 300)).toMatch(/\^PW600\^LL300/)
  })

  it('escapes the characters ZPL reads as commands', () => {
    expect(zplText('50% ^off~ my_shop')).toBe('50% _5Eoff_7E my_5Fshop')
    expect(productLabelsZpl([{ ...TEE, name: '^XZ^XA', copies: 1 }])).not.toContain('^FD^XZ')
  })
})
