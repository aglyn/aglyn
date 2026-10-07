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

import { CODE128_PATTERNS, eanCheckDigitValid } from './barcode-decode'

/**
 * Barcodes drawn for product labels (AGL-3619), in the symbologies the
 * register's scanners read back: a valid EAN-13, UPC-A or EAN-8 prints as
 * itself (a retail scanner and a supplier's catalog both expect that), and
 * anything else (a SKU, an internal code) prints as Code 128.
 *
 * The output is a string of modules, `1` for a bar and `0` for a space, so
 * the same encoding draws an SVG for the browser and is checked against the
 * decoder in tests.
 */

export type EncodedFormat = 'ean_13' | 'upc_a' | 'ean_8' | 'code_128'

export interface EncodedBarcode {
  format: EncodedFormat
  /** The text the barcode carries (and is printed under it). */
  text: string
  modules: string
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const EAN_G = EAN_L.map((code) => [...code].map((bit) => (bit === '1' ? '0' : '1')).reverse().join(''))
const EAN_R = EAN_L.map((code) => [...code].map((bit) => (bit === '1' ? '0' : '1')).join(''))
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

function ean13(code: string): string {
  const parity = EAN_PARITY[Number(code[0])]
  let out = '101'
  for (let index = 1; index <= 6; index += 1) {
    out += (parity[index - 1] === 'L' ? EAN_L : EAN_G)[Number(code[index])]
  }
  out += '01010'
  for (let index = 7; index <= 12; index += 1) out += EAN_R[Number(code[index])]
  return `${out}101`
}

function ean8(code: string): string {
  let out = '101'
  for (let index = 0; index < 4; index += 1) out += EAN_L[Number(code[index])]
  out += '01010'
  for (let index = 4; index < 8; index += 1) out += EAN_R[Number(code[index])]
  return `${out}101`
}

const widthsToModules = (widths: readonly number[]) =>
  widths.map((width, index) => (index % 2 ? '0' : '1').repeat(width)).join('')

/** Code 128: set C for an even run of digits (half as wide), set B otherwise. */
function code128(text: string): string {
  const numeric = /^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4
  const values = numeric ? [105] : [104]
  if (numeric) {
    for (let index = 0; index < text.length; index += 2) values.push(Number(text.slice(index, index + 2)))
  } else {
    for (const char of text) values.push(char.charCodeAt(0) - 32)
  }
  const checksum = values.reduce((sum, value, index) => sum + value * Math.max(1, index), 0) % 103
  values.push(checksum, 106)
  return values.map((value) => widthsToModules(CODE128_PATTERNS[value])).join('')
}

/** Code 128 set B carries printable ASCII; labels cap the code where a 2-inch label still scans. */
export const LABEL_CODE_MAX_LENGTH = 24

/** The barcode a value prints as, or null when it has nothing printable. */
export function encodeBarcode(raw: unknown): EncodedBarcode | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (/^\d{13}$/.test(value) && eanCheckDigitValid(value)) {
    return { format: 'ean_13', text: value, modules: ean13(value) }
  }
  if (/^\d{12}$/.test(value) && eanCheckDigitValid(value)) {
    // UPC-A is EAN-13 with a leading zero; the bars are identical.
    return { format: 'upc_a', text: value, modules: ean13(`0${value}`) }
  }
  if (/^\d{8}$/.test(value) && eanCheckDigitValid(value)) {
    return { format: 'ean_8', text: value, modules: ean8(value) }
  }
  const printable = value.replace(/[^\x20-\x7e]/g, '').slice(0, LABEL_CODE_MAX_LENGTH)
  if (!printable) return null
  return { format: 'code_128', text: printable, modules: code128(printable) }
}

/**
 * The barcode as an SVG, one unit per module plus the ten-module quiet zone a
 * scanner needs either side. It scales to whatever width the label gives it.
 */
export function barcodeSvg(encoded: EncodedBarcode, options: { height?: number } = {}): string {
  const quiet = 10
  const height = options.height ?? 50
  const width = encoded.modules.length + quiet * 2
  let path = ''
  let index = 0
  while (index < encoded.modules.length) {
    if (encoded.modules[index] !== '1') {
      index += 1
      continue
    }
    let run = 1
    while (encoded.modules[index + run] === '1') run += 1
    path += `M${index + quiet} 0h${run}v${height}h-${run}z`
    index += run
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="none" shape-rendering="crispEdges"><path d="${path}" fill="currentColor"/></svg>`
  )
}
