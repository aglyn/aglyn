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
 * HTML clipboard → markdown-lite conversion for the visual editor
 * (AGL-596). Pure functions with no editor state: `htmlToRows` parses a
 * `text/html` clipboard payload and maps it onto the editor's row model,
 * keeping only what the markdown-lite dialect can express — bold, italic,
 * links, h2/h3 headings, flat lists and images. Everything else flattens
 * to plain text; nested marks flatten to the OUTERMOST mark. Row keys are
 * module-local placeholders — the editor re-keys converted rows with its
 * own key sequence on ingest.
 */

import type { MarkdownInline } from '@aglyn/aglyn'
import type { EditorRow } from './markdown-visual-editor.component'

let htmlRowSeq = 0
const nextHtmlRowKey = (): string => `html-row-${++htmlRowSeq}`

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ')

/** Block-level tags that terminate an inline run at the row level. */
const BLOCK_TAGS = new Set([
  'article',
  'aside',
  'blockquote',
  'div',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'img',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
])

const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).join(', ')

const isBlockElement = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE &&
  BLOCK_TAGS.has((node as Element).tagName.toLowerCase())

/**
 * An inline-tagged element hiding block content — e.g. Google Docs wraps
 * the whole clipboard in `<b style="font-weight:normal">`. Treated as a
 * wrapper to recurse through, never as one giant mark.
 */
const isInlineWrapperOfBlocks = (node: Node): node is Element =>
  node.nodeType === Node.ELEMENT_NODE &&
  !isBlockElement(node) &&
  (node as Element).querySelector(BLOCK_SELECTOR) != null

/**
 * Merges adjacent same-type runs (same href for links), re-collapses
 * whitespace across the merge seams and trims the ends of the sequence.
 */
function finishInlines(inlines: MarkdownInline[]): MarkdownInline[] {
  const merged: MarkdownInline[] = []
  for (const inline of inlines) {
    if (!inline.text) continue
    const last = merged[merged.length - 1]
    if (
      last &&
      last.type === inline.type &&
      (last.type !== 'link' ||
        last.href === (inline as { href?: string }).href)
    ) {
      last.text = collapseWhitespace(last.text + inline.text)
    } else {
      merged.push({ ...inline })
    }
  }
  const first = merged[0]
  if (first) first.text = first.text.replace(/^\s+/, '')
  const last = merged[merged.length - 1]
  if (last) last.text = last.text.replace(/\s+$/, '')
  return merged.filter((inline) => inline.text.length > 0)
}

function inlinesFromNodes(nodes: Node[]): MarkdownInline[] {
  const out: MarkdownInline[] = []
  const pushText = (text: string): void => {
    if (text) out.push({ type: 'text', text })
  }
  /**
   * Marked elements flatten to their whole text content (the dialect has
   * no nested marks), with edge whitespace moved OUT of the mark so the
   * separating spaces around `<strong>`/`<a>` survive serialization.
   */
  const pushMarked = (
    el: Element,
    build: (text: string) => MarkdownInline,
  ): void => {
    const text = collapseWhitespace(el.textContent ?? '')
    const core = text.trim()
    if (text.startsWith(' ')) pushText(' ')
    if (core) out.push(build(core))
    if (core && text.endsWith(' ')) pushText(' ')
  }
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(collapseWhitespace(node.textContent ?? ''))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') return
    if (tag === 'br') {
      pushText(' ')
      return
    }
    if (tag === 'strong' || tag === 'b') {
      pushMarked(el, (text) => ({ type: 'bold', text }))
      return
    }
    if (tag === 'em' || tag === 'i') {
      pushMarked(el, (text) => ({ type: 'italic', text }))
      return
    }
    if (tag === 'a' && el.getAttribute('href')) {
      // The RAW attribute (not el.href) so site paths like /pricing
      // survive instead of resolving against the parser's base URL.
      const href = el.getAttribute('href') ?? ''
      pushMarked(el, (text) => ({ type: 'link', text, href }))
      return
    }
    Array.from(el.childNodes).forEach(visit)
  }
  nodes.forEach(visit)
  return finishInlines(out)
}

/** Converts an element's children to markdown-lite inlines. */
export function htmlToInlines(node: Node): MarkdownInline[] {
  return inlinesFromNodes(Array.from(node.childNodes))
}

/**
 * Converts a `text/html` clipboard payload to editor rows. Unknown
 * wrappers recurse so they never swallow content; rows with no inlines
 * and no image are dropped.
 */
export function htmlToRows(html: string): EditorRow[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rows: EditorRow[] = []
  const pushTextRow = (
    kind: 'paragraph' | 'heading2' | 'heading3' | 'listItem',
    inlines: MarkdownInline[],
  ): void => {
    if (inlines.length === 0) return
    rows.push({ key: nextHtmlRowKey(), kind, inlines })
  }
  const visitBlock = (el: Element): void => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'h1' || tag === 'h2') {
      pushTextRow('heading2', htmlToInlines(el))
      return
    }
    if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      pushTextRow('heading3', htmlToInlines(el))
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      for (const child of Array.from(el.children)) {
        const childTag = child.tagName.toLowerCase()
        if (childTag === 'li') pushTextRow('listItem', htmlToInlines(child))
        else if (childTag === 'ul' || childTag === 'ol') visitBlock(child)
      }
      return
    }
    if (tag === 'li') {
      pushTextRow('listItem', htmlToInlines(el))
      return
    }
    if (tag === 'img') {
      const src = el.getAttribute('src')
      if (src) {
        rows.push({
          key: nextHtmlRowKey(),
          kind: 'image',
          src,
          alt: el.getAttribute('alt') ?? '',
        })
      }
      return
    }
    if (
      tag === 'p' ||
      tag === 'div' ||
      tag === 'section' ||
      tag === 'blockquote'
    ) {
      // A container with block children is a wrapper — recurse so the
      // inner structure survives; otherwise it is one paragraph.
      const wrapsBlocks = Array.from(el.children).some(isBlockElement)
      if (wrapsBlocks) visitChildren(el)
      else pushTextRow('paragraph', htmlToInlines(el))
      return
    }
    // Unknown block-ish element (figure, table, article…): recurse.
    visitChildren(el)
  }
  /**
   * Walks mixed content: consecutive inline nodes (bare text, marks,
   * spans) group into ONE paragraph row; block elements flush the run
   * and map to their own rows.
   */
  const visitChildren = (parent: Node): void => {
    let pendingInline: Node[] = []
    const flush = (): void => {
      if (pendingInline.length === 0) return
      pushTextRow('paragraph', inlinesFromNodes(pendingInline))
      pendingInline = []
    }
    for (const child of Array.from(parent.childNodes)) {
      if (isBlockElement(child)) {
        flush()
        visitBlock(child)
      } else if (isInlineWrapperOfBlocks(child)) {
        flush()
        visitChildren(child)
      } else {
        pendingInline.push(child)
      }
    }
    flush()
  }
  visitChildren(doc.body)
  return rows
}
