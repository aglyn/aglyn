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
 * Reads what the platform needs to know about a font file from its own
 * tables (AGL-3656): the family and style it names, the weight it claims,
 * whether its license lets a web page embed it (OS/2 `fsType`), and the
 * metrics a metric-matched fallback is sized to.
 *
 * An SFNT reader and nothing more — TrueType (`0x00010000`, `true`) and
 * OpenType/CFF (`OTTO`). WOFF and WOFF2 are containers around one, and the
 * caller unwraps them first (`fontverter` on the server); a container handed
 * here is reported as such rather than misread.
 *
 * No imports, so the catalog generator in `tools/` runs it as-is under Node's
 * type stripping, and the browser can run it on a file before it is uploaded.
 */

/** What a font file is, read from its first four bytes. */
export type FontContainer = 'truetype' | 'opentype' | 'woff' | 'woff2' | 'collection' | 'unknown'

export function fontContainer(bytes: Uint8Array): FontContainer {
  if (bytes.length < 4) return 'unknown'
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'OTTO') return 'opentype'
  if (tag === 'ttcf') return 'collection'
  if (tag === 'true') return 'truetype'
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return 'truetype'
  return 'unknown'
}

/**
 * Whether a font's license lets a web page embed it, from OS/2 `fsType`.
 *
 * - `installable` (0) and `editable` (bit 3): embedding is allowed.
 * - `preview-print` (bit 2): the font may be embedded to view and print a
 *   document, which is what a web page does. Allowed, with a warning that the
 *   license may still restrict web use.
 * - `restricted` (bit 1, with no less restrictive bit): the vendor forbids
 *   embedding. Refused.
 * - `bitmap-only` (bit 9): only bitmaps may be embedded, which a web font
 *   cannot be. Refused.
 *
 * Bit 8 (`no-subsetting`) is reported separately: the font may be embedded
 * only whole, so the installer converts it without subsetting.
 */
export type FontEmbedding = 'installable' | 'editable' | 'preview-print' | 'restricted' | 'bitmap-only'

export interface FontEmbeddingVerdict {
  embedding: FontEmbedding
  /** The raw `fsType`, for a support conversation. */
  fsType: number
  allowed: boolean
  /** The license forbids embedding a subset (bit 8). */
  noSubsetting: boolean
}

export function fontEmbeddingVerdict(fsType: number): FontEmbeddingVerdict {
  const noSubsetting = (fsType & 0x0100) !== 0
  let embedding: FontEmbedding
  if ((fsType & 0x0200) !== 0) embedding = 'bitmap-only'
  else if ((fsType & 0x0008) !== 0) embedding = 'editable'
  else if ((fsType & 0x0004) !== 0) embedding = 'preview-print'
  else if ((fsType & 0x0002) !== 0) embedding = 'restricted'
  else embedding = 'installable'
  return {
    embedding,
    fsType,
    allowed: embedding !== 'restricted' && embedding !== 'bitmap-only',
    noSubsetting,
  }
}

/** Vertical metrics and average width, in font units. */
export interface FontFileMetrics {
  unitsPerEm: number
  ascent: number
  descent: number
  lineGap: number
  xWidthAvg: number
}

export interface FontFileFacts {
  container: 'truetype' | 'opentype'
  /** The typographic family (name ID 16), else the legacy family (1). */
  family: string
  /** The typographic subfamily (17), else the legacy one (2): "Bold Italic". */
  subfamily: string
  fullName?: string
  /** OS/2 `usWeightClass`, clamped to 1–1000; 400 when the table is absent. */
  weight: number
  style: 'normal' | 'italic'
  embedding: FontEmbeddingVerdict
  metrics: FontFileMetrics
  /** Variation axes (`fvar`), when the font is variable. */
  axes: Array<{ tag: string; min: number; default: number; max: number }>
  /** How many glyphs the font holds. */
  glyphCount: number
  /** Whether the font maps a code point to a glyph. */
  hasCodePoint(codePoint: number): boolean
}

/** Thrown for a file that is not a font this reader can read. */
export type FontFileErrorCode =
  | 'not-a-font'
  | 'container'
  | 'collection'
  | 'truncated'
  | 'missing-table'

export class FontFileError extends Error {
  readonly code: FontFileErrorCode
  constructor(message: string, code: FontFileErrorCode) {
    super(message)
    this.name = 'FontFileError'
    this.code = code
  }
}

/**
 * English letter frequencies, with the space, as the weights an average
 * advance width is taken over. A font's `xAvgCharWidth` averages every glyph
 * equally (or only the lowercase in old fonts), which does not predict how
 * wide a line of running text is; this does, and the fallback's own average
 * is taken over the same weights, so the ratio between them is what a line of
 * text actually changes by.
 */
const WIDTH_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  [' ', 18.3],
  ['e', 10.2],
  ['t', 7.5],
  ['a', 6.6],
  ['o', 6.2],
  ['n', 5.7],
  ['i', 5.7],
  ['s', 5.3],
  ['r', 5.0],
  ['h', 5.0],
  ['l', 3.3],
  ['d', 3.3],
  ['u', 2.3],
  ['c', 2.3],
  ['m', 2.0],
  ['f', 1.8],
  ['w', 1.7],
  ['g', 1.6],
  ['y', 1.6],
  ['p', 1.5],
  ['b', 1.3],
  ['v', 0.8],
  ['k', 0.6],
  ['x', 0.1],
  ['j', 0.1],
  ['q', 0.1],
  ['z', 0.1],
]

interface TableRecord {
  offset: number
  length: number
}

function readTables(view: DataView): Map<string, TableRecord> {
  if (view.byteLength < 12) throw new FontFileError('The file is too short to be a font.', 'truncated')
  const count = view.getUint16(4)
  if (view.byteLength < 12 + count * 16) {
    throw new FontFileError('The font\'s table directory is cut short.', 'truncated')
  }
  const tables = new Map<string, TableRecord>()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    )
    const offset = view.getUint32(at + 8)
    const length = view.getUint32(at + 12)
    if (offset + length > view.byteLength) {
      throw new FontFileError(`The font's ${tag.trim()} table runs past the end of the file.`, 'truncated')
    }
    tables.set(tag, { offset, length })
  }
  return tables
}

function required(tables: Map<string, TableRecord>, tag: string): TableRecord {
  const table = tables.get(tag)
  if (!table) throw new FontFileError(`The font has no ${tag.trim()} table.`, 'missing-table')
  return table
}

function utf16be(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(view.getUint16(offset + i))
  return out
}

function latin1(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i))
  return out
}

/** Name records by id, preferring Windows English Unicode, then Mac Roman. */
function readNames(view: DataView, table: TableRecord | undefined): Map<number, string> {
  const names = new Map<number, string>()
  if (!table) return names
  const base = table.offset
  const count = view.getUint16(base + 2)
  const storage = base + view.getUint16(base + 4)
  const rank = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const at = base + 6 + i * 12
    if (at + 12 > base + table.length) break
    const platform = view.getUint16(at)
    const encoding = view.getUint16(at + 2)
    const language = view.getUint16(at + 4)
    const id = view.getUint16(at + 6)
    const length = view.getUint16(at + 8)
    const offset = storage + view.getUint16(at + 10)
    if (offset + length > view.byteLength) continue
    let score = 0
    let value: string | undefined
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      score = language === 0x0409 ? 3 : 2
      value = utf16be(view, offset, length)
    } else if (platform === 0) {
      score = 2
      value = utf16be(view, offset, length)
    } else if (platform === 1 && encoding === 0) {
      score = language === 0 ? 1 : 0.5
      value = latin1(view, offset, length)
    }
    // A name with a control character is junk or an attack on whoever prints it.
    if (value === undefined || score <= (rank.get(id) ?? 0)) continue
    const clean = [...value]
      .filter((char) => {
        const code = char.charCodeAt(0)
        return code >= 0x20 && code !== 0x7f
      })
      .join('')
      .trim()
    if (!clean) continue
    names.set(id, clean)
    rank.set(id, score)
  }
  return names
}

/** A code point → glyph id lookup from the best Unicode `cmap` subtable. */
function readCmap(view: DataView, table: TableRecord | undefined): (codePoint: number) => number {
  if (!table) return () => 0
  const base = table.offset
  const count = view.getUint16(base + 2)
  let best: { offset: number; format: number; score: number } | undefined
  for (let i = 0; i < count; i++) {
    const at = base + 4 + i * 8
    const platform = view.getUint16(at)
    const encoding = view.getUint16(at + 2)
    const offset = base + view.getUint32(at + 4)
    if (offset + 2 > view.byteLength) continue
    const format = view.getUint16(offset)
    let score = 0
    if (format === 12 && (platform === 3 || platform === 0)) score = 3
    else if (format === 4 && ((platform === 3 && encoding === 1) || platform === 0)) score = 2
    if (score > (best?.score ?? 0)) best = { offset, format, score }
  }
  if (!best) return () => 0
  const { offset, format } = best
  if (format === 12) {
    const groups = view.getUint32(offset + 12)
    return (codePoint) => {
      let low = 0
      let high = groups - 1
      while (low <= high) {
        const mid = (low + high) >> 1
        const at = offset + 16 + mid * 12
        const start = view.getUint32(at)
        const end = view.getUint32(at + 4)
        if (codePoint < start) high = mid - 1
        else if (codePoint > end) low = mid + 1
        else return view.getUint32(at + 8) + (codePoint - start)
      }
      return 0
    }
  }
  const segments = view.getUint16(offset + 6) / 2
  const ends = offset + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const rangeOffsets = deltas + segments * 2
  return (codePoint) => {
    if (codePoint > 0xffff) return 0
    for (let i = 0; i < segments; i++) {
      const end = view.getUint16(ends + i * 2)
      if (codePoint > end) continue
      const start = view.getUint16(starts + i * 2)
      if (codePoint < start) return 0
      const delta = view.getInt16(deltas + i * 2)
      const rangeOffset = view.getUint16(rangeOffsets + i * 2)
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff
      const at = rangeOffsets + i * 2 + rangeOffset + (codePoint - start) * 2
      if (at + 2 > view.byteLength) return 0
      const glyph = view.getUint16(at)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }
}

/**
 * Reads a TrueType or OpenType font. Throws {@link FontFileError} for
 * anything else, including a WOFF or WOFF2 container the caller should unwrap
 * first, and for a file whose tables are cut short.
 */
export function readFontFile(input: ArrayBuffer | Uint8Array): FontFileFacts {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const container = fontContainer(bytes)
  if (container === 'woff' || container === 'woff2') {
    throw new FontFileError(`A ${container.toUpperCase()} file has to be unwrapped before it is read.`, 'container')
  }
  if (container === 'collection') {
    throw new FontFileError('A font collection (.ttc) holds several fonts; upload them one at a time.', 'collection')
  }
  if (container === 'unknown') throw new FontFileError('The file is not a font.', 'not-a-font')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = readTables(view)

  const head = required(tables, 'head')
  const unitsPerEm = view.getUint16(head.offset + 18)
  const macStyle = view.getUint16(head.offset + 44)

  const hhea = required(tables, 'hhea')
  const ascent = view.getInt16(hhea.offset + 4)
  const descent = view.getInt16(hhea.offset + 6)
  const lineGap = view.getInt16(hhea.offset + 8)
  const advanceCount = view.getUint16(hhea.offset + 34)

  const maxp = tables.get('maxp')
  const glyphCount = maxp ? view.getUint16(maxp.offset + 4) : 0

  const os2 = tables.get('OS/2')
  let weight = 400
  let fsType = 0
  let italic = (macStyle & 0x0002) !== 0
  if (os2 && os2.length >= 64) {
    weight = Math.min(1000, Math.max(1, view.getUint16(os2.offset + 4)))
    fsType = view.getUint16(os2.offset + 8)
    const fsSelection = view.getUint16(os2.offset + 62)
    italic = italic || (fsSelection & 0x0001) !== 0 || (fsSelection & 0x0200) !== 0
  }

  const names = readNames(view, tables.get('name'))
  const family = names.get(16) ?? names.get(1)
  if (!family) throw new FontFileError('The font names no family.', 'missing-table')
  const subfamily = names.get(17) ?? names.get(2) ?? (italic ? 'Italic' : 'Regular')
  if (/italic|oblique/i.test(subfamily)) italic = true

  const glyphOf = readCmap(view, tables.get('cmap'))
  const hmtx = required(tables, 'hmtx')
  const advanceOf = (glyph: number): number => {
    const index = Math.min(glyph, Math.max(0, advanceCount - 1))
    const at = hmtx.offset + index * 4
    return at + 2 <= hmtx.offset + hmtx.length ? view.getUint16(at) : 0
  }
  let weighted = 0
  let total = 0
  for (const [char, share] of WIDTH_WEIGHTS) {
    const glyph = glyphOf(char.codePointAt(0) as number)
    if (!glyph) continue
    weighted += advanceOf(glyph) * share
    total += share
  }
  // A font with none of the Latin letters (a Hebrew or CJK face) has no
  // running-English width to match; the average glyph advance stands in.
  const xWidthAvg = total
    ? Math.round(weighted / total)
    : os2 && os2.length >= 4
      ? view.getInt16(os2.offset + 2)
      : Math.round(unitsPerEm / 2)

  const axes: FontFileFacts['axes'] = []
  const fvar = tables.get('fvar')
  if (fvar) {
    const axesOffset = fvar.offset + view.getUint16(fvar.offset + 4)
    const axisCount = view.getUint16(fvar.offset + 8)
    const axisSize = view.getUint16(fvar.offset + 10)
    const fixed = (at: number) => view.getInt32(at) / 65536
    for (let i = 0; i < axisCount; i++) {
      const at = axesOffset + i * axisSize
      if (at + 20 > fvar.offset + fvar.length) break
      axes.push({
        tag: latin1(view, at, 4),
        min: fixed(at + 4),
        default: fixed(at + 8),
        max: fixed(at + 12),
      })
    }
  }

  return {
    container,
    family,
    subfamily,
    ...(names.get(4) ? { fullName: names.get(4) } : {}),
    weight,
    style: italic ? 'italic' : 'normal',
    embedding: fontEmbeddingVerdict(fsType),
    metrics: { unitsPerEm, ascent, descent, lineGap, xWidthAvg },
    axes,
    glyphCount,
    hasCodePoint: (codePoint) => glyphOf(codePoint) !== 0,
  }
}
