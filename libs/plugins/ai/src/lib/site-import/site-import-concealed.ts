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
 * WHAT A VISITOR CANNOT SEE IS NOT THE PAGE (AGL-4152).
 *
 * Read from what an element draws, through the page's own stylesheets, over
 * the structure a first walk of the page builds. The second walk leaves out
 * what this says, and only in a page's main region: a menu and a footer have
 * readers of their own.
 *
 * - **Drawn nowhere.** The `hidden` attribute, `display: none`,
 *   `visibility: hidden`, a zero box, a `<dialog>` left shut. A template goes,
 *   its picture and its words: a lightbox, an overlay, a drawer, a copy measured
 *   out of sight. What a visitor opens stays: an accordion's answer, a tab, a
 *   slide. So it stays where it holds words and no picture, or real words
 *   beside its picture, or a form, or is a tab's panel, or is one of a set of
 *   siblings built alike with one showing and says something else. Built alike
 *   and saying the same, it is a copy for another screen, and goes.
 * - **Only heard.** Clipped to nothing, a one-pixel box, off-screen, or
 *   `aria-hidden` (`sr-only` and its kin count with no sheet to say so). Its
 *   words go. A picture under `aria-hidden` is still seen, and stays.
 * - **Waiting.** A lazy picture its own rule hides until it loads, or an element
 *   hidden until its entrance plays, is shown to a visitor, and stays.
 * - **Going round.** Siblings that say the same again and again (a ticker) say
 *   it once.
 *
 * Its other answer is where a text block breaks: an inline element set on a
 * line of its own, and the elements that keep the line breaks their words are
 * written with.
 *=========================================*/

import { siteImportCssOf, siteImportLengthPx, siteImportStylesOf, type SiteImportComputedStyle } from './site-import-css'
import type { SiteImportElement, SiteImportStructure } from './site-import-html'

/** What a second walk of a page leaves out, and where its text blocks break, by element. */
export interface SiteImportConcealed {
  /** Drawn nowhere for anyone: its pictures and its words go. */
  gone: ReadonlySet<number>
  /** Only a screen reader hears it: its words go, its pictures stay. */
  unread: ReadonlySet<number>
  /** An inline element a text block sets on its own line. */
  lines: ReadonlySet<number>
  /** An element whose words keep the line breaks they are written with. */
  preserved: ReadonlySet<number>
}

/** The letters under a hidden element that make it a panel a visitor opens, not a template's "Close". */
const PANEL_MIN_LETTERS = 20

/** The fewest letters a repeat must say to be a ticker going round, not a table's "x". */
const REPEAT_MIN_LETTERS = 3

/** How far out of the page an element is set to be off-screen: past any screen's edge, or wholly past its own. */
const OFF_PAGE_PX = -999

/** The convention for words only a screen reader hears, where no sheet says so. */
const ONLY_HEARD_CLASS = /(?:^|[\s_-])(?:sr-only|screen-reader(?:-text|-only)?|visually-?hidden|visuallyhidden|assistive-text)(?:-focusable)?(?:\s|$)/i

/** An element waiting on an entrance a script plays: hidden only until then. */
const ENTRANCE_CLASS = /anim|invisible|reveal|fade|wow|aos/i

/** Tags that hold words in a line, which a sheet may set on a line of their own. */
const INLINE_TAG = /^(?:span|b|strong|em|i|u|small|font|mark|abbr|cite)$/

/** A grid of cells may say the same in each one and mean it. */
const CELLS_TAG = /^(?:table|thead|tbody|tfoot|tr|select|datalist)$/

const isOutOfFlow = (style: SiteImportComputedStyle) => /^(?:absolute|fixed)$/.test(style.get('position') ?? '')

/** Whether a length sits past the page's edge. */
function offPage(value: string | undefined): boolean {
  const text = value?.trim() ?? ''
  const percent = /^(-[\d.]+)%$/.exec(text)
  if (percent) return Number(percent[1]) <= -100
  const px = text ? siteImportLengthPx(text) : null
  return px !== null && px <= OFF_PAGE_PX
}

/** Whether an element's box is nothing: nothing drawn, and nothing a padding opens. */
function zeroBox(node: SiteImportElement, style: SiteImportComputedStyle): boolean {
  const width = siteImportLengthPx(style.get('width') ?? '')
  const height = siteImportLengthPx(style.get('height') ?? '')
  if (width !== 0 && height !== 0) return false
  if (node.tag !== 'img' && !/hidden|clip/.test(style.get('overflow') ?? '')) return false
  const open = (value: string | undefined) => !!value && (siteImportLengthPx(value) ?? 1) > 0
  return !['padding', 'padding-top', 'padding-bottom'].some((property) => open(style.get(property)?.split(/\s+/)[0]))
}

/** Whether words are set where no visitor reads them: clipped to nothing, in a one-pixel box, or off-screen. */
function onlyHeard(node: SiteImportElement, style: SiteImportComputedStyle): boolean {
  if (ONLY_HEARD_CLASS.test(node.attrs.class ?? '')) return true
  if (!isOutOfFlow(style)) return false
  // Clipped to a box of at most a pixel: `rect(0 0 0 0)`, `rect(1px, 1px, 1px, 1px)`.
  const clip = /^rect\(([^)]*)\)/.exec(style.get('clip') ?? '')
  if (clip && (clip[1]?.match(/[\d.]+/g) ?? []).every((side) => Number(side) <= 1)) return true
  if (/^(?:inset\((?:50|100)%\)|circle\(0(?:px|%)?\))/.test(style.get('clip-path') ?? '')) return true
  const width = siteImportLengthPx(style.get('width') ?? '')
  const height = siteImportLengthPx(style.get('height') ?? '')
  if (width !== null && height !== null && width <= 1 && height <= 1) return true
  return ['left', 'right', 'top'].some((property) => offPage(style.get(property)))
}

/** A drawer set past the screen's edge, until something slides it in. */
const offCanvas = (style: SiteImportComputedStyle) => style.get('position') === 'fixed' && /translate(?:x|3d)?\(\s*-?100%/.test(style.get('transform') ?? '')

/** What a page leaves out for a visitor, read through its own stylesheets; `null` where it leaves out nothing and breaks no block. */
export function siteImportConcealedOf(structure: SiteImportStructure, runs: ReadonlyMap<number, string>, stylesheets: readonly string[]): SiteImportConcealed | null {
  const { elements } = structure
  const styles = siteImportStylesOf(structure, siteImportCssOf([...structure.styles, ...stylesheets]))
  const gone = new Set<number>()
  const unread = new Set<number>()
  const lines = new Set<number>()
  const preserved = new Set<number>()
  /** Hidden by `visibility`, which a child may set back. */
  const byVisibility = new Set<number>()
  const panels = new Set(elements.flatMap((node) => (node.attrs.controls ? [node.attrs.controls] : [])))

  /** What an element says: its words, its pictures, its links, its icons, top to bottom. */
  const saidMemo = new Map<number, string>()
  const said = (id: number): string => {
    const held = saidMemo.get(id)
    if (held !== undefined) return held
    const node = elements[id] as SiteImportElement
    const parts = [runs.get(id) ?? '', node.picture ? `<${node.picture.url}>` : '', node.icon !== undefined ? `<icon ${node.icon}>` : '', node.tag === 'a' && node.attrs.href ? `<${node.attrs.href}>` : '', ...node.children.map(said)]
    const text = parts.join(' ').replace(/\s+/g, ' ').trim()
    saidMemo.set(id, text)
    return text
  }
  const holdsForm = (id: number): boolean => {
    const node = elements[id] as SiteImportElement
    return node.form !== undefined || node.children.some(holdsForm)
  }
  const holdsPicture = (id: number): boolean => {
    const node = elements[id] as SiteImportElement
    return !!node.picture || node.children.some(holdsPicture)
  }
  const lettersIn = (text: string) => text.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]/gu, '').length

  /** Whether an element is drawn nowhere by itself; what it inherits its parent answers for. */
  const notDrawn = (node: SiteImportElement, style: SiteImportComputedStyle): 'visibility' | 'box' | null => {
    if (node.attrs.notDrawn || style.get('display') === 'none' || (node.tag === 'dialog' && !node.attrs.open)) return 'box'
    if (zeroBox(node, style) || (node.tag === 'img' && node.attrs.tiny && !node.attrs.lazy)) return 'box'
    if (style.get('visibility') === 'hidden' && styles.of(node.parent).get('visibility') !== 'hidden') return 'visibility'
    return null
  }
  /** A shown sibling built alike, by a class they share, or by having none: a slide's neighbor, or the screen this one is a copy for. */
  const shownAlike = (node: SiteImportElement): SiteImportElement | null => {
    const classes = new Set((node.attrs.class ?? '').split(/\s+/).filter(Boolean))
    const siblings = (node.parent >= 0 ? (elements[node.parent] as SiteImportElement).children : []).map((id) => elements[id] as SiteImportElement)
    const alike = siblings.filter((other) => other.id !== node.id && other.tag === node.tag && !other.attrs.ariaHidden && !notDrawn(other, styles.of(other.id)))
    return alike.find((other) => (other.attrs.class ?? '').split(/\s+/).some((name) => classes.has(name))) ?? (classes.size === 0 ? (alike.find((other) => !other.attrs.class) ?? null) : null)
  }

  const subtree = (id: number, into: Set<number>) => {
    into.add(id)
    for (const child of (elements[id] as SiteImportElement).children) subtree(child, into)
  }

  for (const node of elements) {
    const style = styles.of(node.id)
    if (node.region !== 'main' || node.nav) continue
    if (/^pre(?:-wrap|-line)?$/.test(style.get('white-space') ?? '')) preserved.add(node.id)
    if (INLINE_TAG.test(node.tag) && /^(?:block|flex|grid|list-item|table)$/.test(style.get('display') ?? '')) lines.add(node.id)
    if (gone.has(node.parent)) {
      // `visibility` is the one way of hiding that a child may set back.
      if (!(byVisibility.has(node.parent) && style.get('visibility') === 'visible')) {
        gone.add(node.id)
        if (byVisibility.has(node.parent)) byVisibility.add(node.id)
        continue
      }
    }
    if (unread.has(node.parent)) unread.add(node.id)
    if (onlyHeard(node, style) || offCanvas(style)) {
      gone.add(node.id)
      continue
    }
    if (offPage(style.get('text-indent'))) unread.add(node.id)
    if (node.attrs.ariaHidden) {
      const beside = shownAlike(node)
      if (beside && said(beside.id) === said(node.id)) {
        gone.add(node.id)
        continue
      }
      // One of a set: the slide after the one showing, its words a visitor reads when it comes round.
      if (!beside || !node.attrs.class) unread.add(node.id)
    }
    // A lazy picture its own rule hides until it loads is on its way to a visitor.
    if (node.tag === 'img' && node.attrs.lazy) continue
    if (node.attrs.role === 'tabpanel' || (node.attrs.id && panels.has(node.attrs.id))) continue
    const hiddenBy = notDrawn(node, style)
    if (!hiddenBy) continue
    if (hiddenBy === 'visibility' && ENTRANCE_CLASS.test(node.attrs.class ?? '')) continue
    if (holdsForm(node.id)) continue
    // A dialog, what is fixed over the page, or what is measured out of sight: a template, never a panel of it.
    const overlay = node.tag === 'dialog' || /^(?:dialog|alertdialog)$/.test(node.attrs.role ?? '') || style.get('position') === 'fixed' || (hiddenBy === 'visibility' && isOutOfFlow(style))
    if (!overlay) {
      const beside = shownAlike(node)
      const copy = !!beside && said(beside.id) === said(node.id)
      // Not a copy: a slide of a set, or a panel a visitor opens.
      if (!copy && ((beside && node.attrs.class) || !holdsPicture(node.id) || lettersIn(said(node.id)) >= PANEL_MIN_LETTERS)) continue
    }
    gone.add(node.id)
    if (hiddenBy === 'visibility') byVisibility.add(node.id)
  }

  // Siblings that say the same again and again say it once: a ticker going round.
  for (const node of elements) {
    if (node.region !== 'main' || node.nav || gone.has(node.id) || CELLS_TAG.test(node.tag)) continue
    const saying = node.children.filter((child) => !gone.has(child) && !unread.has(child) && !!said(child))
    if (saying.length < 2) continue
    for (let period = 1; period * 2 <= saying.length; period += 1) {
      if (saying.some((child, at) => said(child) !== said(saying[at % period] as number))) continue
      if (lettersIn(saying.slice(0, period).map(said).join('')) < REPEAT_MIN_LETTERS) break
      for (const copy of saying.slice(period)) subtree(copy, gone)
      break
    }
  }

  return gone.size || unread.size || lines.size || preserved.size ? { gone, unread, lines, preserved } : null
}
