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
 * A PDF's document metadata, read and written back without touching a
 * byte of its page content (AGL-3331). Section numbers are ISO 32000-2.
 *
 * ## What is read
 *
 * The document information dictionary the trailer's `/Info` names
 * (§14.3.3), the catalog's `/Metadata` XMP stream (§14.3.2), the page count
 * (`/Root /Pages /Count`), the version, and whether the file is encrypted
 * (§7.6) or signed (§12.8) — the two things that make it read-only.
 *
 * ## How the file is navigated
 *
 * From the last `startxref`, through every cross-reference section on the
 * `/Prev` chain, newest first, the first definition of an object winning
 * (§7.5.6 incremental updates):
 *
 * - classic `xref` tables with their `trailer` (§7.5.4, §7.5.5);
 * - cross-reference streams (§7.5.8), Flate-compressed with a PNG predictor
 *   as most writers leave them;
 * - hybrid files, whose table's trailer points at a supplementary stream
 *   with `/XRefStm` (§7.5.8.4);
 * - linearized files (Annex F), which need no special case: their final
 *   `startxref` names the first-page section, whose `/Prev` is the rest;
 * - objects compressed into object streams (§7.5.7).
 *
 * A file whose cross-reference data does not hold up — a bad offset, a
 * section that does not parse, a `/Prev` loop — is still READ, from a
 * bounded scan for `N G obj` headers and the last trailer, but it is never
 * WRITTEN: an update chained onto a table we had to guess at could make the
 * file worse for every reader that trusted the table.
 *
 * ## How an edit is written
 *
 * As an incremental update (§7.5.6): the new object definitions, a new
 * cross-reference section of the kind the file already ends with, and a
 * trailer whose `/Prev` points at the old one — all APPENDED. The original
 * bytes are a byte-for-byte prefix of the output, which is what guarantees
 * page content, fonts and images are untouched, and what lets any reader
 * that ignores the update still open the file as it was. An encrypted file
 * (its strings are ciphertext) or a signed one (the update would break the
 * signature) is refused with an {@link EmbeddedWriteError}.
 */

import {
  decodePdfStream,
  decodePdfTextString,
  encodePdfTextString,
  indexOfBytes,
  lastIndexOfBytes,
  latin1Bytes,
  latin1Text,
  PDF_NULL,
  PdfLexer,
  pdfNameFromText,
  pdfNameText,
  PdfParser,
  serializePdfObject,
  type PdfDict,
  type PdfObject,
  type PdfRef,
  type PdfStream,
  type PdfToken,
} from './pdf-objects'
import { EmbeddedWriteError } from './types'

export interface PdfMetadataRead {
  /**
   * Document-info entries, in the file's order. Text strings are decoded
   * (PDFDocEncoding, UTF-16BE with BOM, UTF-8 with BOM per PDF 2.0);
   * `CreationDate` and `ModDate` become ISO 8601, with a zone only when the
   * file recorded one. A name value (`/Trapped /True`) reads as its text and
   * any other non-string value as its PDF syntax, both `editable: false`.
   * Empty for an encrypted file, whose strings are ciphertext.
   */
  info: Array<{ name: string; value: string; editable: boolean }>
  /**
   * The catalog's `/Metadata` stream as text. Unfiltered or FlateDecode;
   * any other filter, and an encrypted file, read as `null`.
   */
  xmp: string | null
  /** `/Root /Pages /Count`. */
  pageCount: number | null
  /** The header's `%PDF-x.y`, or the catalog's `/Version` when later (§7.2.2 note, Table 29). */
  version: string | null
  /** The trailer has `/Encrypt`. */
  encrypted: boolean
  /**
   * The file carries a signature, or might: a `/ByteRange` anywhere, a
   * signature field with a value, AcroForm `/SigFlags` 1 or 2, or catalog
   * `/Perms`. Conservative on purpose — a false positive only makes the
   * file read-only; a false negative lets an edit break a signature.
   */
  signed: boolean
}

export interface PdfMetadataUpdate {
  /**
   * Document-info entries by raw name (`Title`, `Author`, `Subject`,
   * `Keywords`, `Creator`, `Producer`, `CreationDate`, `ModDate`, or any
   * custom name as {@link readPdf} spelled it). `null` removes the entry.
   * `CreationDate`/`ModDate` take ISO 8601.
   */
  info: Record<string, string | null>
  /** A replacement XMP packet for the catalog's `/Metadata` stream. */
  xmp?: string
}

/** Cross-reference sections followed along `/Prev` before giving up. */
const MAX_SECTIONS = 512
/** Cross-reference entries kept; far more than a 25 MB file can hold. */
const MAX_XREF_ENTRIES = 1 << 21
/** Decoded size of one cross-reference or object stream. */
const MAX_STRUCTURE_BYTES = 64 * 1024 * 1024
/** Decoded size of the XMP stream. */
const MAX_XMP_BYTES = 16 * 1024 * 1024
/** Objects one object stream may declare. */
const MAX_OBJSTM_OBJECTS = 1 << 20
/** `N G obj` headers the repair scan records. */
const MAX_SCAN_OBJECTS = 1 << 21
/** Objects being loaded at once (a `/Length` inside a stream inside …). */
const MAX_LOAD_NESTING = 16
/** Links followed from a reference to a reference. */
const MAX_REF_CHAIN = 16
/** AcroForm field nodes visited looking for a signature. */
const MAX_FIELD_NODES = 20_000
/** Longest non-string Info value shown as PDF syntax. */
const MAX_VALUE_TEXT = 4096
/** Annex C.2: the most indirect objects a conforming reader must handle. */
const MAX_OBJECT_NUMBER = 8_388_607

const DATE_KEYS = new Set(['CreationDate', 'ModDate'])

type XrefEntry =
  | { type: 0 }
  | { type: 1; offset: number; gen: number }
  | { type: 2; stream: number; index: number }

interface XrefSection {
  offset: number
  kind: 'table' | 'stream'
  trailer: PdfDict
  entries: Array<[number, XrefEntry]>
}

interface ObjectStream {
  data: Uint8Array
  first: number
  /** Object numbers and offsets (from `first`) in header order. */
  numbers: number[]
  offsets: number[]
}

interface ObjectHeader {
  num: number
  gen: number
  offset: number
}

const ascii = (text: string) => latin1Bytes(text)
const STARTXREF = ascii('startxref')
const OBJ = ascii('obj')
const TRAILER = ascii('trailer')
const XREF_TYPE = ascii('/XRef')
const OBJSTM_TYPE = ascii('/ObjStm')
const CATALOG_TYPE = ascii('/Catalog')
const BYTE_RANGE = ascii('/ByteRange')

function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39
}

function isSpace(b: number): boolean {
  return b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20
}

/** Whether `b` can continue a keyword — so `pattern` found before it is only a prefix. */
function continuesWord(b: number): boolean {
  if (b < 0) return false
  return !isSpace(b) && !'()<>[]{}/%'.includes(String.fromCharCode(b))
}

/** A non-negative safe integer, or `null`. */
function intValue(obj: PdfObject | undefined): number | null {
  return obj?.kind === 'number' && Number.isSafeInteger(obj.value) && obj.value >= 0
    ? obj.value
    : null
}

function isInt(token: PdfToken): token is { type: 'number'; value: number; text: string } {
  return token.type === 'number' && /^\d+$/.test(token.text)
}

function asDict(obj: PdfObject | undefined): PdfDict | null {
  if (obj?.kind === 'dict') return obj
  if (obj?.kind === 'stream') return obj.dict
  return null
}

function nameIs(obj: PdfObject | undefined, name: string): boolean {
  return obj?.kind === 'name' && obj.name === name
}

/**
 * One part of a read, so a failure in it costs only that part. Nothing
 * below is expected to throw — it is bounded and total — but a read of
 * hostile bytes is where "expected" deserves a backstop.
 */
function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/** §7.5.2: `%PDF-x.y`, which Acrobat accepts anywhere in the first 1024 bytes. */
function findHeader(bytes: Uint8Array): { offset: number; version: string | null } | null {
  const offset = indexOfBytes(bytes, ascii('%PDF-'), 0, 1024 + 5)
  if (offset < 0) return null
  const head = latin1Text(bytes.subarray(offset + 5, offset + 16))
  const match = /^(\d{1,2})\.(\d{1,2})/.exec(head)
  return { offset, version: match ? `${Number(match[1])}.${Number(match[2])}` : null }
}

/** The byte offset after the file's LAST `startxref` (§7.5.5), or `null`. */
function findStartxref(bytes: Uint8Array): number | null {
  const at = lastIndexOfBytes(bytes, STARTXREF)
  if (at < 0) return null
  const token = new PdfLexer(bytes, at + STARTXREF.length).next()
  return isInt(token) ? token.value : null
}

/** A big-endian unsigned field of a cross-reference stream entry. */
function readField(data: Uint8Array, at: number, width: number): number {
  let value = 0
  for (let i = 0; i < width; i++) value = value * 256 + (data[at + i] ?? 0)
  return value
}

/** The `N G` before an `obj` keyword at `at`, walking back over at most a few bytes. */
function headerBefore(bytes: Uint8Array, at: number): ObjectHeader | null {
  let j = at - 1
  const skipSpace = () => {
    const stop = j - 64
    if (!isSpace(bytes[j] ?? -1)) return false
    while (j > stop && isSpace(bytes[j] ?? -1)) j--
    return true
  }
  const digits = (max: number) => {
    const end = j
    while (end - j < max && isDigit(bytes[j] ?? -1)) j--
    if (end === j) return null
    let value = 0
    for (let k = j + 1; k <= end; k++) value = value * 10 + ((bytes[k] ?? 0x30) - 0x30)
    return value
  }
  if (!skipSpace()) return null
  const gen = digits(5)
  if (gen === null || !skipSpace()) return null
  const num = digits(10)
  if (num === null) return null
  if (j >= 0 && continuesWord(bytes[j] ?? -1)) return null
  return { num, gen, offset: j + 1 }
}

/**
 * The file, navigated. Objects load lazily and are cached; everything a
 * reader asks of it returns `null` rather than throwing.
 */
class PdfFile {
  readonly entries = new Map<number, XrefEntry>()
  /** The sections on the `/Prev` chain, newest first. */
  readonly sections: XrefSection[] = []
  /** Every trailer dictionary seen; `/Encrypt` in any of them counts. */
  readonly trailers: PdfDict[] = []
  /** The newest trailer — the one whose `/Root` and `/Info` are current. */
  trailer: PdfDict | null = null
  /** The offset the final `startxref` gives. */
  startxref = -1
  /**
   * Set when anything had to be found some way other than through a sound
   * cross-reference chain. A repaired file is read, never written.
   */
  repaired = false

  private readonly cache = new Map<number, PdfObject | null>()
  private readonly loading = new Set<number>()
  private readonly objectStreams = new Map<number, ObjectStream | null>()
  private scanned: { headers: ObjectHeader[]; latest: Map<number, ObjectHeader> } | null =
    null

  constructor(
    readonly bytes: Uint8Array,
    readonly headerOffset: number,
    readonly headerVersion: string | null,
  ) {}

  /** The `/Root` reference and the catalog it names. */
  root(): { ref: PdfRef; catalog: PdfDict } | null {
    const ref = this.trailer?.entries.get('Root')
    if (ref?.kind !== 'ref') return null
    const catalog = this.resolve(ref)
    return catalog?.kind === 'dict' ? { ref, catalog } : null
  }

  /** The `/Info` dictionary, when the newest trailer names one. */
  info(): PdfDict | null {
    const info = this.resolve(this.trailer?.entries.get('Info'))
    return info?.kind === 'dict' ? info : null
  }

  encrypted(): boolean {
    return this.trailers.some((trailer) => trailer.entries.has('Encrypt'))
  }

  /** Follows references to a direct object; a dangling one is `null` (§7.3.10). */
  readonly resolve = (obj: PdfObject | undefined): PdfObject | undefined => {
    let value = obj
    for (let i = 0; value?.kind === 'ref' && i < MAX_REF_CHAIN; i++) {
      value = this.getObject(value.num) ?? PDF_NULL
    }
    return value?.kind === 'ref' ? PDF_NULL : value
  }

  getObject(num: number): PdfObject | null {
    if (!Number.isSafeInteger(num) || num < 0) return null
    const cached = this.cache.get(num)
    if (cached !== undefined) return cached
    if (this.loading.has(num) || this.loading.size >= MAX_LOAD_NESTING) return null
    this.loading.add(num)
    let obj: PdfObject | null
    try {
      obj = this.loadObject(num)
    } finally {
      this.loading.delete(num)
    }
    this.cache.set(num, obj)
    return obj
  }

  private loadObject(num: number): PdfObject | null {
    const entry = this.entries.get(num)
    if (entry?.type === 0) return null
    if (entry?.type === 1) {
      const obj = this.parseAt(entry.offset, num)
      if (obj) return obj
      this.repaired = true
    } else if (entry?.type === 2) {
      const obj = this.loadCompressed(entry.stream, entry.index, num)
      if (obj) return obj
      this.repaired = true
    }
    // Not in the table (a dangling reference is legal), or not where the
    // table says: look for it by scanning.
    const header = this.scan().latest.get(num)
    if (!header) return null
    this.repaired = true
    return this.parseAt(header.offset, num)
  }

  private parseAt(offset: number, num: number): PdfObject | null {
    const tryAt = (at: number) => {
      if (!(at >= 0 && at < this.bytes.length)) return null
      const parser = new PdfParser(this.bytes, at, {
        resolveLength: (ref) => intValue(this.resolve(ref) ?? undefined),
      })
      const parsed = parser.parseIndirectObject()
      return parsed && parsed.num === num ? parsed.obj : null
    }
    const obj = tryAt(offset)
    if (obj || this.headerOffset === 0) return obj
    // Offsets counted from the header rather than the file's first byte.
    const shifted = tryAt(offset + this.headerOffset)
    if (shifted) this.repaired = true
    return shifted
  }

  private loadCompressed(stream: number, index: number, num: number): PdfObject | null {
    const objstm = this.objectStream(stream)
    if (!objstm) return null
    let at = objstm.numbers[index] === num ? index : objstm.numbers.indexOf(num)
    if (at < 0) return null
    const offset = objstm.offsets[at]
    if (offset === undefined) return null
    at = objstm.first + offset
    if (at >= objstm.data.length) return null
    return new PdfParser(objstm.data, at).parseObject()
  }

  /** §7.5.7: an object stream's header of `N` number/offset pairs. */
  private objectStream(num: number): ObjectStream | null {
    if (this.objectStreams.has(num)) return this.objectStreams.get(num) ?? null
    this.objectStreams.set(num, null)
    // A stream is never itself compressed; one claiming to be is a loop.
    if (this.entries.get(num)?.type === 2) return null
    const obj = this.getObject(num)
    if (obj?.kind !== 'stream') return null
    const n = intValue(obj.dict.entries.get('N'))
    const first = intValue(obj.dict.entries.get('First'))
    if (n === null || first === null || n > MAX_OBJSTM_OBJECTS) return null
    const data = decodePdfStream(obj, this.resolve, MAX_STRUCTURE_BYTES)
    if (!data || first > data.length) return null
    const lexer = new PdfLexer(data, 0, first)
    const numbers: number[] = []
    const offsets: number[] = []
    for (let i = 0; i < n; i++) {
      const a = lexer.next()
      const b = lexer.next()
      if (!isInt(a) || !isInt(b)) break
      numbers.push(a.value)
      offsets.push(b.value)
    }
    const objstm = { data, first, numbers, offsets }
    this.objectStreams.set(num, objstm)
    return objstm
  }

  /** The next free object number for an appended object. */
  nextObjectNumber(): number {
    let next = Math.max(1, intValue(this.trailer?.entries.get('Size')) ?? 0)
    for (const num of this.entries.keys()) if (num >= next) next = num + 1
    return next
  }

  // -------------------------------------------------------------------------
  // The cross-reference chain

  /** Reads the `/Prev` chain from the last `startxref`. `false` when it does not hold up. */
  readXref(): boolean {
    const start = findStartxref(this.bytes)
    if (start === null) return false
    this.startxref = start
    const visited = new Set<number>()
    let offset: number | null = start
    while (offset !== null) {
      if (visited.has(offset) || visited.size >= MAX_SECTIONS) {
        // A /Prev loop: what was read stands, but the file is not sound.
        this.repaired = true
        break
      }
      visited.add(offset)
      const section = this.readSection(offset)
      if (!section) return false
      const local = new Map(section.entries)
      if (section.kind === 'table') {
        // §7.5.8.4: a hybrid file's table lists the objects a PDF 1.4
        // reader can find; the stream its /XRefStm names adds the ones in
        // object streams, which the table marks free.
        const stmOffset = intValue(section.trailer.entries.get('XRefStm'))
        if (stmOffset !== null && !visited.has(stmOffset)) {
          visited.add(stmOffset)
          const stm = this.readSection(stmOffset)
          if (stm?.kind !== 'stream') return false
          for (const [num, entry] of stm.entries) {
            if (local.get(num)?.type !== 1) local.set(num, entry)
          }
        }
      }
      for (const [num, entry] of local) {
        if (!this.entries.has(num)) this.entries.set(num, entry)
      }
      if (this.entries.size > MAX_XREF_ENTRIES) return false
      this.sections.push(section)
      this.trailers.push(section.trailer)
      const prev = intValue(section.trailer.entries.get('Prev'))
      // Some writers put /Prev 0 on a file's only section; 0 is the header.
      offset = prev ? prev : null
    }
    this.trailer = this.sections[0]?.trailer ?? null
    return this.trailer !== null
  }

  private readSection(offset: number): XrefSection | null {
    if (!(offset >= 0 && offset < this.bytes.length)) return null
    const lexer = new PdfLexer(this.bytes, offset)
    return lexer.peekKeyword('xref')
      ? this.readTable(lexer, offset)
      : this.readXrefStream(offset)
  }

  /** §7.5.4: `xref`, subsections of `start count` and 20-byte entries, then `trailer`. */
  private readTable(lexer: PdfLexer, offset: number): XrefSection | null {
    lexer.next()
    const entries: Array<[number, XrefEntry]> = []
    while (!lexer.peekKeyword('trailer')) {
      const startToken = lexer.next()
      const countToken = lexer.next()
      if (!isInt(startToken) || !isInt(countToken)) return null
      let start = startToken.value
      const count = countToken.value
      if (entries.length + count > MAX_XREF_ENTRIES) return null
      for (let i = 0; i < count; i++) {
        const a = lexer.next()
        const b = lexer.next()
        const t = lexer.next()
        if (!isInt(a) || !isInt(b) || t.type !== 'keyword') return null
        if (t.text !== 'n' && t.text !== 'f') return null
        // A common writer bug numbers the first subsection from 1 although
        // it opens with object 0's free-list head; pdf.js and Poppler shift it.
        if (i === 0 && start === 1 && t.text === 'f' && a.value === 0 && b.value === 65535) {
          start = 0
        }
        entries.push([
          start + i,
          t.text === 'n' && a.value > 0
            ? { type: 1, offset: a.value, gen: b.value }
            : { type: 0 },
        ])
      }
    }
    lexer.next()
    const trailer = new PdfParser(this.bytes, lexer.pos).parseObject()
    if (trailer?.kind !== 'dict') return null
    return { offset, kind: 'table', trailer, entries }
  }

  /**
   * §7.5.8: an indirect stream object with `/Type /XRef`. Its entries are
   * `/W`-wide big-endian fields, listed for the `/Index` ranges (default
   * `[0 Size]`). Its dictionary entries are direct (§7.5.8.2), so nothing
   * here resolves a reference.
   */
  private readXrefStream(offset: number): XrefSection | null {
    const parsed = new PdfParser(this.bytes, offset).parseIndirectObject()
    if (parsed?.obj.kind !== 'stream') return null
    const stream: PdfStream = parsed.obj
    const dict = stream.dict.entries
    if (!nameIs(dict.get('Type'), 'XRef')) return null
    const direct = (obj: PdfObject | undefined) => obj
    const data = decodePdfStream(stream, direct, MAX_STRUCTURE_BYTES)
    const w = dict.get('W')
    if (!data || w?.kind !== 'array' || w.items.length < 3) return null
    const widths = w.items.slice(0, 3).map((item) => intValue(item))
    const [w0, w1, w2] = widths
    if (w0 == null || w1 == null || w2 == null) return null
    if (w0 > 4 || w1 > 8 || w2 > 8 || w0 + w1 + w2 === 0) return null
    const size = intValue(dict.get('Size')) ?? 0
    const index = dict.get('Index')
    const ranges =
      index?.kind === 'array' ? index.items.map((item) => intValue(item)) : [0, size]
    if (ranges.length % 2 || ranges.some((value) => value === null)) return null
    const width = w0 + w1 + w2
    const entries: Array<[number, XrefEntry]> = []
    let at = 0
    for (let r = 0; r < ranges.length; r += 2) {
      const first = ranges[r] ?? 0
      const count = ranges[r + 1] ?? 0
      for (let i = 0; i < count && at + width <= data.length; i++, at += width) {
        if (entries.length >= MAX_XREF_ENTRIES) return null
        // §7.5.8.3: a missing type field means type 1.
        const type = w0 ? readField(data, at, w0) : 1
        const a = readField(data, at + w0, w1)
        const b = readField(data, at + w0 + w1, w2)
        entries.push([
          first + i,
          type === 1
            ? { type: 1, offset: a, gen: b }
            : type === 2
              ? { type: 2, stream: a, index: b }
              : { type: 0 },
        ])
      }
    }
    return { offset, kind: 'stream', trailer: stream.dict, entries }
  }

  // -------------------------------------------------------------------------
  // Repair

  /** Every `N G obj` header in the file, bounded; the last one per number wins. */
  private scan(): { headers: ObjectHeader[]; latest: Map<number, ObjectHeader> } {
    if (this.scanned) return this.scanned
    const headers: ObjectHeader[] = []
    const latest = new Map<number, ObjectHeader>()
    const { bytes } = this
    for (
      let at = indexOfBytes(bytes, OBJ);
      at >= 0 && headers.length < MAX_SCAN_OBJECTS;
      at = indexOfBytes(bytes, OBJ, at + OBJ.length)
    ) {
      if (continuesWord(bytes[at + OBJ.length] ?? -1)) continue
      const header = headerBefore(bytes, at)
      if (!header) continue
      headers.push(header)
      latest.set(header.num, header)
    }
    this.scanned = { headers, latest }
    return this.scanned
  }

  /** The object whose header is the last one before `at`. */
  private objectAround(at: number): ObjectHeader | null {
    const { headers } = this.scan()
    let lo = 0
    let hi = headers.length - 1
    let found: ObjectHeader | null = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const header = headers[mid]
      if (!header) break
      if (header.offset < at) {
        found = header
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found
  }

  /**
   * Every occurrence of `pattern` as a whole token: not continued by a
   * regular character, and — for a keyword, which unlike a name does not
   * open with its own delimiter — not preceded by one either.
   */
  private *occurrences(pattern: Uint8Array): Generator<number> {
    const keyword = pattern[0] !== 0x2f
    let count = 0
    for (
      let at = indexOfBytes(this.bytes, pattern);
      at >= 0 && count < MAX_SCAN_OBJECTS;
      at = indexOfBytes(this.bytes, pattern, at + pattern.length)
    ) {
      count++
      if (continuesWord(this.bytes[at + pattern.length] ?? -1)) continue
      if (keyword && continuesWord(this.bytes[at - 1] ?? -1)) continue
      yield at
    }
  }

  /**
   * Rebuilds the object table from a scan when the cross-reference data
   * does not hold up, as Poppler and pdf.js do: the last definition of each
   * object in file order, including those in object streams, and the last
   * trailer (classic or cross-reference stream) whose `/Root` is a
   * dictionary — or, failing that, the last `/Type /Catalog` object.
   */
  rebuild(): void {
    this.repaired = true
    this.entries.clear()
    this.cache.clear()
    this.objectStreams.clear()
    this.sections.length = 0
    this.trailer = null
    const { headers } = this.scan()
    for (const h of headers) this.entries.set(h.num, { type: 1, offset: h.offset, gen: h.gen })

    // Object streams add their objects at the stream's own position, so
    // the last definition in file order still wins.
    const compressed: Array<{ at: number; num: number; entry: XrefEntry }> = []
    for (const at of this.occurrences(OBJSTM_TYPE)) {
      const header = this.objectAround(at)
      if (!header) continue
      const objstm = this.objectStream(header.num)
      objstm?.numbers.forEach((num, index) =>
        compressed.push({ at: header.offset, num, entry: { type: 2, stream: header.num, index } }),
      )
    }
    if (compressed.length) {
      compressed.sort((a, b) => a.at - b.at)
      this.entries.clear()
      this.cache.clear()
      let next = 0
      for (const h of headers) {
        for (; next < compressed.length && (compressed[next]?.at ?? Infinity) < h.offset; next++) {
          const def = compressed[next]
          if (def) this.entries.set(def.num, def.entry)
        }
        this.entries.set(h.num, { type: 1, offset: h.offset, gen: h.gen })
      }
      for (; next < compressed.length; next++) {
        const def = compressed[next]
        if (def) this.entries.set(def.num, def.entry)
      }
    }

    const candidates: Array<{ at: number; dict: PdfDict }> = []
    for (const at of this.occurrences(TRAILER)) {
      const dict = new PdfParser(this.bytes, at + TRAILER.length).parseObject()
      if (dict?.kind === 'dict') candidates.push({ at, dict })
    }
    for (const at of this.occurrences(XREF_TYPE)) {
      const header = this.objectAround(at)
      const obj = header && this.getObject(header.num)
      if (obj?.kind === 'stream' && nameIs(obj.dict.entries.get('Type'), 'XRef')) {
        candidates.push({ at, dict: obj.dict })
      }
    }
    candidates.sort((a, b) => a.at - b.at)
    for (const candidate of candidates) this.trailers.push(candidate.dict)
    for (let i = candidates.length - 1; i >= 0 && !this.trailer; i--) {
      const dict = candidates[i]?.dict
      const root = dict?.entries.get('Root')
      if (dict && root?.kind === 'ref' && this.resolve(root)?.kind === 'dict') {
        this.trailer = dict
      }
    }
    if (this.trailer) return

    let catalog: PdfRef | null = null
    for (const at of this.occurrences(CATALOG_TYPE)) {
      const header = this.objectAround(at)
      const obj = header && this.getObject(header.num)
      if (header && obj?.kind === 'dict' && nameIs(obj.entries.get('Type'), 'Catalog')) {
        catalog = { kind: 'ref', num: header.num, gen: header.gen }
      }
    }
    let checked = 0
    for (const [num, entry] of this.entries) {
      if (entry.type !== 2 || ++checked > 100_000) continue
      const obj = this.getObject(num)
      if (obj?.kind === 'dict' && nameIs(obj.entries.get('Type'), 'Catalog')) {
        catalog = { kind: 'ref', num, gen: 0 }
      }
    }
    if (catalog) {
      const last = candidates.at(-1)?.dict
      const entries = new Map(last?.entries ?? [])
      entries.set('Root', catalog)
      this.trailer = { kind: 'dict', entries }
    }
  }
}

/** Opens the file: its cross-reference chain, or a rebuild from a scan. */
function openPdf(bytes: Uint8Array): PdfFile | null {
  const header = findHeader(bytes)
  if (!header) return null
  const file = new PdfFile(bytes, header.offset, header.version)
  if (!file.readXref() || !file.root()) file.rebuild()
  return file
}

// ---------------------------------------------------------------------------
// Dates (§7.9.4)

/**
 * `D:YYYYMMDDHHmmSSOHH'mm'`, every field after the year optional, the
 * apostrophes forgiven (writers disagree on the trailing one). `Z` may be
 * followed by a redundant `00'00'`.
 */
const PDF_DATE =
  /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz])(?:00'?(?:00'?)?)?|([+-])(\d{2})'?(?:(\d{2})'?)?)?$/

/**
 * A PDF date as ISO 8601, or `null` when it is not one. Missing month and
 * day default to 01 (§7.9.4); a time is shown only when the date has one,
 * and a zone only when both were recorded — never invented.
 */
export function pdfDateToIso(text: string): string | null {
  const trimmed = text.trim()
  const match = PDF_DATE.exec(trimmed)
  if (!match) return null
  const [, year, month = '01', day = '01', hour, minute = '00', second = '00', utc, sign, zh, zm = '00'] =
    match
  const inRange = (value: string | undefined, min: number, max: number) =>
    value === undefined || (Number(value) >= min && Number(value) <= max)
  if (
    !inRange(month, 1, 12) ||
    !inRange(day, 1, 31) ||
    !inRange(hour, 0, 23) ||
    !inRange(minute, 0, 59) ||
    !inRange(second, 0, 59) ||
    !inRange(zh, 0, 23) ||
    !inRange(zm, 0, 59)
  ) {
    return null
  }
  let iso = `${year}-${month}-${day}`
  if (hour === undefined) return iso
  iso += `T${hour}:${minute}:${second}`
  if (sign && zh !== undefined) return `${iso}${sign}${zh}:${zm}`
  return utc ? `${iso}Z` : iso
}

const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** ISO 8601 as a PDF date (§7.9.4), or `null` when it is not ISO. */
export function isoToPdfDate(value: string): string | null {
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second = '00', zone] = match
  let date = `D:${year}${month}${day}`
  if (hour === undefined) return date
  date += `${hour}${minute}${second}`
  if (zone === 'Z') return `${date}Z`
  if (zone) return `${date}${zone.slice(0, 3)}'${zone.slice(4)}'`
  return date
}

// ---------------------------------------------------------------------------
// Reading

function readInfo(file: PdfFile, info: PdfDict | null): PdfMetadataRead['info'] {
  const out: PdfMetadataRead['info'] = []
  if (!info) return out
  for (const [key, raw] of info.entries) {
    const value = file.resolve(raw)
    const name = pdfNameText(key)
    if (!value || value.kind === 'null' || value.kind === 'stream') continue
    if (value.kind === 'string') {
      const text = decodePdfTextString(value.bytes)
      const date = DATE_KEYS.has(key) ? pdfDateToIso(text) : null
      out.push({ name, value: date ?? text, editable: true })
    } else if (value.kind === 'name') {
      out.push({ name, value: pdfNameText(value.name), editable: false })
    } else {
      const text = serializePdfObject(value)
      out.push({
        name,
        value: text.length > MAX_VALUE_TEXT ? `${text.slice(0, MAX_VALUE_TEXT)}…` : text,
        editable: false,
      })
    }
  }
  return out
}

/** XMP packets are UTF-8, -16 or -32 (XMP part 1 §7.1); PDF writers use UTF-8. */
function xmpText(data: Uint8Array): string {
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data)
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data)
  return new TextDecoder('utf-8').decode(data)
}

function readXmp(file: PdfFile, catalog: PdfDict | null): string | null {
  const metadata = file.resolve(catalog?.entries.get('Metadata'))
  if (metadata?.kind !== 'stream') return null
  const data = decodePdfStream(metadata, file.resolve, MAX_XMP_BYTES)
  return data ? xmpText(data) : null
}

function readPageCount(file: PdfFile, catalog: PdfDict | null): number | null {
  const pages = asDict(file.resolve(catalog?.entries.get('Pages')))
  return intValue(file.resolve(pages?.entries.get('Count')))
}

function readVersion(file: PdfFile, catalog: PdfDict | null): string | null {
  const header = file.headerVersion
  const version = file.resolve(catalog?.entries.get('Version'))
  const match = version?.kind === 'name' ? /^(\d{1,2})\.(\d{1,2})$/.exec(version.name) : null
  if (!match) return header
  const catalogVersion = `${Number(match[1])}.${Number(match[2])}`
  if (!header) return catalogVersion
  const [hMajor = 0, hMinor = 0] = header.split('.').map(Number)
  const later = Number(match[1]) * 100 + Number(match[2]) > hMajor * 100 + hMinor
  return later ? catalogVersion : header
}

/**
 * Whether the file is, or may be, signed. A signature dictionary cannot
 * live in an object stream — its `/ByteRange` must exclude `/Contents` in
 * the file's own bytes — so a raw scan for `/ByteRange` finds every real
 * signature and some false alarms, which is the side to err on. The
 * catalog checks catch signed-looking structure the scan cannot.
 */
function readSigned(file: PdfFile, catalog: PdfDict | null): boolean {
  if (indexOfBytes(file.bytes, BYTE_RANGE) >= 0) return true
  if (!catalog) return false
  // §12.8.4: /Perms holds DocMDP and usage-rights (UR3) signatures.
  if (catalog.entries.has('Perms')) return true
  const acroForm = asDict(file.resolve(catalog.entries.get('AcroForm')))
  if (!acroForm) return false
  // §12.7.3 Table 225: bit 1 SignaturesExist, bit 2 AppendOnly.
  const flags = intValue(file.resolve(acroForm.entries.get('SigFlags'))) ?? 0
  if (flags & 3) return true
  const fields = file.resolve(acroForm.entries.get('Fields'))
  if (fields?.kind !== 'array') return false
  const stack: Array<{ node: PdfObject; sig: boolean }> = fields.items.map((node) => ({
    node,
    sig: false,
  }))
  const seen = new Set<number>()
  for (let visited = 0; stack.length; visited++) {
    // Unsure after this many nodes: say signed.
    if (visited > MAX_FIELD_NODES) return true
    const next = stack.pop()
    if (!next) break
    if (next.node.kind === 'ref') {
      if (seen.has(next.node.num)) continue
      seen.add(next.node.num)
    }
    const field = asDict(file.resolve(next.node))
    if (!field) continue
    // /FT is inheritable (§12.7.4.1), so a kid inherits its parent's type.
    const ft = file.resolve(field.entries.get('FT'))
    const sig = ft ? nameIs(ft, 'Sig') : next.sig
    // A value that is there but does not resolve still counts: unsure.
    const value = field.entries.get('V')
    if (sig && value && value.kind !== 'null') return true
    const kids = file.resolve(field.entries.get('Kids'))
    if (kids?.kind === 'array') {
      for (const kid of kids.items) stack.push({ node: kid, sig })
    }
  }
  return false
}

/**
 * The metadata a PDF carries, or `null` when the bytes are not a PDF or
 * nothing in them could be found — neither a catalog nor an Info
 * dictionary. Never throws.
 */
export function readPdf(bytes: Uint8Array): PdfMetadataRead | null {
  const file = attempt(() => openPdf(bytes), null)
  if (!file) return null
  const catalog = attempt(() => file.root()?.catalog ?? null, null)
  const info = attempt(() => file.info(), null)
  if (!catalog && !info) return null
  const encrypted = attempt(() => file.encrypted(), true)
  return {
    info: encrypted ? [] : attempt(() => readInfo(file, info), []),
    xmp: encrypted ? null : attempt(() => readXmp(file, catalog), null),
    pageCount: attempt(() => readPageCount(file, catalog), null),
    version: attempt(() => readVersion(file, catalog), file.headerVersion),
    encrypted,
    signed: attempt(() => readSigned(file, catalog), true),
  }
}

// ---------------------------------------------------------------------------
// Writing

const DAMAGED =
  "This PDF's internal index is damaged, so an edit cannot be written into it safely."

/** An Info key as name bytes, matching an existing entry's spelling when there is one. */
function infoKey(entries: Map<string, PdfObject>, key: string): string {
  for (const existing of entries.keys()) {
    if (pdfNameText(existing) === key) return existing
  }
  const name = pdfNameFromText(key)
  if (!key || key.includes('\u0000') || name.length > 127) {
    // Annex C.2: 127 bytes is the longest name a reader must accept.
    throw new EmbeddedWriteError(`"${key.slice(0, 40)}" cannot be used as a PDF field name.`)
  }
  return name
}

function infoValue(key: string, value: string): PdfObject {
  if (DATE_KEYS.has(key)) {
    const date = isoToPdfDate(value)
    if (date) return { kind: 'string', bytes: latin1Bytes(date), hex: false }
  }
  // §14.3.3 Table 349: /Trapped is a name.
  if (key === 'Trapped' && /^(?:True|False|Unknown)$/.test(value)) {
    return { kind: 'name', name: value }
  }
  return encodePdfTextString(value)
}

interface NewObject {
  ref: PdfRef
  /** What the object must read back as. */
  expect: PdfObject
  body: Uint8Array
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function dictObject(ref: PdfRef, dict: PdfDict): NewObject {
  return {
    ref,
    expect: dict,
    body: latin1Bytes(`${ref.num} ${ref.gen} obj\n${serializePdfObject(dict)}\nendobj\n`),
  }
}

/** §14.3.2: an uncompressed metadata stream, so any tool can find the packet. */
function metadataObject(ref: PdfRef, data: Uint8Array): NewObject {
  const dict: PdfDict = {
    kind: 'dict',
    entries: new Map<string, PdfObject>([
      ['Type', { kind: 'name', name: 'Metadata' }],
      ['Subtype', { kind: 'name', name: 'XML' }],
      ['Length', { kind: 'number', value: data.length, text: String(data.length) }],
    ]),
  }
  return {
    ref,
    expect: { kind: 'stream', dict, data },
    body: concat([
      latin1Bytes(`${ref.num} ${ref.gen} obj\n${serializePdfObject(dict)}\nstream\n`),
      data,
      latin1Bytes('\nendstream\nendobj\n'),
    ]),
  }
}

/** Consecutive object numbers grouped into `[start, count]` subsections. */
function subsections<T extends { num: number }>(items: T[]): Array<{ start: number; items: T[] }> {
  const runs: Array<{ start: number; items: T[] }> = []
  for (const item of [...items].sort((a, b) => a.num - b.num)) {
    const run = runs.at(-1)
    if (run && run.start + run.items.length === item.num) run.items.push(item)
    else runs.push({ start: item.num, items: [item] })
  }
  return runs
}

function sameObject(actual: PdfObject | null, expected: PdfObject): boolean {
  if (!actual) return false
  if (expected.kind === 'stream') {
    if (actual.kind !== 'stream') return false
    const { data } = expected
    return (
      actual.data.length === data.length &&
      actual.data.every((b, i) => b === data[i]) &&
      serializePdfObject(actual.dict) === serializePdfObject(expected.dict)
    )
  }
  return serializePdfObject(actual) === serializePdfObject(expected)
}

/**
 * Writes an edit as an incremental update (§7.5.6) appended to `bytes`.
 * Returns the new file; `bytes` is a prefix of it. Throws
 * {@link EmbeddedWriteError} for a file that is not a PDF, is encrypted or
 * signed, or whose cross-reference data had to be repaired to be read —
 * and, as a last line, when the output does not read back as written.
 */
export function writePdf(bytes: Uint8Array, update: PdfMetadataUpdate): Uint8Array {
  const file = attempt(() => openPdf(bytes), null)
  if (!file) throw new EmbeddedWriteError('This file could not be read as a PDF, so it was left as it was.')
  if (file.encrypted()) {
    throw new EmbeddedWriteError('This PDF is encrypted, so its details cannot be changed.')
  }
  const root = attempt(() => file.root(), null)
  if (attempt(() => readSigned(file, root?.catalog ?? null), true)) {
    throw new EmbeddedWriteError(
      'This PDF is digitally signed; changing it would invalidate the signature.',
    )
  }
  const patch = Object.entries(update.info ?? {})
  if (!patch.length && update.xmp === undefined) return bytes.slice()
  const trailer = file.trailer
  if (!root || !trailer) throw new EmbeddedWriteError(DAMAGED)

  let next = file.nextObjectNumber()
  const objects: NewObject[] = []

  // The Info dictionary: every entry it has, the patch applied in place.
  let infoRef: PdfObject | undefined = trailer.entries.get('Info')
  if (patch.length) {
    const current = asDict(file.resolve(infoRef))
    const entries = new Map(current?.entries ?? [])
    for (const [key, value] of patch) {
      if (value === undefined) continue
      const name = infoKey(entries, key)
      if (value === null) entries.delete(name)
      else entries.set(name, infoValue(name, value))
    }
    const ref: PdfRef = infoRef?.kind === 'ref' ? infoRef : { kind: 'ref', num: next++, gen: 0 }
    infoRef = ref
    objects.push(dictObject(ref, { kind: 'dict', entries }))
  }

  // The XMP stream: redefined in place, or added and linked from a
  // redefinition of the catalog that keeps every other entry it had.
  if (update.xmp !== undefined) {
    const data = new TextEncoder().encode(update.xmp)
    const existing = root.catalog.entries.get('Metadata')
    const ref: PdfRef =
      existing?.kind === 'ref' ? existing : { kind: 'ref', num: next++, gen: 0 }
    objects.push(metadataObject(ref, data))
    if (existing?.kind !== 'ref') {
      const entries = new Map(root.catalog.entries)
      entries.set('Metadata', ref)
      objects.push(dictObject(root.ref, { kind: 'dict', entries }))
    }
  }

  // Everything above resolved through the table; only now is it known
  // whether any of it had to be found another way.
  if (file.repaired || file.headerOffset !== 0 || file.startxref <= 0) {
    throw new EmbeddedWriteError(DAMAGED)
  }
  const nums = new Set(objects.map((o) => o.ref.num))
  if (
    nums.size !== objects.length ||
    objects.some((o) => o.ref.num < 1 || o.ref.gen > 65535) ||
    next > MAX_OBJECT_NUMBER
  ) {
    throw new EmbeddedWriteError(DAMAGED)
  }

  // §7.5.6: the update starts on a line of its own.
  const last = bytes[bytes.length - 1]
  const chunks: Uint8Array[] = [bytes]
  if (last !== 0x0a && last !== 0x0d) chunks.push(latin1Bytes('\n'))
  let offset = bytes.length + (chunks.length - 1)
  const placed: Array<{ num: number; gen: number; offset: number }> = []
  for (const object of objects) {
    placed.push({ num: object.ref.num, gen: object.ref.gen, offset })
    chunks.push(object.body)
    offset += object.body.length
  }
  const xrefOffset = offset
  if (xrefOffset > 0xffffffff) {
    throw new EmbeddedWriteError('This PDF is too large to take an edit.')
  }

  const trailerEntries = new Map<string, PdfObject>()
  const setSize = (size: number) =>
    trailerEntries.set('Size', { kind: 'number', value: size, text: String(size) })
  const size = Math.max(next, ...placed.map((p) => p.num + 1))
  setSize(size)
  trailerEntries.set('Root', root.ref)
  if (infoRef) trailerEntries.set('Info', infoRef)
  trailerEntries.set('Prev', {
    kind: 'number',
    value: file.startxref,
    text: String(file.startxref),
  })
  const id = file.sections.map((s) => s.trailer.entries.get('ID')).find(Boolean)
  if (id) trailerEntries.set('ID', id)

  if (file.sections[0]?.kind === 'stream') {
    // §7.5.8: a cross-reference stream, uncompressed, listing itself.
    const xrefNum = next
    if (xrefNum > MAX_OBJECT_NUMBER) throw new EmbeddedWriteError(DAMAGED)
    placed.push({ num: xrefNum, gen: 0, offset: xrefOffset })
    const runs = subsections(placed)
    const data = new Uint8Array(placed.length * 7)
    let at = 0
    for (const run of runs) {
      for (const entry of run.items) {
        data[at] = 1
        data[at + 1] = (entry.offset >>> 24) & 0xff
        data[at + 2] = (entry.offset >>> 16) & 0xff
        data[at + 3] = (entry.offset >>> 8) & 0xff
        data[at + 4] = entry.offset & 0xff
        data[at + 5] = (entry.gen >>> 8) & 0xff
        data[at + 6] = entry.gen & 0xff
        at += 7
      }
    }
    const int = (value: number): PdfObject => ({ kind: 'number', value, text: String(value) })
    const dict = new Map<string, PdfObject>([['Type', { kind: 'name', name: 'XRef' }]])
    setSize(Math.max(size, xrefNum + 1))
    for (const [key, value] of trailerEntries) dict.set(key, value)
    dict.set('W', { kind: 'array', items: [int(1), int(4), int(2)] })
    dict.set('Index', {
      kind: 'array',
      items: runs.flatMap((run) => [int(run.start), int(run.items.length)]),
    })
    dict.set('Length', int(data.length))
    chunks.push(
      latin1Bytes(
        `${xrefNum} 0 obj\n${serializePdfObject({ kind: 'dict', entries: dict })}\nstream\n`,
      ),
      data,
      latin1Bytes(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`),
    )
  } else {
    // §7.5.4: each entry exactly 20 bytes, `nnnnnnnnnn ggggg n` and a
    // two-byte end of line.
    let table = 'xref\n'
    for (const run of subsections(placed)) {
      table += `${run.start} ${run.items.length}\n`
      for (const entry of run.items) {
        table += `${String(entry.offset).padStart(10, '0')} ${String(entry.gen).padStart(5, '0')} n\r\n`
      }
    }
    table += `trailer\n${serializePdfObject({ kind: 'dict', entries: trailerEntries })}\n`
    table += `startxref\n${xrefOffset}\n%%EOF\n`
    chunks.push(latin1Bytes(table))
  }
  const output = concat(chunks)

  // Read the result back the way the next reader will. Anything short of
  // a sound chain holding exactly what was written means the update is
  // not what it claims to be, and the original stays as it was.
  const check = attempt(() => openPdf(output), null)
  const verified =
    check !== null &&
    attempt(
      () =>
        check.root()?.ref.num === root.ref.num &&
        objects.every((o) => sameObject(check.getObject(o.ref.num), o.expect)) &&
        !check.repaired &&
        check.sections.length === file.sections.length + 1,
      false,
    )
  if (!verified) {
    throw new EmbeddedWriteError(
      'The edited PDF did not read back as written, so the file was left as it was.',
    )
  }
  return output
}
