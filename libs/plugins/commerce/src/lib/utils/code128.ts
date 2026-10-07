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

/*==========================================
 * CODE 128, AS AN SVG (AGL-3609).
 *
 * The receipt prints the order number as a barcode so the register's return
 * lookup can scan it back: a keyboard-wedge scanner types the digits and
 * presses Enter, exactly as it does for a product. Code 128 because every
 * scanner reads it and a short number stays short — an even run of digits
 * packs two to a symbol in code set C.
 *
 * Each symbol is six alternating bar and space widths (bar first) adding up
 * to eleven modules; the stop symbol has a seventh bar. The check symbol is
 * the start value plus each data value times its position, modulo 103.
 *=========================================*/

/** Bar/space widths of symbols 0–106, ISO/IEC 15417. */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const STOP = 106

/**
 * The symbol values for `text`: code set C for an even run of digits, B for
 * anything else printable (ASCII 32–126). Throws on a character code 128
 * cannot carry in set B rather than printing a barcode that scans as
 * something else.
 */
export function code128Values(text: string): number[] {
  const value = String(text ?? '')
  if (!value) throw new Error('Nothing to encode')
  const useC = /^\d+$/.test(value) && value.length % 2 === 0
  const data: number[] = []
  if (useC) {
    for (let at = 0; at < value.length; at += 2) data.push(Number(value.slice(at, at + 2)))
  } else {
    for (const character of value) {
      const code = character.charCodeAt(0)
      if (code < 32 || code > 126) throw new Error(`Cannot encode "${character}" in a barcode`)
      data.push(code - 32)
    }
  }
  const start = useC ? START_C : START_B
  const checksum = data.reduce((sum, symbol, index) => sum + symbol * (index + 1), start) % 103
  return [start, ...data, checksum, STOP]
}

/** The barcode as module widths, bar first, quiet zones not included. */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((symbol) =>
    [...(CODE128_PATTERNS[symbol] ?? '')].map(Number),
  )
}

/**
 * An SVG of the barcode: black bars on white with a ten-module quiet zone
 * each side, sized in modules so the printer's own resolution decides the
 * physical width. `crispEdges` keeps a thermal head from smearing a bar.
 */
export function code128Svg(
  text: string,
  options: { height?: number; moduleWidth?: number; title?: string } = {},
): string {
  const moduleWidth = options.moduleWidth ?? 2
  const height = options.height ?? 60
  const quiet = 10
  const widths = code128Widths(text)
  const totalModules = widths.reduce((sum, width) => sum + width, 0) + quiet * 2
  let x = quiet
  const bars: string[] = []
  widths.forEach((width, index) => {
    if (index % 2 === 0) {
      bars.push(
        `<rect x="${x * moduleWidth}" y="0" width="${width * moduleWidth}" height="${height}"/>`,
      )
    }
    x += width
  })
  const title = String(options.title ?? text).replace(/[<>&"]/g, '')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}" ` +
    `viewBox="0 0 ${totalModules * moduleWidth} ${height}" ` +
    `width="${totalModules * moduleWidth}" height="${height}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join('')}</g></svg>`
  )
}
