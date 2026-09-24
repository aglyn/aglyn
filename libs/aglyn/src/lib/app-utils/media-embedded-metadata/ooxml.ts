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
 * The document properties of a Word, Excel or PowerPoint file (AGL-3331):
 * read from, and written back into, the package's property parts.
 *
 * An Office file is an Open Packaging Conventions package — a ZIP whose
 * parts are found through relationships (ECMA-376 Part 2). Three parts carry
 * what Explorer, Finder and Office's own Info pane show:
 *
 * - core properties (ECMA-376 Part 2, "Core Properties"): title, subject,
 *   author, keywords, comments, category, last modified by, the two dates.
 *   Readable and writable.
 * - extended properties (Part 1 §22.2): the application, the company, the
 *   page or slide count. Read-only — the application recomputes them.
 * - custom properties (Part 1 §22.3): named, typed values. Read; a text one
 *   can be edited or removed, not added.
 *
 * Each part is found through the package relationships in `_rels/.rels`,
 * never by its usual name — `docProps/core.xml` is a convention, not a rule.
 *
 * ## Lossless writing
 *
 * An edited part is changed as TEXT at the exact offsets the parser
 * recorded: one element's content replaced, one element removed, one
 * inserted before the root's end tag. Every other byte of the part stays as
 * it was, and every other part of the package is copied through byte for
 * byte by `rewriteZip` — the document, the images, the styles, the
 * signatures' parts.
 *
 * ## The XML parser
 *
 * A small, strict, non-validating one (`scanXml`, `parseXml`), because the
 * parts are tiny and the only safe DTD is none: OPC forbids DTD declarations
 * in package XML, so a DOCTYPE here is refused outright rather than
 * skipped, and no entity beyond the five predefined ones and character
 * references is ever expanded. `svg.ts` reuses it, allowing an inert
 * external-id DOCTYPE and nothing more.
 */

import {
  embeddedFieldLabel,
  otherEmbeddedKey,
  parseOtherEmbeddedKey,
} from '../media-embedded-fields'
import { findZipEntry, readZip, readZipEntry, rewriteZip } from './zip'
import type { ZipArchive, ZipEntry } from './zip'
import {
  EmbeddedWriteError,
  type EmbeddedCandidate,
  type EmbeddedPatch,
} from './types'

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const NS_XML = 'http://www.w3.org/XML/1998/namespace'
const NS_XMLNS = 'http://www.w3.org/2000/xmlns/'

export interface XmlAttribute {
  /** The qualified name as written. */
  name: string
  prefix: string | null
  local: string
  /**
   * The resolved namespace URI. An unprefixed attribute is in NO namespace
   * (Namespaces in XML 1.0 §6.2), whatever the default namespace is.
   */
  ns: string | null
  /** The value with entities and character references decoded. */
  value: string
  /** Offsets of the raw value, between its quotes. */
  valueStart: number
  valueEnd: number
}

export interface XmlStartTag {
  /** The qualified name as written. */
  name: string
  prefix: string | null
  local: string
  ns: string | null
  attributes: XmlAttribute[]
  /** Every namespace binding in scope here, by prefix (`''` = default). */
  namespaces: ReadonlyMap<string, string>
  /** The root element is depth 0. */
  depth: number
  /** Offset of the `<` that opens the start tag. */
  start: number
  /** Offset just past the start tag's `>`. */
  openEnd: number
  selfClosing: boolean
}

export interface XmlScanHandlers {
  open?(tag: XmlStartTag): void
  /**
   * Called for every element, a self-closing one included (its
   * `closeStart` and `end` are then both its `openEnd`).
   */
  close?(tag: XmlStartTag, closeStart: number, end: number): void
  /** Character data, decoded; a CDATA section's content arrives verbatim. */
  text?(text: string, start: number, end: number): void
}

export interface XmlScanOptions {
  /**
   * Accept a DOCTYPE that has no internal subset, and skip it — nothing it
   * names is ever fetched. A DOCTYPE with an internal subset, and any
   * `<!ENTITY>`, is refused either way, because entity definitions are what
   * turn a small file into a billion laughs.
   */
  allowExternalDoctype?: boolean
  /** Deeper nesting is refused. */
  maxDepth?: number
  /** More elements are refused. */
  maxElements?: number
}

const XML_ENTITY =
  /&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g
const PREDEFINED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** XML 1.0 §2.2 `Char`. */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  )
}

/**
 * Expand the five predefined entities and character references (XML 1.0
 * §4.1, §4.6). Anything else — an undeclared entity, a stray `&` — is left
 * as written: there is no DTD to define it, and guessing is worse.
 */
function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(
    XML_ENTITY,
    (whole, hex?: string, dec?: string, name?: string) => {
      if (name) return PREDEFINED[name] ?? whole
      const code = hex ? parseInt(hex, 16) : parseInt(dec ?? '', 10)
      return isXmlChar(code) ? String.fromCodePoint(code) : whole
    },
  )
}

/** Character data: line ends normalized (§2.11), then entities. */
export function decodeXmlText(raw: string): string {
  return decodeEntities(raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw)
}

/** An attribute value, normalized as §3.3.3 does for CDATA attributes. */
function decodeXmlAttribute(raw: string): string {
  return decodeEntities(raw.replace(/\r\n|[\t\n\r]/g, ' '))
}

/** Characters XML 1.0 cannot carry at all, even escaped. */
const NOT_XML_CHAR =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/** Escape text content; drops what XML cannot represent. */
export function escapeXmlText(value: string): string {
  return value
    .replace(NOT_XML_CHAR, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape a double-quoted attribute value. */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

const isSpace = (code: number) =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d

/** A name runs until whitespace or markup punctuation. */
const endsName = (code: number) =>
  isSpace(code) ||
  code === 0x2f || // /
  code === 0x3e || // >
  code === 0x3d || // =
  code === 0x3c || // <
  code === 0x22 || // "
  code === 0x27 || // '
  Number.isNaN(code)

function splitName(
  name: string,
): { prefix: string | null; local: string } | null {
  const colon = name.indexOf(':')
  if (colon < 0) return { prefix: null, local: name }
  if (
    colon === 0 ||
    colon === name.length - 1 ||
    name.indexOf(':', colon + 1) >= 0
  )
    return null
  return { prefix: name.slice(0, colon), local: name.slice(colon + 1) }
}

/**
 * Walk a document start to end, reporting elements and text.
 *
 * Returns false — having possibly reported a prefix of the document — on
 * anything that is not a well-formed, namespace-well-formed document with
 * one root element: mismatched or unclosed tags, a duplicate attribute, an
 * unbound prefix, text outside the root, a refused DOCTYPE or `<!ENTITY>`,
 * or a bound exceeded. Never throws.
 */
export function scanXml(
  source: string,
  handlers: XmlScanHandlers,
  options: XmlScanOptions = {},
): boolean {
  const maxDepth = options.maxDepth ?? 256
  const maxElements = options.maxElements ?? 1_000_000
  const baseNamespaces: ReadonlyMap<string, string> = new Map([['xml', NS_XML]])
  const stack: XmlStartTag[] = []
  const n = source.length
  let rootSeen = false
  let elements = 0
  // A byte-order mark decoded into the string is not content.
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0

  while (i < n) {
    const lt = source.indexOf('<', i)
    const textEnd = lt < 0 ? n : lt
    if (textEnd > i) {
      if (stack.length) {
        handlers.text?.(decodeXmlText(source.slice(i, textEnd)), i, textEnd)
      } else {
        for (let k = i; k < textEnd; k++) {
          if (!isSpace(source.charCodeAt(k))) return false
        }
      }
    }
    if (lt < 0) break

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      if (end < 0) return false
      i = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      if (!stack.length) return false
      const end = source.indexOf(']]>', lt + 9)
      if (end < 0) return false
      handlers.text?.(source.slice(lt + 9, end), lt + 9, end)
      i = end + 3
      continue
    }
    if (source.startsWith('<!DOCTYPE', lt)) {
      if (!options.allowExternalDoctype || rootSeen) return false
      let j = lt + 9
      let quote = 0
      for (; j < n; j++) {
        const code = source.charCodeAt(j)
        if (quote) {
          if (code === quote) quote = 0
        } else if (code === 0x22 || code === 0x27) {
          quote = code
        } else if (code === 0x5b) {
          // `[` opens an internal subset: entity definitions.
          return false
        } else if (code === 0x3e) {
          break
        }
      }
      if (j >= n) return false
      i = j + 1
      continue
    }
    // `<!ENTITY`, `<!ELEMENT`, … are only legal inside a DTD.
    if (source.startsWith('<!', lt)) return false
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      if (end < 0) return false
      i = end + 2
      continue
    }

    if (source.startsWith('</', lt)) {
      const gt = source.indexOf('>', lt + 2)
      if (gt < 0) return false
      const open = stack.pop()
      if (!open || open.name !== source.slice(lt + 2, gt).trimEnd())
        return false
      handlers.close?.(open, lt, gt + 1)
      i = gt + 1
      continue
    }

    // A start tag.
    if (!stack.length && rootSeen) return false
    if (stack.length >= maxDepth || ++elements > maxElements) return false
    let j = lt + 1
    while (j < n && !endsName(source.charCodeAt(j))) j++
    const name = source.slice(lt + 1, j)
    const parts = splitName(name)
    if (!name || !parts) return false

    const raw: Array<{
      name: string
      value: string
      start: number
      end: number
    }> = []
    const seen = new Set<string>()
    let selfClosing = false
    for (;;) {
      const before = j
      while (j < n && isSpace(source.charCodeAt(j))) j++
      if (j >= n) return false
      const code = source.charCodeAt(j)
      if (code === 0x3e) {
        j++
        break
      }
      if (code === 0x2f) {
        if (source.charCodeAt(j + 1) !== 0x3e) return false
        selfClosing = true
        j += 2
        break
      }
      // Attributes are separated from the name and each other by space.
      if (j === before) return false
      const nameStart = j
      while (j < n && !endsName(source.charCodeAt(j))) j++
      const attributeName = source.slice(nameStart, j)
      if (!attributeName || seen.has(attributeName)) return false
      seen.add(attributeName)
      while (j < n && isSpace(source.charCodeAt(j))) j++
      if (source.charCodeAt(j) !== 0x3d) return false
      j++
      while (j < n && isSpace(source.charCodeAt(j))) j++
      const quote = source[j]
      if (quote !== '"' && quote !== "'") return false
      const valueEnd = source.indexOf(quote, j + 1)
      if (valueEnd < 0) return false
      const value = source.slice(j + 1, valueEnd)
      if (value.includes('<')) return false
      raw.push({ name: attributeName, value, start: j + 1, end: valueEnd })
      j = valueEnd + 1
    }

    const parent = stack.at(-1)
    const inherited = parent?.namespaces ?? baseNamespaces
    let namespaces = inherited
    for (const attribute of raw) {
      if (attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:'))
        continue
      if (namespaces === inherited) namespaces = new Map(inherited)
      const prefix = attribute.name === 'xmlns' ? '' : attribute.name.slice(6)
      const uri = decodeXmlAttribute(attribute.value)
      const map = namespaces as Map<string, string>
      if (uri) map.set(prefix, uri)
      else if (prefix) return false
      else map.delete('')
    }
    const ns =
      parts.prefix === null ? namespaces.get('') : namespaces.get(parts.prefix)
    if (parts.prefix !== null && ns === undefined) return false

    const attributes: XmlAttribute[] = []
    for (const attribute of raw) {
      const split = splitName(attribute.name)
      if (!split) return false
      let attributeNs: string | null = null
      if (attribute.name === 'xmlns' || split.prefix === 'xmlns') {
        attributeNs = NS_XMLNS
      } else if (split.prefix !== null) {
        const bound = namespaces.get(split.prefix)
        if (bound === undefined) return false
        attributeNs = bound
      }
      attributes.push({
        name: attribute.name,
        prefix: split.prefix,
        local: split.local,
        ns: attributeNs,
        value: decodeXmlAttribute(attribute.value),
        valueStart: attribute.start,
        valueEnd: attribute.end,
      })
    }

    const tag: XmlStartTag = {
      name,
      prefix: parts.prefix,
      local: parts.local,
      ns: ns ?? null,
      attributes,
      namespaces,
      depth: stack.length,
      start: lt,
      openEnd: j,
      selfClosing,
    }
    rootSeen = true
    handlers.open?.(tag)
    if (selfClosing) handlers.close?.(tag, j, j)
    else stack.push(tag)
    i = j
  }
  return rootSeen && stack.length === 0
}

export interface XmlElement extends XmlStartTag {
  parent: XmlElement | null
  children: XmlElement[]
  /** Child elements and decoded text, in document order. */
  content: Array<XmlElement | string>
  /** Offset of the end tag's `<`; `openEnd` when self-closing. */
  closeStart: number
  /** Offset just past the element. */
  end: number
}

/** Parse a whole document into a tree. Null when `scanXml` refuses it. */
export function parseXml(
  source: string,
  options: XmlScanOptions = {},
): XmlElement | null {
  const state: { root: XmlElement | null; stack: XmlElement[] } = {
    root: null,
    stack: [],
  }
  const ok = scanXml(
    source,
    {
      open(tag) {
        const parent = state.stack.at(-1) ?? null
        const element: XmlElement = {
          ...tag,
          parent,
          children: [],
          content: [],
          closeStart: tag.openEnd,
          end: tag.openEnd,
        }
        parent?.children.push(element)
        parent?.content.push(element)
        state.root ??= element
        state.stack.push(element)
      },
      close(_tag, closeStart, end) {
        const element = state.stack.pop()
        if (!element) return
        element.closeStart = closeStart
        element.end = end
      },
      text(text) {
        state.stack.at(-1)?.content.push(text)
      },
    },
    options,
  )
  return ok ? state.root : null
}

/** Every character of text inside an element, descendants included. */
export function xmlTextContent(element: XmlElement): string {
  return element.content
    .map((node) => (typeof node === 'string' ? node : xmlTextContent(node)))
    .join('')
}

/** An attribute's value by local name and namespace (null = no namespace). */
export function xmlAttribute(
  element: XmlStartTag,
  local: string,
  ns: string | null = null,
): XmlAttribute | undefined {
  return element.attributes.find(
    (attribute) => attribute.local === local && attribute.ns === ns,
  )
}

/** A prefix bound to `ns` in scope at `element`; `''` for the default. */
function prefixFor(element: XmlStartTag, ns: string): string | undefined {
  let fallback: string | undefined
  for (const [prefix, uri] of element.namespaces) {
    if (uri !== ns) continue
    if (prefix) return prefix
    fallback = prefix
  }
  return fallback
}

interface TextEdit {
  start: number
  end: number
  text: string
}

function applyEdits(source: string, edits: TextEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end)
  let out = source
  let floor = Infinity
  for (const edit of ordered) {
    if (edit.end > floor) {
      throw new EmbeddedWriteError(
        'The document properties could not be edited safely.',
      )
    }
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
    floor = edit.start
  }
  return out
}

// ---------------------------------------------------------------------------
// Package
// ---------------------------------------------------------------------------

const NS_CP =
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
const NS_DC = 'http://purl.org/dc/elements/1.1/'
const NS_DCTERMS = 'http://purl.org/dc/terms/'
const NS_DCMITYPE = 'http://purl.org/dc/dcmitype/'
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance'
/** Transitional and Strict (ISO/IEC 29500) spellings of the same idea. */
const NS_EXTENDED = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  'http://purl.oclc.org/ooxml/officeDocument/extendedProperties',
])
const NS_CUSTOM = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
  'http://purl.oclc.org/ooxml/officeDocument/customProperties',
])
const NS_VT = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
  'http://purl.oclc.org/ooxml/officeDocument/docPropsVTypes',
])
const NS_RELATIONSHIPS =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_CONTENT_TYPES =
  'http://schemas.openxmlformats.org/package/2006/content-types'

const CONTENT_TYPES_PART = '[Content_Types].xml'
const ROOT_RELATIONSHIPS_PART = '_rels/.rels'
const CORE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'
const CORE_CONTENT_TYPE =
  'application/vnd.openxmlformats-package.core-properties+xml'
const DEFAULT_CORE_PART = 'docProps/core.xml'

/** A property part is a few KB; this is generous and still bounded. */
const PART_MAX_BYTES = 8 * 1024 * 1024

/**
 * The relationship a part is reached by, matched on its tail and without
 * case or hyphens: Transitional says `extended-properties`, Strict says
 * `extendedProperties`, and a few old writers put core properties under the
 * `officeDocument` namespace instead of `package`.
 */
type PropertyRole = 'core' | 'extended' | 'custom'
function roleOf(type: string): PropertyRole | null {
  const tail = type.toLowerCase().replace(/-/g, '')
  if (tail.endsWith('/metadata/coreproperties')) return 'core'
  if (tail.endsWith('/extendedproperties')) return 'extended'
  if (tail.endsWith('/customproperties')) return 'custom'
  return null
}

/** Resolve a root relationship's target to a ZIP entry name (Part 2 §9.3). */
function resolveTarget(target: string): string {
  const segments: string[] = []
  for (const segment of target.split(/[?#]/)[0]?.split('/') ?? []) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

/**
 * A part by name. Part names compare case-insensitively (Part 2 §9.1.1.1),
 * and a target may be percent-encoded where the ZIP item name is not.
 */
function findPart(archive: ZipArchive, name: string): ZipEntry | undefined {
  const exact = findZipEntry(archive, name)
  if (exact) return exact
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {
    // Not percent-encoded after all.
  }
  const wanted = [name.toLowerCase(), decoded.toLowerCase()]
  return archive.entries.find((entry) =>
    wanted.includes(entry.name.toLowerCase()),
  )
}

interface PartText {
  text: string
  /** The part opened with a UTF-8 byte-order mark, to be written back. */
  bom: boolean
}

/**
 * Decode a part for reading. OPC allows UTF-8 and UTF-16 (Part 2, "XML
 * Usage"); the byte-order mark decides, and UTF-8 is the default.
 */
function decodeForRead(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * Decode a part for editing: strict UTF-8 only, so that re-encoding the
 * untouched text reproduces the untouched bytes exactly.
 */
function decodeForEdit(bytes: Uint8Array): PartText {
  if (
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe)
  ) {
    throw new EmbeddedWriteError(
      'This file stores its properties as UTF-16, which cannot be edited here.',
    )
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bom ? bytes.subarray(3) : bytes,
      ),
      bom,
    }
  } catch {
    throw new EmbeddedWriteError(
      'The properties in this file are not valid text.',
    )
  }
}

function encodePart(part: PartText): Uint8Array {
  const body = new TextEncoder().encode(part.text)
  if (!part.bom) return body
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(body, 3)
  return out
}

function readPartText(
  archive: ZipArchive,
  entry: ZipEntry | undefined,
): string | null {
  if (!entry) return null
  const bytes = readZipEntry(archive, entry, PART_MAX_BYTES)
  return bytes ? decodeForRead(bytes) : null
}

interface PackageLayout {
  /** Entry names by role, from the root relationships. */
  parts: Partial<Record<PropertyRole, string>>
  relationships: ZipEntry | undefined
}

function packageLayout(archive: ZipArchive): PackageLayout {
  const relationships = findPart(archive, ROOT_RELATIONSHIPS_PART)
  const parts: Partial<Record<PropertyRole, string>> = {}
  const text = readPartText(archive, relationships)
  const root = text === null ? null : parseXml(text)
  if (!root || root.local !== 'Relationships' || root.ns !== NS_RELATIONSHIPS) {
    return { parts, relationships }
  }
  for (const child of root.children) {
    if (child.local !== 'Relationship' || child.ns !== NS_RELATIONSHIPS)
      continue
    if (xmlAttribute(child, 'TargetMode')?.value === 'External') continue
    const role = roleOf(xmlAttribute(child, 'Type')?.value ?? '')
    const target = xmlAttribute(child, 'Target')?.value
    if (role && target && !parts[role]) parts[role] = resolveTarget(target)
  }
  return { parts, relationships }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type CoreKey =
  | 'title'
  | 'subject'
  | 'creator'
  | 'keywords'
  | 'description'
  | 'category'
  | 'lastModifiedBy'
  | 'createdAt'
  | 'modifiedAt'

/** Where each canonical key lives in the core properties part. */
const CORE_FIELDS: Record<
  CoreKey,
  { ns: string; local: string; prefix: string }
> = {
  title: { ns: NS_DC, local: 'title', prefix: 'dc' },
  subject: { ns: NS_DC, local: 'subject', prefix: 'dc' },
  creator: { ns: NS_DC, local: 'creator', prefix: 'dc' },
  keywords: { ns: NS_CP, local: 'keywords', prefix: 'cp' },
  description: { ns: NS_DC, local: 'description', prefix: 'dc' },
  category: { ns: NS_CP, local: 'category', prefix: 'cp' },
  lastModifiedBy: { ns: NS_CP, local: 'lastModifiedBy', prefix: 'cp' },
  createdAt: { ns: NS_DCTERMS, local: 'created', prefix: 'dcterms' },
  modifiedAt: { ns: NS_DCTERMS, local: 'modified', prefix: 'dcterms' },
}

/** The core keys an edit may set. The dates and last-modified-by are facts. */
const CORE_WRITABLE = new Set<CoreKey>([
  'title',
  'subject',
  'creator',
  'keywords',
  'description',
  'category',
])

const isCoreKey = (key: string): key is CoreKey =>
  Object.prototype.hasOwnProperty.call(CORE_FIELDS, key)

const splitList = (value: string, separator: RegExp) =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)

/**
 * A W3CDTF date (the profile of ISO 8601 `dcterms:W3CDTF` names) in the
 * catalog's form: seconds kept, a fraction cut to milliseconds, the zone as
 * `Z` or `±HH:MM` and only when one was written. Anything else is returned
 * trimmed, as found.
 */
function normalizeW3cdtf(raw: string): string {
  const value = raw.trim()
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:[.,](\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    )
  if (!match) return value
  const [, date, time, fraction, zone] = match
  return `${date}T${time}${fraction ? `.${fraction.slice(0, 3)}` : ''}${zone ?? ''}`
}

function readCore(text: string): EmbeddedCandidate[] {
  const root = parseXml(text)
  if (!root || root.ns !== NS_CP || root.local !== 'coreProperties') return []
  const out: EmbeddedCandidate[] = []
  const creators: string[] = []
  const keywords: string[] = []
  const seen = new Set<CoreKey>()
  for (const child of root.children) {
    const key = (Object.keys(CORE_FIELDS) as CoreKey[]).find(
      (candidate) =>
        CORE_FIELDS[candidate].ns === child.ns &&
        CORE_FIELDS[candidate].local === child.local,
    )
    if (!key) continue
    const value = xmlTextContent(child).trim()
    if (!value) continue
    // Office writes several authors into one `dc:creator`, joined by `;`.
    if (key === 'creator') creators.push(...splitList(value, /;/))
    else if (key === 'keywords') keywords.push(...splitList(value, /[,;]/))
    else if (!seen.has(key)) {
      seen.add(key)
      out.push({
        key,
        value:
          key === 'createdAt' || key === 'modifiedAt'
            ? normalizeW3cdtf(value)
            : value,
        source: 'ooxml',
      })
    }
  }
  if (creators.length)
    out.push({ key: 'creator', value: creators, source: 'ooxml' })
  if (keywords.length)
    out.push({ key: 'keywords', value: keywords, source: 'ooxml' })
  return out
}

function readExtended(text: string): EmbeddedCandidate[] {
  const root = parseXml(text)
  if (
    !root ||
    !root.ns ||
    !NS_EXTENDED.has(root.ns) ||
    root.local !== 'Properties'
  )
    return []
  const value = (local: string) => {
    const child = root.children.find(
      (element) => element.local === local && element.ns === root.ns,
    )
    return child ? xmlTextContent(child).trim() : ''
  }
  const out: EmbeddedCandidate[] = []
  const application = value('Application')
  if (application)
    out.push({ key: 'software', value: application, source: 'ooxml' })
  const company = value('Company')
  if (company) out.push({ key: 'company', value: company, source: 'ooxml' })
  // Word counts pages and PowerPoint slides; a workbook has neither.
  const count = [value('Pages'), value('Slides')].find((item) =>
    /^\d+$/.test(item),
  )
  if (count) out.push({ key: 'pageCount', value: count, source: 'ooxml' })
  return out
}

/** Text-valued variant types — the only ones an edit can write (§22.4). */
const VT_TEXT = new Set(['lpwstr', 'lpstr'])
const VT_READ_ONLY_TEXT = new Set(['bstr'])
const VT_NUMBER = new Set([
  'i1',
  'i2',
  'i4',
  'i8',
  'int',
  'ui1',
  'ui2',
  'ui4',
  'ui8',
  'uint',
  'r4',
  'r8',
  'decimal',
])
const VT_DATE = new Set(['filetime', 'date'])

/** A custom property's name, from its `name` attribute. */
const propertyName = (property: XmlElement) =>
  xmlAttribute(property, 'name')?.value ?? ''

/** The one `vt:` value child of a custom `property` (§22.3.2.2). */
const propertyValue = (property: XmlElement) =>
  property.children.find((child) => child.ns !== null && NS_VT.has(child.ns))

function customProperties(root: XmlElement): XmlElement[] {
  return root.children.filter(
    (child) => child.local === 'property' && child.ns === root.ns,
  )
}

function readCustom(text: string): EmbeddedCandidate[] {
  const root = parseXml(text)
  if (
    !root ||
    !root.ns ||
    !NS_CUSTOM.has(root.ns) ||
    root.local !== 'Properties'
  )
    return []
  const out: EmbeddedCandidate[] = []
  const seen = new Set<string>()
  for (const property of customProperties(root)) {
    const name = propertyName(property)
    const valueElement = propertyValue(property)
    if (!name || !valueElement || seen.has(name)) continue
    const type = valueElement.local
    const raw = xmlTextContent(valueElement)
    let value: string
    if (VT_TEXT.has(type) || VT_READ_ONLY_TEXT.has(type)) value = raw
    else if (VT_NUMBER.has(type)) value = raw.trim()
    else if (type === 'bool') {
      const flag = raw.trim().toLowerCase()
      value = flag === '1' ? 'true' : flag === '0' ? 'false' : flag
    } else if (VT_DATE.has(type)) value = normalizeW3cdtf(raw)
    // Vectors, arrays, blobs, currency and the rest are not shown.
    else continue
    if (!value.trim()) continue
    seen.add(name)
    out.push({
      key: otherEmbeddedKey('ooxml', name),
      value,
      source: 'ooxml',
      label: name,
      ...(VT_TEXT.has(type) ? {} : { editable: false }),
    })
  }
  return out
}

/**
 * Read an Office file's document properties.
 *
 * Null when the bytes are not an OPC package — not a ZIP, or a ZIP with no
 * `[Content_Types].xml`. A package whose property parts are missing or
 * unreadable reads as an empty list: a damaged part costs its own fields,
 * not the others'. A part with a DOCTYPE is unreadable by design.
 */
export function readOoxml(
  bytes: Uint8Array,
): { candidates: EmbeddedCandidate[] } | null {
  const archive = readZip(bytes)
  if (!archive || !findPart(archive, CONTENT_TYPES_PART)) return null
  const { parts } = packageLayout(archive)
  const candidates: EmbeddedCandidate[] = []
  const part = (role: PropertyRole) => {
    const name = parts[role]
    return name === undefined
      ? null
      : readPartText(archive, findPart(archive, name))
  }
  const core = part('core')
  if (core !== null) candidates.push(...readCore(core))
  const extended = part('extended')
  if (extended !== null) candidates.push(...readExtended(extended))
  const custom = part('custom')
  if (custom !== null) candidates.push(...readCustom(custom))
  return { candidates }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Office's own serialization of `dcterms:modified`: seconds, UTC. */
const w3cdtfNow = (now: Date) => now.toISOString().replace(/\.\d{3}Z$/, 'Z')

function patchText(key: string, value: string | string[]): string {
  if (!Array.isArray(value)) return value.trim()
  const items = value.map((item) => item.trim()).filter(Boolean)
  // Office joins authors with ";" and keywords with ","; both read back.
  return items.join(key === 'creator' ? '; ' : ', ')
}

function parsePart(text: string): XmlElement {
  const root = parseXml(text)
  if (!root) {
    throw new EmbeddedWriteError(
      'The document properties in this file are damaged, so they cannot be edited.',
    )
  }
  return root
}

/**
 * The qualified name, and any declaration it needs, for a new element or
 * attribute. An attribute cannot use the default namespace — unprefixed, it
 * would be in none — so it always gets a prefix.
 */
function qualify(
  scope: XmlStartTag,
  ns: string,
  local: string,
  conventional: string,
  attribute = false,
): { name: string; declare: string } {
  const prefix = prefixFor(scope, ns)
  if (prefix !== undefined && !(attribute && prefix === '')) {
    return { name: prefix ? `${prefix}:${local}` : local, declare: '' }
  }
  return {
    name: `${conventional}:${local}`,
    declare: ` xmlns:${conventional}="${escapeXmlAttribute(ns)}"`,
  }
}

/** Replace an element's content, expanding it first if it was self-closing. */
function replaceContent(
  source: string,
  element: XmlElement,
  escaped: string,
): TextEdit {
  if (!element.selfClosing) {
    return { start: element.openEnd, end: element.closeStart, text: escaped }
  }
  const openTag = source
    .slice(element.start, element.openEnd)
    .replace(/\s*\/>$/, '>')
  return {
    start: element.start,
    end: element.end,
    text: `${openTag}${escaped}</${element.name}>`,
  }
}

/** Insert markup as the last content of `root`. */
function appendTo(source: string, root: XmlElement, markup: string): TextEdit {
  if (!root.selfClosing) {
    return { start: root.closeStart, end: root.closeStart, text: markup }
  }
  const openTag = source.slice(root.start, root.openEnd).replace(/\s*\/>$/, '>')
  return {
    start: root.start,
    end: root.end,
    text: `${openTag}${markup}</${root.name}>`,
  }
}

function editCore(
  source: string,
  values: Map<CoreKey, string | null>,
  now: Date,
): string {
  const root = parsePart(source)
  if (root.ns !== NS_CP || root.local !== 'coreProperties') {
    throw new EmbeddedWriteError(
      'The document properties in this file are damaged, so they cannot be edited.',
    )
  }
  const edits: TextEdit[] = []
  const appended: string[] = []
  const all = new Map(values)
  all.set('modifiedAt', w3cdtfNow(now))
  for (const [key, value] of all) {
    const field = CORE_FIELDS[key]
    const found = root.children.filter(
      (child) => child.ns === field.ns && child.local === field.local,
    )
    const [first, ...rest] = found
    if (value === null) {
      for (const element of found) {
        edits.push({ start: element.start, end: element.end, text: '' })
      }
      continue
    }
    const escaped = escapeXmlText(value)
    if (first) {
      edits.push(replaceContent(source, first, escaped))
      // One value per property: a duplicate would be read instead of it.
      for (const element of rest) {
        edits.push({ start: element.start, end: element.end, text: '' })
      }
      continue
    }
    const { name, declare } = qualify(root, field.ns, field.local, field.prefix)
    let attributes = declare
    if (key === 'modifiedAt') {
      // `xsi:type` names W3CDTF by QName, so its prefix must be in scope.
      const xsi = qualify(root, NS_XSI, 'type', 'xsi', true)
      const dctermsPrefix = name.includes(':')
        ? name.slice(0, name.indexOf(':'))
        : ''
      attributes += `${xsi.declare} ${xsi.name}="${dctermsPrefix ? `${dctermsPrefix}:` : ''}W3CDTF"`
    }
    appended.push(`<${name}${attributes}>${escaped}</${name}>`)
  }
  if (appended.length) edits.push(appendTo(source, root, appended.join('')))
  return applyEdits(source, edits)
}

function editCustom(
  source: string,
  values: Map<string, string | null>,
): string {
  const root = parsePart(source)
  if (!root.ns || !NS_CUSTOM.has(root.ns) || root.local !== 'Properties') {
    throw new EmbeddedWriteError(
      'The custom properties in this file are damaged, so they cannot be edited.',
    )
  }
  const properties = customProperties(root)
  const edits: TextEdit[] = []
  const removed = new Set<XmlElement>()
  for (const [name, value] of values) {
    const property = properties.find(
      (element) => propertyName(element) === name,
    )
    if (!property) {
      throw new EmbeddedWriteError(
        `"${name}" is not a custom property of this file.`,
      )
    }
    if (value === null) {
      edits.push({ start: property.start, end: property.end, text: '' })
      removed.add(property)
      continue
    }
    const valueElement = propertyValue(property)
    if (!valueElement || !VT_TEXT.has(valueElement.local)) {
      throw new EmbeddedWriteError(
        `"${name}" is not a text property, so it cannot be edited here.`,
      )
    }
    edits.push(replaceContent(source, valueElement, escapeXmlText(value)))
  }

  // A `pid` must be an integer of at least 2, unique in the part
  // (§22.3.2.2). Removing a property cannot break that, so only a pid that
  // was already broken is renumbered; a valid one never moves.
  const remaining = properties.filter((property) => !removed.has(property))
  const pidOf = (property: XmlElement) => {
    const raw = xmlAttribute(property, 'pid')?.value.trim() ?? ''
    return /^\d+$/.test(raw) ? Number(raw) : NaN
  }
  let next = Math.max(1, ...remaining.map(pidOf).filter((pid) => pid >= 2))
  const used = new Set<number>()
  for (const property of remaining) {
    const pid = pidOf(property)
    if (pid >= 2 && !used.has(pid)) {
      used.add(pid)
      continue
    }
    next += 1
    const attribute = xmlAttribute(property, 'pid')
    if (attribute) {
      edits.push({
        start: attribute.valueStart,
        end: attribute.valueEnd,
        text: String(next),
      })
    } else {
      const at = property.start + 1 + property.name.length
      edits.push({ start: at, end: at, text: ` pid="${next}"` })
    }
  }
  return applyEdits(source, edits)
}

/** Add the core part's content-type override, if it has none (Part 2 §10.1.2). */
function editContentTypes(source: string, partName: string): string {
  const root = parsePart(source)
  if (root.ns !== NS_CONTENT_TYPES || root.local !== 'Types') {
    throw new EmbeddedWriteError('The package index of this file is damaged.')
  }
  const wanted = `/${partName}`.toLowerCase()
  const has = root.children.some(
    (child) =>
      child.local === 'Override' &&
      xmlAttribute(child, 'PartName')?.value.toLowerCase() === wanted,
  )
  if (has) return source
  const name = root.prefix ? `${root.prefix}:Override` : 'Override'
  return applyEdits(source, [
    appendTo(
      source,
      root,
      `<${name} PartName="/${escapeXmlAttribute(partName)}" ContentType="${CORE_CONTENT_TYPE}"/>`,
    ),
  ])
}

/** Add the package relationship to a new core part (Part 2 §9.3). */
function editRelationships(source: string, partName: string): string {
  const root = parsePart(source)
  if (root.ns !== NS_RELATIONSHIPS || root.local !== 'Relationships') {
    throw new EmbeddedWriteError(
      'The package relationships of this file are damaged.',
    )
  }
  const ids = new Set(
    root.children.map((child) => xmlAttribute(child, 'Id')?.value),
  )
  let index = root.children.length + 1
  while (ids.has(`rId${index}`)) index++
  const name = root.prefix ? `${root.prefix}:Relationship` : 'Relationship'
  return applyEdits(source, [
    appendTo(
      source,
      root,
      `<${name} Id="rId${index}" Type="${CORE_RELATIONSHIP}" Target="${escapeXmlAttribute(partName)}"/>`,
    ),
  ])
}

/** An empty core properties part, declared the way Office declares it. */
const EMPTY_CORE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
  `<cp:coreProperties xmlns:cp="${NS_CP}" xmlns:dc="${NS_DC}" xmlns:dcterms="${NS_DCTERMS}" xmlns:dcmitype="${NS_DCMITYPE}" xmlns:xsi="${NS_XSI}"></cp:coreProperties>`

function readEditable(archive: ZipArchive, entry: ZipEntry): PartText {
  if (entry.encrypted) {
    throw new EmbeddedWriteError(
      'This file is encrypted, so its details can only be read.',
    )
  }
  const bytes = readZipEntry(archive, entry, PART_MAX_BYTES)
  if (!bytes) {
    throw new EmbeddedWriteError(
      'The document properties in this file are damaged, so they cannot be edited.',
    )
  }
  return decodeForEdit(bytes)
}

/**
 * Write an edit into an Office file's properties.
 *
 * Takes the canonical keys `title`, `subject`, `creator` (joined `"; "`),
 * `keywords` (joined `", "`), `description` and `category`, and
 * `ooxml|<name>` for a custom text property the file already holds; `null`
 * removes. `dcterms:modified` is always set to `now`. A file with no core
 * part gets one — plus its content-type override and package relationship.
 *
 * Throws {@link EmbeddedWriteError} for any other key, a custom property the
 * file lacks or that is not text, and a package it cannot edit safely.
 */
export function writeOoxml(
  bytes: Uint8Array,
  patch: EmbeddedPatch,
  options: { now: Date },
): Uint8Array {
  const archive = readZip(bytes)
  if (!archive || !findPart(archive, CONTENT_TYPES_PART)) {
    throw new EmbeddedWriteError('This file is not an Office document.')
  }

  const core = new Map<CoreKey, string | null>()
  const custom = new Map<string, string | null>()
  for (const [key, raw] of Object.entries(patch)) {
    const value = raw === null ? null : patchText(key, raw) || null
    if (isCoreKey(key) && CORE_WRITABLE.has(key)) {
      core.set(key, value)
      continue
    }
    const other = parseOtherEmbeddedKey(key)
    if (other?.namespace === 'ooxml') {
      custom.set(other.parts.join('|'), value)
      continue
    }
    throw new EmbeddedWriteError(
      `${embeddedFieldLabel(key, 'ooxml')} cannot be written into an Office document.`,
    )
  }

  const layout = packageLayout(archive)
  const changes = new Map<string, Uint8Array>()
  const verify = (name: string, part: PartText) => {
    if (!parseXml(part.text)) {
      throw new EmbeddedWriteError(
        'The edited properties did not verify, so nothing was saved.',
      )
    }
    changes.set(name, encodePart(part))
  }

  if (custom.size) {
    const name = layout.parts.custom
    const entry = name === undefined ? undefined : findPart(archive, name)
    if (!entry) {
      const [first] = custom.keys()
      throw new EmbeddedWriteError(
        `"${first}" is not a custom property of this file.`,
      )
    }
    const part = readEditable(archive, entry)
    verify(entry.name, { ...part, text: editCustom(part.text, custom) })
  }

  const coreName = layout.parts.core
  const coreEntry =
    coreName === undefined ? undefined : findPart(archive, coreName)
  if (coreEntry) {
    const part = readEditable(archive, coreEntry)
    verify(coreEntry.name, {
      ...part,
      text: editCore(part.text, core, options.now),
    })
  } else {
    // No core part: create one, declare its type, and relate it to the
    // package — or, when a relationship already names a missing part,
    // create the part it names.
    let name = coreName
    if (name === undefined) {
      name = DEFAULT_CORE_PART
      for (let index = 1; findPart(archive, name); index++) {
        name = `docProps/core${index}.xml`
      }
      if (!layout.relationships) {
        throw new EmbeddedWriteError(
          'This Office file has no package relationships.',
        )
      }
      const rels = readEditable(archive, layout.relationships)
      verify(layout.relationships.name, {
        ...rels,
        text: editRelationships(rels.text, name),
      })
    }
    const types = findPart(archive, CONTENT_TYPES_PART)
    if (!types)
      throw new EmbeddedWriteError('This file is not an Office document.')
    const typesPart = readEditable(archive, types)
    verify(types.name, {
      ...typesPart,
      text: editContentTypes(typesPart.text, name),
    })
    verify(name, { text: editCore(EMPTY_CORE, core, options.now), bom: false })
  }

  return rewriteZip(archive, changes, { now: options.now })
}
