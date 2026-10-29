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
 *
 * What a page is made of is kept as the page shows it (AGL-4083): words that
 * sit in tags side by side stay apart ("Sign in" and "Start free", never
 * "Sign inStart free"); a link is a block of its own, `mailto:` and `tel:`
 * ones too, so an address or a phone number survives; a menu entry is named
 * by its first line, not by its mega-menu description; a `<picture>`'s
 * source stands in for an `<img>` with no address; and the head's share card,
 * icons, site name and Organization structured data come along for the
 * header, the footer and the site's own facts.
 *=========================================*/

/** One run of a page's content, in the order the page draws it. */
export type SiteImportBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; region: SiteImportRegion }
  | { kind: 'paragraph' | 'list-item' | 'quote'; text: string; region: SiteImportRegion }
  | { kind: 'image'; url: string; alt: string; region: SiteImportRegion }
  /**
   * A link the page shows outside its menus (AGL-4083): `href` is an absolute
   * http(s) address, a `mailto:` or a `tel:`. `inline` when its words are
   * already in the block before it (a link inside a sentence); a link on its
   * own (a button, an email address in a card) is only this block.
   */
  | { kind: 'link'; text: string; href: string; region: SiteImportRegion; inline?: true }

/** Where on the page a block sat: the header and footer carry business details. */
export type SiteImportRegion = 'header' | 'main' | 'footer'

export interface SiteImportImage {
  /** Absolute https (or http) address. */
  url: string
  alt: string
  /** On the site's own origin; otherwise a CDN or a third party. The importer decides. */
  sameSite: boolean
  /** Where on the page it sat, its menus included (AGL-4083): a header's picture is often the logo. */
  region: SiteImportRegion
}

/** A `<link rel="icon">` or `apple-touch-icon` of the page's head (AGL-4083). */
export interface SiteImportIcon {
  url: string
  rel: 'icon' | 'apple-touch-icon'
  /** The larger side its `sizes` names, or `null` for none or `any`. */
  size: number | null
  /** Its declared type, as written. */
  type: string | null
}

/**
 * The link to the home page in a page's header (AGL-4083): what its brand is
 * drawn with. `logo` is the first picture inside it; `text` its words, which
 * are the site's name when the header prints one.
 */
export interface SiteImportBrandMark {
  logo: { url: string; alt: string } | null
  text: string
  region: SiteImportRegion
}

/**
 * The page's Organization (or LocalBusiness) structured data (AGL-4083), as
 * written: the site's own statement of its name, address, phone, email and
 * profiles. Every field is the empty string, or an empty list, when absent.
 */
export interface SiteImportOrganization {
  name: string
  description: string
  url: string
  logo: string
  telephone: string
  email: string
  /** One line: street, town, region and postal code, country. */
  address: string
  sameAs: string[]
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
  /** The share card, `og:image` (or `twitter:image`), as an absolute address (AGL-4083). */
  ogImage: string | null
  /** The site's own name, `og:site_name` (or `application-name`); empty when absent. */
  siteName: string
  icons: SiteImportIcon[]
  brand: SiteImportBrandMark | null
  organization: SiteImportOrganization | null
  blocks: SiteImportBlock[]
  images: SiteImportImage[]
  navLinks: SiteImportNavLink[]
  /** Same-site page addresses, fragment-free, in first-seen order. */
  links: string[]
  forms: { kept: SiteImportForm[]; removed: number }
  /** True when the page has a password field; nothing else is extracted. */
  loginForm: boolean
  /**
   * How the page is built (AGL-4106), when asked for: every element the
   * blocks sit in, so the layout reader sees the source's sections, rows,
   * cards and menus, not only its lines. Never stored: the crawl reads it
   * into a layout and drops it.
   */
  structure?: SiteImportStructure
}

/** The attributes of an element the layout reader reads; everything else is dropped. */
export interface SiteImportElementAttrs {
  class?: string
  id?: string
  style?: string
  role?: string
  /** `aria-label`. */
  label?: string
  /** An anchor's address as written. */
  href?: string
  /** `hidden`, or `aria-hidden="true"`. */
  hidden?: true
  /** `data-section-theme` or `data-theme`: a site builder's name for a band's look. */
  theme?: string
  type?: string
  /** `aria-controls` / `aria-labelledby`: what a tab shows, and what names a panel. */
  controls?: string
  labelledby?: string
}

/** One element of the page, in a flat table: its parent and children by index. */
export interface SiteImportElement {
  id: number
  tag: string
  /** -1 for an element at the top of the body. */
  parent: number
  children: number[]
  region: SiteImportRegion
  /** Inside a `<nav>`, or a header with no `<nav>`. */
  nav: boolean
  attrs: SiteImportElementAttrs
  /** The blocks whose words sit directly in this element, by index into `blocks`. */
  blocks: number[]
  /** The icon this element is, by index into `structure.icons` (an inline `<svg>`). */
  icon?: number
  /** The form that sat here, by index into the page's kept forms. */
  form?: number
  /**
   * Its place in the page's order of content: a block's index, or the index
   * of the block that follows an icon, less a half. Set on elements that
   * hold a block or an icon directly.
   */
  order?: number
}

/**
 * An inline `<svg>` the page draws as an icon (AGL-4106): one path the
 * Besigner's icon element draws as it is, or the shapes of a small drawing,
 * cleaned to geometry, for a picture of it. Never its text.
 */
export interface SiteImportSvgIcon {
  viewBox: string
  /** The one `<path d>`, at most 4 KB. */
  path?: string
  /** A drawing of several shapes, at most 16 KB, its geometry and fills only. */
  svg?: string
}

/** A link on the page, menus included, as the structure keeps it for the menus' reader. */
export interface SiteImportAnchor {
  /** The `<a>` element. */
  element: number
  /** Where it goes: an absolute http(s) address, a `mailto:` or a `tel:`; `null` for none. */
  href: string | null
  /** Its first line: a menu entry's name. */
  label: string
  /** Its other lines: a mega-menu entry's description. */
  text: string
  region: SiteImportRegion
  nav: boolean
  /** The first icon inside it. */
  icon?: number
  /** The first picture inside it. */
  image?: string
}

export interface SiteImportStructure {
  elements: SiteImportElement[]
  /** The element each block's words sit in, by block index. */
  blockElement: number[]
  icons: SiteImportSvgIcon[]
  anchors: SiteImportAnchor[]
  /**
   * Words a menu or a header holds outside its links, where they sit: a mega
   * menu's column heading ("By team"), the button that opens a menu. A menu's
   * words are never blocks, so these are how the menu reader sees them.
   */
  texts: Array<{ element: number; text: string }>
  /** The page's own `<style>` sheets, in order. */
  styles: string[]
  /** The stylesheets it links (absolute https), in order, Google Fonts' included. */
  stylesheets: string[]
  /** The `<main>` element, or -1 when the page has none. */
  main: number
  /** The `<body>`'s element, or -1. */
  body: number
  /** The `<html>` element's attributes. */
  root: SiteImportElementAttrs
}

export interface SiteImportExtractOptions {
  /** Keep how the page is built (`structure`), for the layout reader (AGL-4106). */
  structure?: boolean
}

/** Ceilings that keep one odd page from becoming the whole inventory. */
export const SITE_IMPORT_PAGE_LIMITS = {
  /** A pricing page's plan table runs past 400 (AGL-4083); a wave's read keeps fewer, under its own budget. */
  blocks: 2_000,
  /** A legal page's paragraph runs past 2,000 characters. */
  blockChars: 10_000,
  images: 100,
  links: 300,
  /** A mega-menu's entries and the footer's columns together. */
  navLinks: 150,
  forms: 10,
  fieldsPerForm: 30,
  icons: 12,
  /** The structure's ceilings (AGL-4106): elements, inline icons, links and the page's own style sheets. */
  elements: 20_000,
  svgIcons: 200,
  anchors: 800,
  styleChars: 1_500_000,
  stylesheets: 4,
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

/**
 * Form controls, removed with their content once the forms are summarized.
 * A `<button>` outside a form is not one (AGL-4106): its words are a line
 * ("Watch the 40-second film", a pricing tab's name) and a picture inside it
 * is still a picture. A form's own buttons go with the form.
 */
const FORM_CONTROLS = ['textarea', 'select']

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
  /** A disclosure's question, a button's words (AGL-4106). */
  summary: 'paragraph',
  button: 'paragraph',
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
  'tfoot',
  'details',
  'figure',
  'form',
  'hr',
  'br',
  'body',
])

/**
 * Tags a browser lays out apart from the words beside them (AGL-4083): two
 * links, or a link and a picture, side by side are two runs of words, never
 * one ("Sign in" and "Start free", not "Sign inStart free"). Every other tag
 * inside a block styles words where they are (a `<span>` or a `<strong>`
 * mid-sentence) and adds no space; block-level tags already end their block.
 */
const RUN_BOUNDARY = new Set(['a', 'img', 'button', 'input', 'select', 'textarea', 'picture', 'video', 'audio', 'iframe', 'object', 'embed', 'canvas', 'svg', 'meter', 'progress', 'output'])

/** Where one run of words ends and the next begins, resolved when a block is written. */
const RUN_BREAK = '\u0001'

/**
 * The runs of a block joined as a reader sees them: a space between two
 * runs, except before closing punctuation or after an opening one, where
 * the page wrote none ("<span>Austin</span>, Texas" is "Austin, Texas").
 */
const RUN_BREAKS = new RegExp(`[\\s${RUN_BREAK}]*${RUN_BREAK}[\\s${RUN_BREAK}]*`, 'g')

function joinRuns(text: string): string {
  if (!text.includes(RUN_BREAK)) return text
  return text.replace(RUN_BREAKS, (match: string, offset: number, whole: string) => {
    if (/\s/.test(match)) return ' '
    const before = whole[offset - 1] ?? ''
    const after = whole[offset + match.length] ?? ''
    if (!before || !after) return ''
    if (/[.,;:!?%)\]}\u2019\u201d\u00bb]/.test(after) || /[([{\u2018\u201c\u00ab]/.test(before)) return ''
    // A straight quote opens after a space or a bracket, and closes before one.
    if (/["']/.test(before) && /^$|[\s([{]/.test(whole[offset - 2] ?? '')) return ''
    if (/["']/.test(after) && /^$|[\s.,;:!?)\]}]/.test(whole[offset + match.length + 1] ?? '')) return ''
    return ' '
  })
}

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
  return joinRuns(text).replace(/\s+/g, ' ').trim()
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
        // A field no visitor sees is a trap for bots or a widget's shadow, not a question (AGL-4083).
        if ((attributes['aria-hidden'] ?? '').toLowerCase() === 'true' || attributes['tabindex'] === '-1') continue
        fields.push({ type, name: clip(attributes['name'] || attributes['id'] || '', 80) })
        if (fields.length >= SITE_IMPORT_PAGE_LIMITS.fieldsPerForm) break
      }
      kept.push({ fields })
      // Where the form sat, for the layout (AGL-4106): a marker, never words.
      return ` <aglyn-form data-form="${kept.length - 1}"> `
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
 * Where a link a page shows goes (AGL-4083): an absolute http(s) address
 * without its fragment, a `mailto:` with an address in it, or a `tel:` with
 * a number in it; `null` for anything else (a script, a jump on the page).
 */
export function resolveSiteLink(raw: string | undefined, base: string): string | null {
  const value = String(raw ?? '').trim()
  const mail = /^mailto:([^?\s<>"']+@[^?\s<>"']+)/i.exec(value)
  if (mail) return `mailto:${decodeURIComponent(mail[1]).toLowerCase()}`
  const phone = /^tel:([+\d][\d\s().-]{2,30})$/i.exec(value)
  if (phone) return `tel:${phone[1].replace(/[\s().-]/g, '')}`
  if (value.startsWith('#')) return null
  return resolveSiteUrl(value, base)?.toString() ?? null
}

/**
 * A `<picture>` whose `<img>` has no address of its own (a placeholder, or
 * none at all) is read from its first `<source>` (AGL-4083); a `<picture>`
 * whose `<img>` has one keeps it. The sources go with the void elements.
 */
function readPictures(html: string): string {
  return html.replace(/<picture\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/picture\s*>/gi, (whole, inner: string) => {
    const img = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(inner)
    const attributes = img ? parseAttributes(img[1]) : {}
    const own = attributes['src'] || attributes['data-src'] || firstSrcset(attributes['srcset'] || attributes['data-srcset'])
    if (own && !/^data:/i.test(own.trim())) return whole
    let source: string | undefined
    for (const match of inner.matchAll(/<source\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
      const sourceAttributes = parseAttributes(match[1])
      source = firstSrcset(sourceAttributes['srcset'] || sourceAttributes['data-srcset'])
      if (source) break
    }
    if (!source) return whole
    const quote = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    return ` <img src="${quote(source)}" alt="${quote(attributes['alt'] ?? '')}"> `
  })
}

/** The head's icons, the largest first within each kind. */
function readIcons(html: string, pageUrl: string): SiteImportIcon[] {
  const icons: SiteImportIcon[] = []
  for (const match of html.matchAll(/<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attributes = parseAttributes(match[1])
    const rels = (attributes['rel'] ?? '').toLowerCase().split(/\s+/)
    const rel = rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')
      ? 'apple-touch-icon'
      : rels.includes('icon')
        ? 'icon'
        : null
    if (!rel) continue
    const url = resolveSiteUrl(attributes['href'], pageUrl)
    if (!url) continue
    const sizes: string[] = [...((attributes['sizes'] ?? '').match(/(\d+)\s*x\s*(\d+)/gi) ?? [])]
    const size = sizes.reduce<number>((most, entry) => Math.max(most, ...entry.split(/x/i).map((side) => Number(side) || 0)), 0)
    icons.push({ url: url.toString(), rel, size: size || null, type: attributes['type']?.trim() || null })
    if (icons.length >= SITE_IMPORT_PAGE_LIMITS.icons) break
  }
  return icons.sort((a, b) => (a.rel === b.rel ? (b.size ?? 0) - (a.size ?? 0) : a.rel === 'apple-touch-icon' ? -1 : 1))
}

const ORGANIZATION_TYPE = /(?:^|\b)(?:Organization|Corporation|LocalBusiness|NGO|EducationalOrganization|MedicalOrganization|SportsOrganization|Store|Restaurant|ProfessionalService|HomeAndConstructionBusiness|HealthAndBeautyBusiness|FoodEstablishment|AutomotiveBusiness|LegalService|FinancialService|Dentist|Physician|LodgingBusiness|EntertainmentBusiness)$/

/**
 * The first Organization (or kind of local business) the page's structured
 * data describes, read before scripts are thrown away. Malformed data, or
 * none, is `null`; nothing in it is ever run.
 */
function readOrganization(html: string): SiteImportOrganization | null {
  const nodes: Record<string, unknown>[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || nodes.length > 50 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1)
      return
    }
    const node = value as Record<string, unknown>
    nodes.push(node)
    if (node['@graph']) visit(node['@graph'], depth + 1)
  }
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      visit(JSON.parse(match[1]), 0)
    } catch {
      // Structured data that does not parse says nothing.
    }
  }
  const typeOf = (node: Record<string, unknown>) => ([] as unknown[]).concat(node['@type'] ?? []).map(String)
  const node = nodes.find((entry) => typeOf(entry).some((type) => ORGANIZATION_TYPE.test(type)))
  if (!node) return null
  const text = (value: unknown, max = 300): string => (typeof value === 'string' ? clip(collapse(value), max) : '')
  const urlOf = (value: unknown): string => {
    const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as Record<string, unknown>)['url'] : ''
    return typeof raw === 'string' && /^https?:\/\//i.test(raw.trim()) ? raw.trim() : ''
  }
  const contact = ([] as unknown[]).concat(node['contactPoint'] ?? []).find((entry) => entry && typeof entry === 'object') as
    | Record<string, unknown>
    | undefined
  const address = (() => {
    const value = node['address']
    if (typeof value === 'string') return text(value)
    if (!value || typeof value !== 'object') return ''
    const parts = value as Record<string, unknown>
    const region = [text(parts['addressRegion']), text(parts['postalCode'])].filter(Boolean).join(' ')
    const country = parts['addressCountry']
    return [text(parts['streetAddress']), text(parts['addressLocality']), region, typeof country === 'string' ? text(country) : text((country as Record<string, unknown> | null)?.['name'])]
      .filter(Boolean)
      .join(', ')
  })()
  return {
    name: text(node['name']),
    description: text(node['description'], 1_000),
    url: urlOf(node['url']),
    logo: urlOf(node['logo']),
    telephone: text(node['telephone']) || text(contact?.['telephone']),
    email: (text(node['email']) || text(contact?.['email'])).replace(/^mailto:/i, ''),
    address,
    sameAs: ([] as unknown[])
      .concat(node['sameAs'] ?? [])
      .map((entry) => urlOf(entry))
      .filter(Boolean)
      .slice(0, 20),
  }
}

/*------------------------------------------
 * How the page is built (AGL-4106)
 *-----------------------------------------*/

const SVG_ELEMENT = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/svg\s*>/gi
const SVG_SHAPE = /<(path|circle|rect|ellipse|line|polyline|polygon)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
/** What a drawing keeps of a shape: its geometry and paint, never a link, a script or a reference. */
const SVG_SHAPE_ATTRIBUTES = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'fill',
  'fill-rule',
  'clip-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'transform',
])
const SVG_SAFE_VALUE = /^[\w\s.,#%()+-]*$/
const SVG_PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,\s+-]+$/
const VIEW_BOX = /^-?[\d.]+(?:[\s,]+-?[\d.]+){3}$/

/** An `<svg>`'s drawing area: its `viewBox`, else its size, else the 24-unit square of an icon set. */
function viewBoxOf(attributes: Record<string, string>): string {
  const written = (attributes['viewbox'] ?? '').trim().replace(/[\s,]+/g, ' ')
  if (VIEW_BOX.test(written)) return written
  const width = parseFloat(attributes['width'] ?? '')
  const height = parseFloat(attributes['height'] ?? '')
  return width > 0 && height > 0 ? `0 0 ${width} ${height}` : '0 0 24 24'
}

/**
 * Every inline `<svg>` turned into a marker the walk reads as an icon at its
 * place, its drawing kept in `icons` once however often it repeats. A drawing
 * that embeds anything but shapes (a picture, text, a reference) is no icon
 * and goes, as every `<svg>` did before.
 */
function readSvgIcons(html: string, icons: SiteImportSvgIcon[]): string {
  const seen = new Map<string, number>()
  return html.replace(SVG_ELEMENT, (whole: string, attributeSource: string, inner: string) => {
    if (/<(?:image|foreignobject|use|text|script)\b/i.test(inner)) return ' '
    const shapes = [...inner.matchAll(SVG_SHAPE)]
    if (!shapes.length) return ' '
    const viewBox = viewBoxOf(parseAttributes(attributeSource))
    let icon: SiteImportSvgIcon | null = null
    if (shapes.length === 1 && shapes[0][1].toLowerCase() === 'path') {
      const d = (parseAttributes(shapes[0][2])['d'] ?? '').trim()
      if (d && d.length <= 4_096 && SVG_PATH_DATA.test(d)) icon = { viewBox, path: d }
    }
    if (!icon && whole.length <= 16_384 && shapes.length <= 64) {
      const drawn = shapes.map(([, tag, source]) => {
        const kept = Object.entries(parseAttributes(source))
          .filter(([name, value]) => SVG_SHAPE_ATTRIBUTES.has(name) && SVG_SAFE_VALUE.test(value) && !/url\s*\(/i.test(value))
          .map(([name, value]) => `${name}="${value}"`)
        return `<${tag.toLowerCase()}${kept.length ? ` ${kept.join(' ')}` : ''}/>`
      })
      icon = { viewBox, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${drawn.join('')}</svg>` }
    }
    if (!icon) return ' '
    const key = `${icon.viewBox}|${icon.path ?? icon.svg}`
    let index = seen.get(key)
    if (index === undefined) {
      if (icons.length >= SITE_IMPORT_PAGE_LIMITS.svgIcons) return ' '
      index = icons.length
      icons.push(icon)
      seen.set(key, index)
    }
    return ` <aglyn-svg data-icon="${index}"> `
  })
}

/** The page's own `<style>` sheets and the stylesheets it links, print ones left out. */
function readStyleSheets(html: string, pageUrl: string): { styles: string[]; stylesheets: string[] } {
  const styles: string[] = []
  let chars = 0
  for (const match of html.matchAll(/<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/style\s*>/gi)) {
    const media = (parseAttributes(match[1])['media'] ?? '').toLowerCase()
    if (media && !/\b(?:all|screen)\b/.test(media)) continue
    const css = match[2] ?? ''
    if (!css.trim() || chars + css.length > SITE_IMPORT_PAGE_LIMITS.styleChars) continue
    chars += css.length
    styles.push(css)
  }
  const stylesheets: string[] = []
  for (const match of html.matchAll(/<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attributes = parseAttributes(match[1])
    if (!(attributes['rel'] ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue
    const media = (attributes['media'] ?? '').toLowerCase()
    if (media && !/\b(?:all|screen)\b/.test(media)) continue
    const url = resolveSiteUrl(attributes['href'], pageUrl)
    if (!url || url.protocol !== 'https:' || stylesheets.includes(url.toString())) continue
    stylesheets.push(url.toString())
    if (stylesheets.length >= SITE_IMPORT_PAGE_LIMITS.stylesheets) break
  }
  return { styles, stylesheets }
}

/** Elements with no content and no end tag. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'aglyn-svg', 'aglyn-form'])

/** Start tags that end an open `<p>`, as a browser reads them. */
const CLOSES_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
])

/** For each tag that ends an open one of its own kind: the kinds it ends, and the tags that wall the search off. */
const IMPLIED_END: Record<string, { ends: ReadonlySet<string>; walls: ReadonlySet<string> }> = {
  li: { ends: new Set(['li']), walls: new Set(['ul', 'ol', 'menu']) },
  dt: { ends: new Set(['dt', 'dd']), walls: new Set(['dl']) },
  dd: { ends: new Set(['dt', 'dd']), walls: new Set(['dl']) },
  tr: { ends: new Set(['tr', 'td', 'th']), walls: new Set(['table', 'tbody', 'thead', 'tfoot']) },
  td: { ends: new Set(['td', 'th']), walls: new Set(['tr', 'table']) },
  th: { ends: new Set(['td', 'th']), walls: new Set(['tr', 'table']) },
  option: { ends: new Set(['option']), walls: new Set(['select', 'datalist']) },
  tbody: { ends: new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']), walls: new Set(['table']) },
  thead: { ends: new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']), walls: new Set(['table']) },
  tfoot: { ends: new Set(['tbody', 'thead', 'tfoot', 'tr', 'td', 'th']), walls: new Set(['table']) },
}
const P_WALLS = new Set(['button', 'table', 'td', 'th', 'caption', 'object', 'template', 'html', 'marquee', 'applet'])

/** The attributes the layout reader reads. */
function elementAttrs(attributes: Record<string, string>): SiteImportElementAttrs {
  const attrs: SiteImportElementAttrs = {}
  const text = (value: string | undefined, max: number) => {
    const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
    return clean ? clean.slice(0, max) : undefined
  }
  const put = <K extends keyof SiteImportElementAttrs>(key: K, value: SiteImportElementAttrs[K] | undefined) => {
    if (value !== undefined) attrs[key] = value
  }
  put('class', text(attributes['class'], 600))
  put('id', text(attributes['id'], 120))
  put('style', text(attributes['style'], 1_000))
  put('role', text(attributes['role'], 40)?.toLowerCase())
  put('label', text(attributes['aria-label'], 200))
  put('href', text(attributes['href'], 2_048))
  put('theme', text(attributes['data-section-theme'] ?? attributes['data-theme'], 40)?.toLowerCase())
  put('type', text(attributes['type'], 40)?.toLowerCase())
  put('controls', text(attributes['aria-controls'], 120))
  put('labelledby', text(attributes['aria-labelledby'], 120))
  if ('hidden' in attributes || (attributes['aria-hidden'] ?? '').toLowerCase() === 'true') attrs.hidden = true
  return attrs
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
  options: SiteImportExtractOptions = {},
): SiteImportExtract {
  const empty: SiteImportExtract = {
    title: '',
    description: '',
    lang: null,
    canonical: null,
    ogImage: null,
    siteName: '',
    icons: [],
    brand: null,
    organization: null,
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

  // Read before scripts go: the structured data is a script's body.
  const organization = readOrganization(source)
  const icons = readIcons(source, pageUrl)
  const keep = options.structure === true
  const sheets = keep ? readStyleSheets(source, pageUrl) : { styles: [], stylesheets: [] }
  // An inline icon is a marker at its place (AGL-4106); its drawing is never words.
  const svgIcons: SiteImportSvgIcon[] = []
  source = readSvgIcons(source, svgIcons)
  source = removeElements(readPictures(source), REMOVED_WITH_CONTENT).replace(REMOVED_VOID, ' ')
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
  const ogImage =
    resolveSiteUrl(metaContent('og:image', 'property') || metaContent('og:image:url', 'property') || metaContent('twitter:image', 'name'), pageUrl)?.toString() ??
    null
  const siteName = clip(metaContent('og:site_name', 'property') || metaContent('application-name', 'name'), 120)
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
  let brand: SiteImportBrandMark | null = null

  let navDepth = 0
  let headerDepth = 0
  let footerDepth = 0
  let current: { kind: 'heading' | 'paragraph' | 'list-item' | 'quote'; level?: number; tag: string; element: number } | null = null
  let buffer = ''
  /** The link being read: its menu address (http(s) only), where it goes, its words and its first picture. */
  let anchor: {
    url: URL | null
    href: string | null
    text: string
    /** Its words split where a block-level tag inside it began, for a menu entry's first line. */
    lines: string[]
    image: { url: string; alt: string } | null
    /** Where in `buffer` its words begin. */
    start: number
    /** Its words ran across a block's end: some of them are in a block already. */
    crossed: boolean
    region: SiteImportRegion
    /** Its element, and the first icon inside it (AGL-4106). */
    element: number
    icon?: number
  } | null = null
  /** The links read into the block being built, written after it. */
  let pending: Array<{ text: string; href: string; start: number; end: number; crossed: boolean; region: SiteImportRegion; element: number }> = []

  // How the page is built (AGL-4106): every element, in a flat table, and
  // the element each block's words sit in. Kept only when asked for.
  const elements: SiteImportElement[] = []
  const blockElement: number[] = []
  const anchors: SiteImportAnchor[] = []
  const texts: Array<{ element: number; text: string }> = []
  /** Where in `buffer` the words no link has taken begin: a menu's own words are read from here. */
  let ownFrom = 0
  /** A menu's or a header's own words, outside its links (AGL-4106), from `ownFrom` on. */
  const takeOwnWords = (element: number) => {
    if (!keep || element < 0 || !(navDepth > 0 || headerDepth > 0) || texts.length >= SITE_IMPORT_PAGE_LIMITS.anchors) return
    const words = clip(collapse(decodeHtmlEntities(buffer.slice(ownFrom))), 300)
    if (words) texts.push({ element, text: words })
  }
  /** The elements open where the walk is, innermost last. */
  const open: number[] = []
  let mainElement = -1
  let roleMain = -1
  let bodyElement = -1
  /** The element the loose words being read began in. */
  let looseElement = -1
  const top = () => (open.length ? (open[open.length - 1] as number) : -1)

  const region = (): SiteImportRegion =>
    footerDepth > 0 ? 'footer' : headerDepth > 0 ? 'header' : 'main'
  // A site without a <nav> keeps its menu in the header; its links are the nav.
  const inNav = () => navDepth > 0 || (!hasNav && headerDepth > 0)
  const room = () => blocks.length < SITE_IMPORT_PAGE_LIMITS.blocks

  /** A block, and where its words sit. */
  const push = (block: SiteImportBlock, element: number) => {
    blocks.push(block)
    if (!keep) return
    blockElement.push(element)
    const owner = elements[element]
    if (!owner) return
    owner.blocks.push(blocks.length - 1)
    if (owner.order === undefined) owner.order = blocks.length - 1
  }

  /** Pops the open elements down to the innermost `tags` one, unless a wall stands first. */
  const endOpen = (tags: ReadonlySet<string>, walls: ReadonlySet<string>) => {
    for (let at = open.length - 1; at >= 0; at -= 1) {
      const tag = elements[open[at] as number]?.tag ?? ''
      if (tags.has(tag)) {
        open.length = at
        return
      }
      if (walls.has(tag)) return
    }
  }
  const P_ONLY = new Set(['p'])
  /** An element opens: what it implies is closed first, then it is the innermost. */
  const openElement = (tag: string, attributes: Record<string, string>, selfClosing: boolean): number => {
    if (!keep) return -1
    if (CLOSES_P.has(tag)) endOpen(P_ONLY, P_WALLS)
    const implied = IMPLIED_END[tag]
    if (implied) endOpen(implied.ends, implied.walls)
    const isVoid = VOID_TAGS.has(tag)
    if (isVoid && tag !== 'img' && tag !== 'aglyn-svg' && tag !== 'aglyn-form') return -1
    if (elements.length >= SITE_IMPORT_PAGE_LIMITS.elements) return -1
    const id = elements.length
    const parent = top()
    elements.push({ id, tag, parent, children: [], region: region(), nav: inNav(), attrs: elementAttrs(attributes), blocks: [] })
    elements[parent]?.children.push(id)
    if (!isVoid && !selfClosing) open.push(id)
    if (tag === 'body' && bodyElement < 0) bodyElement = id
    if (tag === 'main' && mainElement < 0) mainElement = id
    if (roleMain < 0 && (attributes['role'] ?? '').toLowerCase() === 'main') roleMain = id
    return id
  }
  /** An element closes: it and everything still open inside it. */
  const closeElement = (tag: string) => {
    if (!keep) return
    for (let at = open.length - 1; at >= 0; at -= 1) {
      if (elements[open[at] as number]?.tag === tag) {
        open.length = at
        return
      }
    }
  }

  const flush = () => {
    const raw = buffer
    const written = pending
    const loose = current === null
    const element = current?.element ?? looseElement
    if (!anchor) takeOwnWords(element)
    ownFrom = 0
    buffer = ''
    pending = []
    looseElement = -1
    if (anchor && collapse(decodeHtmlEntities(raw.slice(anchor.start)))) anchor.crossed = true
    if (anchor) anchor.start = 0
    const kind = current?.kind ?? 'paragraph'
    const level = current?.level
    current = null
    const text = clip(collapse(decodeHtmlEntities(raw)), SITE_IMPORT_PAGE_LIMITS.blockChars)
    if (navDepth > 0) return
    // Loose words that are only links (a row of buttons, an address in a
    // card) are those links, each a block of its own; words around a link
    // keep their block, and the link follows it.
    let rest = raw
    for (const link of [...written].sort((a, b) => b.start - a.start)) rest = `${rest.slice(0, link.start)}${rest.slice(link.end)}`
    const onlyLinks = loose && written.length > 0 && !collapse(decodeHtmlEntities(rest))
    if (text && !onlyLinks && room()) {
      const last = blocks[blocks.length - 1]
      if (!(last && last.kind !== 'image' && last.kind !== 'link' && last.text === text)) {
        if (kind === 'heading') {
          push({ kind, level: (level ?? 2) as 1 | 2 | 3 | 4 | 5 | 6, text, region: region() }, element)
        } else {
          push({ kind, text, region: region() }, element)
        }
      }
    }
    for (const link of written) {
      if (!room()) break
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'link' && last.href === link.href && last.text === link.text) continue
      const inline = !onlyLinks || link.crossed
      push({ kind: 'link', text: link.text, href: link.href, region: link.region, ...(inline ? { inline: true as const } : {}) }, link.element)
    }
  }

  /** A boundary between two runs of words: in the block, and in the link being read. */
  const boundary = (block: boolean) => {
    buffer += RUN_BREAK
    if (!anchor) return
    anchor.text += RUN_BREAK
    if (block && anchor.lines[anchor.lines.length - 1] !== '') anchor.lines.push('')
  }

  /** One tag of the page, read where the walk is. */
  const read = (closing: boolean, tag: string, attributes: Record<string, string>, element: number) => {
    if (tag === 'a') {
      if (closing) {
        if (anchor) {
          const label = clip(collapse(decodeHtmlEntities(anchor.text)), 300)
          const firstLine = clip(collapse(decodeHtmlEntities(anchor.lines.find((line) => collapse(decodeHtmlEntities(line))) ?? '')), 120)
          if (inNav() && anchor.url && firstLine && navLinks.length < SITE_IMPORT_PAGE_LIMITS.navLinks) {
            navLinks.push({ text: firstLine, url: anchor.url.toString() })
          }
          if (!brand && anchor.region !== 'footer' && (headerDepth > 0 || navDepth > 0) && anchor.url && isSameSite(anchor.url) && anchor.url.pathname === '/') {
            brand = { logo: anchor.image, text: label, region: anchor.region }
          }
          if (!inNav() && anchor.href && label) {
            pending.push({ text: label, href: anchor.href, start: anchor.start, end: buffer.length, crossed: anchor.crossed, region: anchor.region, element: anchor.element })
          }
          if (keep && anchor.element >= 0 && anchors.length < SITE_IMPORT_PAGE_LIMITS.anchors) {
            const lines = anchor.lines.map((line) => clip(collapse(decodeHtmlEntities(line)), 300)).filter(Boolean)
            anchors.push({
              element: anchor.element,
              href: anchor.href,
              label: firstLine,
              text: clip(lines.slice(1).join(' '), 300),
              region: anchor.region,
              nav: inNav(),
              ...(anchor.icon !== undefined ? { icon: anchor.icon } : {}),
              ...(anchor.image ? { image: anchor.image.url } : {}),
            })
          }
          anchor = null
        }
        boundary(false)
        ownFrom = buffer.length
        return
      }
      // Words before a link in a menu are its own: a column's heading.
      if (!anchor) takeOwnWords(current?.element ?? (looseElement >= 0 ? looseElement : top()))
      boundary(false)
      const url = resolveSiteUrl(attributes['href'], pageUrl)
      anchor = {
        url,
        href: resolveSiteLink(attributes['href'], pageUrl),
        text: '',
        lines: [''],
        image: null,
        start: buffer.length,
        crossed: false,
        region: region(),
        element,
      }
      if (url && isSameSite(url) && links.length < SITE_IMPORT_PAGE_LIMITS.links) {
        const key = url.toString()
        if (!linkSeen.has(key)) {
          linkSeen.add(key)
          links.push(key)
        }
      }
      return
    }

    if (tag === 'aglyn-svg') {
      // An icon at its place: never words (AGL-4106).
      const index = Number(attributes['data-icon'])
      if (keep && element >= 0 && Number.isInteger(index) && svgIcons[index]) {
        const own = elements[element] as SiteImportElement
        own.icon = index
        own.order = blocks.length - 0.5
        if (anchor && anchor.icon === undefined) anchor.icon = index
      }
      return
    }

    if (tag === 'aglyn-form') {
      const index = Number(attributes['data-form'])
      if (keep && element >= 0 && Number.isInteger(index)) {
        const own = elements[element] as SiteImportElement
        own.form = index
        own.order = blocks.length - 0.5
      }
      return
    }

    if (tag === 'img' && !closing) {
      const url = resolveSiteUrl(
        attributes['src'] || attributes['data-src'] || firstSrcset(attributes['srcset'] || attributes['data-srcset']),
        pageUrl,
      )
      boundary(false)
      if (url && images.length < SITE_IMPORT_PAGE_LIMITS.images) {
        const key = url.toString()
        const alt = clip(collapse(attributes['alt'] ?? ''), 300)
        if (anchor && !anchor.image) anchor.image = { url: key, alt }
        if (!imageSeen.has(key)) {
          imageSeen.add(key)
          images.push({ url: key, alt, sameSite: isSameSite(url), region: region() })
          if (navDepth === 0) {
            flush()
            if (room()) push({ kind: 'image', url: key, alt, region: region() }, element)
          }
        }
      }
      return
    }

    if (tag === 'nav' || tag === 'header' || tag === 'footer') {
      flush()
      boundary(true)
      const step = closing ? -1 : 1
      if (tag === 'nav') navDepth = Math.max(0, navDepth + step)
      if (tag === 'header') headerDepth = Math.max(0, headerDepth + step)
      if (tag === 'footer') footerDepth = Math.max(0, footerDepth + step)
      // The landmark is in its own region.
      const own = elements[element]
      if (own) {
        own.region = region()
        own.nav = inNav()
      }
      return
    }

    const heading = /^h([1-6])$/.exec(tag)
    if (heading || BLOCK_TAGS[tag]) {
      if (closing) {
        if (current?.tag === tag) flush()
        boundary(true)
        return
      }
      flush()
      boundary(true)
      current = heading
        ? { kind: 'heading', level: Number(heading[1]), tag, element }
        : { kind: BLOCK_TAGS[tag], tag, element }
      return
    }

    if (BREAK_TAGS.has(tag)) {
      if (tag === 'br' && current) {
        buffer += ' '
        if (anchor) anchor.text += ' '
        return
      }
      flush()
      boundary(true)
      return
    }

    if (RUN_BOUNDARY.has(tag)) boundary(false)
  }

  for (const match of body.matchAll(new RegExp(`${TAG.source}|([^<]+)|<`, 'g'))) {
    const text = match[4]
    if (text !== undefined || match[2] === undefined) {
      const run = text ?? '<'
      buffer += run
      if (keep && looseElement < 0 && current === null && run.trim()) looseElement = top()
      if (anchor) {
        anchor.text += run
        anchor.lines[anchor.lines.length - 1] += run
      }
      continue
    }
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    const attributes = closing ? {} : parseAttributes(match[3] ?? '')
    const element = closing ? -1 : openElement(tag, attributes, /\/\s*$/.test(match[3] ?? ''))
    read(closing, tag, attributes, element)
    if (closing) closeElement(tag)
  }
  flush()

  return {
    title,
    description,
    lang,
    canonical,
    ogImage,
    siteName,
    icons,
    brand,
    organization,
    blocks,
    images,
    navLinks,
    links,
    forms: { kept: forms.kept, removed: forms.removed },
    loginForm: false,
    ...(keep
      ? {
          structure: {
            elements,
            blockElement,
            icons: svgIcons,
            anchors,
            texts,
            styles: sheets.styles,
            stylesheets: sheets.stylesheets,
            main: mainElement >= 0 ? mainElement : roleMain,
            body: bodyElement,
            root: htmlTag ? elementAttrs(parseAttributes(htmlTag[1])) : {},
          },
        }
      : {}),
  }
}
