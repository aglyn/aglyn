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
  CODE128_PATTERNS,
  decodeImageData,
  decodeLumaRow,
  eanCheckDigitValid,
} from './barcode-decode'

/*
 * The specs ENCODE real symbols, render them to a camera-like luminance row —
 * a fractional pixel pitch, soft edges, uneven lighting and sensor noise —
 * and read them back, so the reader is held to what a phone camera hands it
 * rather than to its own idea of a clean row.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = L.map((code) => code.replace(/./g, (bit) => (bit === '1' ? '0' : '1')))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function ean13Modules(code: string): string {
  const parity = PARITY[Number(code[0])]
  let out = '101'
  for (let index = 1; index <= 6; index += 1) {
    out += (parity[index - 1] === 'L' ? L : G)[Number(code[index])]
  }
  out += '01010'
  for (let index = 7; index <= 12; index += 1) out += R[Number(code[index])]
  return `${out}101`
}

function ean8Modules(code: string): string {
  let out = '101'
  for (let index = 0; index < 4; index += 1) out += L[Number(code[index])]
  out += '01010'
  for (let index = 4; index < 8; index += 1) out += R[Number(code[index])]
  return `${out}101`
}

function code128BModules(text: string): string {
  const values = [104, ...Array.from(text, (char) => char.charCodeAt(0) - 32)]
  let sum = values[0]
  values.slice(1).forEach((value, index) => {
    sum += value * (index + 1)
  })
  values.push(sum % 103, 106)
  return values
    .map((value) =>
      CODE128_PATTERNS[value].map((width, index) => (index % 2 ? '0' : '1').repeat(width)).join(''),
    )
    .join('')
}

function code128CModules(numeric: string): string {
  const values = [105]
  for (let index = 0; index < numeric.length; index += 2) values.push(Number(numeric.slice(index, index + 2)))
  let sum = values[0]
  values.slice(1).forEach((value, index) => {
    sum += value * (index + 1)
  })
  values.push(sum % 103, 106)
  return values
    .map((value) =>
      CODE128_PATTERNS[value].map((width, index) => (index % 2 ? '0' : '1').repeat(width)).join(''),
    )
    .join('')
}

/** A deterministic pseudo-random sequence, so a failing spec fails the same way twice. */
function noise(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff - 0.5
  }
}

function render(
  modules: string,
  options: { pitch?: number; margin?: number; noise?: number; gradient?: number; seed?: number } = {},
): Float32Array {
  const pitch = options.pitch ?? 3
  const margin = options.margin ?? 40
  const width = Math.ceil(modules.length * pitch + margin * 2)
  const random = noise(options.seed ?? 7)
  const out = new Float32Array(width)
  for (let x = 0; x < width; x += 1) {
    // Area coverage of this pixel by dark modules: a soft, sub-pixel edge.
    let dark = 0
    for (let sample = 0; sample < 4; sample += 1) {
      const position = (x + (sample + 0.5) / 4 - margin) / pitch
      const moduleIndex = Math.floor(position)
      if (moduleIndex >= 0 && moduleIndex < modules.length && modules[moduleIndex] === '1') dark += 0.25
    }
    const light = 220 - (options.gradient ?? 0) * (x / width)
    out[x] = light - dark * (light - 35) + (options.noise ?? 0) * random()
  }
  return out
}

describe('the camera fallback reader (AGL-3619)', () => {
  it('validates EAN/UPC check digits', () => {
    expect(eanCheckDigitValid('4006381333931')).toBe(true)
    expect(eanCheckDigitValid('4006381333932')).toBe(false)
    expect(eanCheckDigitValid('96385074')).toBe(true)
  })

  it('reads an EAN-13', () => {
    expect(decodeLumaRow(render(ean13Modules('4006381333931')))).toEqual({
      format: 'ean_13',
      text: '4006381333931',
    })
  })

  it('reads a UPC-A as the twelve digits a keyboard scanner types', () => {
    expect(decodeLumaRow(render(ean13Modules('0036000291452')))).toEqual({
      format: 'upc_a',
      text: '036000291452',
    })
  })

  it('reads an EAN-8', () => {
    expect(decodeLumaRow(render(ean8Modules('96385074')))).toEqual({ format: 'ean_8', text: '96385074' })
  })

  it('reads the Code128 order number a receipt prints, in set B and set C', () => {
    expect(decodeLumaRow(render(code128BModules('#1042-A')))).toEqual({ format: 'code_128', text: '#1042-A' })
    expect(decodeLumaRow(render(code128CModules('104277')))).toEqual({ format: 'code_128', text: '104277' })
  })

  it('reads upside down (right to left)', () => {
    const row = render(ean13Modules('4006381333931')).reverse()
    expect(decodeLumaRow(row)?.text).toBe('4006381333931')
    expect(decodeLumaRow(render(code128BModules('SKU-778')).reverse())?.text).toBe('SKU-778')
  })

  it('holds up at a fractional pixel pitch, uneven light and sensor noise', () => {
    for (const pitch of [2.1, 2.7, 3.4, 5.2]) {
      const row = render(ean13Modules('5901234123457'), { pitch, noise: 30, gradient: 80, seed: Math.round(pitch * 10) })
      expect(decodeLumaRow(row)?.text).toBe('5901234123457')
    }
    expect(
      decodeLumaRow(render(code128BModules('ORDER-1042'), { pitch: 2.4, noise: 25, gradient: 60 }))?.text,
    ).toBe('ORDER-1042')
  })

  it('returns nothing for a row with no barcode, or too little contrast', () => {
    expect(decodeLumaRow(new Float32Array(400).fill(200))).toBeNull()
    const text = render('1011001110001010101100111000101011', { pitch: 3 })
    expect(decodeLumaRow(text)).toBeNull()
  })

  it('never returns a wrong code: a damaged digit fails the check digit', () => {
    const modules = ean13Modules('4006381333931').split('')
    // Swap one left-hand digit's pattern for another digit's (6 → 7).
    const damaged = modules.join('').replace(L[6], L[7])
    const read = decodeLumaRow(render(damaged))
    expect(read === null || read.text === '4006381333931').toBe(true)
  })

  it('finds the barcode in a frame, sampling rows across the guide band', () => {
    const row = render(ean13Modules('4006381333931'), { pitch: 2.5 })
    const width = row.length
    const height = 60
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    // Only rows 24-36 carry the symbol, the rest are blank paper.
    for (let y = 24; y <= 36; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4
        data[pixel] = data[pixel + 1] = data[pixel + 2] = row[x]
      }
    }
    expect(decodeImageData({ data, width, height })?.text).toBe('4006381333931')
  })
})
