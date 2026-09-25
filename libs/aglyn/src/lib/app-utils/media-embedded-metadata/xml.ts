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
 * A minimal, FAITHFUL XML DOM for editing XMP packets in place (AGL-3331).
 *
 * ## Why not a general XML library
 *
 * An XMP packet written by Lightroom or Photoshop carries structures this
 * module does not understand — `xmpMM:History`, `crs:*` tone curves,
 * `mwg-rs` face regions, contact-info structs — and an edit of one caption
 * must leave every one of them exactly as it was. A conventional DOM
 * normalizes on the way in (quote style, attribute whitespace, entity
 * spelling, `<a/>` versus `<a></a>`), so a round trip through it rewrites
 * the whole packet. This one keeps the raw text of everything it parses
 * next to the decoded value, and {@link serializeXml} writes the raw text
 * back, so `serializeXml(parseXml(s)) === s` for any input it accepts and
 * only the nodes an edit touched come out different.
 *
 * ## What it refuses
 *
 * The input is hostile: it arrives inside an uploaded file. There is NO DTD
 * support at all — `<!DOCTYPE`, and with it `<!ENTITY`, external entities
 * and entity expansion ("billion laughs"), are unparseable, as is any named
 * entity other than the five XML predefines (XML 1.0 §4.6). Depth, node
 * count and input length are bounded. Everything that is not well-formed
 * returns `null`; nothing here throws on input.
 *
 * It is deliberately lenient in one direction only: content outside the
 * root element (the `<?xpacket?>` wrappers, trailing padding, a BOM) is
 * kept as nodes of the document rather than rejected, because XMP packets
 * live in exactly that space and a fragment handed over from an SVG's
 * `<metadata>` may have several top-level elements.
 */

/** The `xml:` prefix is bound by definition (Namespaces in XML 1.0 §3). */
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
/** The `xmlns:` prefix is bound by definition (Namespaces in XML 1.0 §3). */
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'

/** Default parse bounds. XMP packets are kilobytes; these are generous. */
export const XML_MAX_DEPTH = 64
export const XML_MAX_NODES = 50_000
export const XML_MAX_LENGTH = 16 * 1024 * 1024

export interface XmlLimits {
  /** Element nesting depth; the root element is depth 1. */
  maxDepth?: number
  /** Elements, attributes, text, CDATA, comments and PIs together. */
  maxNodes?: number
  /** Input length in UTF-16 code units. */
  maxLength?: number
}

export interface XmlDocument {
  type: 'document'
  children: XmlNode[]
}

export type XmlNode =
  XmlElement | XmlText | XmlCData | XmlComment | XmlProcessingInstruction

export type XmlParent = XmlDocument | XmlElement

export interface XmlElement {
  type: 'element'
  /** The qualified name as written, prefix included. */
  name: string
  /** In source order; order is part of what a round trip preserves. */
  attributes: XmlAttribute[]
  children: XmlNode[]
  parent: XmlParent | null
  /**
   * Written as `<a/>`. Only honored while the element has no children, so
   * appending to a self-closed element serializes it as `<a>…</a>`.
   */
  selfClosing: boolean
  /** Whitespace after the last attribute (or the name), before `>`/`/>`. */
  tagTail: string
  /** Whitespace between the name and `>` of the end tag: `</a >`. */
  endTagTail: string
}

export interface XmlAttribute {
  /** The qualified name as written. */
  name: string
  /**
   * The decoded, normalized value (XML 1.0 §3.3.3): entity and character
   * references resolved, literal tabs and newlines turned into spaces.
   */
  value: string
  /** Exactly what was between the quotes. Serialized as-is. */
  raw: string
  quote: '"' | "'"
  /** Whitespace before the name — a space, or a newline and an indent. */
  leading: string
  /** The `=` with whatever whitespace the author put around it. */
  equals: string
}

export interface XmlText {
  type: 'text'
  /** Decoded (references resolved, line ends normalized, XML 1.0 §2.11). */
  value: string
  /** Exactly as written. Serialized as-is. */
  raw: string
}

export interface XmlCData {
  type: 'cdata'
  value: string
}

export interface XmlComment {
  type: 'comment'
  value: string
}

export interface XmlProcessingInstruction {
  type: 'pi'
  target: string
  /** Everything after the target up to `?>`, leading whitespace included. */
  data: string
}

/*
 * XML 1.0 (Fifth Edition) §2.3, NameStartChar and NameChar, exactly. The
 * `u` flag makes the astral range one range of code points rather than a
 * pair of surrogate halves. The combining-mark range leads NameChar so no
 * base character sits right before it in the class.
 */
const NAME_START =
  'A-Za-z_:\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D' +
  '\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF' +
  '\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const NAME_CHAR =
  '\\u0300-\\u036F' + NAME_START + '\\-.0-9\\u00B7\\u203F-\\u2040'
const NAME = new RegExp(`[${NAME_START}][${NAME_CHAR}]*`, 'uy')
const WHITESPACE = /[ \t\r\n]*/y
const EQUALS = /[ \t\r\n]*=[ \t\r\n]*/y
const ALL_WHITESPACE = /^[ \t\r\n]*$/

/** Read a Name at `pos` with a sticky regex, or null. */
function matchAt(pattern: RegExp, input: string, pos: number): string | null {
  pattern.lastIndex = pos
  const match = pattern.exec(input)
  return match ? match[0] : null
}

/**
 * Whether a code point is a legal XML 1.0 `Char` (§2.2). Character
 * references to anything else — `&#0;`, a lone surrogate — are not
 * well-formed.
 */
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

const PREDEFINED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
}

/**
 * Decode the raw text of a text node or an attribute value.
 *
 * Applies the normalizations a conforming parser applies, in the order the
 * spec gives them: line ends first (§2.11, CRLF and lone CR become LF),
 * then — for attributes only — each literal whitespace character becomes a
 * space (§3.3.3), then references are replaced. A character produced by a
 * reference is NOT normalized, which is how `&#xA;` survives in an
 * attribute. Returns null for an undeclared entity, a bare `&` or a
 * reference to a character XML cannot hold.
 */
export function decodeXmlText(raw: string, attribute = false): string | null {
  let text = raw
  if (text.includes('\r')) text = text.replace(/\r\n?/g, '\n')
  if (attribute && /[\t\n]/.test(text)) text = text.replace(/[\t\n]/g, ' ')
  if (!text.includes('&')) return text
  let out = ''
  let pos = 0
  for (;;) {
    const amp = text.indexOf('&', pos)
    if (amp === -1) break
    const semi = text.indexOf(';', amp + 1)
    // The longest legal reference is a padded numeric one; 32 is generous.
    if (semi === -1 || semi - amp > 32) return null
    const ref = text.slice(amp + 1, semi)
    let decoded: string | undefined
    if (ref.startsWith('#x')) {
      if (!/^#x[0-9A-Fa-f]+$/.test(ref)) return null
      const code = parseInt(ref.slice(2), 16)
      if (!isXmlChar(code)) return null
      decoded = String.fromCodePoint(code)
    } else if (ref.startsWith('#')) {
      if (!/^#[0-9]+$/.test(ref)) return null
      const code = parseInt(ref.slice(1), 10)
      if (!isXmlChar(code)) return null
      decoded = String.fromCodePoint(code)
    } else {
      decoded = Object.prototype.hasOwnProperty.call(PREDEFINED_ENTITIES, ref)
        ? PREDEFINED_ENTITIES[ref]
        : undefined
      if (decoded === undefined) return null
    }
    out += text.slice(pos, amp) + decoded
    pos = semi + 1
  }
  return out + text.slice(pos)
}

/**
 * Escape a value for a text node. `>` is escaped too so a value can never
 * spell `]]>`, and CR is written as a reference because a parser would
 * otherwise normalize it away (§2.11).
 */
export function escapeXmlText(value: string): string {
  return value.replace(/[&<>\r]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&#xD;',
  )
}

/**
 * Escape a value for an attribute delimited by `quote`. Tab, LF and CR are
 * written as references so attribute-value normalization (§3.3.3) does not
 * turn them into spaces on the next read.
 */
export function escapeXmlAttribute(
  value: string,
  quote: '"' | "'" = '"',
): string {
  return value.replace(/[&<>"'\t\n\r]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return quote === '"' ? '&quot;' : ch
      case "'":
        return quote === "'" ? '&apos;' : ch
      case '\t':
        return '&#x9;'
      case '\n':
        return '&#xA;'
      default:
        return '&#xD;'
    }
  })
}

/**
 * Whether a string holds a character that XML 1.0 cannot represent at all,
 * not even as a reference (§2.2): C0 controls other than tab/LF/CR, U+FFFE,
 * U+FFFF and unpaired surrogates. A writer must refuse such a value rather
 * than emit a packet no reader will parse.
 */
export function hasNonXmlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
      return true
    }
    if (!isXmlChar(code)) return true
  }
  return false
}

/**
 * Parse `input` into a faithful DOM, or return null when it is not
 * well-formed, declares a DTD, or exceeds a bound. Never throws.
 *
 * The parser is iterative — an explicit stack, not recursion — so a
 * hostile nesting depth costs a counter check, not the call stack.
 */
export function parseXml(
  input: string,
  limits: XmlLimits = {},
): XmlDocument | null {
  try {
    return parse(input, limits)
  } catch {
    // Defensive only: every path below returns null rather than throwing,
    // and a parser of hostile bytes must not become a 500 if one is missed.
    return null
  }
}

function parse(input: string, limits: XmlLimits): XmlDocument | null {
  if (typeof input !== 'string') return null
  const maxDepth = limits.maxDepth ?? XML_MAX_DEPTH
  const maxNodes = limits.maxNodes ?? XML_MAX_NODES
  const maxLength = limits.maxLength ?? XML_MAX_LENGTH
  if (input.length > maxLength) return null

  const doc: XmlDocument = { type: 'document', children: [] }
  const stack: XmlParent[] = [doc]
  let nodes = 0
  let pos = 0
  const length = input.length

  const current = (): XmlParent => stack[stack.length - 1] ?? doc
  const add = (node: XmlNode): boolean => {
    if (++nodes > maxNodes) return false
    const parent = current()
    if (node.type === 'element') node.parent = parent
    parent.children.push(node)
    return true
  }

  while (pos < length) {
    const lt = input.indexOf('<', pos)
    const textEnd = lt === -1 ? length : lt
    if (textEnd > pos) {
      const raw = input.slice(pos, textEnd)
      const value = decodeXmlText(raw)
      if (value === null) return null
      if (!add({ type: 'text', value, raw })) return null
      pos = textEnd
      continue
    }

    // `input[pos]` is '<'.
    if (input.startsWith('<!--', pos)) {
      const end = input.indexOf('-->', pos + 4)
      if (end === -1) return null
      if (!add({ type: 'comment', value: input.slice(pos + 4, end) }))
        return null
      pos = end + 3
      continue
    }
    if (input.startsWith('<![CDATA[', pos)) {
      // CDATA is content (§2.7): it cannot stand outside an element.
      if (stack.length === 1) return null
      const end = input.indexOf(']]>', pos + 9)
      if (end === -1) return null
      if (!add({ type: 'cdata', value: input.slice(pos + 9, end) })) return null
      pos = end + 3
      continue
    }
    if (input.startsWith('<!', pos)) {
      // <!DOCTYPE, <!ENTITY, <!ELEMENT, <!ATTLIST … — no DTD, ever.
      return null
    }
    if (input.startsWith('<?', pos)) {
      const target = matchAt(NAME, input, pos + 2)
      if (!target) return null
      const end = input.indexOf('?>', pos + 2 + target.length)
      if (end === -1) return null
      const data = input.slice(pos + 2 + target.length, end)
      // PI data is separated from its target by whitespace (§2.6).
      if (data && !/^[ \t\r\n]/.test(data)) return null
      if (!add({ type: 'pi', target, data })) return null
      pos = end + 2
      continue
    }
    if (input.startsWith('</', pos)) {
      const name = matchAt(NAME, input, pos + 2)
      if (!name) return null
      let cursor = pos + 2 + name.length
      const tail = matchAt(WHITESPACE, input, cursor) ?? ''
      cursor += tail.length
      if (input[cursor] !== '>') return null
      const open = current()
      if (open.type !== 'element' || open.name !== name) return null
      open.endTagTail = tail
      stack.pop()
      pos = cursor + 1
      continue
    }

    // A start tag (§3.1).
    const name = matchAt(NAME, input, pos + 1)
    if (!name) return null
    if (stack.length > maxDepth) return null
    const element: XmlElement = {
      type: 'element',
      name,
      attributes: [],
      children: [],
      parent: null,
      selfClosing: false,
      tagTail: '',
      endTagTail: '',
    }
    if (!add(element)) return null
    let cursor = pos + 1 + name.length
    const seen = new Set<string>()
    for (;;) {
      const space = matchAt(WHITESPACE, input, cursor) ?? ''
      cursor += space.length
      if (input[cursor] === '>') {
        element.tagTail = space
        cursor += 1
        stack.push(element)
        break
      }
      if (input.startsWith('/>', cursor)) {
        element.tagTail = space
        element.selfClosing = true
        cursor += 2
        break
      }
      // Attributes are separated from the name and each other by space.
      if (!space) return null
      const attrName = matchAt(NAME, input, cursor)
      if (!attrName) return null
      cursor += attrName.length
      const equals = matchAt(EQUALS, input, cursor)
      if (!equals) return null
      cursor += equals.length
      const quote = input[cursor]
      if (quote !== '"' && quote !== "'") return null
      const close = input.indexOf(quote, cursor + 1)
      if (close === -1) return null
      const raw = input.slice(cursor + 1, close)
      // `<` may not appear in an attribute value, even escaped-looking.
      if (raw.includes('<')) return null
      const value = decodeXmlText(raw, true)
      if (value === null) return null
      // Unique attribute names (§3.1, WFC: Unique Att Spec).
      if (seen.has(attrName)) return null
      seen.add(attrName)
      if (++nodes > maxNodes) return null
      element.attributes.push({
        name: attrName,
        value,
        raw,
        quote,
        leading: space,
        equals,
      })
      cursor = close + 1
    }
    pos = cursor
  }

  // An element still open at the end of input is an unterminated tag.
  if (stack.length !== 1) return null
  return doc
}

/** Serialize a document or node back to text, raw spellings preserved. */
export function serializeXml(node: XmlDocument | XmlNode): string {
  const out: string[] = []
  write(node, out)
  return out.join('')
}

function write(node: XmlDocument | XmlNode, out: string[]): void {
  switch (node.type) {
    case 'document':
      for (const child of node.children) write(child, out)
      return
    case 'text':
      out.push(node.raw)
      return
    case 'cdata':
      out.push('<![CDATA[', node.value, ']]>')
      return
    case 'comment':
      out.push('<!--', node.value, '-->')
      return
    case 'pi':
      out.push('<?', node.target, node.data, '?>')
      return
    case 'element': {
      out.push('<', node.name)
      for (const attr of node.attributes) {
        out.push(
          attr.leading,
          attr.name,
          attr.equals,
          attr.quote,
          attr.raw,
          attr.quote,
        )
      }
      out.push(node.tagTail)
      if (node.selfClosing && !node.children.length) {
        out.push('/>')
        return
      }
      out.push('>')
      for (const child of node.children) write(child, out)
      out.push('</', node.name, node.endTagTail, '>')
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Construction and mutation. Every helper keeps `raw` in step with `value`
// and `parent` in step with `children`, so a serializer pass never has to
// guess which of the two is current.
// ---------------------------------------------------------------------------

/** A text node whose raw spelling is the escaped value. */
export function createText(value: string): XmlText {
  return { type: 'text', value, raw: escapeXmlText(value) }
}

/**
 * A whitespace-only text node written verbatim — indentation copied from
 * the document, where escaping a CR would turn `\r\n` into `&#xD;\n`.
 * Anything that is not XML whitespace is dropped.
 */
export function createWhitespace(raw: string): XmlText {
  const clean = raw.replace(/[^ \t\r\n]/g, '')
  return { type: 'text', value: clean.replace(/\r\n?/g, '\n'), raw: clean }
}

/** A new element; attributes are `[name, value]` pairs, space-separated. */
export function createElement(
  name: string,
  attributes: ReadonlyArray<readonly [string, string]> = [],
  children: XmlNode[] = [],
  quote: '"' | "'" = '"',
): XmlElement {
  const element: XmlElement = {
    type: 'element',
    name,
    attributes: attributes.map(([attrName, value]) => ({
      name: attrName,
      value,
      raw: escapeXmlAttribute(value, quote),
      quote,
      leading: ' ',
      equals: '=',
    })),
    children: [],
    parent: null,
    selfClosing: false,
    tagTail: '',
    endTagTail: '',
  }
  insertChildren(element, 0, children)
  return element
}

/** Insert nodes at `index`, adopting any elements among them. */
export function insertChildren(
  parent: XmlParent,
  index: number,
  nodes: XmlNode[],
): void {
  for (const node of nodes) {
    if (node.type === 'element') node.parent = parent
  }
  parent.children.splice(index, 0, ...nodes)
}

/** Replace every child of `parent`. */
export function replaceChildren(parent: XmlParent, nodes: XmlNode[]): void {
  parent.children = []
  insertChildren(parent, 0, nodes)
}

/** Remove one child. Returns false when it was not a child of `parent`. */
export function removeChild(parent: XmlParent, node: XmlNode): boolean {
  const index = parent.children.indexOf(node)
  if (index === -1) return false
  parent.children.splice(index, 1)
  if (node.type === 'element') node.parent = null
  return true
}

export function getAttribute(
  element: XmlElement,
  name: string,
): XmlAttribute | undefined {
  return element.attributes.find((attr) => attr.name === name)
}

/**
 * Set an attribute's value. An existing attribute keeps its position,
 * quote style and surrounding whitespace; a new one is appended with
 * `leading` before it.
 */
export function setAttribute(
  element: XmlElement,
  name: string,
  value: string,
  options: { leading?: string; quote?: '"' | "'"; index?: number } = {},
): XmlAttribute {
  const existing = getAttribute(element, name)
  if (existing) {
    existing.value = value
    existing.raw = escapeXmlAttribute(value, existing.quote)
    return existing
  }
  const quote = options.quote ?? '"'
  const attr: XmlAttribute = {
    name,
    value,
    raw: escapeXmlAttribute(value, quote),
    quote,
    leading: options.leading ?? ' ',
    equals: '=',
  }
  const index = options.index ?? element.attributes.length
  element.attributes.splice(
    Math.max(0, Math.min(index, element.attributes.length)),
    0,
    attr,
  )
  return attr
}

export function removeAttribute(element: XmlElement, name: string): boolean {
  const index = element.attributes.findIndex((attr) => attr.name === name)
  if (index === -1) return false
  element.attributes.splice(index, 1)
  return true
}

/** Replace an element's content with one text node (none for ''). */
export function setTextContent(element: XmlElement, value: string): void {
  replaceChildren(element, value ? [createText(value)] : [])
  // `<a/>` would read back as '' either way; an explicit pair is clearer
  // for a property that was just given a value.
  if (value) element.selfClosing = false
}

/** The decoded text of an element's direct text and CDATA children. */
export function textContent(element: XmlElement): string {
  let out = ''
  for (const child of element.children) {
    if (child.type === 'text' || child.type === 'cdata') out += child.value
  }
  return out
}

export function elementChildren(parent: XmlParent): XmlElement[] {
  return parent.children.filter(
    (child): child is XmlElement => child.type === 'element',
  )
}

/** Whether a text node is nothing but XML whitespace. */
export function isWhitespaceText(node: XmlNode | undefined): node is XmlText {
  return node?.type === 'text' && ALL_WHITESPACE.test(node.raw)
}

/**
 * Visit every element in document order, iteratively. Return `false` from
 * `visit` to skip an element's descendants.
 */
export function walkElements(
  root: XmlParent,
  visit: (element: XmlElement) => boolean | void,
): void {
  const pending: XmlNode[] = [...root.children].reverse()
  while (pending.length) {
    const node = pending.pop()
    if (!node || node.type !== 'element') continue
    if (visit(node) === false) continue
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i]
      if (child) pending.push(child)
    }
  }
}

// ---------------------------------------------------------------------------
// Namespaces (Namespaces in XML 1.0, Third Edition).
// ---------------------------------------------------------------------------

/** `dc:title` → `{ prefix: 'dc', local: 'title' }`; no colon → prefix ''. */
export function splitQName(name: string): { prefix: string; local: string } {
  const colon = name.indexOf(':')
  return colon === -1
    ? { prefix: '', local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) }
}

/**
 * The namespace URI `prefix` is bound to at `element`, through the nearest
 * `xmlns:prefix` (or, for `''`, `xmlns`) on it or an ancestor. Null when
 * unbound — or, for the default namespace, explicitly undeclared (§6.2).
 */
export function resolvePrefix(
  element: XmlElement,
  prefix: string,
): string | null {
  if (prefix === 'xml') return XML_NAMESPACE
  if (prefix === 'xmlns') return XMLNS_NAMESPACE
  const declaration = prefix ? `xmlns:${prefix}` : 'xmlns'
  let cursor: XmlParent | null = element
  while (cursor && cursor.type === 'element') {
    const attr = getAttribute(cursor, declaration)
    if (attr) return attr.value || null
    cursor = cursor.parent
  }
  return null
}

/** An element's namespace URI: its prefix's, or the default namespace. */
export function elementNamespace(element: XmlElement): string | null {
  return resolvePrefix(element, splitQName(element.name).prefix)
}

/**
 * An attribute's namespace URI. An unprefixed attribute is in NO namespace
 * — the default namespace does not apply to attributes (§6.2).
 */
export function attributeNamespace(
  element: XmlElement,
  attr: XmlAttribute,
): string | null {
  if (attr.name === 'xmlns') return XMLNS_NAMESPACE
  const { prefix } = splitQName(attr.name)
  return prefix ? resolvePrefix(element, prefix) : null
}

/** Whether an attribute is a namespace declaration. */
export function isNamespaceDeclaration(attr: XmlAttribute): boolean {
  return attr.name === 'xmlns' || attr.name.startsWith('xmlns:')
}

/**
 * A prefix bound to `uri` in scope at `element` and not shadowed by a
 * nearer declaration of the same prefix, or null. The default namespace is
 * never returned: an attribute cannot use it.
 */
export function prefixForNamespace(
  element: XmlElement,
  uri: string,
): string | null {
  let cursor: XmlParent | null = element
  while (cursor && cursor.type === 'element') {
    for (const attr of cursor.attributes) {
      if (!attr.name.startsWith('xmlns:') || attr.value !== uri) continue
      const prefix = attr.name.slice(6)
      if (resolvePrefix(element, prefix) === uri) return prefix
    }
    cursor = cursor.parent
  }
  return null
}
