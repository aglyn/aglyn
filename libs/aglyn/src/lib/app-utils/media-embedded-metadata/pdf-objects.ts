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
 * The object layer under the PDF metadata reader and writer (AGL-3331).
 *
 * - A tokenizer and parser for the COS syntax of ISO 32000-2 §7.2–§7.3:
 *   names, literal and hexadecimal strings, numbers, arrays, dictionaries,
 *   indirect references, `stream`…`endstream` bodies, booleans and null.
 * - A serializer that writes a parsed object back out faithfully, so a
 *   dictionary the writer re-emits (a catalog gaining `/Metadata`, an Info
 *   dictionary with one entry changed) keeps every other entry as it was.
 * - The text-string codec of §7.9.2.2 (PDFDocEncoding, UTF-16BE, UTF-8).
 * - FlateDecode with the §7.4.4.4 predictors — the only filter a reader of
 *   cross-reference streams, object streams and metadata streams needs.
 *
 * ## Hostile input
 *
 * Every byte here comes from an uploaded file. Nothing in this module
 * throws on malformed input: the parser returns `null` for what it cannot
 * read, nesting is capped at {@link PDF_MAX_DEPTH}, one object may spend at
 * most {@link PDF_MAX_TOKENS} tokens, every offset is checked against the
 * buffer, and inflation is capped by the caller's `maxOutputLength`.
 */

import { constants, inflateRawSync, inflateSync } from 'zlib'

export interface PdfNull {
  kind: 'null'
}
export interface PdfBoolean {
  kind: 'boolean'
  value: boolean
}
export interface PdfNumber {
  kind: 'number'
  value: number
  /** As written, so `0.50` reserializes as `0.50` rather than `0.5`. */
  text: string
}
export interface PdfString {
  kind: 'string'
  /** The string's bytes after escape processing (§7.3.4). */
  bytes: Uint8Array
  /** Written as `<…>` rather than `(…)`; kept so reserializing is faithful. */
  hex: boolean
}
export interface PdfName {
  kind: 'name'
  /**
   * The name's BYTES after `#xx` decoding (§7.3.5), one char per byte.
   * {@link pdfNameText} turns it into display text.
   */
  name: string
}
export interface PdfArray {
  kind: 'array'
  items: PdfObject[]
}
export interface PdfDict {
  kind: 'dict'
  /** Keyed by name bytes like {@link PdfName.name}; insertion-ordered. */
  entries: Map<string, PdfObject>
}
export interface PdfRef {
  kind: 'ref'
  num: number
  gen: number
}
export interface PdfStream {
  kind: 'stream'
  dict: PdfDict
  /** The ENCODED data, a view into the buffer it was parsed from. */
  data: Uint8Array
}

/** A PDF object as parsed (ISO 32000-2 §7.3). */
export type PdfObject =
  | PdfNull
  | PdfBoolean
  | PdfNumber
  | PdfString
  | PdfName
  | PdfArray
  | PdfDict
  | PdfRef
  | PdfStream

export const PDF_NULL: PdfNull = { kind: 'null' }

/** Deepest array/dictionary nesting the parser follows. */
export const PDF_MAX_DEPTH = 64
/** Tokens one object may consume before the parser gives up on it. */
export const PDF_MAX_TOKENS = 2_000_000
/** Longest name or bare keyword kept; the rest of the run is skipped. */
const MAX_WORD = 4096

// §7.2.3 character classes: 0 regular, 1 white-space, 2 delimiter.
const CHAR_CLASS = new Uint8Array(256)
for (const b of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) CHAR_CLASS[b] = 1
for (const c of '()<>[]{}/%') CHAR_CLASS[c.charCodeAt(0)] = 2

/** A byte of `bytes`, or -1 outside `[0, end)`. */
function byteAt(bytes: Uint8Array, i: number, end = bytes.length): number {
  return i >= 0 && i < end ? (bytes[i] ?? -1) : -1
}

export function isPdfWhitespace(b: number): boolean {
  return b >= 0 && b < 256 && CHAR_CLASS[b] === 1
}

function isRegular(b: number): boolean {
  return b >= 0 && b < 256 && CHAR_CLASS[b] === 0
}

function hexValue(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30
  if (b >= 0x41 && b <= 0x46) return b - 0x37
  if (b >= 0x61 && b <= 0x66) return b - 0x57
  return -1
}

/** Bytes as a binary string, one char per byte. */
export function latin1Text(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return out
}

/** A binary string (chars 0–255) as bytes. */
export function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/** The first index of `needle` in `bytes[from, to)`, or -1. */
export function indexOfBytes(
  bytes: Uint8Array,
  needle: Uint8Array,
  from = 0,
  to = bytes.length,
): number {
  const first = needle[0]
  if (first === undefined) return -1
  const last = Math.min(to, bytes.length) - needle.length
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    if (bytes[i] !== first) continue
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** The last index of `needle` in `bytes` starting at or before `from`. */
export function lastIndexOfBytes(
  bytes: Uint8Array,
  needle: Uint8Array,
  from = bytes.length - needle.length,
): number {
  const first = needle[0]
  if (first === undefined) return -1
  outer: for (let i = Math.min(from, bytes.length - needle.length); i >= 0; i--) {
    if (bytes[i] !== first) continue
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** A growable byte buffer for string bodies of unknown length. */
class ByteSink {
  private buf = new Uint8Array(64)
  length = 0
  push(b: number): void {
    if (this.length === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2)
      next.set(this.buf)
      this.buf = next
    }
    this.buf[this.length++] = b
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

export type PdfToken =
  | { type: 'eof' }
  | { type: 'number'; value: number; text: string }
  | { type: 'keyword'; text: string }
  | { type: 'name'; name: string }
  | { type: 'string'; bytes: Uint8Array; hex: boolean }
  | { type: 'punct'; text: '[' | ']' | '<<' | '>>' | '{' | '}' }

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/
const INTEGER = /^\d+$/

/** The §7.2 tokenizer. `end` is exclusive; nothing is read past it. */
export class PdfLexer {
  pos: number
  readonly end: number

  constructor(
    readonly bytes: Uint8Array,
    pos = 0,
    end = bytes.length,
  ) {
    this.end = Math.max(0, Math.min(end, bytes.length))
    this.pos = Math.max(0, pos)
  }

  private at(i: number): number {
    return byteAt(this.bytes, i, this.end)
  }

  /** Skips white-space and `%` comments (§7.2.4). */
  skipSpace(): void {
    for (;;) {
      const b = this.at(this.pos)
      if (b < 0) return
      if (isPdfWhitespace(b)) {
        this.pos++
      } else if (b === 0x25) {
        while (this.pos < this.end) {
          const c = this.at(this.pos)
          if (c === 0x0a || c === 0x0d) break
          this.pos++
        }
      } else {
        return
      }
    }
  }

  /** Whether `word` is the next token, as a whole keyword. */
  peekKeyword(word: string): boolean {
    this.skipSpace()
    for (let i = 0; i < word.length; i++) {
      if (this.at(this.pos + i) !== word.charCodeAt(i)) return false
    }
    return !isRegular(this.at(this.pos + word.length))
  }

  next(): PdfToken {
    this.skipSpace()
    const b = this.at(this.pos)
    if (b < 0) return { type: 'eof' }
    switch (b) {
      case 0x2f: // '/'
        return this.name()
      case 0x28: // '('
        return this.literalString()
      case 0x3c: // '<'
        if (this.at(this.pos + 1) === 0x3c) {
          this.pos += 2
          return { type: 'punct', text: '<<' }
        }
        return this.hexString()
      case 0x3e: // '>'
        if (this.at(this.pos + 1) === 0x3e) {
          this.pos += 2
          return { type: 'punct', text: '>>' }
        }
        this.pos++
        return { type: 'keyword', text: '>' }
      case 0x5b:
        this.pos++
        return { type: 'punct', text: '[' }
      case 0x5d:
        this.pos++
        return { type: 'punct', text: ']' }
      case 0x7b:
        this.pos++
        return { type: 'punct', text: '{' }
      case 0x7d:
        this.pos++
        return { type: 'punct', text: '}' }
      case 0x29: // a stray ')'
        this.pos++
        return { type: 'keyword', text: ')' }
    }
    let text = ''
    while (isRegular(this.at(this.pos))) {
      if (text.length < MAX_WORD) text += String.fromCharCode(this.at(this.pos))
      this.pos++
    }
    if (NUMBER.test(text)) {
      const value = Number(text)
      if (Number.isFinite(value)) return { type: 'number', value, text }
    }
    return { type: 'keyword', text }
  }

  /** §7.3.5: a name, with `#xx` escapes decoded to bytes. */
  private name(): PdfToken {
    this.pos++
    let name = ''
    while (isRegular(this.at(this.pos))) {
      let b = this.at(this.pos)
      if (b === 0x23) {
        const hi = hexValue(this.at(this.pos + 1))
        const lo = hexValue(this.at(this.pos + 2))
        if (hi >= 0 && lo >= 0) {
          b = hi * 16 + lo
          this.pos += 2
        }
      }
      if (name.length < MAX_WORD) name += String.fromCharCode(b)
      this.pos++
    }
    return { type: 'name', name }
  }

  /**
   * §7.3.4.2: a literal string. Balanced parentheses nest; `\` escapes
   * `n r t b f ( ) \`, one to three octal digits, and an end-of-line (a
   * line continuation, which contributes nothing). An unescaped CR, LF or
   * CRLF reads as a single LF. An unterminated string ends at the buffer.
   */
  private literalString(): PdfToken {
    this.pos++
    const out = new ByteSink()
    let depth = 1
    while (this.pos < this.end) {
      const b = this.at(this.pos++)
      if (b === 0x28) {
        depth++
        out.push(b)
      } else if (b === 0x29) {
        if (--depth === 0) break
        out.push(b)
      } else if (b === 0x5c) {
        const e = this.at(this.pos++)
        switch (e) {
          case 0x6e: out.push(0x0a); break
          case 0x72: out.push(0x0d); break
          case 0x74: out.push(0x09); break
          case 0x62: out.push(0x08); break
          case 0x66: out.push(0x0c); break
          case 0x0d:
            if (this.at(this.pos) === 0x0a) this.pos++
            break
          case 0x0a:
            break
          case -1:
            break
          default:
            if (e >= 0x30 && e <= 0x37) {
              let code = e - 0x30
              for (let k = 0; k < 2; k++) {
                const d = this.at(this.pos)
                if (d < 0x30 || d > 0x37) break
                code = code * 8 + (d - 0x30)
                this.pos++
              }
              out.push(code & 0xff)
            } else {
              out.push(e)
            }
        }
      } else if (b === 0x0d) {
        if (this.at(this.pos) === 0x0a) this.pos++
        out.push(0x0a)
      } else {
        out.push(b)
      }
    }
    return { type: 'string', bytes: out.bytes(), hex: false }
  }

  /**
   * §7.3.4.3: a hexadecimal string. White-space is ignored, an odd final
   * digit is followed by an implied 0, and any other stray byte is skipped
   * rather than ending the string.
   */
  private hexString(): PdfToken {
    this.pos++
    const out = new ByteSink()
    let high = -1
    while (this.pos < this.end) {
      const b = this.at(this.pos++)
      if (b === 0x3e) break
      const v = hexValue(b)
      if (v < 0) continue
      if (high < 0) {
        high = v
      } else {
        out.push(high * 16 + v)
        high = -1
      }
    }
    if (high >= 0) out.push(high * 16)
    return { type: 'string', bytes: out.bytes(), hex: true }
  }
}

/** Keywords that end whatever is being parsed; seeing one means a truncated container. */
const STRUCTURAL = new Set([
  'obj',
  'endobj',
  'stream',
  'endstream',
  'xref',
  'trailer',
  'startxref',
])

export interface PdfParseOptions {
  /** Resolves an indirect stream `/Length` (§7.3.8.2) to a number. */
  resolveLength?: (ref: PdfRef) => number | null
}

export interface PdfIndirectObject {
  num: number
  gen: number
  obj: PdfObject
}

const ENDSTREAM = latin1Bytes('endstream')

/**
 * The §7.3 object parser over {@link PdfLexer}. Returns `null` for what it
 * cannot read rather than throwing; see the module doc for the limits.
 */
export class PdfParser {
  readonly lexer: PdfLexer
  private budget = PDF_MAX_TOKENS
  private failed = false

  constructor(
    readonly bytes: Uint8Array,
    pos = 0,
    private readonly options: PdfParseOptions = {},
    end = bytes.length,
  ) {
    this.lexer = new PdfLexer(bytes, pos, end)
  }

  get pos(): number {
    return this.lexer.pos
  }

  /** One direct object at the current position. */
  parseObject(): PdfObject | null {
    this.failed = false
    this.budget = PDF_MAX_TOKENS
    const obj = this.object(this.lexer.next(), 0)
    return this.failed ? null : obj
  }

  /**
   * `num gen obj … endobj` at the current position (§7.3.10). A dictionary
   * followed by `stream` becomes a {@link PdfStream} (§7.3.8). `endobj` is
   * not required: plenty of writers forget it, and nothing depends on it.
   */
  parseIndirectObject(): PdfIndirectObject | null {
    const numToken = this.lexer.next()
    const genToken = this.lexer.next()
    if (!isIntegerToken(numToken) || !isIntegerToken(genToken)) return null
    if (!this.lexer.peekKeyword('obj')) return null
    this.lexer.next()
    this.failed = false
    this.budget = PDF_MAX_TOKENS
    const start = this.lexer.pos
    const token = this.lexer.next()
    let obj: PdfObject | null
    if (token.type === 'keyword' && token.text === 'endobj') {
      obj = PDF_NULL
    } else {
      obj = this.object(token, 0)
      if (this.failed || !obj) {
        this.lexer.pos = start
        return null
      }
    }
    if (obj.kind === 'dict' && this.lexer.peekKeyword('stream')) {
      this.lexer.next()
      obj = this.streamBody(obj)
    }
    if (this.lexer.peekKeyword('endobj')) this.lexer.next()
    return { num: numToken.value, gen: genToken.value, obj }
  }

  private object(token: PdfToken, depth: number): PdfObject | null {
    if (--this.budget < 0 || depth > PDF_MAX_DEPTH) {
      this.failed = true
      return null
    }
    switch (token.type) {
      case 'number': {
        if (INTEGER.test(token.text)) {
          const mark = this.lexer.pos
          const gen = this.lexer.next()
          if (isIntegerToken(gen)) {
            const r = this.lexer.next()
            if (r.type === 'keyword' && r.text === 'R') {
              return { kind: 'ref', num: token.value, gen: gen.value }
            }
          }
          this.lexer.pos = mark
        }
        return { kind: 'number', value: token.value, text: token.text }
      }
      case 'name':
        return { kind: 'name', name: token.name }
      case 'string':
        return { kind: 'string', bytes: token.bytes, hex: token.hex }
      case 'keyword':
        if (token.text === 'true') return { kind: 'boolean', value: true }
        if (token.text === 'false') return { kind: 'boolean', value: false }
        if (token.text === 'null') return PDF_NULL
        return null
      case 'punct':
        if (token.text === '[') return this.array(depth)
        if (token.text === '<<') return this.dict(depth)
        return null
      default:
        return null
    }
  }

  private array(depth: number): PdfObject | null {
    const items: PdfObject[] = []
    for (;;) {
      const mark = this.lexer.pos
      const token = this.lexer.next()
      if (token.type === 'eof') break
      if (token.type === 'punct' && token.text === ']') break
      if (token.type === 'keyword' && STRUCTURAL.has(token.text)) {
        this.lexer.pos = mark
        break
      }
      const item = this.object(token, depth + 1)
      if (this.failed) return null
      if (item) items.push(item)
    }
    return { kind: 'array', items }
  }

  private dict(depth: number): PdfObject | null {
    const entries = new Map<string, PdfObject>()
    for (;;) {
      const mark = this.lexer.pos
      const token = this.lexer.next()
      if (token.type === 'eof') break
      if (token.type === 'punct' && token.text === '>>') break
      if (token.type === 'keyword' && STRUCTURAL.has(token.text)) {
        this.lexer.pos = mark
        break
      }
      if (token.type !== 'name') {
        // A key that is not a name: skip it (and whatever it opened).
        this.object(token, depth + 1)
        if (this.failed) return null
        continue
      }
      const valueMark = this.lexer.pos
      const valueToken = this.lexer.next()
      if (valueToken.type === 'punct' && valueToken.text === '>>') break
      if (
        valueToken.type === 'eof' ||
        (valueToken.type === 'keyword' && STRUCTURAL.has(valueToken.text))
      ) {
        this.lexer.pos = valueMark
        break
      }
      const value = this.object(valueToken, depth + 1)
      if (this.failed) return null
      // §7.3.7 leaves duplicate keys undefined; the first one wins, as in
      // Poppler, whose `pdfinfo` is what these files are checked against.
      if (value && !entries.has(token.name)) entries.set(token.name, value)
    }
    return { kind: 'dict', entries }
  }

  /**
   * §7.3.8.1: the data starts after the EOL that ends the `stream` keyword
   * (CRLF or LF; a lone CR is tolerated) and runs for `/Length` bytes. When
   * `/Length` is missing, unresolvable or does not land on `endstream`, the
   * data runs to the next `endstream` instead, less the EOL before it.
   */
  private streamBody(dict: PdfDict): PdfStream {
    const { bytes } = this
    const end = this.lexer.end
    let start = this.lexer.pos
    if (byteAt(bytes, start, end) === 0x0d) start++
    if (byteAt(bytes, start, end) === 0x0a) start++
    const length = this.streamLength(dict)
    if (length !== null && start + length <= end) {
      const probe = new PdfLexer(bytes, start + length, end)
      if (probe.peekKeyword('endstream')) {
        probe.next()
        this.lexer.pos = probe.pos
        return { kind: 'stream', dict, data: bytes.subarray(start, start + length) }
      }
    }
    const found = indexOfBytes(bytes, ENDSTREAM, start, end)
    let stop = found < 0 ? end : found
    if (byteAt(bytes, stop - 1, end) === 0x0a && stop > start) stop--
    if (byteAt(bytes, stop - 1, end) === 0x0d && stop > start) stop--
    this.lexer.pos = found < 0 ? end : found + ENDSTREAM.length
    return { kind: 'stream', dict, data: bytes.subarray(start, stop) }
  }

  private streamLength(dict: PdfDict): number | null {
    const value = dict.entries.get('Length')
    let length: number | null = null
    if (value?.kind === 'number') length = value.value
    else if (value?.kind === 'ref') length = this.options.resolveLength?.(value) ?? null
    return length !== null && Number.isSafeInteger(length) && length >= 0 ? length : null
  }
}

function isIntegerToken(
  token: PdfToken,
): token is { type: 'number'; value: number; text: string } {
  return token.type === 'number' && INTEGER.test(token.text)
}

// ---------------------------------------------------------------------------
// Serializing

const HEX = '0123456789ABCDEF'

/** §7.3.5: regular characters 0x21–0x7E other than `#` are written as-is. */
export function serializePdfName(name: string): string {
  let out = '/'
  for (let i = 0; i < name.length; i++) {
    const b = name.charCodeAt(i) & 0xff
    if (b > 0x20 && b < 0x7f && b !== 0x23 && CHAR_CLASS[b] === 0) {
      out += String.fromCharCode(b)
    } else {
      out += '#' + HEX.charAt(b >> 4) + HEX.charAt(b & 15)
    }
  }
  return out
}

/**
 * A string as a literal (§7.3.4.2) or, when it was read as one, a hex
 * string (§7.3.4.3). Literal bytes outside printable ASCII are written as
 * three-digit octal escapes so the output is 7-bit clean and byte-exact.
 */
export function serializePdfString(value: PdfString): string {
  if (value.hex) {
    let out = '<'
    for (const b of value.bytes) out += HEX.charAt(b >> 4) + HEX.charAt(b & 15)
    return out + '>'
  }
  let out = '('
  for (const b of value.bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b)
    else if (b === 0x0a) out += '\\n'
    else if (b === 0x0d) out += '\\r'
    else if (b === 0x09) out += '\\t'
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b)
    else out += '\\' + b.toString(8).padStart(3, '0')
  }
  return out + ')'
}

/**
 * An object as PDF syntax, in a binary string (one char per byte). Streams
 * cannot be nested inside another object (§7.3.8.1), so one met here is
 * written as `null`; a top-level stream is laid out by its writer.
 */
export function serializePdfObject(obj: PdfObject, depth = 0): string {
  if (depth > PDF_MAX_DEPTH) return 'null'
  switch (obj.kind) {
    case 'null':
      return 'null'
    case 'boolean':
      return obj.value ? 'true' : 'false'
    case 'number':
      return NUMBER.test(obj.text) ? obj.text : String(obj.value)
    case 'string':
      return serializePdfString(obj)
    case 'name':
      return serializePdfName(obj.name)
    case 'ref':
      return `${obj.num} ${obj.gen} R`
    case 'array':
      return '[' + obj.items.map((item) => serializePdfObject(item, depth + 1)).join(' ') + ']'
    case 'dict': {
      const entries: string[] = []
      for (const [key, value] of obj.entries) {
        entries.push(serializePdfName(key) + ' ' + serializePdfObject(value, depth + 1))
      }
      return '<<' + entries.join(' ') + '>>'
    }
    case 'stream':
      return 'null'
  }
}

// ---------------------------------------------------------------------------
// Text strings (§7.9.2.2)

/**
 * PDFDocEncoding (Annex D.2) where it differs from Latin-1: 0x18–0x1F are
 * spacing accents and 0x80–0xA0 are typographic marks. 0x7F, 0x9F and 0xAD
 * are undefined and read as their Latin-1 code points, as pdf.js does.
 */
const PDF_DOC_ENCODING: Record<number, number> = {
  0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9,
  0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026,
  0x84: 0x2014, 0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044,
  0x88: 0x2039, 0x89: 0x203a, 0x8a: 0x2212, 0x8b: 0x2030,
  0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d, 0x8f: 0x2018,
  0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01,
  0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160,
  0x98: 0x0178, 0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142,
  0x9c: 0x0153, 0x9d: 0x0161, 0x9e: 0x017e, 0xa0: 0x20ac,
}

function utf16Text(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  let out = ''
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    out += String.fromCharCode(littleEndian ? b * 256 + a : a * 256 + b)
  }
  // Lone surrogates from a truncated pair become U+FFFD.
  return out.toWellFormed()
}

/**
 * A text string's bytes as text (§7.9.2.2): UTF-16BE after a FE FF byte
 * order mark, UTF-8 after EF BB BF (PDF 2.0), PDFDocEncoding otherwise.
 * UTF-16LE after FF FE is not in the standard but is written by enough
 * software that reading it as PDFDocEncoding ("ÿþ…") helps nobody.
 * Language escapes (ESC lang ESC, §7.9.2.2.1) and trailing NULs are removed.
 */
export function decodePdfTextString(bytes: Uint8Array): string {
  let text: string
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = utf16Text(bytes, 2, false)
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = utf16Text(bytes, 2, true)
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    text = new TextDecoder('utf-8').decode(bytes.subarray(3))
  } else {
    text = ''
    for (const b of bytes) text += String.fromCharCode(PDF_DOC_ENCODING[b] ?? b)
  }
  return stripLanguageEscapes(text).replace(TRAILING_NULS, '')
}

const ESC = String.fromCharCode(0x1b)
const TRAILING_NULS = new RegExp(String.fromCharCode(0) + '+$')

/** §7.9.2.2.1: ESC, a 2-letter language, an optional 2-letter country, ESC. */
function stripLanguageEscapes(text: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const open = text.indexOf(ESC, at)
    if (open < 0) break
    const close = text.indexOf(ESC, open + 1)
    if (close < 0 || close - open > 9) {
      out += text.slice(at, open + 1)
      at = open + 1
      continue
    }
    out += text.slice(at, open)
    at = close + 1
  }
  return out + text.slice(at)
}

/**
 * Text as a text string: a literal when every char is printable ASCII (or
 * tab, CR, LF, which escape cleanly and mean the same in PDFDocEncoding),
 * otherwise UTF-16BE with a byte order mark, written as hex (§7.9.2.2).
 */
export function encodePdfTextString(text: string): PdfString {
  if (/^[\x20-\x7e\t\n\r]*$/.test(text)) {
    return { kind: 'string', bytes: latin1Bytes(text), hex: false }
  }
  const units = text.toWellFormed()
  const bytes = new Uint8Array(2 + units.length * 2)
  bytes[0] = 0xfe
  bytes[1] = 0xff
  for (let i = 0; i < units.length; i++) {
    const unit = units.charCodeAt(i)
    bytes[2 + i * 2] = unit >> 8
    bytes[3 + i * 2] = unit & 0xff
  }
  return { kind: 'string', bytes, hex: true }
}

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

/**
 * A name's bytes as display text: UTF-8 when they are valid UTF-8 (PDF 2.0
 * §7.3.5 recommends it), Latin-1 otherwise.
 */
export function pdfNameText(name: string): string {
  let ascii = true
  for (let i = 0; i < name.length && ascii; i++) ascii = name.charCodeAt(i) < 0x80
  if (ascii) return name
  try {
    return UTF8_STRICT.decode(latin1Bytes(name))
  } catch {
    return name
  }
}

/** Display text as name bytes (UTF-8), the inverse of {@link pdfNameText}. */
export function pdfNameFromText(text: string): string {
  return latin1Text(new TextEncoder().encode(text))
}

// ---------------------------------------------------------------------------
// Stream filters (§7.4)

export type PdfResolver = (obj: PdfObject | undefined) => PdfObject | undefined

function asArray(obj: PdfObject | undefined, resolve: PdfResolver): PdfObject[] {
  const value = resolve(obj)
  if (!value || value.kind === 'null') return []
  return value.kind === 'array' ? value.items : [value]
}

function intParam(dict: PdfDict | null, key: string, fallback: number): number {
  const value = dict?.entries.get(key)
  return value?.kind === 'number' && Number.isInteger(value.value) ? value.value : fallback
}

/**
 * zlib inflation capped at `maxOutputLength`. A strict pass first; a stream
 * truncated or missing its Adler-32 (common, and harmless to the data) is
 * retried with a sync flush, and one written without a zlib header as raw
 * deflate. `null` when none of them produces anything.
 */
export function inflatePdf(data: Uint8Array, maxOutputLength: number): Uint8Array | null {
  const options = { maxOutputLength }
  const lenient = { maxOutputLength, finishFlush: constants.Z_SYNC_FLUSH }
  const attempts = [
    () => inflateSync(data, options),
    () => inflateSync(data, lenient),
    () => inflateRawSync(data, lenient),
  ]
  for (const attempt of attempts) {
    try {
      const out = attempt()
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
    } catch {
      // The next attempt is more lenient; a size-cap error fails them all.
    }
  }
  return null
}

/**
 * §7.4.4.4: undo a TIFF (2) or PNG (10–15) predictor. PNG rows each carry
 * their own filter-type byte, so the Predictor value past 10 is only a hint.
 * `null` for parameters this cannot honor.
 */
export function unpredict(data: Uint8Array, params: PdfDict | null): Uint8Array | null {
  const predictor = intParam(params, 'Predictor', 1)
  if (predictor === 1) return data
  const colors = intParam(params, 'Colors', 1)
  const bpc = intParam(params, 'BitsPerComponent', 8)
  const columns = intParam(params, 'Columns', 1)
  if (colors < 1 || colors > 32 || ![1, 2, 4, 8, 16].includes(bpc)) return null
  if (columns < 1 || columns > 1 << 24) return null
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8))
  const rowLength = Math.ceil((colors * bpc * columns) / 8)
  if (predictor === 2) {
    if (bpc !== 8) return null
    const out = data.slice()
    for (let row = 0; row < out.length; row += rowLength) {
      for (let i = row + bpp; i < Math.min(row + rowLength, out.length); i++) {
        out[i] = ((out[i] ?? 0) + (out[i - bpp] ?? 0)) & 0xff
      }
    }
    return out
  }
  if (predictor < 10 || predictor > 15) return null
  const rows = Math.ceil(data.length / (rowLength + 1))
  // Every row writes at most its own input, so the output is never longer
  // than the input — a hostile /Columns cannot make this allocate more.
  const out = new Uint8Array(Math.min(rows * rowLength, data.length))
  let written = 0
  for (let row = 0; row < rows; row++) {
    const src = row * (rowLength + 1)
    const type = data[src] ?? 0
    const base = row * rowLength
    const available = Math.min(rowLength, data.length - src - 1)
    for (let i = 0; i < available; i++) {
      const raw = data[src + 1 + i] ?? 0
      const left = i >= bpp ? (out[base + i - bpp] ?? 0) : 0
      const up = row > 0 ? (out[base - rowLength + i] ?? 0) : 0
      const upLeft = row > 0 && i >= bpp ? (out[base - rowLength + i - bpp] ?? 0) : 0
      let value: number
      switch (type) {
        case 1: value = raw + left; break
        case 2: value = raw + up; break
        case 3: value = raw + ((left + up) >> 1); break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
          break
        }
        default: value = raw
      }
      out[base + i] = value & 0xff
    }
    written = base + Math.max(0, available)
  }
  return out.subarray(0, written)
}

/**
 * A stream's decoded data, or `null` when it uses a filter other than
 * FlateDecode (§7.4.4) or does not decode within `maxOutputLength`.
 */
export function decodePdfStream(
  stream: PdfStream,
  resolve: PdfResolver,
  maxOutputLength: number,
): Uint8Array | null {
  const filters = asArray(stream.dict.entries.get('Filter'), resolve)
  const params = asArray(stream.dict.entries.get('DecodeParms'), resolve)
  if (filters.length > 8) return null
  let data: Uint8Array | null = stream.data
  for (let i = 0; i < filters.length && data; i++) {
    const filter = resolve(filters[i])
    if (filter?.kind !== 'name') return null
    if (filter.name !== 'FlateDecode' && filter.name !== 'Fl') return null
    const param = resolve(params[i])
    data = inflatePdf(data, maxOutputLength)
    if (data) data = unpredict(data, param?.kind === 'dict' ? param : null)
  }
  if (data && data.length > maxOutputLength) return null
  return data
}
