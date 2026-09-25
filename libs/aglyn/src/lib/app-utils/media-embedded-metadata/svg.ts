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
 * The title, description and XMP of an SVG (AGL-3331). Read-only: an SVG is
 * sanitized on every ingress and is its own markup, so an edit belongs in
 * the file's source, not in a metadata writer.
 *
 * - `<title>` and `<desc>` that are DIRECT children of the root `<svg>` are
 *   the document's own (SVG 2 §5.9); a `<title>` inside a `<g>` names that
 *   group, not the file, and is ignored.
 * - A `<metadata>` child holding an `rdf:RDF` — how Inkscape and Illustrator
 *   embed Dublin Core and XMP (SVG 1.1 §21.2) — is handed back as `xmp`
 *   for the XMP reader, with every namespace declared on its ancestors
 *   copied onto it, since Inkscape binds `rdf:`, `dc:` and `cc:` on the root
 *   `<svg>` and the fragment would otherwise not parse on its own.
 *
 * The document is streamed through `scanXml`, never built into a tree, so a
 * 15 MB map export costs one pass and no more memory than its nesting. A
 * DOCTYPE is tolerated only without an internal subset — Illustrator has
 * written an inert external-id DOCTYPE for twenty years, and the SVG
 * sanitizer keeps it for that reason — while an internal subset or any
 * `<!ENTITY>` makes the file unreadable here.
 */

import { escapeXmlAttribute, scanXml, type XmlStartTag } from './ooxml'
import type { EmbeddedCandidate } from './types'

const NS_SVG = 'http://www.w3.org/2000/svg'
const NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const NS_XMLNS = 'http://www.w3.org/2000/xmlns/'

/** Past this, the file is not read at all. */
export const SVG_READ_MAX_BYTES = 16 * 1024 * 1024

function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * An element's source text, standalone: every namespace binding in scope
 * at it that it does not declare itself is added to its start tag.
 */
function standalone(source: string, tag: XmlStartTag, end: number): string {
  const own = new Set(
    tag.attributes
      .filter((attribute) => attribute.ns === NS_XMLNS)
      .map((attribute) => (attribute.prefix === null ? '' : attribute.local)),
  )
  let declarations = ''
  for (const [prefix, uri] of tag.namespaces) {
    if (prefix === 'xml' || own.has(prefix)) continue
    declarations += ` ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${escapeXmlAttribute(uri)}"`
  }
  const at = tag.start + 1 + tag.name.length
  return source.slice(tag.start, at) + declarations + source.slice(at, end)
}

/**
 * Read an SVG's title, description and embedded XMP.
 *
 * Null when the bytes are over {@link SVG_READ_MAX_BYTES}, are not a
 * well-formed XML document whose root is `<svg>`, or carry a DOCTYPE
 * internal subset or an entity declaration.
 */
export function readSvg(
  bytes: Uint8Array,
): { candidates: EmbeddedCandidate[]; xmp: string | null } | null {
  if (bytes.length > SVG_READ_MAX_BYTES) return null
  const source = decode(bytes)

  // Held in one object: the handlers below assign it, and a closure's
  // assignments are invisible to the narrowing of plain `let` variables.
  const state: {
    root: XmlStartTag | null
    isSvg: boolean
    title: string | null
    description: string | null
    capture: { tag: XmlStartTag; text: string[] } | null
    metadata: XmlStartTag | null
    packet: { tag: XmlStartTag; hasRdf: boolean } | null
    xmp: string | null
  } = {
    root: null,
    isSvg: false,
    title: null,
    description: null,
    capture: null,
    metadata: null,
    packet: null,
    xmp: null,
  }

  const ok = scanXml(
    source,
    {
      open(tag) {
        if (tag.depth === 0) {
          state.root = tag
          state.isSvg =
            tag.local === 'svg' && (tag.ns === null || tag.ns === NS_SVG)
          return
        }
        const root = state.root
        if (!state.isSvg || !root) return
        if (tag.depth === 1) {
          if (tag.ns !== root.ns) return
          if (
            (tag.local === 'title' && !state.title) ||
            (tag.local === 'desc' && !state.description)
          ) {
            state.capture = { tag, text: [] }
          } else if (tag.local === 'metadata' && state.xmp === null) {
            state.metadata = tag
          }
          return
        }
        if (!state.metadata) return
        const isRdf = tag.local === 'RDF' && tag.ns === NS_RDF
        if (tag.depth === 2) state.packet = { tag, hasRdf: isRdf }
        else if (state.packet && isRdf) state.packet.hasRdf = true
      },
      text(text) {
        state.capture?.text.push(text)
      },
      close(tag, _closeStart, end) {
        if (state.capture?.tag === tag) {
          const value = state.capture.text.join('')
          if (tag.local === 'title')
            state.title = value.replace(/\s+/g, ' ').trim()
          else state.description = value.trim()
          state.capture = null
        } else if (state.packet?.tag === tag) {
          if (state.packet.hasRdf && state.xmp === null) {
            state.xmp = standalone(source, tag, end)
          }
          state.packet = null
        } else if (state.metadata === tag) {
          state.metadata = null
        }
      },
    },
    { allowExternalDoctype: true, maxDepth: 1024, maxElements: 8_000_000 },
  )
  if (!ok || !state.isSvg) return null

  const candidates: EmbeddedCandidate[] = []
  if (state.title)
    candidates.push({ key: 'title', value: state.title, source: 'svg' })
  if (state.description) {
    candidates.push({
      key: 'description',
      value: state.description,
      source: 'svg',
    })
  }
  return { candidates, xmp: state.xmp }
}
