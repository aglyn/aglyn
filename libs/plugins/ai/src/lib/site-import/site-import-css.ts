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
 *   read in order. `@media` rules apply as a 1280-pixel screen in light mode
 *   sees them, so a grid's desktop columns win over its phone ones;
 *   `@layer`, `@supports` and `@container` are read through; keyframes, font
 *   faces (their families noted) and page rules are skipped.
 * - **Selectors.** Tags, classes (escaped ones too, as utility frameworks
 *   write them), ids and attributes, joined by any combinator. A rule that
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
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-basis',
  'width',
  'max-width',
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
function lengthPx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)\s*(px|em|rem)?$/i.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  return match[2] && match[2].toLowerCase() !== 'px' ? amount * 16 : amount
}

/** Whether one media query holds for a light-mode screen of the read width. */
function mediaQueryHolds(query: string): boolean {
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
    const { width, height } = SITE_IMPORT_CSS_VIEWPORT
    if (feature) {
      const [, name, value] = feature
      const px = lengthPx(value)
      if (name === 'min-width') holds &&= px !== null && width >= px
      else if (name === 'max-width') holds &&= px !== null && width <= px
      else if (name === 'min-height') holds &&= px !== null && height >= px
      else if (name === 'max-height') holds &&= px !== null && height <= px
      else if (name === 'prefers-color-scheme') holds &&= value.trim() === 'light'
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
        const px = lengthPx(range[1])
        holds &&= px !== null && test(px, range[2], size)
      }
      if (range[4] && range[5]) {
        const px = lengthPx(range[5])
        holds &&= px !== null && test(size, range[4], px)
      }
    }
  }
  return negate ? !holds : holds
}

function mediaHolds(prelude: string): boolean {
  const list = splitList(prelude.replace(/^@media\s*/i, ''))
  return !list.length || list.some(mediaQueryHolds)
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
export function siteImportCssOf(sheets: readonly string[]): SiteImportCss {
  const css: SiteImportCss = { rules: [], index: new Map(), fontFaces: [] }
  let order = 0
  const addRule = (prelude: string, body: string) => {
    const decls = declarationsOf(body)
    if (!decls.length) return
    for (const text of splitList(prelude)) {
      const selector = parseSelector(text)
      if (!selector) continue
      const rule: CssRule = { selector, order: order++, decls }
      css.rules.push(rule)
      const key = keyOf(selector)
      const list = css.index.get(key)
      if (list) list.push(rule)
      else css.index.set(key, [rule])
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
        groups.push(applies && mediaHolds(prelude))
        start = at = at + 1
        continue
      }
      if (/^@(?:supports|layer|container|document|scope|starting-style)\b/i.test(prelude)) {
        groups.push(applies && !/^@starting-style/i.test(prelude))
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
        addRule(prelude, body.replace(/[^;{}]*\{[^{}]*\}/g, ''))
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
}

const EMPTY_STYLE: SiteImportComputedStyle = new Map()

/** Replaces each `var(--x, fallback)` with what the custom properties hold, to a few levels. */
function withVariables(value: string, custom: ReadonlyMap<string, string>): string {
  let out = value
  for (let pass = 0; pass < 4 && out.includes('var('); pass += 1) {
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
    const custom = new Map(parent.custom)
    apply(matched, inlineDeclarations(element.attrs.style), own, custom)
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
  const hsl = /hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/.exec(text)
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
  return lengthPx(first)
}

/** A font size in px, or `null`. */
export function siteImportFontSizePx(style: SiteImportComputedStyle): number | null {
  const value = style.get('font-size')
  if (!value) return null
  const clamp = /clamp\(([^,]+),([^,]+),([^)]+)\)/.exec(value)
  // A fluid size at the read width: its maximum, as a wide screen shows it.
  const text = clamp ? clamp[3] : value
  return lengthPx(text.trim())
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
