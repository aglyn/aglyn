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

import {
  buildPageMarkdown,
  headingLevelOf,
  isPageChromeNode,
  pageContentRootId,
  type PageMarkdownNode,
  type PageMarkdownNodes,
} from './page-markdown'

/**
 * What a page SAYS, read off its node tree (AGL-2910): the text a search
 * listing summarizes, the headings, and the images — each heading and image
 * by node id, so a finding can name the element it is about and a fix can
 * address the element it changes.
 *
 * Pure, and the platform's: the SEO check (`seo-audit.ts`) judges a page by
 * these facts, and anything that proposes a listing or a content fix reads
 * the same ones rather than walking the tree its own way.
 *
 * The text is the page's Markdown representation, the one an agent is
 * served, so what the listing summarizes is what a reader of the page gets.
 * The walk starts where that serializer starts — the content region — and
 * skips what it skips, through the same chrome predicate: a heading in the
 * site's navigation is not the page's heading.
 */

/** How much of a page's text the facts carry. A listing summarizes; it does not need the page. */
export const SEO_PAGE_TEXT_MAX_CHARS = 2_000

/** How much text around an image describes it. */
const IMAGE_CONTEXT_MAX_CHARS = 160

/** The deepest a walk goes, and it stops at a cycle — a node map is data. */
const MAX_DEPTH = 64

/** The text components whose heading level `headingLevelOf` reads. */
const TEXT_COMPONENTS: ReadonlySet<string> = new Set(['muiTypography', 'muiInlineText', 'muiListItemText'])

export interface SeoHeading {
  /** The element, or `null` for a heading inside rich text a fix cannot address. */
  nodeId: string | null
  level: number
  text: string
  /** Whether a content fix can change it: a text component with plain text. */
  editable: boolean
}

export interface SeoImage {
  nodeId: string
  src: string
  alt: string
  /**
   * The author marked it decorative (AGL-1305), so its empty description is
   * the accessible answer rather than a gap.
   */
  decorative: boolean
  /** The nearest heading or text before it, which is what the image illustrates. */
  context: string
}

export interface SeoPageFacts {
  /** The page's Markdown body, capped. */
  text: string
  wordCount: number
  headings: SeoHeading[]
  h1s: SeoHeading[]
  images: SeoImage[]
  imagesMissingAlt: SeoImage[]
  /** The node the content region starts at; a new heading goes first inside it. */
  contentRootId: string | null
}

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** Author HTML to its text, for a heading stored as rich text. */
function htmlText(html: string): string {
  return collapse(html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'))
}

/** A text component's own text, and whether it is plain (a fix can rewrite it). */
function textOf(props: Record<string, unknown>): { text: string; plain: boolean } {
  const html = props['html']
  if (typeof html === 'string' && html.trim()) return { text: htmlText(html), plain: false }
  const children = props['children']
  return typeof children === 'string' ? { text: collapse(children), plain: true } : { text: '', plain: true }
}

const childIdsOf = (node: PageMarkdownNode | undefined): string[] =>
  Array.isArray(node?.nodes) ? (node?.nodes as unknown[]).filter((id): id is string => typeof id === 'string') : []

/** Read the facts a listing and the SEO check need from one page's node map. */
export function seoPageFacts(
  nodes: PageMarkdownNodes | null | undefined,
  options: { rootId?: string; maxChars?: number } = {},
): SeoPageFacts {
  const empty: SeoPageFacts = {
    text: '',
    wordCount: 0,
    headings: [],
    h1s: [],
    images: [],
    imagesMissingAlt: [],
    contentRootId: null,
  }
  if (!nodes) return empty
  const contentRootId = pageContentRootId(nodes, options.rootId)
  if (!contentRootId) return empty

  const markdown = buildPageMarkdown({ nodes, rootId: options.rootId })
  const text = markdown.trim().slice(0, options.maxChars ?? SEO_PAGE_TEXT_MAX_CHARS)
  const headings: SeoHeading[] = []
  const images: SeoImage[] = []
  let lastText = ''

  const seen = new Set<string>()
  const visit = (id: string, depth: number): void => {
    if (depth > MAX_DEPTH || seen.has(id)) return
    const node = nodes[id]
    if (!node) return
    seen.add(id)
    if (isPageChromeNode(node)) return
    const props = (node.props ?? {}) as Record<string, unknown>
    const componentId = String(node.componentId ?? '')
    if (TEXT_COMPONENTS.has(componentId)) {
      const { text: own, plain } = textOf(props)
      const level = headingLevelOf(props)
      if (own) {
        if (level > 0) headings.push({ nodeId: id, level, text: own, editable: plain })
        lastText = own
      }
    } else if (componentId === 'markdown' && typeof props['content'] === 'string') {
      for (const line of String(props['content']).split('\n')) {
        const match = /^(#{1,6})\s+(.+)$/.exec(line.trim())
        if (match) {
          headings.push({ nodeId: null, level: match[1].length, text: collapse(match[2]), editable: false })
        }
      }
      lastText = collapse(String(props['content'])).slice(0, IMAGE_CONTEXT_MAX_CHARS)
    } else if (componentId === 'custom-html' && typeof (props['html'] ?? props['children']) === 'string') {
      const html = String(props['html'] ?? props['children'])
      for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        headings.push({ nodeId: null, level: Number(match[1]), text: htmlText(match[2]), editable: false })
      }
    } else if (componentId === 'image') {
      const src = String(props['src'] ?? '').trim()
      if (src) {
        images.push({
          nodeId: id,
          src,
          alt: collapse(String(props['alt'] ?? '')),
          decorative: props['decorative'] === true,
          context: lastText.slice(0, IMAGE_CONTEXT_MAX_CHARS),
        })
      }
    }
    for (const childId of childIdsOf(node)) visit(childId, depth + 1)
  }
  visit(contentRootId, 0)

  return {
    text,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    headings,
    h1s: headings.filter((heading) => heading.level === 1),
    images,
    imagesMissingAlt: images.filter((image) => !image.alt && !image.decorative),
    contentRootId,
  }
}
