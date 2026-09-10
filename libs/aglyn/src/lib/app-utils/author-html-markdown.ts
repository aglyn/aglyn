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
 * Author HTML → Markdown, with no DOM (AGL-2716).
 *
 * Two kinds of author markup reach a page and neither is a node tree: the
 * inline editor's rich mode commits sanitized markup into a node's `html`
 * prop, and the Custom HTML component carries a whole fragment. Both have to
 * survive into the Markdown representation of the page, or a heading typed in
 * rich mode reads as body copy and a Custom HTML block disappears entirely.
 *
 * ## Why not reuse `markdown-html-paste`
 *
 * The visual editor already converts pasted HTML to the markdown-lite row
 * model — but it parses with `DOMParser`, which exists only in a browser. This
 * runs inside a route handler answering `Accept: text/markdown`, where there
 * is no DOM at all, so the parse has to be a tokenizer over the string. The
 * two are not duplicates so much as the same idea either side of a boundary
 * neither can cross.
 *
 * ## Why a tokenizer is safe HERE and would not be in a sanitizer
 *
 * A sanitizer that mis-parses ships markup; the failure is an XSS. This
 * produces TEXT — no consumer of the output executes anything — so a
 * mis-parsed tag costs a formatting artifact and nothing more. That is what
 * makes a ~200-line tokenizer the proportionate tool rather than a parser
 * dependency, and it is why nothing here is on the sanitizer's path: the
 * source it reads has already been through {@link sanitizeAuthorHtml} at
 * render time.
 *
 * Unknown elements UNWRAP rather than drop, matching the sanitizer's own rule,
 * so markup this file has never heard of still contributes its text.
 */

import { decodeCharacterReferences, isAllowedAuthorHtmlUrl } from './author-html'
import { absoluteMediaSrc } from './media-ref'

/**
 * Typographic named references, decoded for TEXT CONTENT only.
 *
 * {@link decodeCharacterReferences} deliberately knows a very short table: it
 * exists to judge ATTRIBUTE values the way a browser will, and its own header
 * explains that a reference outside that table cannot contribute a letter or a
 * colon and so cannot spell a scheme. Widening it to make prose read nicely
 * would trade a security property for a typographic one.
 *
 * So the widening lives HERE, where the output is text that nothing executes.
 * Applied after the shared decoder, and to text nodes only — never to an
 * `href` or a `src`, which still go through the narrow table alone.
 */
const TEXT_REFERENCES: Record<string, string> = {
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018',
  rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', sbquo: '\u201a',
  bdquo: '\u201e', laquo: '\u00ab', raquo: '\u00bb', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', deg: '\u00b0', times: '\u00d7',
  divide: '\u00f7', middot: '\u00b7', bull: '\u2022', dagger: '\u2020',
  Dagger: '\u2021', permil: '\u2030', prime: '\u2032', Prime: '\u2033',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
  sect: '\u00a7', para: '\u00b6', plusmn: '\u00b1', frac12: '\u00bd',
  frac14: '\u00bc', frac34: '\u00be', ne: '\u2260', le: '\u2264',
  ge: '\u2265', larr: '\u2190', rarr: '\u2192', harr: '\u2194',
  infin: '\u221e', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '',
  zwj: '', zwnj: '',
}

/** Character references as a reader should see them; see {@link TEXT_REFERENCES}. */
function decodeTextReferences(value: string): string {
  const decoded = decodeCharacterReferences(value)
  if (!decoded.includes('&')) return decoded
  return decoded.replace(
    /&([a-zA-Z][a-zA-Z0-9]{1,31});?/g,
    (match, name: string) => TEXT_REFERENCES[name] ?? match,
  )
}

/** Where relative URLs resolve, matching `PageMarkdownContext`. */
export interface AuthorHtmlMarkdownContext {
  origin?: string | null
  hostId?: string
}

/** Elements that end the current line and start a new block. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dd', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

/** Elements whose CONTENT is dropped with them, never unwrapped. */
const DROPPED: ReadonlySet<string> = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'object', 'svg', 'math',
])

/** Void elements — no end tag, never pushed on the open stack. */
const VOID: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'source', 'track', 'wbr',
])

interface Attributes {
  [name: string]: string
}

interface Token {
  kind: 'text' | 'start' | 'end'
  name: string
  text: string
  attributes: Attributes
  selfClosing: boolean
}

const ATTRIBUTE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

/** Read a start tag's attributes into a lowercased-name map. */
function readAttributes(raw: string): Attributes {
  const attributes: Attributes = {}
  ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTRIBUTE.exec(raw)) !== null) {
    const value = match[2] ?? ''
    const unquoted =
      value.startsWith('"') || value.startsWith("'") ? value.slice(1, -1) : value
    attributes[match[1].toLowerCase()] = decodeCharacterReferences(unquoted)
  }
  return attributes
}

/**
 * Tokenize a fragment.
 *
 * Comments, doctypes and CDATA are consumed and produce nothing. A `<` that
 * does not begin a tag is literal text — which is what a browser does with it
 * and what an author who typed `a < b` meant.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  let text = ''
  const flushText = (): void => {
    if (!text) return
    tokens.push({
      kind: 'text',
      name: '',
      text: decodeTextReferences(text),
      attributes: {},
      selfClosing: false,
    })
    text = ''
  }
  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) {
      text += html.slice(index)
      break
    }
    text += html.slice(index, next)
    const rest = html.slice(next)
    if (rest.startsWith('<!--')) {
      const end = html.indexOf('-->', next + 4)
      index = end === -1 ? html.length : end + 3
      continue
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      const end = html.indexOf('>', next)
      index = end === -1 ? html.length : end + 1
      continue
    }
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(rest)
    if (!tag) {
      // Not a tag. A literal `<`.
      text += '<'
      index = next + 1
      continue
    }
    flushText()
    const name = tag[2].toLowerCase()
    const raw = tag[3] ?? ''
    tokens.push({
      kind: tag[1] === '/' ? 'end' : 'start',
      name,
      text: '',
      attributes: tag[1] === '/' ? {} : readAttributes(raw),
      selfClosing: raw.trimEnd().endsWith('/'),
    })
    index = next + tag[0].length
  }
  flushText()
  return tokens
}

/** Markdown control characters, escaped so author text does not re-parse. */
function escapeInline(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}

/**
 * Absolutize a link target, leaving anything already absolute alone.
 *
 * Scheme-checked against {@link isAllowedAuthorHtmlUrl} — the sanitizer's own
 * rule, not a second spelling of it (AGL-2740). A Custom HTML fragment is
 * stored UNSANITIZED and cleaned at render, so this converter is the one
 * reader of it that never sees the sanitizer run: without the check, an
 * `<a href="screen:v0clP6xQl-">` an author hand-typed loses its href in the
 * page and keeps it in the Markdown, which publishes a link target the page
 * itself refuses. Refused targets keep their TEXT — the caller emits the
 * unlinked label — because dropping the words as well would silently shorten
 * the document.
 */
function absoluteHref(href: string, context?: AuthorHtmlMarkdownContext): string {
  const value = href.trim()
  if (!value) return ''
  if (!isAllowedAuthorHtmlUrl('a', 'href', value)) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return value
  const origin = context?.origin?.replace(/\/+$/, '') ?? ''
  if (!origin) return value
  return value.startsWith('/') ? `${origin}${value}` : `${origin}/${value}`
}

/** State the converter carries down the tag stack. */
interface Frame {
  name: string
  /** Where in `out` this element's content began, for wrapping on close. */
  start: number
  attributes: Attributes
}

/**
 * Convert a fragment to Markdown.
 *
 * @param inlineOnly - emit no block structure, for a control's rich LABEL,
 *   where a heading or a list would be nonsense inside a button.
 */
function convert(
  html: string,
  context: AuthorHtmlMarkdownContext | undefined,
  inlineOnly: boolean,
): string {
  if (typeof html !== 'string' || !html) return ''
  const out: string[] = []
  const stack: Frame[] = []
  /** Depth of `<pre>`, inside which whitespace is content. */
  let preDepth = 0
  /** Depth of a dropped element, inside which nothing is emitted. */
  let dropDepth = 0
  /** Open list contexts, innermost last; `null` marks an unordered list. */
  const lists: Array<{ ordered: boolean; index: number }> = []

  const emit = (value: string): void => {
    if (value) out.push(value)
  }
  const breakBlock = (): void => {
    if (inlineOnly) {
      // A control's label is one line. A block boundary becomes a space so two
      // paragraphs of rich text do not run their last and first words together.
      if (out.length && !/\s$/.test(out[out.length - 1])) emit(' ')
      return
    }
    while (out.length && out[out.length - 1] === '') out.pop()
    emit('\n\n')
  }

  for (const token of tokenize(html)) {
    if (dropDepth > 0) {
      if (token.kind === 'end' && DROPPED.has(token.name)) dropDepth -= 1
      else if (token.kind === 'start' && DROPPED.has(token.name)) dropDepth += 1
      continue
    }

    if (token.kind === 'text') {
      if (preDepth > 0) emit(token.text)
      else {
        const collapsed = token.text.replace(/\s+/g, ' ')
        if (collapsed.trim() === '' && collapsed !== '') {
          // Whitespace BETWEEN elements is a word separator, but never the
          // first thing in a block — that is the indentation of the source.
          const previous = out.length ? out[out.length - 1] : ''
          if (previous && !/\s$/.test(previous)) emit(' ')
        } else {
          emit(escapeInline(collapsed))
        }
      }
      continue
    }

    const { name } = token
    if (token.kind === 'start') {
      if (DROPPED.has(name)) {
        dropDepth += 1
        continue
      }
      if (BLOCK_ELEMENTS.has(name) && name !== 'li') breakBlock()
      switch (name) {
        case 'br':
          emit(inlineOnly ? ' ' : '\n')
          continue
        case 'hr':
          if (!inlineOnly) emit('---')
          continue
        case 'img': {
          const src = absoluteMediaSrc(token.attributes['src'] ?? '', {
            hostId: context?.hostId,
            origin: context?.origin,
          })
          if (src) {
            emit(`![${escapeInline(token.attributes['alt'] ?? '')}](${src})`)
          }
          continue
        }
        case 'b':
        case 'strong':
          emit('**')
          break
        case 'i':
        case 'em':
        case 'cite':
        case 'dfn':
        case 'var':
          emit('_')
          break
        case 'del':
        case 's':
          emit('~~')
          break
        case 'code':
          // Inside `<pre>` the fence below already marks it as code; a second
          // pair of backticks would land inside the fence as literal text.
          if (preDepth === 0) emit('`')
          break
        case 'pre':
          preDepth += 1
          if (!inlineOnly) emit('```\n')
          break
        case 'blockquote':
          if (!inlineOnly) emit('> ')
          break
        case 'ul':
        case 'ol':
          if (!inlineOnly) lists.push({ ordered: name === 'ol', index: 0 })
          break
        case 'li': {
          if (inlineOnly) break
          const list = lists[lists.length - 1]
          const indent = '  '.repeat(Math.max(0, lists.length - 1))
          if (list?.ordered) {
            list.index += 1
            emit(`${indent}${list.index}. `)
          } else {
            emit(`${indent}- `)
          }
          break
        }
        default:
          break
      }
      if (!VOID.has(name) && !token.selfClosing) {
        stack.push({ name, start: out.length, attributes: token.attributes })
      }
      // A heading's `#` prefix is written on OPEN, after the block break above.
      const heading = /^h([1-6])$/.exec(name)
      if (heading && !inlineOnly) emit(`${'#'.repeat(Number(heading[1]))} `)
      continue
    }

    // An end tag. Unwind to the nearest matching open element; an unmatched
    // end tag is ignored, which is what a parser does with it.
    const at = stack.map((frame) => frame.name).lastIndexOf(name)
    if (at === -1) continue
    while (stack.length > at) {
      const frame = stack.pop()
      if (!frame) break
      switch (frame.name) {
        case 'b':
        case 'strong':
          emit('**')
          break
        case 'i':
        case 'em':
        case 'cite':
        case 'dfn':
        case 'var':
          emit('_')
          break
        case 'del':
        case 's':
          emit('~~')
          break
        case 'code':
          if (preDepth === 0) emit('`')
          break
        case 'pre':
          preDepth = Math.max(0, preDepth - 1)
          if (!inlineOnly) emit('\n```')
          break
        case 'ul':
        case 'ol':
          if (!inlineOnly) lists.pop()
          break
        case 'li':
          if (!inlineOnly) emit('\n')
          break
        case 'a': {
          /*
            The link text is whatever was emitted since the open tag, spliced
            out of `out` and wrapped. Splicing rather than buffering per frame
            because a nested `<strong>` inside the anchor has already written
            its markers into the same array — rebuilding the text from tokens
            would drop them.
          */
          const text = out.splice(frame.start).join('')
          const href = absoluteHref(frame.attributes['href'] ?? '', context)
          if (!text.trim()) {
            // An anchor with no text is a bare URL at best; emitting `[](url)`
            // is a link nothing can click.
            if (href) emit(href)
          } else if (href) {
            emit(`[${text.trim()}](${href})`)
          } else {
            emit(text)
          }
          break
        }
        default:
          break
      }
      if (BLOCK_ELEMENTS.has(frame.name) && frame.name !== 'li') breakBlock()
    }
  }

  const joined = out.join('')
  if (inlineOnly) return joined.replace(/\s+/g, ' ').trim()
  return joined
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Author HTML as Markdown blocks — headings, lists, links, code and all. */
export function authorHtmlToMarkdown(
  html: string,
  context?: AuthorHtmlMarkdownContext,
): string {
  return convert(html, context, false)
}

/**
 * A control's rich label as ONE line of Markdown.
 *
 * Block structure is deliberately flattened: a button whose label is a heading
 * is not a heading, and emitting one would put a `#` in the middle of a
 * sentence for every rich-mode label on the site.
 */
export function inlineAuthorHtmlToMarkdown(
  html: string,
  context?: AuthorHtmlMarkdownContext,
): string {
  return convert(html, context, true)
}
