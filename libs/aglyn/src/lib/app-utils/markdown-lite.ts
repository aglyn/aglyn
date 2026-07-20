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
 * bold/italic, links, images, bullet lists, paragraphs. Parsed into plain
 * data blocks that renderers turn into elements themselves (no HTML string
 * is ever produced, so there is nothing to sanitize).
 */

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'link'; text: string; href: string }

export type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3; inlines: MarkdownInline[] }
  | { type: 'paragraph'; inlines: MarkdownInline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'list'; items: MarkdownInline[][] }

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

export function parseMarkdownInlines(text: string): MarkdownInline[] {
  const inlines: MarkdownInline[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      inlines.push({ type: 'text', text: text.slice(cursor, index) })
    }
    if (match[2] != null) {
      inlines.push({ type: 'bold', text: match[2] })
    } else if (match[4] != null) {
      inlines.push({ type: 'italic', text: match[4] })
    } else if (match[6] != null) {
      const href = safeLinkUrl(match[7])
      if (href) inlines.push({ type: 'link', text: match[6], href })
      else inlines.push({ type: 'text', text: match[6] })
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) {
    inlines.push({ type: 'text', text: text.slice(cursor) })
  }
  return inlines
}

export function parseMarkdownLite(body: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  for (const chunk of body.split(/\n{2,}/)) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed)
    if (image) {
      const src = safeUrl(image[2])
      if (src) blocks.push({ type: 'image', src, alt: image[1] })
      continue
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 2 | 3,
        inlines: parseMarkdownInlines(heading[2]),
      })
      continue
    }
    const lines = trimmed.split('\n')
    if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
      blocks.push({
        type: 'list',
        items: lines.map((line) =>
          parseMarkdownInlines(line.trim().replace(/^[-*]\s+/, '')),
        ),
      })
      continue
    }
    blocks.push({
      type: 'paragraph',
      inlines: parseMarkdownInlines(lines.join(' ')),
    })
  }
  return blocks
}
