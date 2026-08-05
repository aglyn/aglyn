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
 * Markdown-lite (AGL-123): the tiny subset blog entries use — headings,
 * bold/italic, links, images, bullet lists, paragraphs, fenced code blocks
 * and tables. Parsed into plain data blocks that renderers turn into
 * elements themselves (no HTML string is ever produced, so there is nothing
 * to sanitize).
 */

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'link'; text: string; href: string }

/** A table cell's content. Cells hold inline runs only — no nesting. */
export type MarkdownTableCell = MarkdownInline[]
export type MarkdownTableAlign = 'left' | 'center' | 'right'

export type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3; inlines: MarkdownInline[] }
  | { type: 'paragraph'; inlines: MarkdownInline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'list'; items: MarkdownInline[][] }
  /** Fenced block. `text` is verbatim; `lang` is '' when none was given. */
  | { type: 'code'; lang: string; text: string }
  /**
   * A GFM pipe table (AGL-974). Rectangular by construction: every row and
   * `align` carry exactly `header.length` cells, so renderers never have to
   * reason about ragged input and the serializer round-trips exactly.
   */
  | {
      type: 'table'
      align: MarkdownTableAlign[]
      header: MarkdownTableCell[]
      rows: MarkdownTableCell[][]
    }

const INLINE_PATTERN =
  /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g

/** Only http(s) links/images survive; anything else renders as text. */
function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}

/**
 * Link targets additionally allow SITE-RELATIVE paths (AGL-582) so entry
 * markdown can link to other pages of the same site — renderers give those
 * client-side navigation. Protocol-relative `//host` is rejected: it would
 * silently leave the site.
 */
function safeLinkUrl(url: string): string | null {
  if (/^\/(?!\/)/.test(url)) return url
  return safeUrl(url)
}

/** True for hrefs the parser emitted as site-relative (start with `/`). */
export function isInternalMarkdownHref(href: string): boolean {
  return /^\/(?!\/)/.test(href)
}

/**
 * Appends plain text, merging into a trailing text inline so the emitted
 * model is canonical (no adjacent text runs). Canonical inlines are what
 * makes `serializeMarkdownLite` a true inverse: a degraded link squeezed
 * between two text gaps re-parses to the same single text inline (AGL-582).
 */
function pushText(inlines: MarkdownInline[], text: string): void {
  if (!text) return
  const last = inlines[inlines.length - 1]
  if (last?.type === 'text') last.text += text
  else inlines.push({ type: 'text', text })
}

export function parseMarkdownInlines(text: string): MarkdownInline[] {
  const inlines: MarkdownInline[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      pushText(inlines, text.slice(cursor, index))
    }
    if (match[2] != null) {
      inlines.push({ type: 'bold', text: match[2] })
    } else if (match[4] != null) {
      inlines.push({ type: 'italic', text: match[4] })
    } else if (match[6] != null) {
      const href = safeLinkUrl(match[7])
      if (href) inlines.push({ type: 'link', text: match[6], href })
      else pushText(inlines, match[6])
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) {
    pushText(inlines, text.slice(cursor))
  }
  return inlines
}

/**
 * An ATX heading at ANY of markdown's six levels (AGL-1082). The dialect only
 * RENDERS two, but it must not mistake the other four for prose: matching just
 * `#{2,3}` made `# Title` — how essentially every repo README opens — fall
 * through to a paragraph carrying a literal `#`, silently, in every renderer.
 */
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/

/**
 * Clamps an ATX level onto the two the block union carries. `#` promotes to
 * the top rendered level and `####`+ demote to the bottom one, so an out-of-
 * range heading degrades to the NEAREST heading rather than to prose — the
 * same lossy-but-visible degradation the dialect already applies to a `*`
 * inside a bold run. Deliberately NOT widening `level` to `1 | 2 | 3`: every
 * renderer reads it as `level === 2 ? h2 : h3`, so a third value would type-
 * check clean and silently render an h1 as an h3 in five places. This also
 * makes the markdown path agree with the HTML-paste path, which has always
 * mapped `<h1>` to a level-2 heading.
 */
function clampHeadingLevel(hashes: number): 2 | 3 {
  return hashes <= 2 ? 2 : 3
}

/** ```` ``` ```` or longer, optionally naming a language. */
const FENCE_PATTERN = /^`{3,}\s*([^\s`]*)\s*$/
/** A delimiter cell of a GFM table's second row: `---`, `:--`, `:-:`, `--:`. */
const DELIMITER_CELL = /^:?-+:?$/

/** Splits a table row on `|`, dropping the optional outer pipes. */
function splitTableRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map((cell) => cell.trim())
}

function alignOfDelimiter(cell: string): MarkdownTableAlign {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  return right ? 'right' : 'left'
}

/**
 * A pipe table when the chunk's SECOND line is all delimiter cells — the
 * same rule GFM uses, and the reason a paragraph mentioning `a | b` is
 * still a paragraph. Cells are squared off to the header's width: ragged
 * rows pad with empty cells and overflow is dropped, so the model the
 * serializer writes back re-parses to itself.
 */
function parseTable(lines: string[]): MarkdownBlock | null {
  const [headerLine, delimiterLine] = lines
  if (!headerLine || !delimiterLine || !headerLine.includes('|')) return null
  const delimiters = splitTableRow(delimiterLine)
  if (!delimiters.every((cell) => DELIMITER_CELL.test(cell))) return null
  const header = splitTableRow(headerLine).map(parseMarkdownInlines)
  const columns = header.length
  const squared = (cells: string[]): MarkdownTableCell[] =>
    Array.from({ length: columns }, (_, index) =>
      parseMarkdownInlines(cells[index] ?? ''),
    )
  return {
    type: 'table',
    align: Array.from({ length: columns }, (_, index) =>
      alignOfDelimiter(delimiters[index] ?? '---'),
    ),
    header,
    rows: lines.slice(2).map((line) => squared(splitTableRow(line))),
  }
}

/** One blank-line-delimited chunk of non-fenced source, as a block. */
function parseChunk(chunk: string): MarkdownBlock | null {
  const trimmed = chunk.trim()
  if (!trimmed) return null
  const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed)
  if (image) {
    const src = safeUrl(image[2])
    return src ? { type: 'image', src, alt: image[1] } : null
  }
  const heading = HEADING_PATTERN.exec(trimmed)
  if (heading) {
    return {
      type: 'heading',
      level: clampHeadingLevel(heading[1].length),
      inlines: parseMarkdownInlines(heading[2]),
    }
  }
  const lines = trimmed.split('\n')
  const table = parseTable(lines)
  if (table) return table
  if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
    return {
      type: 'list',
      items: lines.map((line) =>
        parseMarkdownInlines(line.trim().replace(/^[-*]\s+/, '')),
      ),
    }
  }
  return { type: 'paragraph', inlines: parseMarkdownInlines(lines.join(' ')) }
}

/**
 * Blocks are blank-line separated, EXCEPT inside a ``` fence — a code
 * block owns its blank lines, so the scan is line-driven rather than a
 * split on `\n{2,}` (AGL-974). An unterminated fence runs to the end of
 * the document, which is what a README truncated mid-snippet needs.
 */
export function parseMarkdownLite(body: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = body.split('\n')
  let pending: string[] = []
  const flush = (): void => {
    const block = pending.length ? parseChunk(pending.join('\n')) : null
    if (block) blocks.push(block)
    pending = []
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const fence = FENCE_PATTERN.exec(line.trim())
    if (fence) {
      flush()
      const text: string[] = []
      while (
        ++index < lines.length &&
        !FENCE_PATTERN.test((lines[index] ?? '').trim())
      ) {
        text.push(lines[index] ?? '')
      }
      // Blank edges are the fence's own padding, not part of the snippet.
      while (text.length && !text[0]?.trim()) text.shift()
      while (text.length && !text[text.length - 1]?.trim()) text.pop()
      blocks.push({ type: 'code', lang: fence[1] ?? '', text: text.join('\n') })
      continue
    }
    if (line.trim()) pending.push(line)
    else flush()
  }
  flush()
  return blocks
}

/**
 * The plain text an inline run reads as — the words with the emphasis and
 * link syntax removed. What a heading contributes to an anchor slug and to a
 * table-of-contents label (AGL-1162), where `## The **fine** print` has to
 * become "The fine print" and `the-fine-print`, not two of either.
 */
export function markdownInlinesToText(inlines: MarkdownInline[]): string {
  return inlines.map((inline) => inline.text).join('')
}

/** A heading a table of contents can point at (AGL-1162). */
export interface MarkdownHeading {
  level: 2 | 3
  /** Heading text with emphasis/link syntax stripped. */
  text: string
  /** Anchor id, deterministic and unique within the document. */
  slug: string
  /** Position in the block list, so a renderer can id the right heading. */
  index: number
}

/**
 * Anchor id for one heading's text (AGL-1162).
 *
 * Deterministic by construction — the same words always produce the same id,
 * which is the whole point: a legal page's true source is a markdown file
 * elsewhere, and re-pasting it must not silently break every link that ever
 * pointed into it. Accents fold to their base letter (NFKD then drop the
 * combining marks) so `Résumé` and `Resume` are the same anchor rather than
 * one of them being an unreadable percent-encoded id.
 *
 * A heading of nothing but punctuation or non-Latin script slugifies to
 * empty; those get `SLUG_FALLBACK` here and are told apart by the numbering
 * in {@link collectMarkdownHeadings}, because an id is required for the link
 * to work at all and no id is worse than a dull one.
 */
export const SLUG_FALLBACK = 'section'

export function slugifyHeading(text: string): string {
  return (
    text
      .normalize('NFKD')
      // Combining diacritics left behind by the decomposition above.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || SLUG_FALLBACK
  )
}

/**
 * Every heading in a parsed document, with a unique anchor slug (AGL-1162).
 *
 * Duplicates take a `-2`, `-3`, … suffix in document order, and the loop
 * re-checks the suffixed candidate: a document holding two `## Notice`
 * headings AND a literal `## Notice 2` must not hand the same id to two
 * elements, which is exactly what a plain counter would do.
 *
 * Deliberately NOT a widening of the `MarkdownBlock` union. The union is
 * rendered exhaustively in five places, so a slug carried on the heading
 * block would have to be produced by every writer of that union — including
 * the visual editor's serializer, which round-trips through markdown source
 * that has nowhere to put one. Derived here instead, from the same parse the
 * renderer already has, so the markdown text stays the only source of truth.
 */
export function collectMarkdownHeadings(
  blocks: MarkdownBlock[],
): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  const used = new Set<string>()
  blocks.forEach((block, index) => {
    if (block.type !== 'heading') return
    const text = markdownInlinesToText(block.inlines).trim()
    const base = slugifyHeading(text)
    let slug = base
    let suffix = 1
    while (used.has(slug)) {
      suffix += 1
      slug = `${base}-${suffix}`
    }
    used.add(slug)
    headings.push({ level: block.level, text, slug, index })
  })
  return headings
}

/** Newlines cannot exist inside an inline run — flatten them to a space. */
const flattenInlineText = (text: string): string =>
  text.replace(/\s*\n+\s*/g, ' ')

/**
 * Serializes inlines back to markdown-lite source (AGL-582). Characters an
 * inline run cannot represent (the dialect has NO escapes) are dropped:
 * `*` inside bold/italic, `]` in link text/alt, `)` or whitespace in URLs.
 * Parser-emitted inlines never contain them, so for those this is exact.
 */
export function serializeMarkdownInlines(inlines: MarkdownInline[]): string {
  let out = ''
  for (const inline of inlines) {
    if (inline.type === 'bold' || inline.type === 'italic') {
      const text = flattenInlineText(inline.text).replace(/\*/g, '')
      if (!text) continue
      out += inline.type === 'bold' ? `**${text}**` : `*${text}*`
    } else if (inline.type === 'link') {
      const text = flattenInlineText(inline.text).replace(/\]/g, '')
      const href = inline.href.replace(/[)\s]/g, '')
      out += text && href ? `[${text}](${href})` : text
    } else {
      out += flattenInlineText(inline.text)
    }
  }
  return out
}

/**
 * Inverse of `parseMarkdownLite` — the WYSIWYG round-trip contract
 * (AGL-582): for any parser-produced model, the serialized string re-parses
 * to a deep-equal model, and serializing is stable (a second
 * parse→serialize round-trip returns the identical string). Editor-produced
 * models are additionally NORMALIZED the same way the parser would: blocks
 * and list items that would parse to nothing (empty text) are omitted, and
 * block lines are edge-trimmed. Entry bodies stay markdown-lite strings in
 * Firestore — this is the only writer the visual editor goes through.
 */
export function serializeMarkdownLite(blocks: MarkdownBlock[]): string {
  const chunks: string[] = []
  for (const block of blocks) {
    if (block.type === 'image') {
      const src = block.src.replace(/[)\s]/g, '')
      const alt = flattenInlineText(block.alt).replace(/\]/g, '')
      if (src) chunks.push(`![${alt}](${src})`)
      continue
    }
    if (block.type === 'list') {
      const lines = block.items
        .map((item) => serializeMarkdownInlines(item).trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
      if (lines.length) chunks.push(lines.join('\n'))
      continue
    }
    if (block.type === 'code') {
      // The fence is the only delimiter the dialect has, so a fence INSIDE
      // the snippet would end it early — those backticks drop, the same way
      // an unrepresentable `*` drops from a bold run.
      const text = block.text
        .replace(/^(\s*)`{3,}/gm, '$1')
        .replace(/^(?:[ \t]*\n)+/, '')
        .replace(/(?:\n[ \t]*)+$/, '')
      const lang = block.lang.replace(/[^\w+#.-]/g, '')
      chunks.push([`\`\`\`${lang}`, ...(text ? [text] : []), '```'].join('\n'))
      continue
    }
    if (block.type === 'table') {
      // `|` separates cells and there are no escapes, so a pipe inside a
      // cell drops. Empty cells are kept — they are meaningful in a table.
      const row = (cells: MarkdownTableCell[]): string =>
        `| ${cells
          .map((cell) => serializeMarkdownInlines(cell).replace(/\|/g, '').trim())
          .join(' | ')} |`
      if (!block.header.length) continue
      const delimiters = block.header.map((_, index) => {
        const align = block.align[index] ?? 'left'
        return align === 'center' ? ':-:' : align === 'right' ? '--:' : '---'
      })
      chunks.push(
        [
          row(block.header),
          `| ${delimiters.join(' | ')} |`,
          // Squared off to the header: the parser reads it back that way,
          // so writing anything else would not round-trip.
          ...block.rows.map((cells) =>
            row(
              Array.from(
                { length: block.header.length },
                (_, index) => cells[index] ?? [],
              ),
            ),
          ),
        ].join('\n'),
      )
      continue
    }
    const line = serializeMarkdownInlines(block.inlines).trim()
    if (!line) continue
    chunks.push(
      block.type === 'heading' ? `${'#'.repeat(block.level)} ${line}` : line,
    )
  }
  return chunks.join('\n\n')
}
