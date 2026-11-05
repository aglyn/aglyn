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
 * HOW A PAGE IS STYLED, AS A WIDE SCREEN SHOWS IT (AGL-4106).
 *
 * Bring my site reads a page's layout, not only its lines, and most of a
 * layout lives in the stylesheet: which band is grey and which is dark, which
 * container lays its children out in three columns, which link is drawn as a
 * filled button. This is a small cascade, enough for that and no more:
 *
 * - **The sheets.** The page's own `<style>` sheets and the ones it links,
 *   every one to a byte budget (`siteImportReadStylesheets`, AGL-4152), read
 *   in order. `@media` rules apply as a 1280-pixel screen in light mode
 *   sees them, so a grid's desktop columns win over its phone ones;
 *   `@layer`, `@supports` and `@container` are read through; keyframes, font
 *   faces (their families noted) and page rules are skipped.
 * - **Selectors.** Tags, classes (escaped ones too, as utility frameworks
 *   write them), ids and attributes, joined by any combinator, and `:is()`
 *   and `:where()` spelled out (AGL-4152). A rule that
 *   only applies on hover, focus or to a generated part (`::before`) is a
 *   state the page is not in and is not read.
 * - **The cascade.** Specificity, then order, `!important` over both, and the
 *   element's own `style` over every rule; color, font and alignment inherit,
 *   and so do custom properties, which `var()` reads.
 *
 * Only the properties the layout reader asks about are kept. Nothing here
 * runs anything a page wrote: values are text compared to text.
 *=========================================*/

import type { SiteImportElement, SiteImportStructure } from './site-import-html'

/** The width a page is read at: a laptop's, where a desktop layout shows. */
export const SITE_IMPORT_CSS_VIEWPORT = { width: 1280, height: 800 } as const

/**
 * The width a page's column is read at (AGL-4083). A container caps itself
 * only on screens wider than its cap (`@media (min-width:1536px)` around a
 * `max-width:1536px`), so on a laptop it runs the whole page: read there, it
 * would look as if it had no cap at all.
 */
export const SITE_IMPORT_CSS_WIDE_WIDTH = 1920

/** The properties the layout reader reads; every other declaration is dropped as the sheet is parsed. */
const KEPT_PROPERTIES = new Set([
  'background',
  'background-color',
  'background-image',
  'color',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-width',
  'border-bottom-width',
  'border-left-width',
  'border-right-width',
  'border-top-style',
  'border-bottom-style',
  'border-top-color',
  'border-bottom-color',
  'border-radius',
  'box-shadow',
  'display',
  'grid-template-columns',
  'grid-column',
  // Where a grid places its children, and the order a row shows them in (AGL-4152).
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-flow',
  'grid-area',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
  'grid-column-start',
  'grid-column-end',
  'order',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-basis',
  'width',
  'max-width',
  // The shape a picture is framed at (AGL-4138): a box's own, or a height it is cropped to.
  'aspect-ratio',
  'height',
  'font-family',
  'font-size',
  'font-weight',
  'text-transform',
  'letter-spacing',
  'text-align',
  'position',
  'visibility',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'object-fit',
  'justify-content',
  'align-items',
])

/** What a rule says of a child's place in its grid, which a breakpoint nested in the rule may say again (AGL-4152). */
const GRID_PLACEMENT = /^(?:grid-area|grid-row|grid-row-start|grid-row-end|grid-column|grid-column-start|grid-column-end|order)$/

/** What an element takes from its parent when it says nothing itself. */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'text-transform', 'letter-spacing', 'text-align', 'visibility'])

interface Compound {
  tag: string | null
  id: string | null
  classes: string[]
  attrs: Array<{ name: string; op: string | null; value: string }>
  /** `:root`: only the document's root element. */
  root: boolean
}

interface ComplexSelector {
  /** Rightmost last. */
  compounds: Compound[]
  /** `combinators[i]` joins `compounds[i]` and `compounds[i + 1]`: a space, a child, an adjacent or a sibling combinator. */
  combinators: string[]
  specificity: number
}

interface CssRule {
  selector: ComplexSelector
  order: number
  decls: Array<[property: string, value: string, important: boolean]>
}

/** The page's sheets, parsed for one width. */
export interface SiteImportCss {
  rules: CssRule[]
  /** Rules by their rightmost compound's id (`#x`), first class (`.x`), tag, or `*`. */
  index: Map<string, CssRule[]>
  /** Families its `@font-face` rules name, in order. */
  fontFaces: string[]
  /** Read for its dark scheme (AGL-4152): the rules that scheme alone selects, by a media query or a class on the page. */
  darkRules: number
  /** How many declarations read each custom property (AGL-4152): what its palette uses most. */
  variableUses: Map<string, number>
}

/** Which of a page's color schemes a read of its stylesheets answers for. */
export interface SiteImportCssOptions {
  /** Absent is `light`, as a page is first read. */
  scheme?: 'light' | 'dark'
}

/*------------------------------------------
 * Parsing
 *-----------------------------------------*/

function unescapeIdent(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_, escaped: string) => {
    if (/^[0-9a-fA-F]{1,6}\s?$/.test(escaped)) {
      const code = parseInt(escaped.trim(), 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return escaped
  })
}

const IDENT = String.raw`(?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-]|[^\x00-\x7f])+`
const SIMPLE = new RegExp(
  String.raw`^(?:(\*|${IDENT})|#(${IDENT})|\.(${IDENT})|\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(?:[is]\s*)?)?\]|(::?)(${IDENT})(\((?:[^()]|\([^()]*\))*\))?)`,
)

/** The pseudo-classes a page at rest matches as if they were not there. */
const AT_REST = new Set(['link', 'any-link'])

/** One compound selector, or `null` when it depends on a state or a generated part. */
function parseCompound(text: string): Compound | null {
  const compound: Compound = { tag: null, id: null, classes: [], attrs: [], root: false }
  let rest = text
  while (rest) {
    const match = SIMPLE.exec(rest)
    if (!match || !match[0]) return null
    rest = rest.slice(match[0].length)
    if (match[1]) compound.tag = match[1] === '*' ? null : unescapeIdent(match[1]).toLowerCase()
    else if (match[2]) compound.id = unescapeIdent(match[2])
    else if (match[3]) compound.classes.push(unescapeIdent(match[3]))
    else if (match[4]) compound.attrs.push({ name: match[4].toLowerCase(), op: match[5] ?? null, value: match[6] ?? match[7] ?? match[8] ?? '' })
    else if (match[9]) {
      const name = unescapeIdent(match[10] ?? '').toLowerCase()
      if (match[9] === '::') return null
      if (name === 'root') compound.root = true
      else if (!AT_REST.has(name)) return null
    }
  }
  return compound
}

/** A complex selector, or `null` when any part of it cannot be read at rest. */
function parseSelector(text: string): ComplexSelector | null {
  const compounds: Compound[] = []
  const combinators: string[] = []
  const parts = text.trim().replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/)
  let pending: string | null = null
  for (const part of parts) {
    if (!part) continue
    if (part === '>' || part === '+' || part === '~') {
      pending = part
      continue
    }
    const compound = parseCompound(part)
    if (!compound) return null
    if (compounds.length) combinators.push(pending ?? ' ')
    pending = null
    compounds.push(compound)
  }
  if (!compounds.length || pending) return null
  let ids = 0
  let classes = 0
  let tags = 0
  for (const compound of compounds) {
    if (compound.id) ids += 1
    classes += compound.classes.length + compound.attrs.length + (compound.root ? 1 : 0)
    if (compound.tag) tags += 1
  }
  return { compounds, combinators, specificity: ids * 1_000_000 + classes * 1_000 + tags }
}

/** The most selectors one written with `:is()` or `:where()` is spelled out into. */
const SELECTOR_VARIANTS = 24

/**
 * A selector with its `:is()` and `:where()` spelled out (AGL-4152), each with
 * the weight to take off for a `:where()`, which counts for nothing. A variant
 * two compounds cannot be joined into (`.x:is(div)`, `.x:is(.a .b)`) is left out.
 */
function spelledOut(text: string): Array<{ text: string; discount: number }> {
  const match = /:(?:is|where)\(/i.exec(text)
  if (!match) return [{ text, discount: 0 }]
  const inner = match.index + match[0].length
  let depth = 1
  let end = inner
  while (end < text.length && depth > 0) {
    if (text[end] === '(') depth += 1
    else if (text[end] === ')') depth -= 1
    end += 1
  }
  if (depth) return [{ text, discount: 0 }]
  const head = text.slice(0, match.index)
  const tail = text.slice(end)
  const zeroed = /where/i.test(match[0])
  const joined = !head || /[\s>+~]$/.test(head)
  const out: Array<{ text: string; discount: number }> = []
  for (const option of splitList(text.slice(inner, end - 1))) {
    if (!joined && (/\s/.test(option) || /^[\w*]/.test(option))) continue
    const discount = zeroed ? (parseSelector(option.replace(/:(?:is|where)\([^()]*\)/gi, ''))?.specificity ?? 0) : 0
    for (const variant of spelledOut(`${head}${option}${tail}`)) {
      if (out.length >= SELECTOR_VARIANTS) return out
      out.push({ text: variant.text, discount: discount + variant.discount })
    }
  }
  return out
}

/** Splits at top-level commas: none inside brackets or parentheses. */
function splitList(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      out.push(text.slice(start, at))
      start = at + 1
    }
  }
  out.push(text.slice(start))
  return out.map((part) => part.trim()).filter(Boolean)
}

/** A length in px at the read width; `em`/`rem` at 16. */
export function siteImportLengthPx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)\s*(px|em|rem)?$/i.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  return match[2] && match[2].toLowerCase() !== 'px' ? amount * 16 : amount
}

/** Whether one media query holds for a screen of this width in this color scheme. */
function mediaQueryHolds(query: string, viewport: number, scheme: 'light' | 'dark'): boolean {
  let text = query.trim().toLowerCase()
  let negate = false
  if (text.startsWith('not ')) {
    negate = true
    text = text.slice(4)
  }
  text = text.replace(/^only\s+/, '')
  let holds = true
  for (const part of text.split(/\s+and\s+/)) {
    const term = part.trim()
    if (!term) continue
    if (!term.startsWith('(')) {
      if (!/^(?:all|screen)$/.test(term)) holds = false
      continue
    }
    const inner = term.replace(/^\(|\)$/g, '').trim()
    const feature = /^([\w-]+)\s*:\s*(.+)$/.exec(inner)
    const { height } = SITE_IMPORT_CSS_VIEWPORT
    const width = viewport
    if (feature) {
      const [, name, value] = feature
      const px = siteImportLengthPx(value)
      if (name === 'min-width') holds &&= px !== null && width >= px
      else if (name === 'max-width') holds &&= px !== null && width <= px
      else if (name === 'min-height') holds &&= px !== null && height >= px
      else if (name === 'max-height') holds &&= px !== null && height <= px
      else if (name === 'prefers-color-scheme') holds &&= value.trim() === scheme
      else if (name === 'prefers-reduced-motion') holds &&= value.trim() === 'no-preference'
      else if (name === 'orientation') holds &&= value.trim() === 'landscape'
      else if (name === 'hover' || name === 'any-hover') holds &&= value.trim() === 'hover'
      else if (name === 'pointer' || name === 'any-pointer') holds &&= value.trim() === 'fine'
      else if (name === 'prefers-contrast' || name === 'forced-colors') holds &&= /^(?:no-preference|none)$/.test(value.trim())
      continue
    }
    // Range syntax: (width >= 900px), (600px <= width < 1200px).
    const range = /^(?:(-?[\d.]+\w*)\s*(<=|<|>=|>)\s*)?(width|height)\s*(?:(<=|<|>=|>)\s*(-?[\d.]+\w*))?$/.exec(inner)
    if (range) {
      const size = range[3] === 'width' ? width : height
      const test = (a: number, op: string, b: number) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b)
      if (range[1] && range[2]) {
        const px = siteImportLengthPx(range[1])
        holds &&= px !== null && test(px, range[2], size)
      }
      if (range[4] && range[5]) {
        const px = siteImportLengthPx(range[5])
        holds &&= px !== null && test(size, range[4], px)
      }
    }
  }
  return negate ? !holds : holds
}

function mediaHolds(prelude: string, viewport: number, scheme: 'light' | 'dark'): boolean {
  const list = splitList(prelude.replace(/^@media\s*/i, ''))
  return !list.length || list.some((query) => mediaQueryHolds(query, viewport, scheme))
}

/**
 * A selector's leading mark of the dark scheme (AGL-4152): `.dark`, `.dark-mode`
 * or a `data-theme` that says dark, on the page's root or body. Nothing a read
 * sees carries it, so a dark read lifts it off and the rest applies as written.
 */
const DARK_SCOPE = /^(?:(html|body|:root))?(?:\.dark(?:-mode|-theme)?|\[\s*data-(?:theme|mode|color-scheme|color-mode|bs-theme|mui-color-scheme)\s*[*~|^]?=\s*["']?[^"'\]]*dark[^"'\]]*["']?\s*(?:i\s*)?\])(?=$|[\s>+~.:#[])/i

/** What a selector asks of a page in its dark scheme, its mark lifted off: what remains, else the element that held the mark. `null` for a selector with no such mark. */
function withoutDarkScope(text: string): string | null {
  const match = DARK_SCOPE.exec(text.trim())
  if (!match) return null
  const rest = text.trim().slice(match[0].length).replace(/^[\s>+~]+/, '')
  return rest || match[1] || ':root'
}

function declarationsOf(body: string): CssRule['decls'] {
  const decls: CssRule['decls'] = []
  // Values may hold semicolons only inside strings or url(), which the kept properties never need.
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon <= 0) continue
    const written = part.slice(0, colon).trim()
    // A custom property's name is case-sensitive, as `var()` reads it.
    const property = written.startsWith('--') ? written : written.toLowerCase()
    if (!property.startsWith('--') && !KEPT_PROPERTIES.has(property)) continue
    let value = part.slice(colon + 1).trim()
    const important = /!\s*important\s*$/i.test(value)
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim()
    if (value) decls.push([property, value.slice(0, 2_000), important])
  }
  return decls
}

/** The index key of a selector: its rightmost compound's id, first class, tag, else `*`. */
function keyOf(selector: ComplexSelector): string {
  const last = selector.compounds[selector.compounds.length - 1] as Compound
  if (last.id) return `#${last.id}`
  if (last.classes.length) return `.${last.classes[0]}`
  if (last.root) return ':root'
  if (last.tag) return last.tag
  return '*'
}

/**
 * The page's sheets parsed for a wide screen. Malformed CSS is read as far as
 * it makes sense, as a browser would; nothing throws.
 */
export function siteImportCssOf(sheets: readonly string[], viewport: number = SITE_IMPORT_CSS_VIEWPORT.width, options: SiteImportCssOptions = {}): SiteImportCss {
  const css: SiteImportCss = { rules: [], index: new Map(), fontFaces: [], darkRules: 0, variableUses: new Map() }
  const scheme = options.scheme ?? 'light'
  let order = 0
  /** For each open group: whether only a dark scheme's media query opens it. */
  const darkGroups: boolean[] = []
  const addRule = (prelude: string, body: string) => {
    const decls = declarationsOf(body)
    if (!decls.length) return
    for (const [, value] of decls) {
      if (!value.includes('var(')) continue
      for (const use of value.matchAll(/var\(\s*(--[\w-]+)/g)) css.variableUses.set(use[1] as string, (css.variableUses.get(use[1] as string) ?? 0) + 1)
    }
    for (const text of splitList(prelude)) {
      const lifted = scheme === 'dark' ? withoutDarkScope(text) : null
      for (const variant of spelledOut(lifted ?? text)) {
        const selector = parseSelector(variant.text)
        if (!selector) continue
        selector.specificity = Math.max(0, selector.specificity - variant.discount)
        if (scheme === 'dark' && (lifted !== null || darkGroups.includes(true))) css.darkRules += 1
        // The mark it lost still counts: a dark rule outranks the same rule of the light scheme.
        if (lifted !== null) selector.specificity += 1_000
        const rule: CssRule = { selector, order: order++, decls }
        css.rules.push(rule)
        const key = keyOf(selector)
        const list = css.index.get(key)
        if (list) list.push(rule)
        else css.index.set(key, [rule])
      }
    }
  }
  for (const sheet of sheets) {
    const text = String(sheet ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ')
    /** For each open group: whether its rules apply. */
    const groups: boolean[] = []
    let at = 0
    let start = 0
    while (at < text.length) {
      const char = text[at]
      if (char === '"' || char === "'") {
        const end = text.indexOf(char, at + 1)
        at = end < 0 ? text.length : end + 1
        continue
      }
      if (char === ';') {
        // A statement at-rule (@import, @charset) or stray text.
        start = at + 1
        at += 1
        continue
      }
      if (char === '}') {
        groups.pop()
        darkGroups.pop()
        start = at + 1
        at += 1
        continue
      }
      if (char !== '{') {
        at += 1
        continue
      }
      const prelude = text.slice(start, at).trim()
      const applies = groups.every(Boolean)
      if (/^@(?:media)\b/i.test(prelude)) {
        groups.push(applies && mediaHolds(prelude, viewport, scheme))
        darkGroups.push(/prefers-color-scheme\s*:\s*dark/i.test(prelude))
        start = at = at + 1
        continue
      }
      if (/^@(?:supports|layer|container|document|scope|starting-style)\b/i.test(prelude)) {
        groups.push(applies && !/^@starting-style/i.test(prelude))
        darkGroups.push(false)
        start = at = at + 1
        continue
      }
      // A block to read whole: a style rule, a font face, or an at-rule to skip.
      let depth = 1
      let end = at + 1
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth += 1
        else if (text[end] === '}') depth -= 1
        end += 1
      }
      const body = text.slice(at + 1, Math.max(at + 1, end - 1))
      if (/^@font-face\b/i.test(prelude)) {
        const family = /font-family\s*:\s*(["']?)([^;"']+)\1/i.exec(body)?.[2]?.trim()
        if (family && !css.fontFaces.includes(family)) css.fontFaces.push(family)
      } else if (!prelude.startsWith('@') && applies && prelude) {
        // A rule nested inside a rule (`&:hover`) is a state: only the outer declarations are read.
        // A breakpoint nested inside one that holds at this width places its child as a top-level one does.
        const placed = [...body.matchAll(/@media([^{};]*)\{([^{}]*)\}/g)]
          .filter((match) => mediaHolds(match[1] as string, viewport, scheme))
          .flatMap((match) => (match[2] as string).split(';').filter((part) => GRID_PLACEMENT.test(part.slice(0, part.indexOf(':')).trim().toLowerCase())))
        addRule(prelude, [body.replace(/[^;{}]*\{[^{}]*\}/g, ''), ...placed].join(';'))
      }
      start = at = end
    }
  }
  return css
}

/*------------------------------------------
 * Matching and the cascade
 *-----------------------------------------*/

function classesOf(element: SiteImportElement): string[] {
  return (element.attrs.class ?? '').split(/\s+/).filter(Boolean)
}

function attributeOf(element: SiteImportElement, name: string): string | undefined {
  switch (name) {
    case 'class':
      return element.attrs.class
    case 'id':
      return element.attrs.id
    case 'role':
      return element.attrs.role
    case 'aria-label':
      return element.attrs.label
    case 'href':
      return element.attrs.href
    case 'type':
      return element.attrs.type
    case 'style':
      return element.attrs.style
    case 'hidden':
    case 'aria-hidden':
      return element.attrs.hidden ? 'true' : undefined
    case 'data-section-theme':
    case 'data-theme':
      return element.attrs.theme
    default:
      return undefined
  }
}

function compoundMatches(compound: Compound, element: SiteImportElement, rootId: number): boolean {
  if (compound.root && element.id !== rootId) return false
  if (compound.tag && compound.tag !== element.tag) return false
  if (compound.id && compound.id !== element.attrs.id) return false
  if (compound.classes.length) {
    const own = classesOf(element)
    if (!compound.classes.every((name) => own.includes(name))) return false
  }
  for (const attr of compound.attrs) {
    const value = attributeOf(element, attr.name)
    if (value === undefined) return false
    if (!attr.op) continue
    const wanted = attr.value
    const ok =
      attr.op === '='
        ? value === wanted
        : attr.op === '~='
          ? value.split(/\s+/).includes(wanted)
          : attr.op === '^='
            ? value.startsWith(wanted)
            : attr.op === '$='
              ? value.endsWith(wanted)
              : attr.op === '*='
                ? value.includes(wanted)
                : value === wanted || value.startsWith(`${wanted}-`)
    if (!ok) return false
  }
  return true
}

/** Whether a selector matches an element, its combinators walked from the right. */
function selectorMatches(
  selector: ComplexSelector,
  element: SiteImportElement,
  elements: readonly SiteImportElement[],
  root: SiteImportElement | null,
): boolean {
  const rootId = root?.id ?? -2
  /** The element above `at`: its parent, or the document's root above the body. */
  const above = (at: SiteImportElement) => (at.parent >= 0 ? elements[at.parent] : at === root ? undefined : (root ?? undefined))
  const walk = (index: number, at: SiteImportElement): boolean => {
    if (!compoundMatches(selector.compounds[index] as Compound, at, rootId)) return false
    if (index === 0) return true
    const combinator = selector.combinators[index - 1]
    if (combinator === '>') {
      const parent = above(at)
      return !!parent && walk(index - 1, parent)
    }
    if (combinator === '+' || combinator === '~') {
      const siblings = elements[at.parent]?.children ?? []
      const position = siblings.indexOf(at.id)
      for (let before = position - 1; before >= 0; before -= 1) {
        const sibling = elements[siblings[before] as number]
        if (!sibling) continue
        if (walk(index - 1, sibling)) return true
        if (combinator === '+') return false
      }
      return false
    }
    for (let parent = above(at); parent; parent = above(parent)) {
      if (walk(index - 1, parent)) return true
    }
    return false
  }
  return walk(selector.compounds.length - 1, element)
}

/** One element's resolved style: the kept properties, `var()` read, lowercased. */
export type SiteImportComputedStyle = ReadonlyMap<string, string>

/** Reads elements' styles over a page's structure, each once. */
export interface SiteImportStyles {
  of(element: number): SiteImportComputedStyle
  /** The root's (`<html>`) element id, which `:root` matches; -1 for none. */
  readonly root: number
  /** The custom properties the root declares (AGL-4152), each read through to what it holds. */
  rootVariables(): ReadonlyMap<string, string>
}

const EMPTY_STYLE: SiteImportComputedStyle = new Map()

/** How far a variable that names a variable is followed: a site builder's palette goes several deep. */
const VARIABLE_DEPTH = 8

/** Replaces each `var(--x, fallback)` with what the custom properties hold, to a few levels. */
function withVariables(value: string, custom: ReadonlyMap<string, string>): string {
  let out = value
  for (let pass = 0; pass < VARIABLE_DEPTH && out.includes('var('); pass += 1) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_, name: string, fallback?: string) => custom.get(name) ?? fallback?.trim() ?? '')
  }
  return out
}

/** The kept declarations an inline `style` attribute writes. */
function inlineDeclarations(style: string | undefined): CssRule['decls'] {
  return style ? declarationsOf(style) : []
}

/**
 * Elements' styles over a page's structure and its sheets. Styles are
 * resolved on demand, parent first, each element once.
 */
export function siteImportStylesOf(structure: Pick<SiteImportStructure, 'elements' | 'root'>, css: SiteImportCss): SiteImportStyles {
  const { elements } = structure
  const resolved = new Map<number, { style: Map<string, string>; custom: Map<string, string> }>()
  // The page's root is above the body: `:root` and `html` rules are its.
  const rootStyle = (() => {
    const style = new Map<string, string>()
    const custom = new Map<string, string>()
    const fake: SiteImportElement = { id: -2, tag: 'html', parent: -1, children: [], region: 'main', nav: false, attrs: structure.root ?? {}, blocks: [] }
    const candidates = [...(css.index.get(':root') ?? []), ...(css.index.get('html') ?? []), ...(css.index.get('*') ?? [])]
    for (const name of classesOf(fake)) candidates.push(...(css.index.get(`.${name}`) ?? []))
    if (fake.attrs.id) candidates.push(...(css.index.get(`#${fake.attrs.id}`) ?? []))
    apply(candidates.filter((rule) => selectorMatches(rule.selector, fake, [], fake)), inlineDeclarations(fake.attrs.style), style, custom)
    return { style, custom, element: fake }
  })()

  function apply(rules: CssRule[], inline: CssRule['decls'], style: Map<string, string>, custom: Map<string, string>) {
    const unique = [...new Set(rules)].sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order)
    const important: Array<[string, string]> = []
    const put = (property: string, value: string) => {
      if (property.startsWith('--')) custom.set(property, value)
      else style.set(property, value)
    }
    for (const rule of unique) {
      for (const [property, value, flag] of rule.decls) {
        if (flag) important.push([property, value])
        else put(property, value)
      }
    }
    for (const [property, value, flag] of inline) {
      if (flag) important.push([property, value])
      else put(property, value)
    }
    for (const [property, value] of important) put(property, value)
  }

  function resolve(id: number): { style: Map<string, string>; custom: Map<string, string> } {
    const held = resolved.get(id)
    if (held) return held
    const element = elements[id]
    if (!element) return rootStyle
    const parent = element.parent >= 0 ? resolve(element.parent) : rootStyle
    const candidates: CssRule[] = [...(css.index.get(element.tag) ?? []), ...(css.index.get('*') ?? [])]
    for (const name of classesOf(element)) candidates.push(...(css.index.get(`.${name}`) ?? []))
    if (element.attrs.id) candidates.push(...(css.index.get(`#${element.attrs.id}`) ?? []))
    const matched = candidates.filter((rule) => selectorMatches(rule.selector, element, elements, rootStyle.element))
    const own = new Map<string, string>()
    const inline = inlineDeclarations(element.attrs.style)
    // A palette can be thousands of properties: only an element that declares one takes a copy of them.
    const declares = inline.some(([property]) => property.startsWith('--')) || matched.some((rule) => rule.decls.some(([property]) => property.startsWith('--')))
    const custom = declares ? new Map(parent.custom) : parent.custom
    apply(matched, inline, own, custom)
    const style = new Map<string, string>()
    for (const property of INHERITED) {
      const value = parent.style.get(property)
      if (value !== undefined) style.set(property, value)
    }
    for (const [property, value] of own) {
      const lowered = value.trim().toLowerCase()
      if (lowered === 'inherit') {
        const inherited = parent.style.get(property)
        if (inherited !== undefined) style.set(property, inherited)
        continue
      }
      if (lowered === 'initial' || lowered === 'unset' || lowered === 'revert') {
        if (!INHERITED.has(property) || lowered === 'initial') style.delete(property)
        continue
      }
      style.set(property, property === 'font-family' ? withVariables(value, custom) : withVariables(value, custom).toLowerCase())
    }
    const entry = { style, custom }
    resolved.set(id, entry)
    return entry
  }

  // The root's own inherited values reach the body through `rootStyle`.
  for (const [property, value] of rootStyle.style) {
    rootStyle.style.set(property, property === 'font-family' ? withVariables(value, rootStyle.custom) : withVariables(value, rootStyle.custom).toLowerCase())
  }
  return {
    root: -2,
    of(element: number): SiteImportComputedStyle {
      if (element === -2) return rootStyle.style
      return elements[element] ? resolve(element).style : EMPTY_STYLE
    },
    rootVariables() {
      return new Map([...rootStyle.custom].map(([name, value]) => [name, withVariables(value, rootStyle.custom)]))
    },
  }
}

/*------------------------------------------
 * Values
 *-----------------------------------------*/

export interface SiteImportRgba {
  r: number
  g: number
  b: number
  a: number
}

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  whitesmoke: '#f5f5f5',
  ghostwhite: '#f8f8ff',
  snow: '#fffafa',
  ivory: '#fffff0',
  beige: '#f5f5dc',
  linen: '#faf0e6',
  navy: '#000080',
  teal: '#008080',
  orange: '#ffa500',
  gold: '#ffd700',
  purple: '#800080',
  crimson: '#dc143c',
  tomato: '#ff6347',
  coral: '#ff7f50',
  aliceblue: '#f0f8ff',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  gainsboro: '#dcdcdc',
  darkslategray: '#2f4f4f',
  dimgray: '#696969',
}

/** The first color a value names, or `null`; `transparent` is a color of no strength. */
export function siteImportColorOf(value: string | undefined): SiteImportRgba | null {
  if (!value) return null
  const text = value.toLowerCase()
  const hex = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/.exec(text)
  const rgb = /rgba?\(\s*(-?[\d.]+%?)\s*[,\s]\s*(-?[\d.]+%?)\s*[,\s]\s*(-?[\d.]+%?)\s*(?:[,/]\s*(-?[\d.]+%?)\s*)?\)/.exec(text)
  const hsl = /hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/.exec(text)
  const named = /\b(transparent|[a-z]+)\b/.exec(text.replace(/[a-z-]+\(/g, ' ('))
  const first = [hex, rgb, hsl].filter((match): match is RegExpExecArray => !!match).sort((a, b) => a.index - b.index)[0]
  const alphaOf = (raw: string | undefined) => (raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw))
  if (first === hex && hex) {
    const digits = hex[1]
    const full = digits.length <= 4 ? digits.split('').map((d) => d + d).join('') : digits
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    }
  }
  if (first === rgb && rgb) {
    const channel = (raw: string) => Math.max(0, Math.min(255, raw.endsWith('%') ? (Number(raw.slice(0, -1)) / 100) * 255 : Number(raw)))
    return { r: channel(rgb[1]), g: channel(rgb[2]), b: channel(rgb[3]), a: alphaOf(rgb[4]) }
  }
  if (first === hsl && hsl) {
    const h = (((Number(hsl[1]) % 360) + 360) % 360) / 360
    const s = Number(hsl[2]) / 100
    const l = Number(hsl[3]) / 100
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const tone = (t: number) => {
      const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
      if (x < 1 / 6) return p + (q - p) * 6 * x
      if (x < 1 / 2) return q
      if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
      return p
    }
    return { r: tone(h + 1 / 3) * 255, g: tone(h) * 255, b: tone(h - 1 / 3) * 255, a: alphaOf(hsl[4]) }
  }
  if (named) {
    if (named[1] === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
    const known = NAMED_COLORS[named[1]]
    if (known) return siteImportColorOf(known)
  }
  return null
}

/** A variable's name that says it holds a brand's color. */
const BRAND_VARIABLE = /primary|secondary|brand|accent|highlight/i

/** A custom property's whole value as a color: a color function, or the triple a color function reads through `var()`. */
function colorOfVariable(value: string): SiteImportRgba | null {
  const text = value.trim()
  if (/^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^()]*\))$/i.test(text)) return siteImportColorOf(text)
  if (/^-?[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+[\d.]+%$/.test(text)) return siteImportColorOf(`hsl(${text})`)
  if (/^\d{1,3}[\s,]+\d{1,3}[\s,]+\d{1,3}$/.test(text)) return siteImportColorOf(`rgb(${text})`)
  return null
}

/** The most colors of a palette kept. */
const PALETTE_COLORS = 6

/**
 * The brand colors a page's root declares (AGL-4152): the custom properties
 * named for a brand that hold a color, a triple included, none too pale, dark
 * or grey to carry one, the most read first. What the page says its brand is,
 * even where nothing on this page happens to draw it.
 */
export function siteImportPaletteOf(styles: Pick<SiteImportStyles, 'rootVariables'>, uses: ReadonlyMap<string, number>): string[] {
  const tally = new Map<string, number>()
  for (const [name, value] of styles.rootVariables()) {
    if (!BRAND_VARIABLE.test(name)) continue
    const color = colorOfVariable(value)
    if (!color || color.a < 0.5 || siteImportSaturation(color) < 0.2) continue
    const light = siteImportLuminance(color)
    if (light < 0.01 || light > 0.9) continue
    const hex = siteImportHex(color)
    tally.set(hex, (tally.get(hex) ?? 0) + (uses.get(name) ?? 0))
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, PALETTE_COLORS).map(([hex]) => hex)
}

/** `#rrggbb` of a color, its strength ignored. */
export function siteImportHex(color: SiteImportRgba): string {
  return `#${[color.r, color.g, color.b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

/** Relative luminance, 0 (black) to 1 (white). */
export function siteImportLuminance(color: SiteImportRgba): number {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

/** How colorful a color is, 0 (grey) to 1. */
export function siteImportSaturation(color: SiteImportRgba): number {
  const max = Math.max(color.r, color.g, color.b) / 255
  const min = Math.min(color.r, color.g, color.b) / 255
  if (max === min) return 0
  const l = (max + min) / 2
  return (max - min) / (1 - Math.abs(2 * l - 1))
}

/** What an element draws behind itself: a color, a gradient and its colors, or a picture. */
export interface SiteImportBackground {
  color: SiteImportRgba | null
  gradient: SiteImportRgba[] | null
  /** A picture's address, as written. */
  image: string | null
}

/** An element's own background, from the shorthand or its parts. */
export function siteImportBackgroundOf(style: SiteImportComputedStyle): SiteImportBackground {
  const shorthand = style.get('background') ?? ''
  const imageValue = style.get('background-image') ?? (/(?:url|gradient)\(/.test(shorthand) ? shorthand : '')
  const colorValue = style.get('background-color') ?? (shorthand && !/(?:url|gradient)\(/.test(shorthand) ? shorthand : shorthand.replace(/[a-z-]*gradient\((?:[^()]|\([^()]*\))*\)|url\([^)]*\)/g, ' '))
  const color = siteImportColorOf(colorValue)
  let gradient: SiteImportRgba[] | null = null
  let image: string | null = null
  const gradientMatch = /gradient\(((?:[^()]|\([^()]*\))*)\)/.exec(imageValue)
  if (gradientMatch) {
    const stops: SiteImportRgba[] = []
    for (const match of gradientMatch[1].matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|transparent)\b/gi)) {
      const stop = siteImportColorOf(match[0])
      if (stop) stops.push(stop)
    }
    if (stops.length) gradient = stops
  }
  const url = /url\(\s*(["']?)([^"')]+)\1\s*\)/.exec(imageValue)
  if (url) image = url[2].trim()
  return { color: color && color.a > 0.02 ? color : null, gradient, image }
}

/** Whether an element draws a border on any side. */
export function siteImportHasBorder(style: SiteImportComputedStyle): boolean {
  const sides = ['border', 'border-top', 'border-bottom', 'border-left', 'border-right']
  for (const side of sides) {
    const value = style.get(side)
    if (!value) continue
    if (/\bnone\b|\bhidden\b/.test(value) || /^0(?:px)?$/.test(value.trim())) continue
    const color = siteImportColorOf(value) ?? siteImportColorOf(style.get('border-color'))
    if (color && color.a < 0.05) continue
    if (/\d/.test(value) || /\b(?:solid|dashed|dotted|double)\b/.test(value)) {
      const width = /(-?[\d.]+)px/.exec(value)
      if (!width || Number(width[1]) > 0) return true
    }
  }
  const width = style.get('border-width')
  const kind = style.get('border-style')
  if (kind && /\b(?:solid|dashed|dotted|double)\b/.test(kind) && (!width || !/^0(?:px)?$/.test(width.trim()))) return true
  return false
}

/** A side of an element's box. */
export type SiteImportSide = 'top' | 'right' | 'bottom' | 'left'

const SIDES: readonly SiteImportSide[] = ['top', 'right', 'bottom', 'left']

/** One side's border, where it draws one: its width in px and its color as written. */
export interface SiteImportBorderSide {
  width: number
  color: SiteImportRgba | null
}

/**
 * The sides an element draws a border on (AGL-4138), each with its width and
 * color: a box is bordered on every side, a rule on one. The shorthand draws
 * all four; a side's own declaration, or `border-width` and `border-style`
 * by side, draw only theirs.
 */
export function siteImportBorderSides(style: SiteImportComputedStyle): Partial<Record<SiteImportSide, SiteImportBorderSide>> {
  const out: Partial<Record<SiteImportSide, SiteImportBorderSide>> = {}
  const shared = siteImportColorOf(style.get('border-color'))
  const drawn = (value: string | undefined): SiteImportBorderSide | null => {
    if (!value || /\bnone\b|\bhidden\b/.test(value) || /^0(?:px)?$/.test(value.trim())) return null
    const color = siteImportColorOf(value) ?? shared
    if (color && color.a < 0.05) return null
    if (!/\d/.test(value) && !/\b(?:solid|dashed|dotted|double)\b/.test(value)) return null
    const width = /(-?[\d.]+)(?:px)?(?:\s|$)/.exec(value.replace(/#[0-9a-f]+|rgba?\([^)]*\)|hsla?\([^)]*\)/gi, ' '))
    const px = width ? Number(width[1]) : /\bthick\b/.test(value) ? 5 : /\bthin\b/.test(value) ? 1 : 3
    return px > 0 ? { width: px, color } : null
  }
  const all = drawn(style.get('border'))
  for (const side of SIDES) {
    const own = style.get(`border-${side}`)
    const found = own !== undefined ? drawn(own) : all
    if (found) out[side] = found
  }
  // `border-width` and `border-style` by side, where no shorthand drew a side.
  const kind = style.get('border-style')
  if (!Object.keys(out).length && kind && /\b(?:solid|dashed|dotted|double)\b/.test(kind)) {
    const widths = (style.get('border-width') ?? '3px').trim().split(/\s+/)
    const by = [widths[0], widths[1] ?? widths[0], widths[2] ?? widths[0], widths[3] ?? widths[1] ?? widths[0]]
    SIDES.forEach((side, at) => {
      const px = siteImportLengthPx(by[at] ?? '')
      if (px !== null && px > 0) out[side] = { width: px, color: shared }
    })
  }
  return out
}

/** A picture box's `aspect-ratio`, width over height: `16 / 9`, `1.5`, `auto 4 / 3`; `null` where it sets none. */
export function siteImportAspectRatio(value: string | undefined): number | null {
  const match = /(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?/.exec((value ?? '').replace(/\bauto\b/g, ' '))
  if (!match) return null
  const width = Number(match[1])
  const height = match[2] === undefined ? 1 : Number(match[2])
  return width > 0 && height > 0 ? width / height : null
}

/** A color as it shows over the ground it sits on, its strength blended in: `rgba(0,0,0,.6)` over white is `#666666`. */
export function siteImportOpaque(color: SiteImportRgba, under: SiteImportRgba | null = null): SiteImportRgba {
  const ground = under ?? { r: 255, g: 255, b: 255, a: 1 }
  const a = Math.max(0, Math.min(1, color.a))
  return { r: color.r * a + ground.r * (1 - a), g: color.g * a + ground.g * (1 - a), b: color.b * a + ground.b * (1 - a), a: 1 }
}

/** How far apart two colors look, in OKLab (0 the same, about 1 black from white). */
export function siteImportColorDistance(a: SiteImportRgba, b: SiteImportRgba): number {
  const lab = (color: SiteImportRgba) => {
    const linear = (channel: number) => {
      const c = channel / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const [r, g, bl] = [linear(color.r), linear(color.g), linear(color.b)]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  }
  const [x, y] = [lab(a), lab(b)]
  return Math.hypot((x[0] as number) - (y[0] as number), (x[1] as number) - (y[1] as number), (x[2] as number) - (y[2] as number))
}

/** Whether an element draws a shadow. */
export function siteImportHasShadow(style: SiteImportComputedStyle): boolean {
  const value = style.get('box-shadow')
  return !!value && !/^(?:none|0|initial|unset)$/.test(value.trim()) && !/^0(?:px)?\s+0(?:px)?\s+0(?:px)?(?:\s+0(?:px)?)?\s+(?:transparent|rgba\([^)]*,\s*0\))/.test(value.trim())
}

/** An element's corner radius in px, or `null`. */
export function siteImportRadiusPx(style: SiteImportComputedStyle): number | null {
  const value = style.get('border-radius')
  if (!value) return null
  const first = value.trim().split(/[\s/]+/)[0] ?? ''
  if (first.endsWith('%')) return Number(first.slice(0, -1)) >= 50 ? 999 : Number(first.slice(0, -1))
  return siteImportLengthPx(first)
}

/** A font size in px, or `null`. */
export function siteImportFontSizePx(style: SiteImportComputedStyle): number | null {
  const value = style.get('font-size')
  if (!value) return null
  const clamp = /clamp\(([^,]+),([^,]+),([^)]+)\)/.exec(value)
  // A fluid size at the read width: its maximum, as a wide screen shows it.
  const text = clamp ? clamp[3] : value
  return siteImportLengthPx(text.trim())
}

/** The relative widths a grid template draws its columns at, or `null` for none. */
export function siteImportGridColumns(template: string | undefined): number[] | null {
  if (!template || /^(?:none|subgrid|masonry)$/.test(template.trim())) return null
  let text = template.trim()
  // repeat(3, 1fr) / repeat(auto-fill, minmax(240px, 1fr)): the count, or three of them.
  text = text.replace(/repeat\(\s*([\w-]+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g, (_, count: string, track: string) => {
    const times = /^\d+$/.test(count) ? Math.min(12, Number(count)) : 3
    return Array.from({ length: times }, () => track.trim()).join(' ')
  })
  const tracks: string[] = []
  let depth = 0
  let token = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (token) tracks.push(token)
      token = ''
    } else token += char
  }
  if (token) tracks.push(token)
  const weights = tracks
    .filter((track) => !/^\[.*\]$/.test(track))
    .map((track) => {
      const fr = /(-?[\d.]+)fr\)?$/.exec(track)
      if (fr) return Number(fr[1]) || 1
      const px = /(-?[\d.]+)px/.exec(track)
      if (px) return Number(px[1]) / 100
      const percent = /(-?[\d.]+)%/.exec(track)
      if (percent) return Number(percent[1]) / 10
      return 1
    })
  return weights.length ? weights : null
}

/** A template's top-level words: a track, a `repeat()` or a `[line name]`. */
function gridTemplateWords(template: string): string[] {
  const words: string[] = []
  let depth = 0
  let word = ''
  for (const char of template) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (word) words.push(word)
      word = ''
    } else word += char
  }
  if (word) words.push(word)
  return words
}

/**
 * How many tracks a grid template draws (AGL-4152), each `repeat()` opened at
 * its whole count; `null` for none, or where the screen decides (`auto-fill`).
 */
export function siteImportGridTrackCount(template: string | undefined): number | null {
  const text = template?.trim() ?? ''
  if (!text || /^(?:none|subgrid|masonry|inherit|initial|unset)$/.test(text)) return null
  let count = 0
  for (const word of gridTemplateWords(text)) {
    if (word.startsWith('[')) continue
    const repeat = /^repeat\(([\s\S]*)\)$/.exec(word)
    if (!repeat) {
      count += 1
      continue
    }
    const [times, ...tracks] = splitList(repeat[1] as string)
    const inner = siteImportGridTrackCount(tracks.join(','))
    if (!/^\d+$/.test(times ?? '') || inner === null) return null
    count += Number(times) * inner
  }
  return count || null
}

/** The cells a child of a grid covers, by grid line: `rowEnd` and `columnEnd` are the lines after its last row and column. */
export interface SiteImportGridBox {
  rowStart: number
  rowEnd: number
  columnStart: number
  columnEnd: number
}

/** A child's place along one axis: the line it starts at, `null` where the grid's flow decides, and how many tracks it covers. */
interface GridAxis {
  start: number | null
  span: number
}

/** One written line of a placement: a line number, a span, or nothing a reader can place (`auto`, a named line). */
function gridLineOf(value: string | undefined, tracks: number | null): { line?: number; span?: number } {
  const text = value?.trim() ?? ''
  const span = /^span\s+(\d+)$/.exec(text)
  if (span) return { span: Math.max(1, Number(span[1])) }
  if (!/^-?\d+$/.test(text)) return {}
  const line = Number(text)
  if (line > 0) return { line }
  // A line counted from the end: the last there is, where the template does not say how many.
  if (line < 0) return { line: tracks === null ? Number.POSITIVE_INFINITY : Math.max(1, tracks + 2 + line) }
  return {}
}

function gridAxisOf(startValue: string | undefined, endValue: string | undefined, tracks: number | null): GridAxis {
  const start = gridLineOf(startValue, tracks)
  const end = gridLineOf(endValue, tracks)
  if (start.line === Number.POSITIVE_INFINITY) return { start: null, span: 1 }
  if (start.line !== undefined && end.line !== undefined) {
    const from = Math.min(start.line, end.line)
    return { start: from, span: Math.max(1, Math.max(start.line, end.line) - from) }
  }
  if (start.line !== undefined) return { start: start.line, span: end.span ?? 1 }
  if (end.line !== undefined && end.line !== Number.POSITIVE_INFINITY) {
    const span = start.span ?? 1
    return { start: Math.max(1, end.line - span), span }
  }
  return { start: null, span: start.span ?? end.span ?? 1 }
}

/** The boxes a `grid-template-areas` names, by name. */
function gridAreasOf(template: string | undefined): Map<string, SiteImportGridBox> {
  const areas = new Map<string, SiteImportGridBox>()
  const rows = [...(template ?? '').matchAll(/"([^"]*)"|'([^']*)'/g)].map((match) => (match[1] ?? match[2] ?? '').trim().split(/\s+/))
  rows.forEach((names, row) => {
    names.forEach((name, column) => {
      if (!name || /^\.+$/.test(name)) return
      const held = areas.get(name)
      if (!held) areas.set(name, { rowStart: row + 1, rowEnd: row + 2, columnStart: column + 1, columnEnd: column + 2 })
      else {
        held.rowEnd = Math.max(held.rowEnd, row + 2)
        held.columnEnd = Math.max(held.columnEnd, column + 2)
      }
    })
  })
  return areas
}

/** A flex or grid child's `order`, 0 where it sets none. */
export function siteImportOrderOf(style: SiteImportComputedStyle): number {
  const order = Number.parseInt(style.get('order') ?? '', 10)
  return Number.isNaN(order) ? 0 : order
}

/**
 * Where a grid places its children (AGL-4152), each child's cells by grid
 * line, as a browser lays them out: the lines each child names (by
 * `grid-area`, a named area, `grid-row` or `grid-column`, a longhand over the
 * shorthand; lines from the end read from the template), then the children it
 * leaves to the grid's flow, in `order`, each in the first cells free.
 *
 * `null` where it cannot say, or there is nothing to say: no child names a
 * place (a `span` says how wide, and `1 / -1` the whole row, not where), the
 * rest of the children flow by columns, or through tracks the screen decides.
 */
export function siteImportGridBoxes(container: SiteImportComputedStyle, items: readonly SiteImportComputedStyle[]): SiteImportGridBox[] | null {
  const areas = gridAreasOf(container.get('grid-template-areas'))
  const named = [...areas.values()]
  const columns = siteImportGridTrackCount(container.get('grid-template-columns')) ?? (named.length ? Math.max(...named.map((area) => area.columnEnd)) - 1 : null)
  const rows = siteImportGridTrackCount(container.get('grid-template-rows')) ?? (named.length ? Math.max(...named.map((area) => area.rowEnd)) - 1 : null)
  const places = items.map((item) => {
    const [rowStart, columnStart, rowEnd, columnEnd] = (item.get('grid-area') ?? '').split('/').map((part) => part.trim())
    const area = rowStart && columnStart === undefined ? areas.get(rowStart) : undefined
    const row = item.get('grid-row')?.split('/') ?? [rowStart, rowEnd]
    const column = item.get('grid-column')?.split('/') ?? [columnStart, columnEnd]
    return {
      row: area ? { start: area.rowStart, span: area.rowEnd - area.rowStart } : gridAxisOf(item.get('grid-row-start') ?? row[0], item.get('grid-row-end') ?? row[1], rows),
      column: area ? { start: area.columnStart, span: area.columnEnd - area.columnStart } : gridAxisOf(item.get('grid-column-start') ?? column[0], item.get('grid-column-end') ?? column[1], columns),
    }
  })
  const wholeRow = (axis: GridAxis) => axis.start === 1 && (axis.span === Number.POSITIVE_INFINITY || (columns !== null && axis.span >= columns))
  if (!places.some((place) => place.row.start !== null || (place.column.start !== null && !wholeRow(place.column)))) return null
  const flows = places.some((place) => place.row.start === null || place.column.start === null)
  if (flows && (columns === null || /\bcolumn\b/.test(container.get('grid-auto-flow') ?? ''))) return null

  const finite = (value: number) => (Number.isFinite(value) ? value : 0)
  const lastRow = Math.max(rows === null ? 1 : rows + 1, ...places.map((place) => (place.row.start ?? 0) + finite(place.row.span)))
  const lastColumn = columns === null ? Math.max(...places.map((place) => (place.column.start ?? 0) + finite(place.column.span))) : columns + 1
  const boxes: Array<SiteImportGridBox | null> = places.map(() => null)
  const free = (row: number, column: number, height: number, width: number) =>
    boxes.every((box) => !box || box.rowEnd <= row || box.rowStart >= row + height || box.columnEnd <= column || box.columnStart >= column + width)
  const put = (at: number, row: number, column: number, height: number, width: number) => {
    boxes[at] = { rowStart: row, rowEnd: row + height, columnStart: column, columnEnd: column + width }
  }
  const heightOf = (axis: GridAxis, row: number) => (Number.isFinite(axis.span) ? axis.span : Math.max(1, lastRow - row))
  const widthOf = (axis: GridAxis, column: number) => Math.max(1, Math.min(axis.span, lastColumn - column))
  const inOrder = places.map((_, at) => at).sort((a, b) => siteImportOrderOf(items[a] as SiteImportComputedStyle) - siteImportOrderOf(items[b] as SiteImportComputedStyle) || a - b)
  // Rows and columns both named first, whatever their order: nothing flows into them.
  for (const at of inOrder) {
    const { row, column } = places[at] as (typeof places)[number]
    if (row.start !== null && column.start !== null) put(at, row.start, column.start, heightOf(row, row.start), widthOf(column, column.start))
  }
  // A row named and its column not: the first cells free in that row.
  for (const at of inOrder) {
    const { row, column } = places[at] as (typeof places)[number]
    if (row.start === null || column.start !== null) continue
    const height = heightOf(row, row.start)
    const width = widthOf(column, 1)
    let left = 1
    while (left + width < lastColumn && !free(row.start, left, height, width)) left += 1
    put(at, row.start, left, height, width)
  }
  // The rest, in the order they flow: a cursor down the grid, never back.
  let cursorRow = 1
  let cursorColumn = 1
  for (const at of inOrder) {
    if (boxes[at]) continue
    const { row, column } = places[at] as (typeof places)[number]
    const height = heightOf(row, 1)
    if (column.start !== null) {
      const width = widthOf(column, column.start)
      if (column.start < cursorColumn) cursorRow += 1
      cursorColumn = column.start
      while (!free(cursorRow, cursorColumn, height, width)) cursorRow += 1
      put(at, cursorRow, cursorColumn, height, width)
      continue
    }
    const width = widthOf(column, 1)
    while (cursorColumn + width > lastColumn || !free(cursorRow, cursorColumn, height, width)) {
      cursorColumn += 1
      if (cursorColumn + width > lastColumn) {
        cursorColumn = 1
        cursorRow += 1
      }
    }
    put(at, cursorRow, cursorColumn, height, width)
  }
  return boxes as SiteImportGridBox[]
}

/** Weights scaled to twelfths, each at least 1: `[420, 788]` is `[4, 8]`. */
export function siteImportTwelfths(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0)
  if (!total) return weights.map(() => 1)
  const scaled = weights.map((weight) => Math.max(1, Math.round((Math.max(0, weight) / total) * 12)))
  // Two equal tracks stay equal, three stay thirds.
  const unique = new Set(weights.map((weight) => Math.round(weight * 1000)))
  if (unique.size === 1) return weights.map(() => 1)
  return scaled
}

/** The families a `font-family` value names, quotes dropped, generic ones left out. */
export function siteImportFontFamilies(value: string | undefined): string[] {
  if (!value) return []
  return splitList(value)
    .map((family) => family.replace(/^["']|["']$/g, '').trim())
    .filter((family) => family && !/^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[\w-]+|-apple-system|blinkmacsystemfont|inherit|initial|emoji|math|var\(.*)$/i.test(family))
}

/*------------------------------------------
 * Reading a page's stylesheets
 *-----------------------------------------*/

/**
 * How much of a page's stylesheets is read (AGL-4152). A site builder's own
 * sheet can be its fifth link and 1.3 MB, with half a megabyte more behind it,
 * and every color and font of the site is in it. So:
 *
 * - `firstLookBytes`: every link is first read this far. Most sheets end
 *   inside it, and those are done; a larger one shows here whether it declares
 *   `:root` custom properties, which they do at their top.
 * - `budgetBytes`: what all the page's sheets may hold together, first looks
 *   included. Three times the sheet that set it, with room for what comes with
 *   it. What does not fit is cut, and a cut sheet is read as far as it goes.
 * - `atOnce`: first looks asked together, so twenty links are not twenty
 *   connections to one host.
 *
 * So one page's read costs at most its links' first looks and the budget:
 * 3.8 MB at the most links a page lists, however large its sheets are.
 */
export const SITE_IMPORT_SHEET_LIMITS = {
  firstLookBytes: 32 * 1024,
  budgetBytes: 3 * 1024 * 1024,
  atOnce: 6,
} as const

/** What a read of a stylesheet gives back. */
export interface SiteImportSheetAnswer {
  ok: boolean
  text: string
  /** Bytes read. */
  bytes: number
  /** Whether the sheet goes on past `maxBytes`. */
  truncated: boolean
}

/** Reads a stylesheet to a number of bytes; `null` where it cannot. */
export type SiteImportSheetRead = (url: string, maxBytes: number) => Promise<SiteImportSheetAnswer | null>

/** Whether a sheet declares custom properties on the page's root: its theme, not a widget's. */
const ROOT_VARIABLES = /(?:^|[},;\s])(?::root|html)\b[^{}]*\{[^{}]*--[\w-]+\s*:/

/**
 * Every stylesheet a page links, to a byte budget (AGL-4152), in link order,
 * as the cascade needs them. Each is read a first look; then the ones that go
 * on are read whole, the ones declaring `:root` custom properties first, then
 * the rest in link order, each to what is left of the budget. A read that fails
 * leaves its sheet out, and never the page.
 */
export async function siteImportReadStylesheets(
  urls: readonly string[],
  read: SiteImportSheetRead,
  options: { budgetBytes?: number; outOfTime?: () => boolean } = {},
): Promise<string[]> {
  const budget = options.budgetBytes ?? SITE_IMPORT_SHEET_LIMITS.budgetBytes
  const outOfTime = options.outOfTime ?? (() => false)
  const unique = [...new Set(urls)]
  const looks: Array<SiteImportSheetAnswer | null> = unique.map(() => null)
  const ask = (url: string, maxBytes: number) => read(url, maxBytes).then((answer) => (answer?.ok ? answer : null), () => null)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(SITE_IMPORT_SHEET_LIMITS.atOnce, unique.length) }, async () => {
      while (next < unique.length && !outOfTime()) {
        const at = next
        next += 1
        looks[at] = await ask(unique[at] as string, SITE_IMPORT_SHEET_LIMITS.firstLookBytes)
      }
    }),
  )
  let room = budget - looks.reduce((sum, look) => sum + (look?.bytes ?? 0), 0)
  const rest = unique.map((_, at) => at).filter((at) => looks[at]?.truncated)
  const theme = (at: number) => (ROOT_VARIABLES.test((looks[at] as SiteImportSheetAnswer).text) ? 0 : 1)
  rest.sort((a, b) => theme(a) - theme(b) || a - b)
  for (const at of rest) {
    if (room <= 0 || outOfTime()) break
    const look = looks[at] as SiteImportSheetAnswer
    const whole = await ask(unique[at] as string, look.bytes + room)
    if (!whole) continue
    room -= whole.bytes - look.bytes
    looks[at] = whole
  }
  return looks.flatMap((look) => (look ? [look.text] : []))
}
