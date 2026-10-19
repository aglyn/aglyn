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
  AI_SITE_CORNERS,
  AI_SITE_GROUNDS,
  type AiSiteButtons,
  type AiSiteCorners,
  type AiSiteDensity,
  type AiSiteGround,
} from '../model/ai-site-kinds'
import {
  AI_SITE_BUTTONS,
  AI_SITE_CARDS,
  AI_SITE_HEADERS,
  aiHexOklch,
  type AiSiteCards,
  type AiSiteHeader,
} from '../model/ai-site-look'
import { aiSiteMotionStyle, type AiSiteMotionStyle } from '../layout-language/ai-layout-motion'
import { normalizeThemeHex } from '../tools/ai-theme-tool'
import { AI_THEME_BRAND_COLORS_PER_SOURCE, referencePageColors, type AiReferencePage } from './ai-theme-brand-inputs'

/**
 * What a site the person likes says about how it is built (AGL-3975), read by
 * code into the site job's own vocabularies. SIGNALS ONLY: every value here
 * is a member of a closed set this module or the look's modules define, or a
 * hex color. Nothing the page SAYS — no sentence, heading, name, picture
 * address or logo — is kept, so nothing of it can reach a prompt or a page.
 * The page's words are read only to tell one kind of section from another,
 * and the answer is the kind, never the words.
 *
 * One page and at most two of its stylesheets (`readReferencePage`), never a
 * crawl. Every reader is best effort: a signal the page does not show is
 * `null`, and the site job chooses that dimension as it always has.
 */

/** The kinds of section a page is read into, in the site plan's own words. */
export const AI_SITE_INSPIRATION_SECTIONS = [
  'hero',
  'about',
  'features',
  'steps',
  'stats',
  'gallery',
  'menu',
  'products',
  'pricing',
  'testimonials',
  'logos',
  'team',
  'events',
  'blog',
  'faq',
  'newsletter',
  'booking',
  'contact',
  'cta',
] as const
export type AiSiteInspirationSection = (typeof AI_SITE_INSPIRATION_SECTIONS)[number]

/** What a site offers its visitors, which a paid start maps onto Aglyn's own parts. */
export const AI_SITE_INSPIRATION_FEATURES = [
  'booking',
  'store',
  'blog',
  'forms',
  'gallery',
  'events',
  'menu',
  'testimonials',
  'newsletter',
] as const
export type AiSiteInspirationFeature = (typeof AI_SITE_INSPIRATION_FEATURES)[number]

/** The mood of a site's headings' type. */
export const AI_SITE_INSPIRATION_FONT_MOODS = ['serif', 'sans', 'display'] as const
export type AiSiteInspirationFontMood = (typeof AI_SITE_INSPIRATION_FONT_MOODS)[number]

/** How a site's main buttons are drawn: a fill, or only an outline. */
export const AI_SITE_INSPIRATION_BUTTON_FILLS = ['filled', 'outline'] as const
export type AiSiteInspirationButtonFill = (typeof AI_SITE_INSPIRATION_BUTTON_FILLS)[number]

const DENSITIES: readonly AiSiteDensity[] = ['compact', 'regular', 'airy']
const ALIGNS = ['start', 'center'] as const

/** The most sections of one page that are kept, in order. */
export const AI_SITE_INSPIRATION_MAX_SECTIONS = 10

/** One site's signals. */
export interface AiSiteInspirationSite {
  /** Its home page's sections, top to bottom, the header and footer left out. */
  sections: AiSiteInspirationSection[]
  density: AiSiteDensity | null
  /** Its header: the logo at the start with the links after it, or centered. */
  headerAlign: (typeof ALIGNS)[number] | null
  /** What sets its header bar off the page. */
  header: AiSiteHeader | null
  /** Its brand colors, most used first, the colorful before the greys. */
  colors: string[]
  ground: AiSiteGround | null
  fontMood: AiSiteInspirationFontMood | null
  buttons: AiSiteButtons | null
  buttonFill: AiSiteInspirationButtonFill | null
  corners: AiSiteCorners | null
  cards: AiSiteCards | null
  motion: AiSiteMotionStyle | null
  /** What it offers its visitors; empty on a Free start, which maps none. */
  features: AiSiteInspirationFeature[]
}

/** What a job read of the sites it was given, as its plan keeps it. */
export interface AiSiteInspiration {
  v: 1
  sites: AiSiteInspirationSite[]
  /** How many of the sites given could not be read. */
  unread: number
}

// ── The page, reduced ────────────────────────────────────────────────────

const COMMENTS = /<!--[\s\S]*?-->/g
const INERT_BLOCKS = /<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
const STYLE_ATTRIBUTE = /\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/gi
const URL_ATTRIBUTE = /\b(?:href|src|action|data-src)\s*=\s*["']([^"']+)["']/gi
const CLASS_ATTRIBUTE = /\b(?:class|id|data-section|data-block|aria-labelledby)\s*=\s*["']([^"']*)["']/gi
const TAG = /<[^>]+>/g

/** A page's visible words, for telling sections apart; never kept. */
function wordsOf(html: string): string {
  return html
    .replace(INERT_BLOCKS, ' ')
    .replace(TAG, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Every class, id and section name in a stretch of markup, lowercased. */
function tokensOf(html: string): string {
  return [...html.matchAll(CLASS_ATTRIBUTE)].map((match) => match[1] ?? '').join(' ').toLowerCase()
}

/** Every address a stretch of markup links or loads. */
function urlsOf(html: string): string[] {
  return [...html.matchAll(URL_ATTRIBUTE)].map((match) => (match[1] ?? '').toLowerCase())
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length

// ── Stylesheets, reduced ─────────────────────────────────────────────────

interface CssRule {
  selector: string
  decls: Map<string, string>
}

const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g

function declarationsOf(body: string): Map<string, string> {
  const decls = new Map<string, string>()
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon <= 0) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).replace(/!important/i, '').trim().toLowerCase()
    if (property && value) decls.set(property, value)
  }
  return decls
}

/** Each rule of a stylesheet, its selector and declarations; nested at-rules are read by their inner rules. */
export function cssRulesOf(css: string): CssRule[] {
  const rules: CssRule[] = []
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(CSS_RULE)) {
    const selector = (match[1] ?? '').trim().toLowerCase()
    if (!selector || selector.startsWith('@')) continue
    rules.push({ selector, decls: declarationsOf(match[2] ?? '') })
  }
  return rules
}

/** A CSS length in px: rem and em at 16px, a percentage as itself. `null` for anything else. */
function px(value: string | undefined): number | null {
  if (!value) return null
  const match = /(-?\d*\.?\d+)\s*(px|rem|em|%)?/.exec(value)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  return match[2] === 'rem' || match[2] === 'em' ? amount * 16 : amount
}

const median = (values: readonly number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] as number
}

/** The first color a declaration value names, as hex. */
function colorOf(value: string | undefined): string | null {
  if (!value) return null
  const hex = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(value)
  if (hex) return normalizeThemeHex(hex[0])
  const rgb = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?/i.exec(value)
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])
    if (alpha < 0.5) return null
    return `#${[rgb[1], rgb[2], rgb[3]].map((channel) => Math.min(255, Number(channel)).toString(16).padStart(2, '0')).join('')}`
  }
  if (/\bwhite\b/.test(value)) return '#ffffff'
  if (/\bblack\b/.test(value)) return '#000000'
  return null
}

const NONE = /^(none|0|0px|transparent|initial|unset)$/

/** Whether a declaration draws something: a shadow, a border, a fill. */
const draws = (value: string | undefined) => Boolean(value && !NONE.test(value.trim()) && !/^0(px)?\s+0(px)?\s+0(px)?\b/.test(value))

// ── Sections ─────────────────────────────────────────────────────────────

const BOOKING_HOSTS =
  /calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|square\.site\/book|opentable\.|resy\.com|exploretock\.com|sevenrooms\.com|booksy\.com|vagaro\.com|fresha\.com|mindbodyonline\.com|setmore\.com|simplybook\.|schedulicity\.com|zocdoc\.com|janeapp\.com/

interface Segment {
  index: number
  html: string
  tokens: string
  heading: string
  words: string
}

/** The page's body with its header and footer cut away. */
function bodyOf(html: string): { body: string; header: string } {
  const open = /<body\b[^>]*>/i.exec(html)
  let body = open ? html.slice(open.index + open[0].length) : html
  body = body.replace(/<\/body\s*>[\s\S]*$/i, '')
  const headerMatch = /<header\b[\s\S]*?<\/header\s*>/i.exec(body)
  const header = headerMatch?.[0] ?? (/<nav\b[\s\S]*?<\/nav\s*>/i.exec(body)?.[0] ?? '')
  if (headerMatch) body = body.slice(0, headerMatch.index) + body.slice(headerMatch.index + headerMatch[0].length)
  const footer = body.search(/<footer\b/i)
  if (footer >= 0) body = body.slice(0, footer)
  return { body, header }
}

/** The page's sections: its `<section>`s where it has them, else the stretches its main headings open. */
function segmentsOf(body: string): Segment[] {
  const clean = body.replace(COMMENTS, ' ')
  const starts = (pattern: RegExp) => [...clean.matchAll(pattern)].map((match) => match.index ?? 0)
  let cuts = starts(/<section\b/gi)
  if (cuts.length < 2) cuts = starts(/<h[12]\b/gi)
  if (!cuts.length) return []
  return cuts.map((at, index) => {
    const html = clean.slice(at, cuts[index + 1] ?? clean.length)
    const heading = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/i.exec(html)
    return { index, html, tokens: tokensOf(html), heading: heading ? wordsOf(heading[1] ?? '') : '', words: wordsOf(html) }
  })
}

/** The kind of one section, or `null` for a stretch that says too little to tell. */
function sectionKind(segment: Segment): AiSiteInspirationSection | null {
  const { html, tokens, heading, words, index } = segment
  const has = (pattern: RegExp) => pattern.test(tokens) || pattern.test(heading)
  const images = count(html, /<img\b|<picture\b/gi)
  const emails = count(html, /<input\b[^>]*type\s*=\s*["']?email/gi)
  const areas = count(html, /<textarea\b/gi)
  const prices = count(words, /[$€£]\s?\d/g)
  const wordCount = words ? words.split(' ').length : 0
  if ((index === 0 && /<h1\b/i.test(html)) || /\bhero\b|banner|masthead|jumbotron|splash/.test(tokens)) return 'hero'
  if (has(/pricing|\bplans?\b|price-table|packages|\btiers?\b/) || (prices >= 2 && /\/\s?(mo|month|yr|year)\b|per month|billed/.test(words))) return 'pricing'
  if (/\bmenu\b|our dishes|food (&|and) drink/.test(heading) || /(food|dinner|lunch|brunch|drinks?|cocktail)[-_]?menu|menu[-_](section|list|card|category)/.test(tokens)) return 'menu'
  if (count(html, /<details\b/gi) >= 2 || has(/\bfaq|accordion|frequently asked|questions/)) return 'faq'
  if (/<blockquote\b/i.test(html) || has(/testimonial|\breviews?\b|kind words|what (our )?(clients|customers|guests|people) say/)) return 'testimonials'
  if (has(/\blogos?\b|clients|\bbrands\b|partners|trusted by|as seen|featured in/)) return 'logos'
  if (BOOKING_HOSTS.test(urlsOf(html).join(' ')) || has(/booking|reserv|appointment|\bbook (a|an|your|now)\b|schedule a/)) return 'booking'
  if (emails === 1 && !areas && has(/newsletter|subscribe|sign-?up|stay in (the )?loop/)) return 'newsletter'
  if (/<form\b/i.test(html) && (emails || areas)) return 'contact'
  if (has(/contact|get in touch|reach us|say hello|visit us|find us/)) return 'contact'
  if (has(/\bevents?\b|calendar|upcoming|\bshows\b|tour dates|what's on/) || count(html, /<time\b/gi) >= 2) return 'events'
  if (has(/\bblog\b|\bposts?\b|articles?|journal|\bnews\b|latest stories/) || count(html, /<article\b/gi) >= 2) return 'blog'
  if (has(/product|\bshop\b|bestsellers|new arrivals/) || /add to (cart|bag)/.test(words)) return 'products'
  if (has(/\bteam\b|\bstaff\b|meet (the|our)|our people|founders/)) return 'team'
  if (has(/\bstats\b|numbers|counter|metrics/) || count(words, /\b\d+(\.\d+)?\s?(k|m|\+|%)(?=\s|$)/g) >= 3) return 'stats'
  if (has(/\bsteps\b|process|how-it-works|how it works|timeline|how we work/)) return 'steps'
  if (has(/gallery|portfolio|selected work|our work|\bworks\b|projects|masonry|lookbook/) || (images >= 4 && wordCount < 60)) return 'gallery'
  if (has(/\babout\b|our story|\bstory\b|mission|who we are/)) return 'about'
  if (has(/features|services|benefits|what we (do|offer)|why choose|\boffer/) || count(html, /<h3\b/gi) >= 3) return 'features'
  if (has(/\bcta\b|callout|call-to-action/) || (wordCount < 40 && /<(a|button)\b/i.test(html))) return 'cta'
  return wordCount >= 20 ? 'about' : null
}

/** The page's sections in order, a run of one kind read as one section. */
export function inspirationSectionsOf(html: string): AiSiteInspirationSection[] {
  const sections: AiSiteInspirationSection[] = []
  for (const segment of segmentsOf(bodyOf(html).body)) {
    const kind = sectionKind(segment)
    if (kind && sections[sections.length - 1] !== kind) sections.push(kind)
    if (sections.length === AI_SITE_INSPIRATION_MAX_SECTIONS) break
  }
  return sections
}

// ── Header ───────────────────────────────────────────────────────────────

const HEADER_SELECTOR = /(^|[\s,>])(header|\.header|\.site-header|\.navbar|\.nav-bar|\.topbar|\.masthead|#header|nav)([\s.:#,>[]|$)/

/** The header's arrangement and what sets it off the page. */
function headerSignals(html: string, rules: readonly CssRule[]): Pick<AiSiteInspirationSite, 'headerAlign' | 'header'> {
  const { header } = bodyOf(html)
  const headerRules = rules.filter((rule) => HEADER_SELECTOR.test(rule.selector))
  let headerAlign: AiSiteInspirationSite['headerAlign'] = null
  if (header) {
    const tokens = tokensOf(header)
    const logo = header.search(/<[^>]+\b(class|id)\s*=\s*["'][^"']*\b(logo|brand)[^"']*["']|<img\b/i)
    const before = logo > 0 ? count(header.slice(0, logo), /<a\b/gi) : 0
    const after = logo >= 0 ? count(header.slice(logo), /<a\b/gi) : 0
    const centered =
      /(^|\s)(text-center|justify-center|centered|center|header--center|logo-center|is-centered)(\s|$)/.test(tokens) ||
      headerRules.some((rule) => rule.decls.get('text-align') === 'center' || rule.decls.get('justify-content') === 'center') ||
      (before >= 2 && after >= 3)
    headerAlign = centered ? 'center' : 'start'
  }
  let style: AiSiteHeader | null = null
  if (headerRules.length) {
    if (headerRules.some((rule) => draws(rule.decls.get('box-shadow')))) style = 'shadow'
    else if (headerRules.some((rule) => draws(rule.decls.get('border-bottom')) || draws(rule.decls.get('border-bottom-width')))) style = 'line'
    else style = 'flat'
  }
  return { headerAlign, header: style }
}

// ── Spacing ──────────────────────────────────────────────────────────────

const SECTION_SELECTOR = /(^|[\s,>.#])(section|hero|band|block|\.container|\.wrapper|main|\.content|\.row)\b/

/** How much room the sections take: their vertical padding, from the stylesheet or a utility class. */
function densityOf(html: string, rules: readonly CssRule[]): AiSiteDensity | null {
  const paddings: number[] = []
  for (const rule of rules) {
    if (!SECTION_SELECTOR.test(rule.selector)) continue
    const value = rule.decls.get('padding-top') ?? rule.decls.get('padding-block') ?? rule.decls.get('padding')
    const amount = px(value)
    if (amount !== null && amount > 0 && !value?.includes('%')) paddings.push(amount)
  }
  for (const match of tokensOf(bodyOf(html).body).matchAll(/(?:^|\s)(?:py|pt)-(\d{1,2})(?=\s|$)/g)) {
    paddings.push(Number(match[1]) * 4)
  }
  const middle = median(paddings)
  if (middle === null) return null
  return middle >= 96 ? 'airy' : middle <= 40 ? 'compact' : 'regular'
}

// ── Color and ground ─────────────────────────────────────────────────────

/** The page ground the body sits on, among the light grounds a site's look offers; `null` for a dark one. */
function groundOf(rules: readonly CssRule[]): AiSiteGround | null {
  const body = rules.find(
    (rule) => /(^|,)\s*(body|html|:root)\s*(,|$)/.test(rule.selector) && (rule.decls.has('background') || rule.decls.has('background-color')),
  )
  const hex = colorOf(body?.decls.get('background-color') ?? body?.decls.get('background'))
  if (!hex) return null
  const { L, C, h } = aiHexOklch(hex)
  if (L < 0.85) return null
  if (C < 0.012) return 'white'
  if (C < 0.045) return h >= 40 && h <= 115 ? 'warm' : h >= 180 && h <= 280 ? 'cool' : 'white'
  return 'tinted'
}

// ── Type ─────────────────────────────────────────────────────────────────

const DISPLAY_FAMILIES =
  /anton|oswald|bebas|archivo black|syne|abril|alfa slab|league gothic|impact|barlow condensed|fjalla|teko|righteous|bungee|passion one|staatliches|six caps|big shoulders/
const SERIF_FAMILIES =
  /playfair|georgia|times|garamond|merriweather|lora\b|baskerville|cormorant|dm serif|fraunces|newsreader|source serif|crimson|caslon|bodoni|didot|instrument serif|spectral|cardo|prata|marcellus|noto serif|pt serif|zilla|domine|libre serif|eb garamond|cinzel/

/** One font family's mood. */
export function inspirationFontMood(family: string): AiSiteInspirationFontMood | null {
  const name = family.replace(/["']/g, '').trim().toLowerCase()
  if (!name) return null
  if (DISPLAY_FAMILIES.test(name)) return 'display'
  if (/\bsans\b/.test(name) || name === 'sans-serif') return 'sans'
  if (SERIF_FAMILIES.test(name) || name === 'serif' || /\bserif\b/.test(name)) return 'serif'
  return 'sans'
}

const HEADING_SELECTOR = /(^|[\s,>])(h1|h2|\.h1|\.h2|\.heading|\.title|\.display|\.headline)\b/
const BODY_SELECTOR = /(^|,)\s*(body|html|:root)\s*(,|$)/

/** The mood of the headings' type: their font family, else the page's, else the first family it loads. */
function fontMoodOf(html: string, rules: readonly CssRule[]): AiSiteInspirationFontMood | null {
  const familyOf = (rule: CssRule | undefined) => {
    const value = rule?.decls.get('font-family') ?? (rule?.decls.get('font') ?? '').replace(/^[^"'a-z]*\d[^\s]*\s+/, '')
    const first = value.split(',')[0]?.trim()
    return first && !first.startsWith('var(') ? first : null
  }
  const heading = familyOf(rules.find((rule) => HEADING_SELECTOR.test(rule.selector) && (rule.decls.has('font-family') || rule.decls.has('font'))))
  if (heading) return inspirationFontMood(heading)
  const loaded = /fonts\.googleapis\.com\/css2?\?family=([^&"':]+)/i.exec(html)
  if (loaded?.[1]) return inspirationFontMood(decodeURIComponent(loaded[1].replace(/\+/g, ' ')))
  const body = familyOf(rules.find((rule) => BODY_SELECTOR.test(rule.selector) && (rule.decls.has('font-family') || rule.decls.has('font'))))
  return body ? inspirationFontMood(body) : null
}

// ── Buttons, cards, corners ──────────────────────────────────────────────

const BUTTON_SELECTOR = /(^|[\s,>.])(btn|button|\.cta|\[type=.?submit)/
const CARD_SELECTOR = /\.[\w-]*(card|tile|panel|box|feature|service|item|plan|post)s?\b/

/** A radius as the look's corners. */
function cornersOf(radius: number): AiSiteCorners {
  return radius <= 2 ? 'sharp' : radius <= 10 ? 'soft' : radius <= 20 ? 'round' : 'pill'
}

/** How the main buttons are drawn: their shape and casing, and whether they are filled. */
function buttonSignals(
  html: string,
  rules: readonly CssRule[],
): Pick<AiSiteInspirationSite, 'buttons' | 'buttonFill'> & { radius: number | null } {
  const buttonRules = rules.filter((rule) => BUTTON_SELECTOR.test(rule.selector) && !/:hover|:focus|:active/.test(rule.selector))
  const classes = [...html.matchAll(/<(?:a|button)\b[^>]*\bclass\s*=\s*["']([^"']*\b(?:btn|button|cta)\b[^"']*)["']/gi)]
    .map((match) => (match[1] ?? '').toLowerCase())
    .join(' ')
  const radii = buttonRules.flatMap((rule) => {
    const value = rule.decls.get('border-radius')
    if (!value) return []
    const amount = px(value)
    return amount === null ? [] : [value.includes('%') ? 999 : amount]
  })
  if (/\brounded-full\b/.test(classes)) radii.push(999)
  if (/\brounded-none\b/.test(classes)) radii.push(0)
  const caps = buttonRules.some((rule) => rule.decls.get('text-transform') === 'uppercase') || /\buppercase\b/.test(classes)
  const underlined = buttonRules.length > 0 && buttonRules.every((rule) => /underline/.test(rule.decls.get('text-decoration') ?? '') && !draws(rule.decls.get('background-color') ?? rule.decls.get('background')))
  const radius = median(radii)
  let buttons: AiSiteButtons | null = null
  if (underlined) buttons = 'link'
  else if (radius !== null && radius >= 24) buttons = 'pill'
  else if (caps) buttons = 'caps'
  else if (radius !== null) buttons = radius <= 2 ? 'square' : 'rounded'
  const filled = buttonRules.some((rule) => {
    const fill = rule.decls.get('background-color') ?? rule.decls.get('background')
    return draws(fill) && colorOf(fill) !== null
  })
  const outlined = buttonRules.some((rule) => draws(rule.decls.get('border')) || draws(rule.decls.get('border-width')))
  const buttonFill: AiSiteInspirationButtonFill | null = filled ? 'filled' : outlined ? 'outline' : null
  return { buttons, buttonFill, radius }
}

/** How cards are drawn, and the corners they and the page's fields round to. */
function cardSignals(rules: readonly CssRule[]): Pick<AiSiteInspirationSite, 'cards' | 'corners'> {
  const cardRules = rules.filter((rule) => CARD_SELECTOR.test(rule.selector) && !BUTTON_SELECTOR.test(rule.selector) && !/:hover|:focus/.test(rule.selector))
  if (!cardRules.length) return { cards: null, corners: null }
  const radius = median(cardRules.flatMap((rule) => {
    const amount = px(rule.decls.get('border-radius'))
    return amount === null ? [] : [amount]
  }))
  const any = (property: string) => cardRules.some((rule) => draws(rule.decls.get(property)))
  let cards: AiSiteCards = 'flat'
  if (any('box-shadow')) cards = 'elevated'
  else if (any('border-top') && !any('border')) cards = 'rule'
  else if (any('border')) cards = 'outlined'
  else {
    const fill = cardRules.map((rule) => colorOf(rule.decls.get('background-color') ?? rule.decls.get('background'))).find(Boolean)
    if (fill && aiHexOklch(fill).C >= 0.02 && aiHexOklch(fill).L > 0.8) cards = 'tinted'
  }
  return { cards, corners: radius === null ? null : cornersOf(radius) }
}

// ── Motion ───────────────────────────────────────────────────────────────

/** How the page moves as it is scrolled: the scroll-animation names in its markup and the keyframes in its styles. */
function motionOf(html: string, css: string, rules: readonly CssRule[], styled: boolean): AiSiteMotionStyle | null {
  const score = { sides: 0, rise: 0, scale: 0 }
  const named = [
    ...[...html.matchAll(/\bdata-(?:aos|sal|animate)\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1] ?? ''),
    ...[...html.matchAll(/\banimate__(\w+)|\bwow\s+(\w+)/gi)].map((match) => match[1] ?? match[2] ?? ''),
  ].map((name) => name.toLowerCase())
  for (const name of named) {
    if (/left|right/.test(name)) score.sides += 1
    else if (/zoom|scale/.test(name)) score.scale += 1
    else if (/up|down|fade|slide/.test(name)) score.rise += 1
  }
  // Server-rendered scroll animations start hidden and displaced, in the markup's own styles.
  for (const match of html.matchAll(STYLE_ATTRIBUTE)) {
    const style = (match[1] ?? match[2] ?? '').toLowerCase()
    if (!/opacity\s*:\s*0(\.0+)?\s*(;|$)/.test(style)) continue
    if (/translatex|translate3d\(\s*-?\d/.test(style)) score.sides += 1
    else if (/scale/.test(style)) score.scale += 1
    else if (/translatey/.test(style)) score.rise += 1
  }
  for (const frames of css.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/gi)) {
    const body = (frames[1] ?? '').toLowerCase()
    if (!/opacity/.test(body) && !/translate|scale/.test(body)) continue
    if (/translatex|translate3d\(\s*-?\d+(px|%)\s*,\s*0/.test(body)) score.sides += 1
    else if (/scale/.test(body)) score.scale += 1
    else if (/translatey|translate3d\(\s*0\s*,/.test(body)) score.rise += 1
  }
  const delays = new Set([
    ...[...html.matchAll(/\bdata-(?:aos|sal)-delay\s*=\s*["'](\d+)["']/gi)].map((match) => match[1]),
    ...rules.flatMap((rule) => [rule.decls.get('animation-delay'), rule.decls.get('transition-delay')]).filter((value): value is string => Boolean(value && !NONE.test(value))),
  ])
  const moving = score.sides + score.rise + score.scale
  if (moving > 0 && delays.size >= 3) return 'cascade'
  if (moving > 0) {
    const best = (Object.entries(score) as Array<[keyof typeof score, number]>).sort((a, b) => b[1] - a[1])[0] as [AiSiteMotionStyle, number]
    return best[0]
  }
  // A page whose styles were read and that animates nothing is still.
  return styled ? 'still' : null
}

// ── Features ─────────────────────────────────────────────────────────────

/** What the page offers its visitors, from its sections, its links and what its forms ask. */
function featuresOf(html: string, sections: readonly AiSiteInspirationSection[]): AiSiteInspirationFeature[] {
  const urls = urlsOf(html).join(' ')
  const words = wordsOf(html)
  const has = (section: AiSiteInspirationSection) => sections.includes(section)
  const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form\s*>/gi)].map((match) => match[0])
  const asks = forms.some((form) => /<textarea\b/i.test(form) || count(form, /<input\b(?![^>]*type\s*=\s*["']?(hidden|submit|search|checkbox))/gi) >= 2)
  const found: Record<AiSiteInspirationFeature, boolean> = {
    booking:
      has('booking') ||
      BOOKING_HOSTS.test(urls) ||
      /\bbook (now|online|an appointment|a table|a session|a call|a visit)\b|reserve a table|make a reservation/.test(words),
    store: has('products') || /add to (cart|bag)|view cart/.test(words) || /\/cart\b|\/products?\/|\/collections\/|cdn\.shopify|woocommerce/.test(urls),
    blog: has('blog') || /\/(blog|journal|articles|posts|news)(\/|\b)|application\/rss\+xml/.test(`${urls} ${html.toLowerCase()}`),
    forms: has('contact') || asks,
    gallery: has('gallery') || count(html, /<img\b/gi) >= 8,
    events: has('events') || /\/events?(\/|\b)|eventbrite|ticketmaster|dice\.fm|bandsintown/.test(urls),
    menu: has('menu') || /\/menus?(\/|\b)/.test(urls) || count(words, /\b(appetizers|entr[eé]es|starters|mains|desserts|small plates)\b/g) >= 2,
    testimonials: has('testimonials') || /yelp\.com|trustpilot\.com|g\.page|google\.com\/maps.*reviews/.test(urls),
    newsletter: has('newsletter') || /list-manage\.com|klaviyo|convertkit|mailerlite|substack\.com/.test(urls),
  }
  return AI_SITE_INSPIRATION_FEATURES.filter((feature) => found[feature])
}

// ── One page ─────────────────────────────────────────────────────────────

/**
 * A read page's signals (AGL-3975). Pure over the page and its sheets, so the
 * specs read recorded pages; nothing of the page but these values leaves.
 */
export function aiSiteInspirationSignals(page: Pick<AiReferencePage, 'html' | 'stylesheets'>): AiSiteInspirationSite {
  const html = page.html.replace(COMMENTS, ' ')
  const inline = [...html.matchAll(STYLE_BLOCK)].map((match) => match[1] ?? '')
  const css = [...inline, ...page.stylesheets].join('\n')
  const rules = cssRulesOf(css)
  const sections = inspirationSectionsOf(html)
  const button = buttonSignals(html, rules)
  const card = cardSignals(rules)
  return {
    sections,
    density: densityOf(html, rules),
    ...headerSignals(html, rules),
    colors: referencePageColors({ html, stylesheets: page.stylesheets }).slice(0, AI_THEME_BRAND_COLORS_PER_SOURCE),
    ground: groundOf(rules),
    fontMood: fontMoodOf(html, rules),
    buttons: button.buttons,
    buttonFill: button.buttonFill,
    cards: card.cards,
    // A page with no cards rounds its corners as its buttons do, unless they are pills.
    corners: card.corners ?? (button.radius !== null && button.radius < 24 ? cornersOf(button.radius) : null),
    motion: motionOf(html, css, rules, css.trim().length > 0),
    features: featuresOf(html, sections),
  }
}

// ── Read back ────────────────────────────────────────────────────────────

const oneOf = <T extends string>(value: unknown, values: readonly T[]): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null

const listOf = <T extends string>(value: unknown, values: readonly T[], max: number): T[] =>
  Array.isArray(value) ? value.flatMap((entry) => (oneOf(entry, values) ? [entry as T] : [])).slice(0, max) : []

/**
 * Stored signals, read back defensively: a plan travels through the confirm
 * door and a unit's inputs, so every value is held to its closed set again
 * and anything else is dropped. `null` for nothing usable.
 */
export function aiReadSiteInspiration(value: unknown): AiSiteInspiration | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const sites = (Array.isArray(raw['sites']) ? raw['sites'] : []).slice(0, 3).flatMap((entry): AiSiteInspirationSite[] => {
    if (!entry || typeof entry !== 'object') return []
    const site = entry as Record<string, unknown>
    const colors = Array.isArray(site['colors'])
      ? site['colors'].flatMap((hex) => (typeof hex === 'string' && normalizeThemeHex(hex) ? [normalizeThemeHex(hex) as string] : [])).slice(0, AI_THEME_BRAND_COLORS_PER_SOURCE)
      : []
    return [
      {
        sections: listOf(site['sections'], AI_SITE_INSPIRATION_SECTIONS, AI_SITE_INSPIRATION_MAX_SECTIONS),
        density: oneOf(site['density'], DENSITIES),
        headerAlign: oneOf(site['headerAlign'], ALIGNS),
        header: oneOf(site['header'], AI_SITE_HEADERS),
        colors,
        ground: oneOf(site['ground'], AI_SITE_GROUNDS),
        fontMood: oneOf(site['fontMood'], AI_SITE_INSPIRATION_FONT_MOODS),
        buttons: oneOf(site['buttons'], AI_SITE_BUTTONS),
        buttonFill: oneOf(site['buttonFill'], AI_SITE_INSPIRATION_BUTTON_FILLS),
        corners: oneOf(site['corners'], AI_SITE_CORNERS),
        cards: oneOf(site['cards'], AI_SITE_CARDS),
        motion: aiSiteMotionStyle(site['motion']),
        features: listOf(site['features'], AI_SITE_INSPIRATION_FEATURES, AI_SITE_INSPIRATION_FEATURES.length),
      },
    ]
  })
  if (!sites.length) return null
  const unread = typeof raw['unread'] === 'number' && Number.isInteger(raw['unread']) && raw['unread'] >= 0 ? Math.min(3, raw['unread']) : 0
  return { v: 1, sites, unread }
}
