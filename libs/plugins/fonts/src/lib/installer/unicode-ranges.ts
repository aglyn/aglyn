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
 * The scripts an uploaded font is cut down to (AGL-3656), with the
 * `unicode-range` Google Fonts serves each under, so an uploaded face and a
 * catalog face split the same way and a browser downloads a file only for
 * text it is about to draw.
 *
 * Six scripts, the ones a site's own text is overwhelmingly written in.
 * Everything a font holds outside them (symbols, other scripts, private-use
 * glyphs) is left out of the subset; a font that covers none of them is not
 * subset at all, so an icon font or a Hebrew face loses nothing.
 */

export type FontSubsetScript = 'latin' | 'latin-ext' | 'cyrillic' | 'cyrillic-ext' | 'greek' | 'vietnamese'

export interface FontSubsetScriptSpec {
  script: FontSubsetScript
  /** How the installer names the script to a person. */
  label: string
  /** Google's `unicode-range` for the script's file. */
  unicodeRange: string
  /**
   * The letters a font has to draw for the script to count as covered. A font
   * that maps a stray `µ` or `Ω` from Latin-1 or the math block does not
   * thereby cover Greek; one that draws its alphabet does.
   */
  sample: string
}

/** Every code point from `from` to `to`, as a string. */
function run(from: number, to: number): string {
  let out = ''
  for (let codePoint = from; codePoint <= to; codePoint++) out += String.fromCodePoint(codePoint)
  return out
}

/** The scripts in the order a stylesheet lists them. */
export const FONT_SUBSET_SCRIPTS: readonly FontSubsetScriptSpec[] = [
  {
    script: 'cyrillic-ext',
    label: 'Cyrillic Extended',
    unicodeRange: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
    sample: 'ҒғҚқҢңӨөҮүҰұҺһӘә',
  },
  {
    script: 'cyrillic',
    label: 'Cyrillic',
    unicodeRange: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
    sample: run(0x0410, 0x044f),
  },
  {
    script: 'greek',
    label: 'Greek',
    unicodeRange: 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF',
    sample: run(0x0391, 0x03a1) + run(0x03a3, 0x03a9) + run(0x03b1, 0x03c9),
  },
  {
    script: 'vietnamese',
    label: 'Vietnamese',
    unicodeRange:
      'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, ' +
      'U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    sample: 'ĂăĐđƠơƯư' + run(0x1ea0, 0x1ef9),
  },
  {
    script: 'latin-ext',
    label: 'Latin Extended',
    unicodeRange:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, ' +
      'U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    sample: 'ĀāĂăĄąĆćČčĎďĘęĚěĞğŁłŃńŇňŐőŘřŚśŞşŠšŢţŤťŰűŹźŻżŽž',
  },
  {
    script: 'latin',
    label: 'Latin',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, ' +
      'U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    // Lowercase only: an all-caps display face still draws a Latin page.
    sample: run(0x61, 0x7a),
  },
]

/** The share of a script's sample a font must draw for the script to be kept. */
export const SCRIPT_COVERAGE_THRESHOLD = 0.8

/** A `unicode-range` as inclusive code point intervals. */
export function parseUnicodeRange(range: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const part of range.split(',')) {
    const match = /^\s*U\+([0-9A-Fa-f]{1,6})(?:-([0-9A-Fa-f]{1,6}))?\s*$/.exec(part)
    if (!match) continue
    const from = parseInt(match[1], 16)
    const to = match[2] ? parseInt(match[2], 16) : from
    if (to >= from) out.push([from, to])
  }
  return out
}

/** Whether a font draws enough of a script's sample to keep the script. */
export function coversScript(spec: FontSubsetScriptSpec, hasCodePoint: (codePoint: number) => boolean): boolean {
  const letters = Array.from(spec.sample)
  const drawn = letters.filter((letter) => hasCodePoint(letter.codePointAt(0) as number)).length
  return letters.length > 0 && drawn / letters.length >= SCRIPT_COVERAGE_THRESHOLD
}

export interface FontSubsetPlan {
  /** The scripts the font covers, in stylesheet order. Empty: do not subset. */
  scripts: FontSubsetScript[]
  /** Every code point to keep: the ones the font draws inside those scripts' ranges. */
  text: string
  /** The `unicode-range` the subset file is declared with; empty when not subset. */
  unicodeRange: string
}

/**
 * What to keep of a font: the scripts it covers among
 * {@link FONT_SUBSET_SCRIPTS}, and every code point it draws inside their
 * ranges. A range is declared whole even where the font lacks a glyph, which
 * is what Google does too: the browser then falls back per character.
 */
export function planFontSubset(hasCodePoint: (codePoint: number) => boolean): FontSubsetPlan {
  const covered = FONT_SUBSET_SCRIPTS.filter((spec) => coversScript(spec, hasCodePoint))
  if (!covered.length) return { scripts: [], text: '', unicodeRange: '' }
  const kept = new Set<number>()
  for (const spec of covered) {
    for (const [from, to] of parseUnicodeRange(spec.unicodeRange)) {
      for (let codePoint = from; codePoint <= to; codePoint++) {
        if (hasCodePoint(codePoint)) kept.add(codePoint)
      }
    }
  }
  const text = Array.from(kept)
    .sort((a, b) => a - b)
    .map((codePoint) => String.fromCodePoint(codePoint))
    .join('')
  return {
    scripts: covered.map((spec) => spec.script),
    text,
    unicodeRange: mergeUnicodeRanges(covered.map((spec) => spec.unicodeRange)),
  }
}

const hex = (codePoint: number) => codePoint.toString(16).toUpperCase().padStart(4, '0')

/** The union of several `unicode-range`s, sorted and with overlaps folded. */
export function mergeUnicodeRanges(ranges: readonly string[]): string {
  const intervals = ranges.flatMap(parseUnicodeRange).sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [from, to] of intervals) {
    const last = merged[merged.length - 1]
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged.map(([from, to]) => (from === to ? `U+${hex(from)}` : `U+${hex(from)}-${hex(to)}`)).join(', ')
}

/** How a person reads a list of scripts: "Latin, Latin Extended and Cyrillic". */
export function describeScripts(scripts: readonly FontSubsetScript[]): string {
  const labels = FONT_SUBSET_SCRIPTS.filter((spec) => scripts.includes(spec.script))
    .reverse()
    .map((spec) => spec.label)
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
