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
 * A small 1D barcode reader for camera frames (AGL-3619): the fallback the
 * camera scanner uses where the browser has no `BarcodeDetector` — Safari on
 * the iPad a register most often runs on, and Chrome on Windows.
 *
 * Why not zxing: its WebAssembly build cannot be compiled under the console's
 * enforcing `script-src` (no `'wasm-unsafe-eval'`), and its JavaScript build
 * is ~400 KB that does not tree-shake. A counter scans three symbologies —
 * EAN-13 / UPC-A on retail goods, EAN-8 on small packs, and Code128 on the
 * order number Aglyn prints and on most warehouse labels — and reading those
 * from a horizontal pass needs a few kilobytes, loaded only when the scanner
 * opens on a browser that lacks the native detector.
 *
 * The reader takes LUMINANCE ROWS, binarizes each against its local mean,
 * turns it into bar/space runs and tries each symbology in both directions.
 * Every symbology carries a check digit and every candidate must pass it, so
 * a misread is rejected rather than returned; the scanner additionally waits
 * for two agreeing reads.
 */

export type DecodedFormat = 'ean_13' | 'upc_a' | 'ean_8' | 'code_128'

export interface DecodedBarcode {
  format: DecodedFormat
  text: string
}

interface Run {
  dark: boolean
  width: number
}

/** Bar/space runs of a binarized row; `dark` is a bar. */
export function rowRuns(dark: ArrayLike<boolean>): Run[] {
  const runs: Run[] = []
  for (let index = 0; index < dark.length; index += 1) {
    const value = Boolean(dark[index])
    const last = runs[runs.length - 1]
    if (last && last.dark === value) last.width += 1
    else runs.push({ dark: value, width: 1 })
  }
  return runs
}

/**
 * A row binarized against a local mean, so a shadow across the label or a
 * glossy hot spot does not swallow half the bars. Rows with too little
 * contrast to hold a barcode answer `null`.
 */
export function binarizeRow(luma: ArrayLike<number>): boolean[] | null {
  const length = luma.length
  if (length < 32) return null
  let min = Infinity
  let max = -Infinity
  const smooth = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const value =
      (Number(luma[Math.max(0, index - 1)]) + 2 * Number(luma[index]) + Number(luma[Math.min(length - 1, index + 1)])) / 4
    smooth[index] = value
    if (value < min) min = value
    if (value > max) max = value
  }
  if (max - min < 24) return null
  const half = Math.max(8, Math.round(length / 24))
  const prefix = new Float64Array(length + 1)
  for (let index = 0; index < length; index += 1) prefix[index + 1] = prefix[index] + smooth[index]
  const globalMid = (min + max) / 2
  const out: boolean[] = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const from = Math.max(0, index - half)
    const to = Math.min(length, index + half + 1)
    const local = (prefix[to] - prefix[from]) / (to - from)
    // Lean on the global midpoint in flat stretches (quiet zones), where a
    // local mean would turn paper grain into bars.
    const threshold = 0.6 * local + 0.4 * globalMid
    out[index] = smooth[index] < threshold
  }
  return out
}

/** Distance between measured run widths and a pattern, both scaled to the same total. */
function patternError(widths: readonly number[], pattern: readonly number[], modules: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0)
  if (!total) return Infinity
  const scale = modules / total
  let error = 0
  for (let index = 0; index < pattern.length; index += 1) {
    error += Math.abs(widths[index] * scale - pattern[index])
  }
  return error
}

function bestMatch(
  widths: readonly number[],
  patterns: readonly (readonly number[])[],
  modules: number,
  maxError: number,
): number {
  let best = -1
  let bestError = maxError
  for (let index = 0; index < patterns.length; index += 1) {
    const error = patternError(widths, patterns[index], modules)
    if (error < bestError) {
      bestError = error
      best = index
    }
  }
  return best
}

const digits = (spec: string) => spec.split('').map(Number)

/*==========================================
 * EAN-13 / UPC-A / EAN-8
 *=========================================*/

/** Space-bar-space-bar widths of the odd-parity (L) left-hand digits 0-9. */
const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map(digits)
/** Even parity (G) is L reversed. */
const EAN_G = EAN_L.map((pattern) => [...pattern].reverse())
/** Left-half parity of an EAN-13 per first digit; 1 = G. */
const EAN_FIRST_DIGIT_PARITY = [
  '000000', '001011', '001101', '001110', '010011', '011001', '011100', '010101', '010110', '011010',
]

export function eanCheckDigitValid(code: string): boolean {
  if (!/^\d+$/.test(code)) return false
  const body = code.slice(0, -1)
  let sum = 0
  for (let index = 0; index < body.length; index += 1) {
    // Weights run 3,1,3,1… from the digit nearest the check digit.
    const fromRight = body.length - 1 - index
    sum += Number(body[index]) * (fromRight % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1])
}

const GUARD = [1, 1, 1]
const MIDDLE = [1, 1, 1, 1, 1]

function widthsAt(runs: Run[], start: number, count: number): number[] | null {
  if (start + count > runs.length) return null
  return runs.slice(start, start + count).map((run) => run.width)
}

function guardOk(runs: Run[], start: number, count: number, moduleWidth: number): boolean {
  const widths = widthsAt(runs, start, count)
  if (!widths) return false
  return widths.every((width) => width > moduleWidth * 0.35 && width < moduleWidth * 2.2)
}

function quietBefore(runs: Run[], start: number, moduleWidth: number): boolean {
  return start === 0 || runs[start - 1].width >= moduleWidth * 2.5
}

function decodeEanDigits(
  runs: Run[],
  start: number,
  count: number,
  leftHalf: boolean,
): { digits: number[]; parity: string } | null {
  const out: number[] = []
  let parity = ''
  for (let index = 0; index < count; index += 1) {
    const widths = widthsAt(runs, start + index * 4, 4)
    if (!widths) return null
    if (leftHalf) {
      const l = bestMatch(widths, EAN_L, 7, 2.2)
      const g = bestMatch(widths, EAN_G, 7, 2.2)
      const lError = l < 0 ? Infinity : patternError(widths, EAN_L[l], 7)
      const gError = g < 0 ? Infinity : patternError(widths, EAN_G[g], 7)
      if (l < 0 && g < 0) return null
      if (lError <= gError) {
        out.push(l)
        parity += '0'
      } else {
        out.push(g)
        parity += '1'
      }
    } else {
      const r = bestMatch(widths, EAN_L, 7, 2.2)
      if (r < 0) return null
      out.push(r)
    }
  }
  return { digits: out, parity }
}

function decodeEan13At(runs: Run[], start: number): DecodedBarcode | null {
  if (start + 59 > runs.length || !runs[start].dark) return null
  const total = runs.slice(start, start + 59).reduce((sum, run) => sum + run.width, 0)
  const moduleWidth = total / 95
  if (!quietBefore(runs, start, moduleWidth)) return null
  if (!guardOk(runs, start, 3, moduleWidth) || !guardOk(runs, start + 27, 5, moduleWidth) || !guardOk(runs, start + 56, 3, moduleWidth)) {
    return null
  }
  if (patternError(widthsAt(runs, start, 3)!, GUARD, 3) > 1.2) return null
  if (patternError(widthsAt(runs, start + 27, 5)!, MIDDLE, 5) > 1.6) return null
  const left = decodeEanDigits(runs, start + 3, 6, true)
  const right = decodeEanDigits(runs, start + 32, 6, false)
  if (!left || !right) return null
  const first = EAN_FIRST_DIGIT_PARITY.indexOf(left.parity)
  if (first < 0) return null
  const code = [first, ...left.digits, ...right.digits].join('')
  if (!eanCheckDigitValid(code)) return null
  // An EAN-13 that starts with 0 IS a UPC-A, and a UPC-A is what a keyboard
  // scanner types and what most product records hold: twelve digits.
  return code.startsWith('0') ? { format: 'upc_a', text: code.slice(1) } : { format: 'ean_13', text: code }
}

function decodeEan8At(runs: Run[], start: number): DecodedBarcode | null {
  if (start + 43 > runs.length || !runs[start].dark) return null
  const total = runs.slice(start, start + 43).reduce((sum, run) => sum + run.width, 0)
  const moduleWidth = total / 67
  if (!quietBefore(runs, start, moduleWidth)) return null
  if (!guardOk(runs, start, 3, moduleWidth) || !guardOk(runs, start + 19, 5, moduleWidth) || !guardOk(runs, start + 40, 3, moduleWidth)) {
    return null
  }
  const left = decodeEanDigits(runs, start + 3, 4, true)
  const right = decodeEanDigits(runs, start + 24, 4, false)
  if (!left || !right || left.parity !== '0000') return null
  const code = [...left.digits, ...right.digits].join('')
  return eanCheckDigitValid(code) ? { format: 'ean_8', text: code } : null
}

/*==========================================
 * CODE 128
 *=========================================*/

/** Bar-space widths of symbol values 0-105 (each 11 modules); 106 is STOP (13 modules). */
export const CODE128_PATTERNS: readonly (readonly number[])[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
].map(digits)

const CODE128_DATA = CODE128_PATTERNS.slice(0, 106)
const START_A = 103
const START_B = 104
const START_C = 105
const STOP = CODE128_PATTERNS[106]

function decodeCode128At(runs: Run[], start: number): DecodedBarcode | null {
  if (!runs[start]?.dark) return null
  const startWidths = widthsAt(runs, start, 6)
  if (!startWidths) return null
  const startValue = bestMatch(startWidths, CODE128_DATA, 11, 2.0)
  if (startValue < START_A) return null
  const moduleWidth = startWidths.reduce((sum, width) => sum + width, 0) / 11
  if (!quietBefore(runs, start, moduleWidth)) return null
  const values: number[] = [startValue]
  let at = start + 6
  for (let guard = 0; guard < 60; guard += 1) {
    const widths = widthsAt(runs, at, 6)
    const value = widths ? bestMatch(widths, CODE128_DATA, 11, 2.0) : -1
    const dataError = value >= 0 && widths ? patternError(widths, CODE128_DATA[value], 11) : Infinity
    // STOP is seven runs and ends the symbol at a quiet zone. A data symbol
    // and the bar after it can look like one, so it wins only where it fits
    // better than any data symbol AND white space follows it.
    const stop = widthsAt(runs, at, 7)
    if (stop) {
      const stopError = patternError(stop, STOP, 13)
      const stopModule = stop.reduce((sum, width) => sum + width, 0) / 13
      const after = runs[at + 7]
      const quietAfter = !after || after.width >= moduleWidth * 2.5
      if (stopError < 2.2 && stopError < dataError && quietAfter) {
        if (Math.abs(stopModule - moduleWidth) > moduleWidth * 0.4) return null
        return finishCode128(values)
      }
    }
    if (!widths || value < 0 || value >= START_A) return null
    const symbolModule = widths.reduce((sum, width) => sum + width, 0) / 11
    if (Math.abs(symbolModule - moduleWidth) > moduleWidth * 0.4) return null
    values.push(value)
    at += 6
  }
  return null
}

function finishCode128(values: number[]): DecodedBarcode | null {
  if (values.length < 3) return null
  const check = values[values.length - 1]
  const data = values.slice(1, -1)
  let sum = values[0]
  data.forEach((value, index) => {
    sum += value * (index + 1)
  })
  if (sum % 103 !== check) return null
  let set: 'A' | 'B' | 'C' = values[0] === START_A ? 'A' : values[0] === START_B ? 'B' : 'C'
  let shift = false
  let text = ''
  for (const value of data) {
    const current: 'A' | 'B' | 'C' = shift ? (set === 'A' ? 'B' : 'A') : set
    shift = false
    if (current === 'C') {
      if (value < 100) text += String(value).padStart(2, '0')
      else if (value === 100) set = 'B'
      else if (value === 101) set = 'A'
      // 102 is FNC1 (GS1 framing): nothing to type.
      continue
    }
    if (value < 96) {
      if (current === 'B') text += String.fromCharCode(value + 32)
      else text += String.fromCharCode(value < 64 ? value + 32 : value - 64)
      continue
    }
    if (value === 98) shift = true
    else if (value === 99) set = 'C'
    else if (value === 100 && current === 'A') set = 'B'
    else if (value === 101 && current === 'B') set = 'A'
    // 96, 97 and the remaining FNC codes carry nothing printable.
  }
  // Control characters (set A) are not something a product lookup types.
  text = Array.from(text).filter((char) => char.charCodeAt(0) >= 0x20).join('')
  return text ? { format: 'code_128', text } : null
}

/*==========================================
 * A ROW
 *=========================================*/

const DECODERS = [decodeEan13At, decodeEan8At, decodeCode128At]

function decodeRuns(runs: Run[]): DecodedBarcode | null {
  for (let start = 0; start < runs.length; start += 1) {
    if (!runs[start].dark) continue
    for (const decode of DECODERS) {
      const found = decode(runs, start)
      if (found) return found
    }
  }
  return null
}

/** The barcode in one luminance row, read in either direction, or `null`. */
export function decodeLumaRow(luma: ArrayLike<number>): DecodedBarcode | null {
  const dark = binarizeRow(luma)
  if (!dark) return null
  const runs = rowRuns(dark)
  return decodeRuns(runs) ?? decodeRuns([...runs].reverse())
}

/**
 * The barcode in an RGBA frame (a canvas `ImageData`), sampling horizontal
 * rows across the band a barcode is held in. The middle rows go first: that
 * is where the on-screen guide asks for the label.
 */
export function decodeImageData(
  image: { data: ArrayLike<number>; width: number; height: number },
  options: { rows?: number; band?: number } = {},
): DecodedBarcode | null {
  const { width, height, data } = image
  const rows = options.rows ?? 15
  const band = Math.min(1, Math.max(0.05, options.band ?? 0.5))
  const centre = height / 2
  const spread = (height * band) / 2
  const order: number[] = []
  for (let index = 0; index < rows; index += 1) {
    const step = Math.ceil(index / 2) * (index % 2 ? -1 : 1)
    order.push(Math.round(centre + (step * spread) / Math.ceil(rows / 2)))
  }
  const luma = new Float32Array(width)
  for (const y of order) {
    if (y < 0 || y >= height) continue
    const offset = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const pixel = offset + x * 4
      luma[x] = 0.299 * Number(data[pixel]) + 0.587 * Number(data[pixel + 1]) + 0.114 * Number(data[pixel + 2])
    }
    const found = decodeLumaRow(luma)
    if (found) return found
  }
  return null
}
