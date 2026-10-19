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

/*==========================================
 * WHAT A CRAWLED PAGE SAYS (AGL-3974, parent AGL-3973).
 *
 * "Bring my site" reads a person's existing pages for their words, their
 * structure and their pictures. No server HTML parser is a dependency of any
 * lib, and a page's text in order is a small question, so this is a
 * tokenizer: tags and text runs, with the few elements that matter tracked
 * and everything else read through.
 *
 * What never survives, before a single tag is walked:
 * - scripts, styles, iframes, embeds, objects, SVG, canvas, media players,
 *   templates and comments, content and all;
 * - any form with a card, bank or payment field, whole;
 * - and a page with a password field is not read at all: it is refused and
 *   reported (`loginForm`), because a sign-in page is exactly what a
 *   phishing clone wants and nothing a site import needs.
 *
 * The output is DATA. Text from a page reaches a model only fenced as
 * untrusted (`fenceUntrustedText`), never as instructions.
 *=========================================*/

/** One run of a page's content, in the order the page draws it. */
export type SiteImportBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; region: SiteImportRegion }
  | { kind: 'paragraph' | 'list-item' | 'quote'; text: string; region: SiteImportRegion }
  | { kind: 'image'; url: string; alt: string; region: SiteImportRegion }

/** Where on the page a block sat: the header and footer carry business details. */
export type SiteImportRegion = 'header' | 'main' | 'footer'

export interface SiteImportImage {
  /** Absolute https (or http) address. */
  url: string
  alt: string
  /** On the site's own origin; otherwise a CDN or a third party. The importer decides. */
  sameSite: boolean
}

export interface SiteImportNavLink {
  text: string
  url: string
}

/** A form that was kept: what it asks, never what was typed. */
export interface SiteImportForm {
  fields: { type: string; name: string }[]
}

export interface SiteImportExtract {
  title: string
  description: string
  lang: string | null
  canonical: string | null
  blocks: SiteImportBlock[]
  images: SiteImportImage[]
  navLinks: SiteImportNavLink[]
  /** Same-site page addresses, fragment-free, in first-seen order. */
  links: string[]
  forms: { kept: SiteImportForm[]; removed: number }
  /** True when the page has a password field; nothing else is extracted. */
  loginForm: boolean
}

/** Ceilings that keep one odd page from becoming the whole inventory. */
export const SITE_IMPORT_PAGE_LIMITS = {
  blocks: 400,
  blockChars: 2_000,
  images: 100,
  links: 300,
  navLinks: 60,
  forms: 10,
  fieldsPerForm: 30,
} as const

/** Elements removed with everything inside them. */
const REMOVED_WITH_CONTENT = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'applet',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
]

/** Form controls, removed with their content once the forms are summarized. */
const FORM_CONTROLS = ['textarea', 'select', 'button']

/** Void elements removed wherever they appear. */
const REMOVED_VOID = /<(?:embed|param|source|track|link|base)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi

const PASSWORD_INPUT = /<input\b(?:[^>"']|"[^"]*"|'[^']*')*\btype\s*=\s*["']?password\b/i

/**
 * A field that takes money or a bank detail: an autocomplete hint for a
 * card, or a name or id that says card, CVC, IBAN, routing or payment.
 */
const PAYMENT_FIELD =
  /<(?:input|select)\b(?:[^>"']|"[^"]*"|'[^']*')*?(?:\bautocomplete\s*=\s*["']?\s*cc-|\b(?:name|id|data-stripe|data-braintree-name)\s*=\s*["']?[^"'\s>]*(?:card|cc[-_]?(?:num|number|exp|csc|cvv|cvc)|cvv|cvc|csc|iban|routing|account[-_]?number|payment|billing[-_]?card))/i

const BLOCK_TAGS: Record<string, 'paragraph' | 'list-item' | 'quote'> = {
  p: 'paragraph',
  li: 'list-item',
  dt: 'paragraph',
  dd: 'paragraph',
  td: 'paragraph',
  th: 'paragraph',
  address: 'paragraph',
  pre: 'paragraph',
  figcaption: 'paragraph',
  caption: 'paragraph',
  label: 'paragraph',
  blockquote: 'quote',
}

/** Tags that end a run of loose text without being a block themselves. */
const BREAK_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'footer',
  'nav',
  'ul',
  'ol',
  'dl',
  'table',
  'tr',
  'tbody',
  'thead',
  'figure',
  'form',
  'hr',
  'br',
  'body',
])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  ntilde: 'ñ',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  deg: '°',
  times: '×',
}

/** Character references to characters; an unknown name stays as written. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ''
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) return ''
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}

const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g

/** A tag's attributes, names lowercased, values decoded. */
export function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase()
    if (name in attributes) continue
    attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g

/** Every `<meta>` tag's attributes. */
function metaTags(html: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const match of html.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    out.push(parseAttributes(match[1]))
  }
  return out
}

/** The `content` of every `<meta name="…">` with this name. */
export function readMetaValues(html: string, name: string): string[] {
  const wanted = name.toLowerCase()
  return metaTags(html)
    .filter((attributes) => (attributes['name'] ?? '').toLowerCase() === wanted)
    .map((attributes) => (attributes['content'] ?? '').trim())
    .filter(Boolean)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function removeElements(html: string, tags: readonly string[]): string {
  let out = html
  for (const tag of tags) {
    const paired = new RegExp(`<${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi')
    out = out.replace(paired, ' ')
    // One left open runs to the end of the document, as a browser reads it.
    const unclosed = new RegExp(`<${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*>[\\s\\S]*$`, 'i')
    out = out.replace(unclosed, ' ')
  }
  return out
}

/** Forms with a payment field go whole; the rest are summarized, then go. */
function takeForms(html: string): { html: string; kept: SiteImportForm[]; removed: number } {
  const kept: SiteImportForm[] = []
  let removed = 0
  const out = html.replace(/<form\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/form\s*>|$)/gi, (form) => {
    if (PAYMENT_FIELD.test(form)) {
      removed += 1
      return ' '
    }
    if (kept.length < SITE_IMPORT_PAGE_LIMITS.forms) {
      const fields: SiteImportForm['fields'] = []
      for (const match of form.matchAll(/<(input|textarea|select)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
        const attributes = parseAttributes(match[2])
        const type = match[1].toLowerCase() === 'input' ? (attributes['type'] || 'text').toLowerCase() : match[1].toLowerCase()
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') continue
        fields.push({ type, name: clip(attributes['name'] || attributes['id'] || '', 80) })
        if (fields.length >= SITE_IMPORT_PAGE_LIMITS.fieldsPerForm) break
      }
      kept.push({ fields })
    }
    return ' '
  })
  return { html: out, kept, removed }
}

/** `raw` against the page, as an absolute http(s) address without a fragment. */
export function resolveSiteUrl(raw: string | undefined, base: string): URL | null {
  const value = String(raw ?? '').trim()
  if (!value || /^(?:javascript|data|mailto|tel|sms|blob|about):/i.test(value)) return null
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

/** The first address a `srcset` offers. */
function firstSrcset(srcset: string | undefined): string | undefined {
  const first = String(srcset ?? '').split(',')[0]?.trim().split(/\s+/)[0]
  return first || undefined
}

/**
 * The words, structure, pictures and links of one page.
 *
 * `isSameSite(url)` says whether an address is on the site being imported;
 * only those become `links`, and images are marked by it.
 */
export function extractSiteImportPage(
  html: string,
  pageUrl: string,
  isSameSite: (url: URL) => boolean,
): SiteImportExtract {
  const empty: SiteImportExtract = {
    title: '',
    description: '',
    lang: null,
    canonical: null,
    blocks: [],
    images: [],
    navLinks: [],
    links: [],
    forms: { kept: [], removed: 0 },
    loginForm: false,
  }
  let source = String(html ?? '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
  if (PASSWORD_INPUT.test(source)) return { ...empty, loginForm: true }

  source = removeElements(source, REMOVED_WITH_CONTENT).replace(REMOVED_VOID, ' ')
  // Forms next, so a field list is read before the controls go.
  const forms = takeForms(source)
  source = removeElements(forms.html, FORM_CONTROLS)

  const metas = metaTags(source)
  const metaContent = (key: string, attribute: 'name' | 'property') =>
    collapse(metas.find((m) => (m[attribute] ?? '').toLowerCase() === key)?.['content'] ?? '')
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)
  const title = clip(
    collapse(decodeHtmlEntities(titleMatch?.[1] ?? '')) || metaContent('og:title', 'property'),
    300,
  )
  const description = clip(
    metaContent('description', 'name') || metaContent('og:description', 'property'),
    1_000,
  )
  const htmlTag = /<html\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(source)
  const lang = htmlTag ? parseAttributes(htmlTag[1])['lang']?.trim() || null : null
  let canonical: string | null = null
  for (const match of String(html ?? '').matchAll(/<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attributes = parseAttributes(match[1])
    if ((attributes['rel'] ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
      canonical = resolveSiteUrl(attributes['href'], pageUrl)?.toString() ?? null
      break
    }
  }

  const bodyStart = source.search(/<body\b/i)
  const body = bodyStart >= 0 ? source.slice(bodyStart) : source.replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
  const hasNav = /<nav\b/i.test(body)

  const blocks: SiteImportBlock[] = []
  const images: SiteImportImage[] = []
  const imageSeen = new Set<string>()
  const navLinks: SiteImportNavLink[] = []
  const links: string[] = []
  const linkSeen = new Set<string>()

  let navDepth = 0
  let headerDepth = 0
  let footerDepth = 0
  let current: { kind: 'heading' | 'paragraph' | 'list-item' | 'quote'; level?: number; tag: string } | null = null
  let buffer = ''
  let anchor: { url: URL; text: string } | null = null

  const region = (): SiteImportRegion =>
    footerDepth > 0 ? 'footer' : headerDepth > 0 ? 'header' : 'main'
  // A site without a <nav> keeps its menu in the header; its links are the nav.
  const inNav = () => navDepth > 0 || (!hasNav && headerDepth > 0)

  const flush = () => {
    const text = clip(collapse(decodeHtmlEntities(buffer)), SITE_IMPORT_PAGE_LIMITS.blockChars)
    buffer = ''
    const kind = current?.kind ?? 'paragraph'
    const level = current?.level
    current = null
    if (!text || navDepth > 0 || blocks.length >= SITE_IMPORT_PAGE_LIMITS.blocks) return
    const last = blocks[blocks.length - 1]
    if (last && last.kind !== 'image' && last.text === text) return
    if (kind === 'heading') {
      blocks.push({ kind, level: (level ?? 2) as 1 | 2 | 3 | 4 | 5 | 6, text, region: region() })
    } else {
      blocks.push({ kind, text, region: region() })
    }
  }

  for (const match of body.matchAll(new RegExp(`${TAG.source}|([^<]+)|<`, 'g'))) {
    const text = match[4]
    if (text !== undefined || match[2] === undefined) {
      const run = text ?? '<'
      buffer += run
      if (anchor) anchor.text += run
      continue
    }
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    const attributes = closing ? {} : parseAttributes(match[3] ?? '')

    if (tag === 'a') {
      if (closing) {
        if (anchor) {
          const label = clip(collapse(decodeHtmlEntities(anchor.text)), 120)
          if (inNav() && label && navLinks.length < SITE_IMPORT_PAGE_LIMITS.navLinks) {
            navLinks.push({ text: label, url: anchor.url.toString() })
          }
          anchor = null
        }
        continue
      }
      const url = resolveSiteUrl(attributes['href'], pageUrl)
      anchor = url ? { url, text: '' } : null
      if (url && isSameSite(url) && links.length < SITE_IMPORT_PAGE_LIMITS.links) {
        const key = url.toString()
        if (!linkSeen.has(key)) {
          linkSeen.add(key)
          links.push(key)
        }
      }
      continue
    }

    if (tag === 'img' && !closing) {
      const url = resolveSiteUrl(
        attributes['src'] || attributes['data-src'] || firstSrcset(attributes['srcset'] || attributes['data-srcset']),
        pageUrl,
      )
      if (url && images.length < SITE_IMPORT_PAGE_LIMITS.images) {
        const key = url.toString()
        const alt = clip(collapse(attributes['alt'] ?? ''), 300)
        if (!imageSeen.has(key)) {
          imageSeen.add(key)
          images.push({ url: key, alt, sameSite: isSameSite(url) })
          if (navDepth === 0) {
            flush()
            if (blocks.length < SITE_IMPORT_PAGE_LIMITS.blocks) {
              blocks.push({ kind: 'image', url: key, alt, region: region() })
            }
          }
        }
      }
      continue
    }

    if (tag === 'nav' || tag === 'header' || tag === 'footer') {
      flush()
      const step = closing ? -1 : 1
      if (tag === 'nav') navDepth = Math.max(0, navDepth + step)
      if (tag === 'header') headerDepth = Math.max(0, headerDepth + step)
      if (tag === 'footer') footerDepth = Math.max(0, footerDepth + step)
      continue
    }

    const heading = /^h([1-6])$/.exec(tag)
    if (heading || BLOCK_TAGS[tag]) {
      if (closing) {
        if (current?.tag === tag) flush()
        continue
      }
      flush()
      current = heading
        ? { kind: 'heading', level: Number(heading[1]), tag }
        : { kind: BLOCK_TAGS[tag], tag }
      continue
    }

    if (BREAK_TAGS.has(tag)) {
      if (tag === 'br' && current) {
        buffer += ' '
        continue
      }
      flush()
    }
  }
  flush()

  return {
    title,
    description,
    lang,
    canonical,
    blocks,
    images,
    navLinks,
    links,
    forms: { kept: forms.kept, removed: forms.removed },
    loginForm: false,
  }
}
