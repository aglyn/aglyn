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
 * A published page as Markdown — the representation an agent gets when it
 * sends `Accept: text/markdown` (acceptmarkdown.com).
 *
 * ## Why serialize the NODE TREE and not the rendered HTML
 *
 * The obvious implementation is to render the page and run an HTML-to-Markdown
 * converter over it. Every site on this platform is a node document, and the
 * tree carries what the HTML has already thrown away: which text is a heading
 * because the author said so rather than because it is large, which container
 * is the page's content region, and which subtree is navigation. Converting
 * the HTML back would be reconstructing, by heuristic, information we are
 * holding.
 *
 * It is also cheaper by a wide margin — no React render, no plugin registry,
 * no MUI — which is what makes this affordable to serve from a cached route on
 * every site rather than only where somebody enabled it.
 *
 * ## The content region, not the document
 *
 * Serialization starts at the document's `main` landmark, which
 * `stampDocumentLandmark` has already placed on the layout slot (the page
 * content between the chrome) or on the screen root. That is what makes the
 * output nav-free and footer-free without this module knowing anything about
 * how a particular site builds its header — the same property that makes a
 * Markdown variant worth serving at all.
 *
 * A page with no landmark falls back to the whole tree. Some content is always
 * better than an empty document, and a page that shipped no landmark
 * deliberately (see `document-landmark.ts`) has no content region to prefer.
 *
 * ## Chrome that lives INSIDE the content region
 *
 * A handful of components are navigation wherever they sit — an app bar, a nav
 * menu, a language switcher, a pagination strip. They are skipped by id, and
 * the list is deliberately short: everything not named recurses, so a plugin
 * block nobody here has heard of still contributes its text instead of
 * vanishing. Silence is the one failure mode that would be invisible to the
 * author.
 */

import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import { authorHtmlToMarkdown, inlineAuthorHtmlToMarkdown } from './author-html-markdown'
import { absoluteMediaSrc } from './media-ref'

/** The node shape this serializer reads; keeps callers free of the full type. */
export interface PageMarkdownNode {
  componentId?: string
  props?: Record<string, unknown> | null
  /** Normalized documents carry child IDS; this never reads a denormalized tree. */
  nodes?: unknown
}

/** A flat node map keyed by node id — exactly what the page route already holds. */
export type PageMarkdownNodes = Record<string, PageMarkdownNode>

/** The element name a node was told to render as (`props.component`). */
const elementOf = (node: PageMarkdownNode | undefined): string =>
  String(node?.props?.['component'] ?? '').toLowerCase()

/** Components that are navigation wherever they appear. See the module note. */
const CHROME_COMPONENTS: ReadonlySet<string> = new Set([
  'muiAppBar',
  'muiToolbar',
  'muiDrawer',
  'muiBreadcrumbs',
  'navMenu',
  'searchBox',
  'languageSwitcher',
  'themeModeSwitcher',
  'muiPagination',
  // An icon is decoration with no accessible text of its own. Its LABEL, where
  // one exists, belongs to the control around it and is emitted there.
  'icon',
])

/** Heading levels, as either `props.component` or `props.variant` spells them. */
const HEADING = /^h([1-6])$/

/**
 * The heading level a text node publishes, or 0 for body copy.
 *
 * `component` wins over `variant` because they answer different questions and
 * the platform lets them disagree: `variant` is the type STYLE (what size it is
 * drawn at) and `component` is the ELEMENT (what it means). An author who set a
 * hero line to look like an h1 but render as a `p` said it is not a heading,
 * and the Markdown has to agree with the HTML or the two documents describe
 * different pages.
 */
export function headingLevelOf(props: Record<string, unknown> | null | undefined): number {
  const element = String(props?.['component'] ?? '').toLowerCase()
  if (element) {
    const asElement = HEADING.exec(element)
    return asElement ? Number(asElement[1]) : 0
  }
  const variant = String(props?.['variant'] ?? '').toLowerCase()
  const asVariant = HEADING.exec(variant)
  return asVariant ? Number(asVariant[1]) : 0
}

/**
 * Escape the Markdown control characters that would otherwise re-parse.
 *
 * Only the characters that START a construct at the position they can occur in:
 * a leading `#`, `>`, `-`, `+` or `1.` on its own line, and the emphasis,
 * backtick and bracket characters anywhere. Escaping more than that produces
 * output littered with backslashes, which is worse to read and worse to embed
 * than the rare false heading it prevents.
 */
export function escapeMarkdownText(value: string): string {
  return value
    .replace(/([\\`*_[\]<>])/g, '\\$1')
    .replace(/^(\s*)([#>])/gm, '$1\\$2')
    .replace(/^(\s*)([-+])(\s)/gm, '$1\\$2$3')
    .replace(/^(\s*)(\d+)\.(\s)/gm, '$1$2\\.$3')
}

/** Collapse runs of whitespace to single spaces, as inline text renders. */
const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** Resolution context for values that are stored as references, not URLs. */
export interface PageMarkdownContext {
  /** Site origin, for absolutizing media and site-relative links. */
  origin?: string | null
  /** Host id, so a restricted org asset resolves for the site rendering it. */
  hostId?: string
  /** The routing map screen links resolve against (`screenRoutes`). */
  screenRoutes?: Record<string, string> | null
}

/**
 * A link target as Markdown should carry it: absolute where we can make it so.
 *
 * Site-relative is fine in a page — the browser has a document to resolve
 * against. A Markdown body has no such context by the time an agent has copied
 * it into a prompt, so a relative href there is a link to nowhere.
 */
function absoluteHref(href: string, context?: PageMarkdownContext): string {
  const value = href.trim()
  if (!value) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return value
  const origin = context?.origin?.replace(/\/+$/, '') ?? ''
  if (!origin) return value
  return value.startsWith('/') ? `${origin}${value}` : `${origin}/${value}`
}

/** The text a control shows, preferring its rich label over the plain one. */
function labelOf(
  props: Record<string, unknown> | null | undefined,
  context?: PageMarkdownContext,
): string {
  const html = props?.['html']
  if (typeof html === 'string' && html.trim()) {
    const rich = inlineAuthorHtmlToMarkdown(html, context)
    if (rich.trim()) return collapse(rich)
  }
  const children = props?.['children']
  return typeof children === 'string' ? collapse(escapeMarkdownText(children)) : ''
}

/** A block emitted by the walk, before the blocks are joined. */
interface Block {
  /** Markdown text of the block, already escaped. */
  text: string
}

/**
 * Serialize the subtree at `rootId` into Markdown blocks.
 *
 * A depth budget and a visited set, because a node map is data: a document
 * restored from a backup, or written through the REST API, can name a child
 * that names it back. Recursing that tree is a stack overflow inside a request
 * handler, i.e. a 500 on a page that renders fine — the renderer tolerates it
 * because React unmounts a cycle, and this has nothing to stop it but itself.
 */
function walk(
  nodes: PageMarkdownNodes,
  rootId: string,
  context: PageMarkdownContext | undefined,
  blocks: Block[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 64 || seen.has(rootId)) return
  const node = nodes[rootId]
  if (!node) return
  seen.add(rootId)

  const componentId = String(node.componentId ?? '')
  if (CHROME_COMPONENTS.has(componentId)) return
  // `nav`, `header` and `footer` are chrome by their OWN declaration — an
  // author who set the element picker to one of them named it navigation, and
  // that is a stronger signal than any component-id list can be.
  const element = elementOf(node)
  if (element === 'nav' || element === 'header' || element === 'footer') return

  const props = node.props ?? {}
  const childIds = Array.isArray(node.nodes)
    ? node.nodes.filter((id): id is string => typeof id === 'string')
    : []
  const recurse = (): void => {
    for (const childId of childIds) {
      walk(nodes, childId, context, blocks, seen, depth + 1)
    }
  }
  const push = (text: string): void => {
    if (text.trim()) blocks.push({ text: text.trim() })
  }

  switch (componentId) {
    case 'muiTypography':
    case 'muiInlineText':
    case 'muiListItemText': {
      const level = headingLevelOf(props)
      const text = labelOf(props, context)
      if (!text) {
        // A Typography with no text of its own but children beneath it is a
        // wrapper, which is how rich composites are built. Recurse rather than
        // dropping the subtree.
        recurse()
        return
      }
      push(level > 0 ? `${'#'.repeat(level)} ${text}` : text)
      return
    }
    case 'markdown': {
      /*
        Already Markdown. Emitted VERBATIM and never re-escaped: `content` is
        the markdown-lite source an author typed, so escaping it would turn
        their headings into literal `#` characters — the one transformation
        that can only make this output worse.
      */
      const content = props['content']
      if (typeof content === 'string') push(content)
      return
    }
    case 'custom-html': {
      const html = props['html'] ?? props['children']
      if (typeof html === 'string') push(authorHtmlToMarkdown(html, context))
      return
    }
    case 'image': {
      const src = absoluteMediaSrc(String(props['src'] ?? '').trim(), {
        hostId: context?.hostId,
        origin: context?.origin,
      })
      if (!src) return
      const alt = collapse(String(props['alt'] ?? ''))
      push(`![${escapeMarkdownText(alt)}](${src})`)
      return
    }
    case 'video':
    case 'videoEmbed': {
      const src = String(props['src'] ?? props['url'] ?? '').trim()
      if (!src) return
      push(`[Video](${absoluteHref(src, context)})`)
      return
    }
    case 'muiButton':
    case 'muiScreenLink': {
      const label = labelOf(props, context) || 'Link'
      const href = screenLinkHref(props, context)
      push(href ? `[${label}](${href})` : label)
      return
    }
    case 'muiList': {
      /*
        The items are gathered into ONE block so they join as a list. Walking
        them as siblings would put a blank line between every bullet, which is
        a sequence of paragraphs beginning with a dash rather than a list.
      */
      const items: Block[] = []
      for (const childId of childIds) {
        walk(nodes, childId, context, items, seen, depth + 1)
      }
      const lines = items
        .map((item) => item.text.replace(/\n/g, '\n  '))
        .filter(Boolean)
        .map((text) => `- ${text}`)
      push(lines.join('\n'))
      return
    }
    default:
      recurse()
  }
}

/**
 * Where a Button or Screen Link points.
 *
 * A screen link stores a SCREEN ID, not a path, and the path it resolves to is
 * a per-request question — `screenRoutes` is the routing map the router
 * actually honors, which is not the map publishing wrote (a collection's list
 * template answers at the collection's slug, template screens answer nowhere).
 * Emitting `href` alone would publish, in Markdown, the dead links AGL-1998
 * removed from the HTML.
 */
function screenLinkHref(
  props: Record<string, unknown>,
  context?: PageMarkdownContext,
): string {
  const screenId = props['screenId']
  if (typeof screenId === 'string' && screenId) {
    const path = context?.screenRoutes?.[screenId]
    if (typeof path === 'string' && path) {
      return absoluteHref(path.startsWith('/') ? path : `/${path}`, context)
    }
  }
  const href = props['href']
  return typeof href === 'string' ? absoluteHref(href, context) : ''
}

/**
 * The node the document's content begins at.
 *
 * The `main` landmark first — `stampDocumentLandmark` puts it on the layout
 * slot or the screen root — then the layout slot by component id, then the
 * document root. Each fallback is wider than the last, so a tree that is
 * missing the marker still serializes rather than returning nothing.
 */
export function pageContentRootId(
  nodes: PageMarkdownNodes | null | undefined,
  rootId: string = NODE_ROOT_ID,
): string | null {
  if (!nodes) return null
  for (const id in nodes) {
    if (elementOf(nodes[id]) === 'main') return id
  }
  for (const id in nodes) {
    if (nodes[id]?.componentId === 'layoutSlot') return id
  }
  return nodes[rootId] ? rootId : null
}

/** What a Markdown page carries above its body. */
export interface PageMarkdownFrontMatter {
  /** The `# ` heading. The page's own title, never the site's. */
  title?: string
  /** The meta description, emitted as the summary blockquote. */
  description?: string
  /** Canonical absolute URL, emitted as the source line. */
  canonicalUrl?: string
  /** ISO-8601 publication date, for a content entry. */
  publishedAt?: string
  /** ISO-8601 last-modified date, for a content entry. */
  updatedAt?: string
  /** Byline, for a content entry. */
  author?: string
}

/**
 * The whole Markdown representation of a page.
 *
 * @param body - already-Markdown body to use INSTEAD of walking nodes; the
 *   content-entry case, where the stored body is markdown-lite source and
 *   round-tripping it through the node tree could only lose fidelity.
 */
export function buildPageMarkdown(options: {
  nodes?: PageMarkdownNodes | null
  rootId?: string
  body?: string | null
  front?: PageMarkdownFrontMatter
  context?: PageMarkdownContext
}): string {
  const front = options.front ?? {}
  const parts: string[] = []

  const title = collapse(String(front.title ?? ''))
  if (title) parts.push(`# ${escapeMarkdownText(title)}`)

  const description = collapse(String(front.description ?? ''))
  if (description) parts.push(`> ${escapeMarkdownText(description)}`)

  /*
    The dateline is one line rather than YAML front matter. Front matter is
    unparsed text to every Markdown reader that has not opted into it, so it
    arrives in an agent's context as a block of `key: value` noise above the
    content; a sentence is read correctly by all of them.
  */
  const meta: string[] = []
  if (front.author) meta.push(`By ${collapse(front.author)}`)
  if (front.publishedAt) meta.push(`Published ${front.publishedAt}`)
  if (front.updatedAt && front.updatedAt !== front.publishedAt) {
    meta.push(`Updated ${front.updatedAt}`)
  }
  if (meta.length) parts.push(`_${meta.join(' · ')}_`)

  if (typeof options.body === 'string' && options.body.trim()) {
    parts.push(options.body.trim())
  } else if (options.nodes) {
    const contentRoot = pageContentRootId(options.nodes, options.rootId)
    if (contentRoot) {
      const blocks: Block[] = []
      walk(options.nodes, contentRoot, options.context, blocks, new Set(), 0)
      for (const block of blocks) parts.push(block.text)
    }
  }

  if (front.canonicalUrl) {
    // A source line, and the reason it is worth the two lines it costs: an
    // agent that has copied this body into a prompt has no URL bar, so without
    // it the document cannot be cited, re-fetched, or linked to by whatever
    // reads it next.
    parts.push('---', `Source: ${front.canonicalUrl}`)
  }

  /*
    Collapse the runs of blank lines a nested walk leaves behind, and end with
    exactly one newline. A Markdown body is compared byte-for-byte by caches
    and by the conformance checkers agents run, so "tidy" here is a contract
    rather than an aesthetic.
  */
  return `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
