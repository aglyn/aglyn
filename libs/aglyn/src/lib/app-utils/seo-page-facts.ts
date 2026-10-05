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
 *
 * ## The page as it publishes (AGL-3501)
 *
 * Hand it the COMPOSED node map — reusable components grafted, repeats
 * expanded (`seo-site-scan.ts` composes one) — and the page's own map as
 * `pageNodes`. A heading a component renders is the page's heading; reading
 * the raw map instead missed every one of them. The page's own map is what
 * says where a fact can be fixed: an element a component renders points at
 * the component's placement on the page and is not `editable` (a page fix
 * cannot rewrite a component's text), and so is a copy a repeat makes, whose
 * text is a row's.
 *
 * A `{{…}}` token is not copy. A token the composition did not resolve —
 * a repeat whose rows were not read, a site variable the head resolves — is
 * left out of the text and the headings, and a heading or a description
 * made of one is neither judged by what it says nor offered to a fix.
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

/** A reusable-component placement, as the page's own map stores it (`reusable-component-keys.ts`). */
const REUSABLE_INSTANCE = 'reusableInstance'

/** The prefix a component's grafted elements carry (`reusable-component-keys.ts`): `cmp__{placementId}__{id}`. */
const COMPONENT_GRAFT_PREFIX = 'cmp__'

/** The prefix a repeat's copies carry (`expand-repeatables.ts`): `rep__{repeatId}__{index}__{templateId}`. */
const REPEAT_COPY_PREFIX = 'rep__'

/** A `{{…}}` token: a value something else resolves, never copy of its own. */
const TOKEN_PATTERN = /\{\{[^{}]*\}\}/g

export interface SeoHeading {
  /**
   * The element on the page — for one a component renders, the component's
   * placement — or `null` for a heading inside the page's rich text a fix
   * cannot address.
   */
  nodeId: string | null
  level: number
  /** What it says, without the tokens it resolves at render: `''` for a heading made of one. */
  text: string
  /**
   * Whether a content fix can change it: a text component on the page itself
   * with plain text and no token — not one a component or a repeat renders.
   */
  editable: boolean
  /** Rendered by a reusable component placed on the page; `nodeId` is the placement. */
  inComponent?: boolean
}

export interface SeoImage {
  /** The element on the page, or the component placement that renders it. */
  nodeId: string
  src: string
  alt: string
  /** Whether a content fix can set its description: an image on the page itself, not a component's or a repeat's. */
  editable: boolean
  /** Rendered by a reusable component placed on the page; `nodeId` is the placement. */
  inComponent?: boolean
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
  /** The page's own node the content region starts at; a new heading goes first inside it. */
  contentRootId: string | null
}

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim()

const hasToken = (value: string): boolean => value.search(TOKEN_PATTERN) >= 0

/** A value as copy: its unresolved tokens left out. */
const withoutTokens = (value: string): string => collapse(value.replace(TOKEN_PATTERN, ' '))

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

/** Where a fact found on a composed page can be addressed on the page itself. */
interface FactOrigin {
  nodeId: string
  editable: boolean
  inComponent: boolean
}

/**
 * Maps an element of the composed map to the page's own map: itself when the
 * page holds it, its placement when a component renders it (the placement
 * keeps its id as the component's root; what the component holds is grafted
 * under the placement's prefix), and the template a repeat copied it from —
 * with the copy's text a row's, so not editable.
 */
function originResolver(
  pageNodes: PageMarkdownNodes,
): (id: string) => FactOrigin | null {
  const placementIds = Object.keys(pageNodes).filter((id) => pageNodes[id]?.componentId === REUSABLE_INSTANCE)
  const repeatIds = Object.keys(pageNodes).filter((id) => {
    const key = (pageNodes[id]?.props as Record<string, unknown> | null | undefined)?.['repeatDataset']
    return typeof key === 'string' && key.trim() !== ''
  })
  const resolve = (id: string, depth: number): FactOrigin | null => {
    if (depth > MAX_DEPTH) return null
    const own = pageNodes[id]
    if (own) {
      return own.componentId === REUSABLE_INSTANCE
        ? { nodeId: id, editable: false, inComponent: true }
        : { nodeId: id, editable: true, inComponent: false }
    }
    if (id.startsWith(COMPONENT_GRAFT_PREFIX)) {
      const placementId = placementIds.find((placement) => id.startsWith(`${COMPONENT_GRAFT_PREFIX}${placement}__`))
      return placementId ? { nodeId: placementId, editable: false, inComponent: true } : null
    }
    if (!id.startsWith(REPEAT_COPY_PREFIX)) return null
    for (const repeatId of repeatIds) {
      const prefix = `${REPEAT_COPY_PREFIX}${repeatId}__`
      if (!id.startsWith(prefix)) continue
      const template = /^\d+__(.+)$/.exec(id.slice(prefix.length))?.[1]
      const origin = template ? resolve(template, depth + 1) : null
      if (origin) return { ...origin, editable: false }
    }
    return null
  }
  return (id) => resolve(id, 0)
}

/**
 * Read the facts a listing and the SEO check need from one page's node map.
 *
 * `nodes` is the page as it publishes, composed; `pageNodes` the page's own
 * map it was composed from, which decides what a fact points at and whether
 * a fix may change it. Without `pageNodes` the map is read as the page's own.
 */
export function seoPageFacts(
  nodes: PageMarkdownNodes | null | undefined,
  options: { rootId?: string; maxChars?: number; pageNodes?: PageMarkdownNodes | null } = {},
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
    .replace(TOKEN_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
  const text = markdown.trim().slice(0, options.maxChars ?? SEO_PAGE_TEXT_MAX_CHARS)
  const headings: SeoHeading[] = []
  const images: SeoImage[] = []
  /** Images whose description is a token: described at render, by a value this read cannot see. */
  const boundAlt = new Set<SeoImage>()
  const originOf = originResolver(options.pageNodes ?? nodes)
  let lastText = ''

  const seen = new Set<string>()
  const visit = (id: string, depth: number, owner: FactOrigin | null): void => {
    if (depth > MAX_DEPTH || seen.has(id)) return
    const node = nodes[id]
    if (!node) return
    seen.add(id)
    if (isPageChromeNode(node)) return
    // Inside a placement everything is the component's; elsewhere the page's own map says.
    const origin: FactOrigin = owner ?? originOf(id) ?? { nodeId: id, editable: false, inComponent: false }
    const tag = origin.inComponent ? { inComponent: true as const } : {}
    const props = (node.props ?? {}) as Record<string, unknown>
    const componentId = String(node.componentId ?? '')
    if (TEXT_COMPONENTS.has(componentId)) {
      const { text: raw, plain } = textOf(props)
      const own = withoutTokens(raw)
      const bound = hasToken(raw)
      const level = headingLevelOf(props)
      if (own || bound) {
        if (level > 0) {
          headings.push({ nodeId: origin.nodeId, level, text: own, editable: plain && !bound && origin.editable, ...tag })
        }
        if (own) lastText = own
      }
    } else if (componentId === 'markdown' && typeof props['content'] === 'string') {
      for (const line of String(props['content']).split('\n')) {
        const match = /^(#{1,6})\s+(.+)$/.exec(line.trim())
        if (match) {
          headings.push({
            nodeId: origin.inComponent ? origin.nodeId : null,
            level: match[1].length,
            text: withoutTokens(match[2]),
            editable: false,
            ...tag,
          })
        }
      }
      lastText = withoutTokens(String(props['content'])).slice(0, IMAGE_CONTEXT_MAX_CHARS)
    } else if (componentId === 'custom-html' && typeof (props['html'] ?? props['children']) === 'string') {
      const html = String(props['html'] ?? props['children'])
      for (const match of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
        headings.push({
          nodeId: origin.inComponent ? origin.nodeId : null,
          level: Number(match[1]),
          text: withoutTokens(htmlText(match[2])),
          editable: false,
          ...tag,
        })
      }
    } else if (componentId === 'image') {
      const src = String(props['src'] ?? '').trim()
      if (src) {
        const rawAlt = String(props['alt'] ?? '')
        const image: SeoImage = {
          nodeId: origin.nodeId,
          src,
          alt: withoutTokens(rawAlt),
          decorative: props['decorative'] === true,
          editable: origin.editable && !hasToken(rawAlt),
          context: lastText.slice(0, IMAGE_CONTEXT_MAX_CHARS),
          ...tag,
        }
        images.push(image)
        if (hasToken(rawAlt)) boundAlt.add(image)
      }
    }
    const inherited = owner ?? (origin.inComponent ? origin : null)
    for (const childId of childIdsOf(node)) visit(childId, depth + 1, inherited)
  }
  visit(contentRootId, 0, null)

  return {
    text,
    wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
    headings,
    h1s: headings.filter((heading) => heading.level === 1),
    images,
    imagesMissingAlt: images.filter((image) => !image.alt && !image.decorative && !boundAlt.has(image)),
    // Where a fix adds a heading is the page's own content region, which a
    // composed map can start inside a component.
    contentRootId: options.pageNodes ? pageContentRootId(options.pageNodes, options.rootId) : contentRootId,
  }
}
