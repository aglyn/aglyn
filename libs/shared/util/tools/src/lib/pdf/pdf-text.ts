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
 * TEXT IN A HAND-WRITTEN PDF: the standard Helvetica faces in WinAnsi.
 *
 * The standard 14 fonts need no embedding, and every reader draws them, but
 * they hold one byte per character: WinAnsi, which is Latin-1 plus a row of
 * typographic marks (curly quotes, dashes, the bullet, the euro). Everything
 * here turns arbitrary text into that byte set FIRST, so a string that
 * reaches a content stream can never carry a byte the font has no glyph for:
 *
 *   - a character WinAnsi holds is kept as it is;
 *   - a known look-alike is swapped in (`−` → `-`, `→` → `->`, `ł` → `l`,
 *     odd spaces → a space, zero-width marks → nothing);
 *   - an accented letter outside Latin-1 loses its accent (`ă` → `a`) and a
 *     compatibility form its styling (`ﬁ` → `fi`, `Ａ` → `A`);
 *   - emoji, pictographs and stray combining marks are dropped;
 *   - anything else (another script) prints `?`.
 *
 * Widths are Adobe's published metrics for Helvetica and Helvetica-Bold
 * (Helvetica-Oblique shares Helvetica's), in thousandths of the font size,
 * so text measured here right-aligns where a reader draws it.
 *
 * Reached as `@aglyn/shared-util-tools/pdf/pdf-text`; not re-exported from
 * the package root.
 *=========================================*/

/** The three faces a document may set text in. */
export type PdfFont = 'regular' | 'bold' | 'italic'

/** Unicode code points WinAnsi holds at 0x80–0x9F, and their bytes. */
const WIN_ANSI_HIGH: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
}

/** Characters WinAnsi lacks, read as the nearest text it has. */
const STAND_INS: Readonly<Record<string, string>> = {
  '\t': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '　': ' ',
  '​': '',
  '‌': '',
  '‍': '',
  '⁠': '',
  '﻿': '',
  '‐': '-',
  '‑': '-',
  '‒': '–',
  '―': '—',
  '−': '-',
  '⁃': '-',
  '′': "'",
  '″': '"',
  '‵': "'",
  '‛': "'",
  '‟': '"',
  'ʼ': '’',
  'ʹ': "'",
  '‣': '•',
  '●': '•',
  '▪': '•',
  '◦': 'o',
  '○': 'o',
  '∙': '·',
  '⁄': '/',
  '←': '<-',
  '→': '->',
  '↔': '<->',
  '⇒': '=>',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '≈': '~',
  '№': 'No.',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '₹': 'Rs',
  '₩': 'W',
  '₪': 'NIS',
  '₽': 'RUB',
  '₱': 'PHP',
  '₺': 'TL',
  '₫': 'd',
  '₦': 'N',
  '₴': 'UAH',
  'Ł': 'L',
  'ł': 'l',
  'Đ': 'D',
  'đ': 'd',
  'Ħ': 'H',
  'ħ': 'h',
  'ı': 'i',
  'Ŀ': 'L',
  'ŀ': 'l',
  'Ŋ': 'N',
  'ŋ': 'n',
  'Ŧ': 'T',
  'ŧ': 't',
  'ſ': 's',
  'Ĳ': 'IJ',
  'ĳ': 'ij',
  'ȷ': 'j',
  'Ə': 'E',
  'ə': 'e',
}

/** Whether WinAnsi holds this one character. */
function encodable(code: number): boolean {
  return (code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_HIGH[code] !== undefined
}

/** Marks with no glyph of their own in a text font: combining accents, variation selectors, emoji, private use. */
function dropped(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xfe20 && code <= 0xfe2f) ||
    (code >= 0x2600 && code <= 0x27bf) ||
    (code >= 0x2b00 && code <= 0x2bff) ||
    (code >= 0xe000 && code <= 0xf8ff) ||
    code >= 0x1f000 ||
    code < 32 ||
    (code >= 0x7f && code < 0xa0)
  )
}

/** One character as text WinAnsi holds, without the decomposition fallback. */
function direct(char: string): string | null {
  const code = char.codePointAt(0) ?? 0
  if (encodable(code)) return char
  const standIn = STAND_INS[char]
  if (standIn !== undefined) return standIn
  if (dropped(code)) return ''
  return null
}

/**
 * `text` as characters WinAnsi holds, line breaks kept (`\r\n` and `\r`
 * become `\n`). Text that is already WinAnsi comes back unchanged.
 */
export function toWinAnsiText(text: string): string {
  const source = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
  let out = ''
  for (const char of source) {
    if (char === '\n') {
      out += char
      continue
    }
    const kept = direct(char)
    if (kept !== null) {
      out += kept
      continue
    }
    // An accented letter or a compatibility form: its parts, accents dropped.
    let parts = ''
    let readable = true
    for (const part of char.normalize('NFKD')) {
      const mapped = direct(part)
      if (mapped === null) {
        readable = false
        break
      }
      parts += mapped
    }
    out += readable && parts ? parts : '?'
  }
  return out
}

/** One character's WinAnsi byte, `?` (63) for a character WinAnsi does not hold. */
export function winAnsiByte(char: string): number {
  const code = char.codePointAt(0) ?? 63
  if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) return code
  return WIN_ANSI_HIGH[code] ?? 63
}

/**
 * A PDF string literal's body for `text`: WinAnsi bytes, `\`, `(` and `)`
 * escaped, and every byte outside printable ASCII as an octal escape, so the
 * literal itself is plain ASCII. A line break prints as a space.
 */
export function pdfString(text: string): string {
  let out = ''
  for (const char of toWinAnsiText(text)) {
    const byte = char === '\n' ? 32 : winAnsiByte(char)
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) out += `\\${String.fromCharCode(byte)}`
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(byte)
  }
  return out
}

/*==========================================
 * WIDTHS
 *=========================================*/

/** Helvetica advance widths for WinAnsi bytes 32–255, 1/1000 em; 0 where WinAnsi has no character. */
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
]

/** Helvetica-Bold advance widths for WinAnsi bytes 32–255, 1/1000 em. */
const HELVETICA_BOLD: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
]

/** `text`'s width in points at `size`, as a reader draws it in `font`. */
export function measureText(text: string, size: number, font: PdfFont = 'regular'): number {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA
  let total = 0
  for (const char of toWinAnsiText(text)) {
    if (char === '\n') continue
    total += table[winAnsiByte(char) - 32] ?? 556
  }
  return (total / 1000) * size
}

/** Words wrapped into lines no wider than `width` by `measure`; an overlong word is broken. */
function wrapWith(text: string, width: number, measure: (line: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      while (measure(word) > width) {
        let cut = word.length - 1
        while (cut > 1 && measure(word.slice(0, cut)) > width) cut -= 1
        if (line) {
          lines.push(line)
          line = ''
        }
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const next = line ? `${line} ${word}` : word
      if (measure(next) > width && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/**
 * `text` wrapped to `width` points at `size` in `font`, by the exact widths.
 * Each `\n` starts a new line; a blank line comes back as `''`.
 */
export function wrapLines(text: string, size: number, width: number, font: PdfFont = 'regular'): string[] {
  return wrapWith(toWinAnsiText(text), width, (line) => measureText(line, size, font))
}

/*==========================================
 * THE QUICK ESTIMATE
 *
 * The first hand-written document (the waivers plugin's signed copy) wraps by
 * this cheaper estimate: Helvetica's widths for ASCII, an em-ish 556 for the
 * rest, and bold as 7% wider. It stays as it was so that document's bytes
 * never move; new layouts use `measureText` and `wrapLines`.
 *=========================================*/

function estimatedWidth(byte: number): number {
  if (byte >= 32 && byte <= 126) return HELVETICA[byte - 32]
  if (byte === 0x95) return 350
  if (byte === 0x97 || byte === 0x85) return 1000
  return 556
}

/** A string's estimated width in points at `size`; bold runs 7% wider. */
export function textWidth(text: string, size: number, bold = false): number {
  let total = 0
  for (const char of toWinAnsiText(text)) total += estimatedWidth(winAnsiByte(char))
  return (total / 1000) * size * (bold ? 1.07 : 1)
}

/** Words wrapped by {@link textWidth} into lines no wider than `width`; an overlong word is broken. */
export function wrapText(text: string, size: number, width: number, bold = false): string[] {
  return wrapWith(text, width, (line) => textWidth(line, size, bold))
}
