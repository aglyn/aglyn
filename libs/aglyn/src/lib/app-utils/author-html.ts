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
 * An ISOMORPHIC sanitizer for AUTHOR-WRITTEN HTML (AGL-1901).
 *
 * ## Why this exists
 *
 * Rich text (`typography.tsx`'s `html` prop) and Custom HTML
 * (`custom-html.tsx`) are the two places a site author's raw markup reaches
 * `dangerouslySetInnerHTML`. Both sanitized with DOMPurify, which needs a
 * real DOM, so both deferred the sanitize into a `useEffect` — server render
 * and first client render agreed only because BOTH were empty (AGL-1268).
 * That fixed hydration and left every rich-text body and every Custom HTML
 * block absent from the server response: a crawler that does not run JS saw
 * nothing, on a product sold on "build a site and be found".
 *
 * AGL-1901 named two ways out. Isomorphic DOMPurify over jsdom keeps one
 * engine but puts jsdom in the tenant SERVER bundle, landing on the open
 * cold-start 502s (AGL-1152). A second sanitizer on the server is light but
 * re-encodes the policy in a second engine, and any drift between the two
 * becomes a stored-XSS hole rather than a rendering bug.
 *
 * This module takes the second shape and DELETES the drift risk instead of
 * managing it: it is the ONLY sanitizer on the render path, on both sides.
 * The server renders `sanitizeAuthorHtml(html)`; the first client render
 * calls the same pure function on the same string and gets the same bytes,
 * so hydration is clean by construction and there is no second engine to
 * drift from. DOMPurify remains the reference the parity spec measures this
 * against (`author-html-dompurify-parity.spec.ts`), not a second gate at
 * runtime — a runtime second pass would be worthless anyway, because the
 * server string is parsed and executed by the browser BEFORE any client code
 * runs.
 *
 * The safety argument is therefore a SUBSET argument, and the parity spec
 * asserts it: every tag and every attribute this emits is one DOMPurify
 * would also have kept under the same config. Where the two differ, this one
 * keeps less. Keeping less can only cost an author some markup; keeping more
 * would be the hole.
 *
 * ## How it is safe without a DOM
 *
 * A source-level sanitizer is only sound if the string it emits re-parses to
 * the tree it thinks it built — the mXSS class. Four rules make that true
 * here, and each is load-bearing:
 *
 * 1. **No foreign content, ever.** `<svg>` and `<math>` switch the parser
 *    into a namespace with different tokenization rules; they are dropped
 *    with their contents, as are `<template>`, `<noscript>`, `<noembed>`,
 *    `<xmp>` and `<plaintext>`, whose contents parse under rules of their
 *    own. Nothing this emits can re-enter foreign or raw-text mode.
 * 2. **Everything is re-serialized, never passed through.** Text is emitted
 *    with `&`, `<` and `>` escaped; attribute values are always double
 *    quoted with `&`, `<`, `>` and `"` escaped. There are no unquoted
 *    attribute values and no raw `<` in text for a re-parse to misread.
 * 3. **Character references are decoded BEFORE any value is judged.** A
 *    tokenizer that reads source rather than a DOM is otherwise trivially
 *    defeated by `href="java&#115;cript:alert(1)"`, which the browser
 *    decodes and this would not. {@link decodeCharacterReferences} handles
 *    every numeric reference generically, plus the named references that can
 *    contribute a colon or whitespace to a scheme. ASCII letters have NO
 *    named references in HTML, so no named reference this does not know can
 *    help spell a scheme; only numeric ones could, and those are all
 *    decoded. The decoded value is what is validated AND what is re-escaped
 *    on the way out, so the browser sees exactly the string that was judged.
 * 4. **Allowlists, not denylists**, for elements and for attributes, with
 *    every URL-bearing attribute scheme-checked.
 *
 * ## Relationship to the CSS rule
 *
 * `style` attributes go through {@link sanitizeAuthorCss} exactly as the
 * per-instance DOMPurify hook AGL-1725 added did, because DOMPurify performs
 * no CSS filtering of its own. A `<style>` ELEMENT is dropped rather than
 * filtered, which is what both DOMPurify configs already did — the `css`
 * component attribute remains the only route to a style block on a page.
 */

import { sanitizeAuthorCss } from './author-css'

/**
 * Elements that survive: HTML flow and phrasing content, a strict subset of
 * DOMPurify's `USE_PROFILES: { html: true }` set minus the tags both callers
 * already forbade (`script`, `iframe`, `object`, `embed`, `form`, `base`)
 * and minus every interactive form control, which no author markup on a
 * rendered page has a use for and which carries `formaction` shapes.
 */
export const ALLOWED_AUTHOR_HTML_ELEMENTS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo',
  'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'data',
  'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  // `main` is a deliberate subtraction from the DOMPurify profile (AGL-2486):
  // the tenant root layout renders the document's one `main` landmark, so
  // author markup carrying another can only make the landmark ambiguous. It is
  // UNWRAPPED like any other unlisted tag, not dropped, so the author's content
  // survives verbatim and only the competing landmark goes.
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'nav', 'ol', 'p',
  'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small',
  'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'u', 'ul', 'var',
  'video', 'wbr',
])

/**
 * Void elements — emitted WITHOUT a closing tag and never pushed on the open
 * stack. A void element that carries children is not merely wrong markup
 * here: `<img>` with children is an SSR 500 in this codebase, so the
 * serializer must be structurally incapable of producing one.
 */
const VOID_ELEMENTS = new Set([
  'br', 'col', 'hr', 'img', 'source', 'track', 'wbr',
])

/**
 * Elements dropped WITH their contents rather than unwrapped.
 *
 * Two reasons, both about the parser rather than about the tag: raw-text and
 * escapable-raw-text elements (`script`, `style`, `textarea`, `title`,
 * `xmp`, `plaintext`, `noscript`, `noembed`, `noframes`, `iframe`) tokenize
 * their contents under different rules, and foreign-content roots (`svg`,
 * `math`) switch namespace. Unwrapping either would hand the re-parse a
 * string this never modelled.
 *
 * `<style>` is in this set for BOTH callers, because both DOMPurify configs
 * dropped it: `typography.tsx` listed it in `FORBID_TAGS` and the `html`
 * profile does not carry it, which `custom-html-author-css.spec.tsx` pins.
 * The `css` component attribute stays the only route to a style block, and
 * it goes through {@link sanitizeAuthorCss} where it always did.
 */
const CONTENT_DROPPING = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'plaintext', 'noscript',
  'noembed', 'noframes', 'iframe', 'svg', 'math', 'template', 'object',
  'applet', 'frame', 'frameset', 'canvas',
])

/** Attributes any allowed element may carry. */
export const GLOBAL_AUTHOR_HTML_ATTRIBUTES: ReadonlySet<string> = new Set([
  'class', 'id', 'title', 'lang', 'dir', 'style', 'role',
])

/** Attributes allowed only on the elements that define them. */
export const AUTHOR_HTML_ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  // No `target`. DOMPurify's html profile drops it, so both callers already
  // dropped it, and the parity spec measures this table against that profile
  // — putting it back here would be this sanitizer keeping MORE than the
  // policy it replaced, which is the one direction that is not allowed to
  // happen quietly. Giving authors `target="_blank"` is a product decision
  // about the allowlist, not a side effect of moving the sanitizer.
  a: new Set(['href', 'rel', 'name', 'download', 'hreflang', 'type']),
  audio: new Set(['src', 'controls', 'loop', 'muted', 'preload']),
  blockquote: new Set(['cite']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  data: new Set(['value']),
  del: new Set(['cite', 'datetime']),
  details: new Set(['open']),
  img: new Set([
    'src', 'srcset', 'alt', 'width', 'height', 'loading', 'decoding', 'sizes',
  ]),
  ins: new Set(['cite', 'datetime']),
  li: new Set(['value']),
  ol: new Set(['start', 'reversed', 'type']),
  q: new Set(['cite']),
  source: new Set(['src', 'srcset', 'type', 'media', 'sizes', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  // No `abbr`: DOMPurify's html profile drops it on `th`, same reason as
  // `target` on `a` — this table may not be wider than the policy it replaced.
  th: new Set(['colspan', 'rowspan', 'headers', 'scope']),
  time: new Set(['datetime']),
  track: new Set(['src', 'kind', 'srclang', 'label', 'default']),
  video: new Set([
    'src', 'poster', 'controls', 'loop', 'muted', 'preload', 'playsinline',
    'width', 'height',
  ]),
}

/**
 * Start tags that force an open `<p>` closed (HTML "in body", the
 * `close a p element` clause).
 *
 * These exist here because the emitted string has to be a FIXED POINT of the
 * parser. A crawler and a browser both read the server response through the
 * document parser, which reparents `<p>a<div>b</div></p>` into
 * `<p>a</p><div>b</div><p></p>` — and React, hydrating, compares the
 * container's `innerHTML` to the `__html` it was handed and reports the
 * difference as a mismatch. Emitting the implied end tag ourselves is what
 * makes "what we wrote" and "what the browser will hold" the same string.
 * That is not a theoretical tidiness: it is the hydration regression this
 * change would otherwise have traded the SSR gap for.
 */
const CLOSES_OPEN_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dd',
  'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'summary', 'table', 'ul',
])

/**
 * Elements whose children the parser accepts ONLY as table parts. Text and
 * ordinary elements written here are foster-parented OUT of the table, which
 * is a reparenting this cannot express — so they are dropped instead, and
 * the emitted string round-trips.
 */
const TABLE_CONTEXTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr'])

/** Elements the parser only accepts inside a table. */
const TABLE_PARTS = new Set([
  'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
])

/** Attributes whose value is a URL and must clear the scheme rule. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster', 'cite'])
/** Attributes whose value is a comma-separated candidate list of URLs. */
const URL_LIST_ATTRIBUTES = new Set(['srcset'])

/**
 * Schemes a URL attribute may name. Mirrors DOMPurify's default
 * `ALLOWED_URI_REGEXP` minus `javascript:`-adjacent shapes it also refuses;
 * `data:` is handled separately because it is only safe on the media
 * attributes and only for raster types.
 */
const ALLOWED_SCHEMES = new Set([
  'http', 'https', 'ftp', 'ftps', 'mailto', 'tel', 'callto', 'sms', 'cid',
  'xmpp',
])

/** Tag/attribute pairs on which a `data:` URL is considered at all. */
const DATA_URI_ATTRIBUTES = new Set(['img:src', 'img:srcset', 'source:src',
  'source:srcset', 'video:src', 'video:poster', 'audio:src'])

/**
 * `data:` payloads accepted on those pairs: raster images only.
 *
 * `image/svg+xml` is deliberately absent. An SVG document can carry
 * `<script>`, and a `data:` SVG in an `img` is same-origin-ish enough in
 * enough engines that treating it as an image is a bet this does not need to
 * take — the author has real image hosting.
 */
const DATA_URI_PAYLOAD =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon)\s*;\s*base64\s*,/i

/**
 * Named character references this decodes, beyond the numeric forms.
 *
 * The list is short on purpose and the reasoning is in the module header:
 * HTML has no named reference for an ASCII letter, so no reference outside
 * this table can contribute to spelling `javascript`. What a reference CAN
 * contribute is the colon and the leading whitespace a browser tolerates
 * before a scheme, so those are the ones that must be understood rather than
 * passed through.
 */
const NAMED_REFERENCES: Record<string, string> = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"',
  QUOT: '"', apos: "'", nbsp: ' ', colon: ':', semi: ';', sol: '/',
  bsol: '\\', num: '#', period: '.', comma: ',', excl: '!', quest: '?',
  lpar: '(', rpar: ')', Tab: '\t', NewLine: '\n', equals: '=', ast: '*',
  commat: '@', dollar: '$', percnt: '%', plus: '+', minus: '-', lowbar: '_',
}

/**
 * Decodes character references in an attribute value the way a browser will,
 * so the value can be JUDGED as the browser will see it.
 *
 * Numeric references are decoded generically — that is the form that can
 * produce any character at all, and the only form that can spell a scheme.
 * Named references are decoded from {@link NAMED_REFERENCES}; anything else
 * is left verbatim, which is safe precisely because it cannot become a
 * letter or a colon. Everything decoded here is re-escaped on output, so the
 * emitted attribute value and the validated value are the same string.
 */
export function decodeCharacterReferences(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(
    /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}))(;?)/g,
    (match, dec: string, hex: string, name: string) => {
      if (dec !== undefined || hex !== undefined) {
        const code = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16)
        // Surrogates and out-of-range values have no scalar; dropping them
        // is safer than inventing a replacement a re-parse would disagree
        // with.
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ''
        if (code >= 0xd800 && code <= 0xdfff) return ''
        return String.fromCodePoint(code)
      }
      const named = NAMED_REFERENCES[name]
      return named === undefined ? match : named
    },
  )
}

/**
 * Escapes text content EXACTLY as the HTML serialization algorithm does.
 *
 * The byte-for-byte match is the requirement, not a nicety: React compares
 * the container's `innerHTML` against the `__html` it was given when it
 * hydrates, so a string that merely PARSES the same but SERIALIZES
 * differently is reported as a hydration mismatch. `escapeAuthorHtmlText`
 * and {@link escapeAttributeValue} together are the "serialize" half of the
 * fixed point `author-html-round-trip.spec.ts` asserts.
 */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Escapes a decoded attribute value for a double-quoted slot.
 *
 * Deliberately does NOT escape `<` or `>`: the serialization algorithm
 * escapes only `&`, U+00A0 and `"` in an attribute value, and inside a
 * quoted value a raw `<` is literal to the parser, so escaping it would be
 * safe but would not round-trip.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/"/g, '&quot;')
}

/**
 * Whether a decoded URL clears the scheme rule for this tag/attribute.
 *
 * The comparison is made on a copy with every C0 control and space removed
 * and folded to lower case, because browsers strip exactly those while
 * resolving a scheme — `"java\tscript:alert(1)"` navigates.
 */
function isAllowedUrl(tag: string, attribute: string, decoded: string): boolean {
  // eslint-disable-next-line no-control-regex
  const stripped = decoded.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase()
  if (!stripped) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(stripped)
  // No scheme at all: a relative path, a query, or a fragment. Nothing to
  // refuse — it resolves against the site's own origin.
  if (!scheme) return true
  if (scheme[1] === 'data') {
    if (!DATA_URI_ATTRIBUTES.has(`${tag}:${attribute}`)) return false
    return DATA_URI_PAYLOAD.test(stripped)
  }
  return ALLOWED_SCHEMES.has(scheme[1])
}

/**
 * Filters a `srcset`, keeping only candidates whose URL clears the rule.
 *
 * Returns `null` when nothing survives, so the caller drops the attribute
 * rather than emitting an empty one.
 */
function filterSrcset(tag: string, attribute: string, decoded: string): string | null {
  const kept = decoded
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      if (!candidate) return false
      const url = candidate.split(/\s+/)[0] ?? ''
      return isAllowedUrl(tag, attribute, url)
    })
  return kept.length ? kept.join(', ') : null
}

/**
 * CSS shapes dropped outright rather than filtered.
 *
 * {@link sanitizeAuthorCss} is a `url()` scheme rule and says so; it does not
 * claim to understand these. They are legacy script-in-CSS vectors, dead in
 * current engines, and no author has a use for them — refusing the whole
 * declaration block is both cheaper and more honest than pretending to parse
 * it. This is one of the places this sanitizer keeps LESS than DOMPurify,
 * which filters no CSS at all.
 */
const REFUSED_CSS = /expression\s*\(|behaviou?r\s*:|-moz-binding|@import|javascript\s*:|vbscript\s*:/i

/** Applies the CSS rule to a decoded `style` attribute or `<style>` body. */
function sanitizeStyleValue(css: string): string | null {
  if (REFUSED_CSS.test(css)) return null
  const safe = sanitizeAuthorCss(css)
  return safe.trim() ? safe : null
}

interface Attribute {
  name: string
  value: string
}

/**
 * Reads the attributes of a start tag beginning at `index` (just past the
 * tag name). Returns where the tag ends and whether it self-closed.
 */
function readAttributes(
  source: string,
  start: number,
): { attributes: Attribute[]; end: number; selfClosing: boolean } {
  const attributes: Attribute[] = []
  let index = start
  let selfClosing = false
  while (index < source.length) {
    while (index < source.length && /[\s/]/.test(source[index])) {
      if (source[index] === '/') selfClosing = true
      index += 1
    }
    if (index >= source.length) break
    if (source[index] === '>') {
      index += 1
      break
    }
    selfClosing = false
    const nameMatch = /^[^\s"'>/=]+/.exec(source.slice(index))
    if (!nameMatch) {
      index += 1
      continue
    }
    const name = nameMatch[0]
    index += name.length
    while (index < source.length && /\s/.test(source[index])) index += 1
    let value = ''
    if (source[index] === '=') {
      index += 1
      while (index < source.length && /\s/.test(source[index])) index += 1
      const quote = source[index]
      if (quote === '"' || quote === "'") {
        index += 1
        const close = source.indexOf(quote, index)
        const stop = close === -1 ? source.length : close
        value = source.slice(index, stop)
        index = close === -1 ? source.length : close + 1
      } else {
        const unquoted = /^[^\s>]*/.exec(source.slice(index))
        value = unquoted ? unquoted[0] : ''
        index += value.length
      }
    }
    attributes.push({ name, value })
  }
  return { attributes, end: index, selfClosing }
}

/**
 * Skips a raw-text element's contents, returning the index just past its end
 * tag and the raw body.
 *
 * Raw text is the one place this cannot escape its way to safety: the
 * browser will not decode references or recognize tags inside it, so there
 * is no serialization that makes such a body safe to re-emit. Every element
 * in {@link CONTENT_DROPPING} therefore loses its contents entirely.
 */
function readRawTextElement(
  source: string,
  tag: string,
  contentStart: number,
): { body: string; end: number } {
  const closing = new RegExp(`</${tag}[\\s/>]`, 'i')
  const rest = source.slice(contentStart)
  const match = closing.exec(rest)
  if (!match) return { body: rest, end: source.length }
  const body = rest.slice(0, match.index)
  const afterTag = source.indexOf('>', contentStart + match.index)
  return { body, end: afterTag === -1 ? source.length : afterTag + 1 }
}

/**
 * Whether `container` would be TORN OPEN by the sanitized body put inside it.
 *
 * The caller renders the body with `dangerouslySetInnerHTML` inside an
 * element of its own choosing, and that element is part of the served
 * document — so the parser's implied end tags apply to it exactly as they do
 * inside the body. A `<p>` holding an `<h2>`, or an `<h2>` holding an
 * `<h2>`, is closed early by the parser, the rest of the body becomes a
 * SIBLING, and React hydrates against a tree it did not describe.
 *
 * Lives here rather than in the caller so the rule and the
 * {@link CLOSES_OPEN_P} table cannot drift apart; `typography.tsx` uses it to
 * fall back to a `<div>`, which no start tag implies an end tag for.
 *
 * Pure, so the server and the client reach the same answer.
 */
export function authorHtmlBreaksContainer(
  sanitized: string,
  container: string,
): boolean {
  if (!sanitized) return false
  const tags = sanitized.match(/<([a-z][a-z0-9]*)[\s/>]/gi) ?? []
  const names = tags.map((tag) => tag.slice(1, -1).toLowerCase())
  if (container === 'p') return names.some((name) => CLOSES_OPEN_P.has(name))
  if (/^h[1-6]$/.test(container)) {
    return names.some((name) => /^h[1-6]$/.test(name))
  }
  return false
}

/**
 * Something this sanitizer took OUT, phrased for the author who typed it
 * (AGL-2486).
 *
 * Collected BY the sanitizer, at the point each decision is made, rather
 * than re-derived by a second scan of the input. That is the whole design
 * constraint: this module's header refuses to let the policy exist in two
 * engines, and a warning that re-implements the rules is a second engine —
 * one that goes quietly wrong the moment the real rules move, and tells the
 * author their markup is fine while the page drops it.
 *
 * The render path never asks for these. They exist for the AUTHORING side,
 * which is the only place a person who can fix the markup is standing; the
 * runtime is executing for a VISITOR and can do nothing but drop the value
 * silently. Same reasoning as the reserved-name refusal in `actions.ts`.
 */
export interface AuthorHtmlRemoval {
  kind: 'element' | 'attribute' | 'style' | 'url'
  /** One sentence, addressed to the author, naming what is gone and why. */
  message: string
}

/**
 * Sanitizes author-written HTML to a string safe to hand
 * `dangerouslySetInnerHTML`, on the server and in the browser alike.
 *
 * Pure and deterministic: the same input yields the same bytes in Node and
 * in a browser, which is what lets the server render and the first client
 * render agree without an effect (AGL-1901).
 *
 * `removals`, when passed, is APPENDED to with an {@link AuthorHtmlRemoval}
 * for each thing dropped (AGL-2486). It changes nothing about the output —
 * every existing caller is byte-identical whether it passes one or not — so
 * the render path stays exactly as pure as it was and only the editor pays
 * for the bookkeeping.
 */
export function sanitizeAuthorHtml(
  html: string,
  removals?: AuthorHtmlRemoval[],
): string {
  /** Records one removal, deduped so a repeated tag reads once. */
  const note = (kind: AuthorHtmlRemoval['kind'], message: string): void => {
    if (!removals) return
    if (removals.some((entry) => entry.message === message)) return
    removals.push({ kind, message })
  }
  if (!html) return ''
  const out: string[] = []
  const open: string[] = []
  let index = 0
  /** Set right after a `<pre>` start tag — see {@link emitText}. */
  let justOpenedPre = false

  /** Emits end tags down to and including `depth`. */
  const closeTo = (depth: number): void => {
    for (let cursor = open.length - 1; cursor >= depth; cursor -= 1) {
      out.push(`</${open[cursor]}>`)
    }
    open.length = depth
  }

  /** Closes the nearest open `tag`, if one is open. */
  const closeNearest = (tag: string): void => {
    const at = open.lastIndexOf(tag)
    if (at !== -1) closeTo(at)
  }

  /**
   * The end tags the PARSER would imply before this start tag, emitted so the
   * string we write is the string a document parse will hold — see
   * {@link CLOSES_OPEN_P}.
   */
  const applyImpliedEndTags = (tag: string): void => {
    if (CLOSES_OPEN_P.has(tag)) closeNearest('p')
    // A heading start tag closes an open heading — h2 inside h2 is not
    // nesting to the parser, it is a sibling.
    if (/^h[1-6]$/.test(tag)) {
      const at = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
        .map((heading) => open.lastIndexOf(heading))
        .reduce((best, found) => Math.max(best, found), -1)
      if (at !== -1) closeTo(at)
    }
    if (tag === 'li') closeNearest('li')
    if (tag === 'dd' || tag === 'dt') {
      const at = Math.max(open.lastIndexOf('dd'), open.lastIndexOf('dt'))
      if (at !== -1) closeTo(at)
    }
    // A nested anchor is not nesting — the parser closes the outer one.
    if (tag === 'a') closeNearest('a')
    if (tag === 'td' || tag === 'th') {
      const at = Math.max(open.lastIndexOf('td'), open.lastIndexOf('th'))
      if (at !== -1) closeTo(at)
    }
    if (tag === 'tr') closeNearest('tr')
    if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      closeNearest('tr')
      for (const section of ['thead', 'tbody', 'tfoot']) closeNearest(section)
    }
    if (tag === 'table') closeNearest('table')
  }

  /** Whether the insertion point is directly inside a table's structure. */
  const inTableContext = (): boolean =>
    open.length > 0 && TABLE_CONTEXTS.has(open[open.length - 1])

  /**
   * Emits the `<tbody>` and `<tr>` the parser would have INSERTED.
   *
   * `<table><tr>` is held by every browser as `<table><tbody><tr>`, and a
   * `<td>` with no row around it gets both. Writing them out is the same
   * fixed-point rule as the implied end tags: whatever the parser will add,
   * this has to have said already, or the served string and the hydrated DOM
   * are different documents.
   */
  const openImpliedTableParents = (tag: string): void => {
    const parent = (): string => open[open.length - 1]
    if (tag === 'tr' && parent() === 'table') {
      out.push('<tbody>')
      open.push('tbody')
      return
    }
    if (tag === 'td' || tag === 'th') {
      if (parent() === 'table') {
        out.push('<tbody>')
        open.push('tbody')
      }
      if (parent() === 'thead' || parent() === 'tbody' || parent() === 'tfoot') {
        out.push('<tr>')
        open.push('tr')
      }
    }
  }

  const emitStart = (tag: string, attributes: Attribute[]): void => {
    const perElement = AUTHOR_HTML_ELEMENT_ATTRIBUTES[tag]
    const parts: string[] = [tag]
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase()
      // Event handlers, `data-*` (ALLOW_DATA_ATTR: false on both callers),
      // namespaced names, and the two shapes both configs forbade by name.
      if (!/^[a-z][a-z0-9-]*$/.test(name)) continue
      if (name.startsWith('on')) {
        note(
          'attribute',
          `${name}="…" is removed — a published page cannot run author JavaScript from an event handler.`,
        )
        continue
      }
      if (name.startsWith('data-')) continue
      if (name === 'srcdoc' || name === 'formaction' || name === 'is') continue
      if (!GLOBAL_AUTHOR_HTML_ATTRIBUTES.has(name) && !perElement?.has(name)) continue
      let value = decodeCharacterReferences(attribute.value)
      if (name === 'style') {
        const safe = sanitizeStyleValue(value)
        if (safe === null) {
          note(
            'style',
            `the style attribute on <${tag}> is removed — inline CSS cannot use @import, expression(), behavior:, -moz-binding or javascript:.`,
          )
          continue
        }
        // Identity return means nothing was refused; anything else means a
        // `url()` was neutered, which is invisible on the page (the image
        // simply never appears) and therefore the case most worth naming.
        if (safe !== value) {
          note(
            'url',
            `a url() in the style attribute on <${tag}> will not load — inline CSS may only fetch over https:, data: or blob:.`,
          )
        }
        value = safe
      } else if (URL_LIST_ATTRIBUTES.has(name)) {
        const safe = filterSrcset(tag, name, value)
        if (safe === null) {
          note(
            'url',
            `${name} on <${tag}> is removed — only https:, data: and blob: URLs are allowed.`,
          )
          continue
        }
        value = safe
      } else if (URL_ATTRIBUTES.has(name)) {
        if (!isAllowedUrl(tag, name, value)) {
          note(
            'url',
            `${name} on <${tag}> is removed — only https:, data: and blob: URLs are allowed.`,
          )
          continue
        }
      }
      parts.push(`${name}="${escapeAttribute(value)}"`)
    }
    out.push(`<${parts.join(' ')}>`)
  }

  /**
   * Text between a table's own elements is foster-parented OUT of the table
   * by the parser, which is a move this serializer cannot express — so it is
   * dropped and the emitted string round-trips.
   */
  const emitText = (text: string): void => {
    if (!text || inTableContext()) return
    let value = text
    // The parser drops ONE U+000A immediately after a `<pre>` start tag. The
    // serializer is supposed to put one back when the text still begins with
    // one, but that half is not implemented everywhere (jsdom does not), so
    // the ONLY string that survives both a browser and a test DOM unchanged
    // is one with no leading newline at all. Emitting that costs an author a
    // blank first line inside a `<pre>` and buys a fixed point.
    if (justOpenedPre && open[open.length - 1] === 'pre') {
      value = value.replace(/^\n+/, '')
    }
    justOpenedPre = false
    if (!value) return
    out.push(escapeText(value))
  }

  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) {
      emitText(html.slice(index))
      break
    }
    if (next > index) emitText(html.slice(index, next))

    const rest = html.slice(next)
    // Comments, doctypes and processing instructions: no content of ours.
    if (rest.startsWith('<!--')) {
      const close = html.indexOf('-->', next + 4)
      index = close === -1 ? html.length : close + 3
      continue
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      const close = html.indexOf('>', next)
      index = close === -1 ? html.length : close + 1
      continue
    }

    const endTag = /^<\/([a-zA-Z][a-zA-Z0-9]*)/.exec(rest)
    if (endTag) {
      const tag = endTag[1].toLowerCase()
      const close = html.indexOf('>', next)
      index = close === -1 ? html.length : close + 1
      const at = open.lastIndexOf(tag)
      // A stray end tag closes nothing — the browser ignores it too.
      if (at === -1) continue
      closeTo(at)
      continue
    }

    const startTag = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(rest)
    if (!startTag) {
      // A `<` that begins no tag is literal text, exactly as the parser
      // treats it.
      emitText('<')
      index = next + 1
      continue
    }

    const tag = startTag[1].toLowerCase()
    const { attributes, end, selfClosing } = readAttributes(
      html,
      next + startTag[0].length,
    )

    if (CONTENT_DROPPING.has(tag)) {
      note(
        'element',
        `<${tag}> and everything inside it is removed — this element is not allowed in author HTML.`,
      )
      const { end: bodyEnd } = readRawTextElement(html, tag, end)
      index = bodyEnd
      continue
    }

    index = end

    if (!ALLOWED_AUTHOR_HTML_ELEMENTS.has(tag)) {
      // Unwrapped, not dropped — matches DOMPurify's `KEEP_CONTENT` default,
      // so a `<form>` or an unknown tag loses the element and keeps the words
      // inside it.
      note(
        'element',
        `<${tag}> is removed — the text inside it is kept, but the element itself is not allowed in author HTML.`,
      )
      continue
    }

    // Context rules, both of them about reparenting rather than about safety.
    // A non-table element written directly inside a table is foster-parented
    // out of it; a table part written outside a table has its tag dropped and
    // its contents kept. Following the parser here is what keeps the emitted
    // string a fixed point of it.
    if (inTableContext() && !TABLE_PARTS.has(tag)) {
      const { end: bodyEnd } = readRawTextElement(html, tag, end)
      index = bodyEnd
      continue
    }
    if (TABLE_PARTS.has(tag) && !open.includes('table')) continue

    applyImpliedEndTags(tag)

    // `caption`, `colgroup` and `col` are only accepted in one place each;
    // written anywhere else the parser moves or drops them, so this does the
    // dropping and keeps the string stable.
    const parentTag = open[open.length - 1]
    if (
      (tag === 'caption' || tag === 'colgroup') && parentTag !== 'table'
    ) {
      continue
    }
    if (tag === 'col' && parentTag !== 'colgroup') continue

    openImpliedTableParents(tag)

    if (VOID_ELEMENTS.has(tag)) {
      emitStart(tag, attributes)
      continue
    }
    emitStart(tag, attributes)
    justOpenedPre = tag === 'pre'
    if (!selfClosing) open.push(tag)
    else out.push(`</${tag}>`)
  }

  closeTo(0)
  return out.join('')
}
