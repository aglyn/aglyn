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
 * THE SOURCE'S LAYOUT, READ BY CODE (AGL-4106).
 *
 * An imported page used to be its lines and nothing else: every section
 * cut at an `h2`, every card a run of paragraphs, every icon gone, so the
 * page came out one column of text. This reads how the source lays the page
 * out, with no model, into a tree whose leaves are the page's own lines by
 * index (`SiteImportLayout`); the compile draws it with the site's own cards,
 * columns, pictures, icons and bands.
 *
 * - **Sections.** The source's own: the `<section>`s (or `<article>`s, or
 *   labeled regions) its `<main>` is made of, else the containers of their
 *   own that each hold a heading, else the stretches its `h1` and `h2` open.
 *   The eyebrow that opens a section stays in it. Each gets its name (its
 *   `aria-label`, else its heading) and its band, from its background: white
 *   is `plain`, a light grey or tint `soft`, a strong color `brand`, a dark
 *   color, a gradient or a photo `dark`.
 * - **Rows.** A container that lays its children side by side (a grid with
 *   columns, a flex row, a grid framework's row and cells, a table row) is a
 *   row; its columns' widths come from the grid template, the cells' sizes
 *   or equal shares, in twelfths.
 * - **Groups.** Three or more siblings built alike (the same elements in the
 *   same order) are a group, and what they hold says its kind: icon or
 *   picture with a title and words are `cards`, a leading number `steps`, a
 *   short figure over a label `stats`, questions with answers `faq`, quotes
 *   `quotes`, pictures alone `logos`, a price with a period `pricing`.
 *   Rows of cells built alike are a `table`; a `tablist` is `tabs`.
 * - **Pictures, icons, buttons.** Every picture where it sits (one inside a
 *   button or a link too); every inline icon, once, by index; every link or
 *   button the source draws as a button, filled (`primary`), outlined
 *   (`secondary`) or plain (`quiet`).
 * - **The look.** The fonts (Google Fonts' named), the page's background and
 *   text, the buttons' fill and corners, the links' color, the header's
 *   background: what the look pass draws the site's theme from.
 *
 * Class names are hints a framework leaves (`MuiGrid-grid-md-4`, `col-md-6`),
 * never the rule: the reader reads what an element draws, through the page's
 * own stylesheets (`site-import-css.ts`). Nothing a page wrote runs.
 *=========================================*/

import {
  AI_SITE_IMPORT_MAX_SECTIONS,
  siteImportFilterNodes,
  siteImportLayoutLines,
  type SiteImportBand,
  type SiteImportButtonStyle,
  type SiteImportGroupKind,
  type SiteImportHeroPicture,
  type SiteImportLayout,
  type SiteImportLayoutGroup,
  type SiteImportLayoutItem,
  type SiteImportLayoutNode,
  type SiteImportLayoutSection,
  type SiteImportLayoutTable,
  type SiteImportLayoutTabs,
  type SiteImportLineRef,
  type SiteImportLookFacts,
} from '../model/ai-site-import'
import {
  siteImportBackgroundOf,
  siteImportColorOf,
  siteImportCssOf,
  siteImportFontFamilies,
  siteImportFontSizePx,
  siteImportGridColumns,
  siteImportHasBorder,
  siteImportHasShadow,
  siteImportHex,
  siteImportLuminance,
  siteImportRadiusPx,
  siteImportSaturation,
  siteImportStylesOf,
  siteImportTwelfths,
  type SiteImportComputedStyle,
  type SiteImportStyles,
} from './site-import-css'
import { extractSiteImportPage, type SiteImportBlock, type SiteImportElement, type SiteImportExtract, type SiteImportStructure } from './site-import-html'
import { siteImportLabel } from './site-import-page'

/** A page as the layout reader takes it: its blocks and how it is built. */
export type SiteImportLayoutSource = Pick<SiteImportExtract, 'blocks'> & { structure: SiteImportStructure }

/** One thing in the page's order: a line (by its main-region index) or an icon. */
interface Leaf {
  order: number
  kind: 'line' | 'icon' | 'form'
  /** The line's index among the main-region blocks; the icon's or the form's index. */
  ref: number
  element: number
}

/** A part of a container: one of its children with content, or a leaf directly in it. */
type Part = { element: number; first: number } | { leaf: Leaf; first: number }

const isElementPart = (part: Part): part is { element: number; first: number } => 'element' in part

/** Whether a block is a line of its own: a link inside a sentence is in its sentence already. */
function isLine(block: SiteImportBlock): boolean {
  if (block.kind === 'image') return !!block.url
  if (block.kind === 'link') return !block.inline && !!block.text.trim()
  return !!block.text.trim()
}

const BUTTON_CLASS = /(?:^|[\s_-])(?:btn|button)(?:$|[\s_-])|Button-root|wp-block-button__link|sqs-block-button-element|elementor-button|w-button/i
const TEXT_BUTTON_CLASS = /MuiButton-text\b|btn-link\b|is-style-text/i
const OUTLINED_CLASS = /MuiButton-outlined\b|btn-outline|is-style-outline|--outline|button--secondary|btn-secondary/i
const FILLED_CLASS = /MuiButton-contained\b|btn-primary|button--primary|--solid|is-style-fill/i
const LANDMARK_TAGS = new Set(['section', 'article', 'aside'])
const SECTION_CLASS = /(?:^|[\s_-])(?:section|page-section|wp-block-group|elementor-section|e-con|shopify-section|block-section)(?:$|[\s_-])/i
const MUI_GRID_SIZE = /\bMuiGrid-grid-(xs|sm|md|lg|xl)-(\d+)\b/g
const BOOTSTRAP_COL = /\bcol-(?:(sm|md|lg|xl)-)?(\d{1,2})\b/g
const BREAKPOINT_RANK: Record<string, number> = { xs: 0, sm: 1, md: 2, lg: 3, xl: 4 }
const PRICE = /(?:[$€£¥₹]\s?\d|\d+(?:[.,]\d+)?\s?(?:USD|EUR|GBP|CAD|AUD)\b)/
const PERIOD = /\/\s?(?:mo|month|yr|year|user|seat|site)\b|\bper (?:month|year|user|seat)\b|\bmonthly\b|\bannual(?:ly)?\b|\bbilled\b|\ba month\b|\ba year\b/i
const STEP_NUMBER = /^(?:step\s*)?(?:0?\d{1,2}|[ivx]{1,4})[.):]?$/i
const FIGURE = /^[^\s]{0,3}[\d][\d.,:/x×+%kmb$€£-]*\s?[^\s]{0,12}$|^\d+-[a-z]+$/i

/**
 * The page's layout from its structure and its linked stylesheets' text,
 * over its main-region lines. `null` for a page with no structure or no main
 * content.
 */
export function siteImportLayout(page: SiteImportLayoutSource, stylesheets: readonly string[] = []): SiteImportLayout | null {
  const { structure, blocks } = page
  if (!structure) return null
  const css = siteImportCssOf([...structure.styles, ...stylesheets])
  const styles = siteImportStylesOf(structure, css)
  const reader = new LayoutReader(structure, blocks, styles)
  const sections = reader.sections()
  if (!sections.length) return null
  return {
    v: 1,
    sections,
    icons: structure.icons.map((icon) => ({ ...icon })),
    look: siteImportLookFacts(structure, styles, css.fontFaces),
  }
}

class LayoutReader {
  private readonly elements: readonly SiteImportElement[]
  /** Block index → its index among the main-region blocks; -1 for every other block. */
  private readonly mainIndex: number[]
  /** Each element's leaves, its subtree's, in order (memoized). */
  private readonly leafMemo = new Map<number, Leaf[]>()
  /** Each element's own leaves. */
  private readonly own: Leaf[][]
  /** Tab panels a tab strip has read already. */
  private readonly usedPanels = new Set<number>()
  private bodySize = 16

  constructor(
    private readonly structure: SiteImportStructure,
    private readonly blocks: readonly SiteImportBlock[],
    private readonly styles: SiteImportStyles,
  ) {
    this.elements = structure.elements
    this.mainIndex = []
    let main = 0
    for (const block of blocks) this.mainIndex.push(block.region === 'main' ? main++ : -1)
    this.own = this.elements.map(() => [])
    structure.blockElement.forEach((element, index) => {
      const block = blocks[index]
      const ref = this.mainIndex[index] ?? -1
      if (!block || ref < 0 || !isLine(block)) return
      this.own[element]?.push({ order: index, kind: 'line', ref, element })
    })
    for (const element of this.elements) {
      if (element.region !== 'main' || element.nav) continue
      if (element.icon !== undefined) this.own[element.id]?.push({ order: element.order ?? 0, kind: 'icon', ref: element.icon, element: element.id })
      if (element.form !== undefined) this.own[element.id]?.push({ order: element.order ?? 0, kind: 'form', ref: element.form, element: element.id })
    }
    const body = structure.body >= 0 ? structure.body : -2
    this.bodySize = siteImportFontSizePx(styles.of(body)) ?? 16
  }

  /*---------------- leaves and parts ----------------*/

  leaves(element: number): Leaf[] {
    const held = this.leafMemo.get(element)
    if (held) return held
    const node = this.elements[element]
    if (!node) return []
    const list = [...(this.own[element] ?? [])]
    for (const child of node.children) list.push(...this.leaves(child))
    list.sort((a, b) => a.order - b.order)
    this.leafMemo.set(element, list)
    return list
  }

  private inRange(leaf: Leaf, range: readonly [number, number]): boolean {
    return leaf.order >= range[0] && leaf.order < range[1]
  }

  private parts(element: number, range: readonly [number, number]): Part[] {
    const node = this.elements[element]
    if (!node) return []
    const parts: Part[] = []
    for (const leaf of this.own[element] ?? []) if (this.inRange(leaf, range)) parts.push({ leaf, first: leaf.order })
    for (const child of node.children) {
      const first = this.leaves(child).find((leaf) => this.inRange(leaf, range))
      if (first) parts.push({ element: child, first: first.order })
    }
    return parts.sort((a, b) => a.first - b.first)
  }

  /** Down through wrappers that hold one part, to the element whose parts are the content. */
  private unwrap(element: number, range: readonly [number, number]): number {
    let at = element
    for (let guard = 0; guard < 64; guard += 1) {
      const parts = this.parts(at, range)
      if (parts.length !== 1 || !isElementPart(parts[0] as Part)) return at
      at = (parts[0] as { element: number }).element
    }
    return at
  }

  private style(element: number): SiteImportComputedStyle {
    return this.styles.of(element)
  }

  private block(leaf: Leaf): SiteImportBlock | undefined {
    return this.blocks[leaf.order]
  }

  /*---------------- sections ----------------*/

  sections(): SiteImportLayoutSection[] {
    const root = this.structure.main >= 0 ? this.structure.main : this.structure.body
    const all: readonly [number, number] = [-1, Number.POSITIVE_INFINITY]
    const rootLeaves = root >= 0 ? this.leaves(root) : this.elements.filter((element) => element.parent < 0).flatMap((element) => this.leaves(element.id))
    if (!rootLeaves.length) return []
    const container = root >= 0 ? this.unwrap(root, all) : -1
    const parts = container >= 0 ? this.parts(container, all) : []
    const elementParts = parts.filter(isElementPart)
    const landmarks = elementParts.filter((part) => this.isLandmark(part.element))
    let cuts: Cut[] = []
    if (elementParts.length >= 2 && landmarks.length >= Math.max(2, Math.ceil(elementParts.length / 2))) {
      // A container of its own among the landmarks (a post's article column) is a section too; a stray line joins the next.
      cuts = this.cutsAt(parts, (part) => this.isLandmark(part.element) || this.holdsHeading(part.element) || this.lineCount(part.element) >= 3, 'landmark')
    } else if (elementParts.length >= 2 && this.containersHoldSections(elementParts)) {
      cuts = this.cutsAt(parts, (part) => this.holdsHeading(part.element), 'container')
    }
    if (cuts.length < 2) cuts = this.headingCuts(rootLeaves)
    const sections: SiteImportLayoutSection[] = []
    for (const cut of cuts.slice(0, AI_SITE_IMPORT_MAX_SECTIONS * 2)) {
      const section = this.section(cut, container, sections.length)
      if (section) sections.push(section)
    }
    this.markHero(sections)
    return this.capSections(sections)
  }

  /** At most `AI_SITE_IMPORT_MAX_SECTIONS`: the last holds whatever follows. */
  private capSections(sections: SiteImportLayoutSection[]): SiteImportLayoutSection[] {
    if (sections.length <= AI_SITE_IMPORT_MAX_SECTIONS) return sections
    const kept = sections.slice(0, AI_SITE_IMPORT_MAX_SECTIONS)
    const last = kept[kept.length - 1] as SiteImportLayoutSection
    for (const extra of sections.slice(AI_SITE_IMPORT_MAX_SECTIONS)) {
      last.nodes.push(...extra.nodes)
      last.lines.push(...extra.lines)
    }
    return kept
  }

  private isLandmark(element: number): boolean {
    const node = this.elements[element]
    if (!node) return false
    if (LANDMARK_TAGS.has(node.tag)) return true
    if (node.attrs.role === 'region' || (node.attrs.label && /^(?:div|section)$/.test(node.tag))) return true
    return SECTION_CLASS.test(node.attrs.class ?? '')
  }

  private lineCount(element: number): number {
    return this.leaves(element).filter((leaf) => leaf.kind === 'line').length
  }

  private holdsHeading(element: number): boolean {
    return this.leaves(element).some((leaf) => {
      const block = this.block(leaf)
      return block?.kind === 'heading' && block.level <= 3
    })
  }

  /** Containers of their own, most of them holding a heading: a page builder's sections without the tag. */
  private containersHoldSections(parts: Array<{ element: number }>): boolean {
    const containers = parts.filter((part) => !/^(?:h[1-6]|p|ul|ol|li|a|img|span|strong|em|button|blockquote|figure|picture)$/.test(this.elements[part.element]?.tag ?? ''))
    if (containers.length < parts.length * 0.8) return false
    return containers.filter((part) => this.holdsHeading(part.element)).length >= Math.max(2, Math.ceil(containers.length * 0.6))
  }

  /** Sections at the parts `starts` picks; loose parts between them join the next one, or the last. */
  private cutsAt(parts: Part[], starts: (part: { element: number }) => boolean, from: SiteImportLayoutSection['from']): Cut[] {
    const cuts: Cut[] = []
    let pendingFrom: number | null = null
    for (const part of parts) {
      if (isElementPart(part) && starts(part)) {
        const leaves = this.leaves(part.element)
        const lo = Math.min(pendingFrom ?? Number.POSITIVE_INFINITY, (leaves[0] as Leaf).order)
        cuts.push({ element: pendingFrom === null ? part.element : null, anchor: part.element, range: [lo, (leaves[leaves.length - 1] as Leaf).order + 0.75], from })
        pendingFrom = null
      } else {
        pendingFrom = pendingFrom ?? part.first
      }
    }
    if (pendingFrom !== null) {
      const last = cuts[cuts.length - 1]
      if (last) {
        last.range[1] = Number.POSITIVE_INFINITY
        last.element = null
      } else cuts.push({ element: null, anchor: null, range: [pendingFrom, Number.POSITIVE_INFINITY], from })
    }
    // Ranges meet, so nothing between two sections is lost.
    for (let index = 1; index < cuts.length; index += 1) (cuts[index - 1] as Cut).range[1] = (cuts[index] as Cut).range[0]
    if (cuts[0]) {
      // Loose lines before the first section open it.
      if (cuts[0].range[0] > (parts[0]?.first ?? 0)) cuts[0].element = null
      cuts[0].range[0] = -1
    }
    if (cuts.length) (cuts[cuts.length - 1] as Cut).range[1] = Number.POSITIVE_INFINITY
    return cuts
  }

  /** Sections at the page's `h1` and `h2`, each opened by the eyebrow just above its heading. */
  private headingCuts(leaves: Leaf[]): Cut[] {
    const starts: number[] = []
    leaves.forEach((leaf, index) => {
      const block = this.block(leaf)
      if (block?.kind !== 'heading' || block.level > 2) return
      let at = index
      const before = leaves[index - 1]
      const previous = before ? this.block(before) : undefined
      if (before && previous?.kind === 'paragraph' && this.looksLikeEyebrow(before, previous.text)) at = index - 1
      const order = (leaves[at] as Leaf).order
      if (!starts.length || order > (starts[starts.length - 1] as number)) starts.push(order)
    })
    if (!starts.length || starts[0] !== (leaves[0] as Leaf).order) starts.unshift(-1)
    return starts.map((start, index) => ({
      element: null,
      anchor: null,
      range: [index === 0 ? -1 : start, starts[index + 1] ?? Number.POSITIVE_INFINITY] as [number, number],
      from: 'heading' as const,
    }))
  }

  private section(cut: Cut, container: number, index: number): SiteImportLayoutSection | null {
    const { element, range, from } = cut
    const scope = element ?? container
    const nodes = scope >= 0 ? this.read(scope, range) : this.readLeaves(range)
    const lines = this.linesOf(nodes)
    if (!lines.length && !nodes.some((node) => node.kind === 'icon' || node.kind === 'form')) return null
    const name = this.nameOf(cut.anchor, lines, index)
    const band = cut.anchor !== null ? this.bandOf(cut.anchor, false) : this.bandOf(container, true)
    return {
      name,
      from,
      band: band.band,
      background: band.background,
      ...(band.backdrop ? { backdrop: band.backdrop } : {}),
      align: this.alignOf(scope, lines),
      nodes,
      lines,
    }
  }

  /** Lines with no container to read them through: one after another. */
  private readLeaves(range: [number, number]): SiteImportLayoutNode[] {
    const leaves = this.elements.filter((element) => element.parent < 0).flatMap((element) => this.leaves(element.id))
    return leaves.filter((leaf) => this.inRange(leaf, range)).map((leaf) => this.leafNode(leaf))
  }

  private nameOf(element: number | null, lines: SiteImportLineRef[], index: number): string {
    const label = element !== null ? this.elements[element]?.attrs.label : undefined
    if (label) return siteImportLabel(label)
    const mainBlocks = this.mainBlocks()
    const heading =
      lines.map((ref) => mainBlocks[ref]).find((block) => block?.kind === 'heading' && block.level <= 2) ??
      lines.map((ref) => mainBlocks[ref]).find((block) => block?.kind === 'heading')
    const text = heading && heading.kind === 'heading' ? siteImportLabel(heading.text) : ''
    if (text) return text
    const first = lines.map((ref) => mainBlocks[ref]).find((block) => block && block.kind !== 'image')
    const line = first && first.kind !== 'image' && first.text.length <= 60 ? siteImportLabel(first.text) : ''
    return line || `Section ${index + 1}`
  }

  private mainBlocksMemo: SiteImportBlock[] | null = null
  private mainBlocks(): SiteImportBlock[] {
    this.mainBlocksMemo ??= this.blocks.filter((block) => block.region === 'main')
    return this.mainBlocksMemo
  }

  /*---------------- bands ----------------*/

  private bandOf(element: number, inherited: boolean): { band: SiteImportBand; background: string | null; backdrop?: SiteImportLayoutSection['backdrop'] } {
    // The section's own background, else the one wrapper inside it that covers it.
    const chain: number[] = []
    if (!inherited) {
      let at = element
      for (let depth = 0; depth < 4 && at >= 0; depth += 1) {
        chain.push(at)
        const children = (this.elements[at]?.children ?? []).filter((child) => this.leaves(child).length)
        if (children.length !== 1) break
        at = children[0] as number
      }
    }
    for (const at of chain) {
      const found = this.backgroundBand(at)
      if (found) return found
    }
    // None of its own: the page's, under it.
    for (let at = inherited ? element : (this.elements[element]?.parent ?? -1); at >= 0; at = this.elements[at]?.parent ?? -1) {
      const found = this.backgroundBand(at)
      if (found) return found
    }
    return this.backgroundBand(-2) ?? { band: 'plain', background: null }
  }

  private backgroundBand(element: number): { band: SiteImportBand; background: string | null; backdrop?: SiteImportLayoutSection['backdrop'] } | null {
    const style = this.style(element)
    const background = siteImportBackgroundOf(style)
    const hex = background.color && background.color.a >= 0.5 ? siteImportHex(background.color) : null
    if (background.image && !/\.svg(?:$|\?)/i.test(background.image)) {
      return { band: 'dark', background: hex, backdrop: { kind: 'picture', url: background.image } }
    }
    if (background.gradient) {
      const stops = background.gradient.filter((stop) => stop.a > 0.1)
      const light = stops.length ? stops.reduce((sum, stop) => sum + siteImportLuminance(stop), 0) / stops.length : 1
      return { band: light < 0.55 ? 'dark' : 'soft', background: hex, backdrop: { kind: 'gradient' } }
    }
    if (background.color && background.color.a >= 0.5) return { band: siteImportBandOfColor(background.color), background: hex }
    const theme = this.elements[element]?.attrs.theme
    if (theme) {
      if (/^(?:dark|black)/.test(theme)) return { band: 'dark', background: null }
      if (/^bright/.test(theme)) return { band: 'brand', background: null }
      if (/^light/.test(theme)) return { band: 'soft', background: null }
      if (/^white/.test(theme)) return { band: 'plain', background: null }
    }
    return null
  }

  private alignOf(scope: number, lines: SiteImportLineRef[]): 'start' | 'center' {
    const mainBlocks = this.mainBlocks()
    const heading = lines.find((ref) => mainBlocks[ref]?.kind === 'heading')
    if (heading === undefined || scope < 0) return 'start'
    const leaf = this.leaves(scope).find((entry) => entry.kind === 'line' && entry.ref === heading)
    if (!leaf) return 'start'
    return this.style(leaf.element).get('text-align') === 'center' ? 'center' : 'start'
  }

  /*---------------- reading a container ----------------*/

  private read(element: number, range: readonly [number, number]): SiteImportLayoutNode[] {
    const node = this.elements[element]
    if (!node) return []
    if (node.tag === 'table') {
      const table = this.table(element, range)
      if (table) return [table]
    }
    const parts = this.parts(element, range)
    if (!parts.length) return []
    if (parts.length === 1) {
      const only = parts[0] as Part
      return isElementPart(only) ? this.read(only.element, range) : [this.leafNode(only.leaf)]
    }
    const strips = this.tabStrips().get(element)
    if (strips) return this.readTabs(element, strips, range)
    const table = this.gridTable(element, parts, range)
    if (table) return [table]
    const runs = this.groupRuns(element, parts, range)
    const elementParts = parts.filter(isElementPart)
    // Items built alike are a group, a heading over them included; only a container of unlike parts is a row of columns.
    if (!runs.length && elementParts.length >= 2 && this.isRow(element) && this.rowWorthy(parts, range)) {
      return [this.row(element, parts, range)]
    }
    const out: SiteImportLayoutNode[] = []
    for (let index = 0; index < parts.length; ) {
      const run = runs.find((entry) => entry.start === index)
      if (run) {
        out.push(this.group(element, parts.slice(run.start, run.end) as Array<{ element: number; first: number }>, range))
        index = run.end
        continue
      }
      const part = parts[index] as Part
      if (isElementPart(part)) out.push(...this.read(part.element, range))
      else out.push(this.leafNode(part.leaf))
      index += 1
    }
    return out
  }

  private leafNode(leaf: Leaf): SiteImportLayoutNode {
    if (leaf.kind === 'icon') return { kind: 'icon', icon: leaf.ref }
    if (leaf.kind === 'form') return { kind: 'form', form: leaf.ref }
    const block = this.block(leaf)
    if (block?.kind === 'image') {
      const wrap = this.wrapperOf(leaf.element, ['a', 'button'], 4)
      const href = wrap !== null && this.elements[wrap]?.tag === 'a' ? this.anchorHref(wrap) : null
      return { kind: 'picture', line: leaf.ref, ...(href ? { href } : {}), ...(wrap !== null && this.elements[wrap]?.tag === 'button' ? { button: true as const } : {}) }
    }
    const button = this.buttonStyle(leaf)
    const role = button ? undefined : this.roleOf(leaf)
    return { kind: 'line', line: leaf.ref, ...(role ? { role } : {}), ...(button ? { button } : {}) }
  }

  /** The nearest element of these tags at or above `element`, within `depth` levels. */
  private wrapperOf(element: number, tags: readonly string[], depth: number): number | null {
    let at = element
    for (let level = 0; level <= depth && at >= 0; level += 1) {
      const node = this.elements[at]
      if (!node) return null
      if (tags.includes(node.tag)) return at
      at = node.parent
    }
    return null
  }

  private anchorHref(element: number): string | null {
    const anchor = this.structure.anchors.find((entry) => entry.element === element)
    return anchor?.href ?? null
  }

  /** How the source draws a line as a button, when it does. */
  private buttonStyle(leaf: Leaf): SiteImportButtonStyle | undefined {
    const block = this.block(leaf)
    if (!block || (block.kind !== 'link' && block.kind !== 'paragraph')) return undefined
    const host = this.wrapperOf(leaf.element, block.kind === 'link' ? ['a'] : ['button'], 3)
    if (host === null) return undefined
    const node = this.elements[host] as SiteImportElement
    if (node.attrs.role === 'tab') return undefined
    return siteImportButtonStyleOf(node, this.style(host), this.backgroundUnder(host)) ?? undefined
  }

  /** The background an element is drawn on: its nearest ancestor's. */
  private backgroundUnder(element: number): string | null {
    for (let at = this.elements[element]?.parent ?? -1; at >= 0; at = this.elements[at]?.parent ?? -1) {
      const color = siteImportBackgroundOf(this.style(at)).color
      if (color && color.a >= 0.5) return siteImportHex(color)
    }
    const page = siteImportBackgroundOf(this.style(-2)).color
    return page ? siteImportHex(page) : '#ffffff'
  }

  /** An eyebrow, a lede or a note, where the source's styling says so. */
  private roleOf(leaf: Leaf): 'eyebrow' | 'lede' | 'note' | undefined {
    const block = this.block(leaf)
    if (block?.kind !== 'paragraph') return undefined
    const style = this.style(leaf.element)
    if (this.looksLikeEyebrow(leaf, block.text)) return 'eyebrow'
    const size = siteImportFontSizePx(style)
    if (size !== null && size >= this.bodySize * 1.12 && block.text.length > 40) return 'lede'
    if (size !== null && size <= this.bodySize * 0.875 && block.text.length <= 160) return 'note'
    return undefined
  }

  private looksLikeEyebrow(leaf: Leaf, text: string): boolean {
    const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
    if (text.length > 60 || words.length > 10) return false
    const style = this.style(leaf.element)
    const letters = text.replace(/[^\p{L}]/gu, '')
    const caps = letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
    return caps || style.get('text-transform') === 'uppercase'
  }

  /*---------------- rows ----------------*/

  private isRow(element: number): boolean {
    const node = this.elements[element]
    if (!node) return false
    if (node.tag === 'tr') return true
    const classes = node.attrs.class ?? ''
    if (/\bMuiGrid-container\b|(?:^|\s)row(?:\s|$)|\bcolumns\b|wp-block-columns|elementor-row|e-con-inner|sqs-row/.test(classes)) return true
    const style = this.style(element)
    const display = style.get('display') ?? ''
    if (/\bgrid\b/.test(display)) {
      const columns = siteImportGridColumns(style.get('grid-template-columns'))
      return !!columns && columns.length >= 2
    }
    if (/\bflex\b/.test(display)) return !/column/.test(style.get('flex-direction') ?? 'row')
    return false
  }

  /** A row is columns of content, not a line of buttons or links. */
  private rowWorthy(parts: Part[], range: readonly [number, number]): boolean {
    const substantial = parts.filter((part) => {
      if (!isElementPart(part)) return false
      return this.leaves(part.element).some((leaf) => {
        if (!this.inRange(leaf, range) || leaf.kind !== 'line') return false
        const block = this.block(leaf)
        return block?.kind === 'image' || block?.kind === 'heading' || ((block?.kind === 'paragraph' || block?.kind === 'list-item' || block?.kind === 'quote') && !this.buttonStyle(leaf))
      })
    })
    return substantial.length >= 2
  }

  private row(element: number, parts: Part[], range: readonly [number, number]): SiteImportLayoutNode {
    const cells: SiteImportLayoutNode[][] = parts.map((part) => (isElementPart(part) ? this.read(part.element, range) : [this.leafNode(part.leaf)]))
    const weights = this.weightsOf(element, parts)
    // Cells that are each one group of one kind are one group in columns.
    const groups = cells.map((cell) => (cell.length === 1 && cell[0]?.kind === 'group' ? (cell[0] as SiteImportLayoutGroup) : null))
    if (cells.length >= 2 && groups.every((group) => group && group.group === groups[0]?.group && group.columns === 1)) {
      const first = groups[0] as SiteImportLayoutGroup
      return { kind: 'group', group: first.group, columns: cells.length, boxed: groups.every((group) => group?.boxed), items: groups.flatMap((group) => group?.items ?? []) }
    }
    return { kind: 'row', cols: siteImportTwelfths(weights), cells }
  }

  /** The columns' relative widths: the grid template, the cells' own sizes, else equal shares. */
  private weightsOf(element: number, parts: Part[]): number[] {
    const count = parts.length
    const template = siteImportGridColumns(this.style(element).get('grid-template-columns'))
    if (template && template.length >= count) return template.slice(0, count)
    const sized = parts.map((part) => (isElementPart(part) ? this.cellSize(part.element) : null))
    if (sized.every((size) => size !== null)) return sized as number[]
    return parts.map(() => 1)
  }

  /** A cell's size: a framework's column class, its width share or its flex grow. */
  private cellSize(element: number): number | null {
    const classes = this.elements[element]?.attrs.class ?? ''
    let best: { rank: number; size: number } | null = null
    for (const match of classes.matchAll(MUI_GRID_SIZE)) {
      const rank = BREAKPOINT_RANK[match[1] as string] ?? 0
      if (rank <= 3 && (!best || rank >= best.rank)) best = { rank, size: Number(match[2]) }
    }
    for (const match of classes.matchAll(BOOTSTRAP_COL)) {
      const rank = match[1] ? (BREAKPOINT_RANK[match[1]] ?? 0) : 0
      if (rank <= 3 && (!best || rank >= best.rank)) best = { rank, size: Number(match[2]) }
    }
    if (best) return best.size
    const style = this.style(element)
    for (const property of ['flex-basis', 'width', 'max-width']) {
      const percent = /^(-?[\d.]+)%$/.exec(style.get(property)?.trim() ?? '')
      if (percent) return Number(percent[1])
    }
    const grow = /^(\d+(?:\.\d+)?)(?:\s|$)/.exec(style.get('flex')?.trim() ?? style.get('flex-grow')?.trim() ?? '')
    if (grow && Number(grow[1]) > 0) return Number(grow[1])
    return null
  }

  /*---------------- groups ----------------*/

  private signature(element: number, range: readonly [number, number]): string {
    const at = this.unwrap(element, range)
    return this.parts(at, range)
      .map((part) => (isElementPart(part) ? (this.elements[part.element]?.tag ?? '') : part.leaf.kind !== 'line' ? part.leaf.kind : (this.block(part.leaf)?.kind ?? '')))
      .join(',')
  }

  /** The kinds of an item's leaves in order, repeats folded: a looser likeness. */
  private kinds(element: number, range: readonly [number, number]): string {
    const out: string[] = []
    for (const leaf of this.leaves(element)) {
      if (!this.inRange(leaf, range)) continue
      const kind = leaf.kind !== 'line' ? leaf.kind : (this.block(leaf)?.kind ?? '')
      if (out[out.length - 1] !== kind) out.push(kind)
    }
    return out.join(',')
  }

  /** Runs of three or more siblings built alike (two, when a row draws them as boxes). */
  private groupRuns(element: number, parts: Part[], range: readonly [number, number]): GroupRun[] {
    // A strip of short words side by side (a row of site kinds, a post's tags) is one group.
    if (parts.length >= 4 && this.isRow(element) && parts.every((part) => isElementPart(part) && this.isChip(part.element, range))) return [{ start: 0, end: parts.length }]
    const keys = parts.map((part) => (isElementPart(part) && this.couldBeItem(part.element, range) ? `${this.elements[part.element]?.tag}|${this.signature(part.element, range)}` : null))
    const loose = parts.map((part) => (isElementPart(part) ? this.kinds(part.element, range) : null))
    const runs: GroupRun[] = []
    const row = this.isRow(element)
    for (let index = 0; index < parts.length; ) {
      const key = keys[index]
      const kind = loose[index]
      if (key === null || key === undefined) {
        index += 1
        continue
      }
      let end = index + 1
      while (end < parts.length && keys[end] !== null && (keys[end] === key || (loose[end] === kind && !!kind && kind.includes(',')))) end += 1
      const count = end - index
      const boxed = count === 2 && row && parts.slice(index, end).every((part) => isElementPart(part) && this.boxed(part.element))
      // One element alone (a single list item) is not a group; a heading leaf is never an item.
      const items = parts.slice(index, end) as Array<{ element: number }>
      const headings = items.every((part) => /^h[1-6]$/.test(this.elements[part.element]?.tag ?? ''))
      if ((count >= 3 || boxed) && !headings) {
        runs.push({ start: index, end })
        index = end
      } else index += 1
    }
    return runs
  }

  /**
   * Whether an element can be one item of a group: a list item, a disclosure,
   * a figure, a picture, or a container of more than one thing. A run of
   * plain paragraphs is prose, never a group.
   */
  private couldBeItem(element: number, range: readonly [number, number]): boolean {
    const node = this.elements[element]
    if (!node) return false
    if (/^(?:li|dt|dd|details|figure|article)$/.test(node.tag)) return true
    const leaves = this.leaves(element).filter((leaf) => this.inRange(leaf, range))
    if (leaves.length && leaves.every((leaf) => leaf.kind === 'line' && this.block(leaf)?.kind === 'image')) return true
    return this.parts(this.unwrap(element, range), range).length >= 2
  }

  /** One short line and nothing else: a chip, a tag, a strip's entry. */
  private isChip(element: number, range: readonly [number, number]): boolean {
    const leaves = this.leaves(element).filter((leaf) => this.inRange(leaf, range))
    const lines = leaves.filter((leaf) => leaf.kind === 'line')
    if (lines.length !== 1) return false
    const block = this.block(lines[0] as Leaf)
    return !!block && block.kind !== 'image' && block.kind !== 'heading' && block.text.length <= 40
  }

  private boxed(element: number): boolean {
    let at = element
    for (let depth = 0; depth < 3 && at >= 0; depth += 1) {
      const style = this.style(at)
      if (siteImportHasBorder(style) || siteImportHasShadow(style)) return true
      const fill = siteImportBackgroundOf(style).color
      if (fill && fill.a >= 0.5 && siteImportHex(fill) !== this.backgroundUnder(at)) return true
      const children = (this.elements[at]?.children ?? []).filter((child) => this.leaves(child).length)
      if (children.length !== 1) break
      at = children[0] as number
    }
    return false
  }

  private group(container: number, parts: Array<{ element: number; first: number }>, range: readonly [number, number]): SiteImportLayoutGroup {
    const items = parts.map((part) => this.item(part.element, range))
    const chips = parts.length >= 4 && this.isRow(container) && parts.every((part) => this.isChip(part.element, range))
    const kind = chips ? 'logos' : this.groupKind(parts.map((part) => part.element), items, range)
    const columns = this.columnsOf(container, parts)
    const boxed = parts.length > 0 && parts.filter((part) => this.boxed(part.element)).length >= Math.ceil(parts.length / 2)
    // A step's number and a stat's figure lead their item.
    if (kind === 'steps' || kind === 'stats') {
      for (const item of items) {
        const lead = item.title ?? item.text?.[0]
        const text = lead !== undefined ? this.lineText(lead) : ''
        if (lead !== undefined && (kind === 'steps' ? STEP_NUMBER.test(text.trim()) : FIGURE.test(text.trim()) || text.length <= 14)) {
          item.figure = lead
          if (item.title === lead) {
            delete item.title
            const next = item.text?.find((ref) => this.lineText(ref).length <= 80)
            if (next !== undefined && (item.text?.length ?? 0) > 1) {
              item.title = next
              item.text = item.text?.filter((ref) => ref !== next)
            }
          } else item.text = item.text?.filter((ref) => ref !== lead)
          if (item.text && !item.text.length) delete item.text
        }
      }
    }
    if (kind === 'faq') {
      for (const item of items) {
        const question = item.lines[0]
        if (question === undefined || item.title === question) continue
        // The question names it; whatever named it before is its words.
        if (item.title !== undefined) item.text = [item.title, ...(item.text ?? [])].sort((a, b) => item.lines.indexOf(a) - item.lines.indexOf(b))
        item.title = question
        item.text = item.text?.filter((ref) => ref !== question)
        item.link = item.link?.filter((ref) => ref !== question)
        if (item.text && !item.text.length) delete item.text
        if (item.link && !item.link.length) delete item.link
      }
    }
    if (kind === 'pricing') {
      for (const item of items) {
        const price = item.lines.find((ref) => PRICE.test(this.lineText(ref)) && this.lineText(ref).length <= 24)
        if (price === undefined || item.title === price) continue
        item.figure = price
        item.text = item.text?.filter((ref) => ref !== price)
        item.list = item.list?.filter((ref) => ref !== price)
        if (item.text && !item.text.length) delete item.text
        if (item.list && !item.list.length) delete item.list
      }
    }
    return { kind: 'group', group: kind, columns, boxed, items }
  }

  private lineText(ref: SiteImportLineRef): string {
    const block = this.mainBlocks()[ref]
    if (!block) return ''
    return block.kind === 'image' ? block.alt : block.text
  }

  /** One item's lines, each in exactly one of its parts. */
  private item(element: number, range: readonly [number, number]): SiteImportLayoutItem {
    const leaves = this.leaves(element).filter((leaf) => this.inRange(leaf, range))
    const item: SiteImportLayoutItem = { lines: [] }
    const lines = leaves.filter((leaf) => leaf.kind === 'line')
    item.lines = lines.map((leaf) => leaf.ref)
    const firstLine = lines[0]
    const leadIcon = leaves.find((leaf) => leaf.kind === 'icon' && (!firstLine || leaf.order < firstLine.order + 1))
    if (leadIcon) item.icon = leadIcon.ref
    // Bullet points: list items, and lines that sit in a repeated run inside the item (a plan's features).
    const listed = new Set<number>()
    const own = this.elements[element]?.tag === 'li'
    if (!own) for (const leaf of lines) if (this.block(leaf)?.kind === 'list-item') listed.add(leaf.ref)
    const inner = this.unwrap(element, range)
    for (const members of this.listRuns(inner, range, 4)) {
      for (const member of members) for (const leaf of this.leaves(member)) if (leaf.kind === 'line' && this.inRange(leaf, range)) listed.add(leaf.ref)
      const marks = members.map((member) => this.leaves(member).find((leaf) => leaf.kind === 'icon')?.ref)
      if (marks.length && marks.every((mark) => mark !== undefined && mark === marks[0])) item.listIcon = marks[0] as number
    }
    if (item.icon !== undefined && item.icon === item.listIcon && !lines.length) delete item.icon
    const rest = lines.filter((leaf) => !listed.has(leaf.ref))
    const image = rest.find((leaf) => this.block(leaf)?.kind === 'image')
    if (image) item.image = image.ref
    const words = rest.filter((leaf) => leaf !== image)
    // Its own call to action: the links and buttons that close it.
    const trailing: Leaf[] = []
    for (let index = words.length - 1; index >= 0; index -= 1) {
      const leaf = words[index] as Leaf
      const block = this.block(leaf)
      if (block?.kind === 'link' || this.buttonStyle(leaf)) trailing.unshift(leaf)
      else break
    }
    const body = words.slice(0, words.length - trailing.length)
    let title: Leaf | undefined = body.find((leaf) => this.block(leaf)?.kind === 'heading')
    if (!title) {
      const first = body[0]
      const block = first ? this.block(first) : undefined
      if (first && block?.kind === 'link' && body.length >= 2) title = first
      else if (first && block && block.kind !== 'image' && block.text.length <= 80 && block.text.split(/\s+/).length <= 12 && body.length >= 2) title = first
    }
    if (!title && trailing.length === words.length && trailing.length >= 1 && words.length >= 2) {
      // Only links: the first names the item.
      title = trailing.shift()
    }
    if (title) item.title = title.ref
    const text = body.filter((leaf) => leaf !== title).map((leaf) => leaf.ref)
    if (text.length) item.text = text
    if (listed.size) item.list = lines.filter((leaf) => listed.has(leaf.ref)).map((leaf) => leaf.ref)
    if (trailing.length) item.link = trailing.map((leaf) => leaf.ref)
    const titleBlock = title ? this.block(title) : undefined
    if (titleBlock?.kind === 'link') item.to = titleBlock.href
    else if (trailing.length === 1) {
      const only = this.block(trailing[0] as Leaf)
      if (only?.kind === 'link') item.to = only.href
    } else {
      const wrap = this.wrapperOf(element, ['a'], 0)
      const href = wrap !== null ? this.anchorHref(wrap) : null
      if (href) item.to = href
    }
    return item
  }

  /**
   * Runs of three or more one-line entries built alike anywhere inside an
   * item (a plan's features, each a check mark and a line), each run its
   * entries' elements. The item itself is never one of them.
   */
  private listRuns(element: number, range: readonly [number, number], depth: number, root = true): number[][] {
    const out: number[][] = []
    const parts = this.parts(element, range)
    const taken = new Set<number>()
    for (const run of this.groupRuns(element, parts, range)) {
      const members = (parts.slice(run.start, run.end) as Array<{ element: number }>).map((part) => part.element)
      const oneLine = members.every((member) => this.leaves(member).filter((leaf) => leaf.kind === 'line' && this.inRange(leaf, range)).length === 1)
      if (!oneLine || (root && members.length === parts.length)) continue
      out.push(members)
      members.forEach((member) => taken.add(member))
    }
    if (depth <= 0) return out
    for (const part of parts) if (isElementPart(part) && !taken.has(part.element)) out.push(...this.listRuns(part.element, range, depth - 1, false))
    return out
  }

  private groupKind(elements: number[], items: SiteImportLayoutItem[], range: readonly [number, number]): SiteImportGroupKind {
    const count = items.length
    const share = (test: (item: SiteImportLayoutItem, index: number) => boolean) => items.filter(test).length / Math.max(1, count)
    const first = (item: SiteImportLayoutItem) => this.lineText(item.lines[0] ?? -1).trim()
    const blockKinds = (item: SiteImportLayoutItem) => item.lines.map((ref) => this.mainBlocks()[ref]?.kind)
    if (elements.some((element) => this.elements[element]?.tag === 'details')) return 'faq'
    if (share((item) => item.lines.length === 0 || blockKinds(item).every((kind) => kind === 'image')) === 1 && items.some((item) => item.lines.length) && count >= 4) return 'logos'
    if (share((item) => blockKinds(item).includes('quote') || /^[“"«]/.test(first(item))) >= 0.6) return 'quotes'
    if (share((item) => item.lines.some((ref) => PRICE.test(this.lineText(ref)) && this.lineText(ref).length <= 24) && (item.lines.some((ref) => PERIOD.test(this.lineText(ref))) || !!item.link)) >= 0.6 && count >= 2) {
      return 'pricing'
    }
    if (share((item) => /\?\s*$/.test(first(item)) && item.lines.length >= 2) >= 0.6) return 'faq'
    if (share((item) => STEP_NUMBER.test(first(item)) && item.lines.length >= 2) >= 0.6) return 'steps'
    if (share((item) => item.lines.length >= 2 && item.lines.length <= 3 && first(item).length <= 14 && FIGURE.test(first(item))) >= 0.6) return 'stats'
    const visual = share((item) => item.icon !== undefined || item.image !== undefined)
    const titled = share((item) => item.title !== undefined && (item.text?.length ?? 0) > 0)
    const boxed = elements.filter((element) => this.boxed(element)).length >= Math.ceil(elements.length / 2)
    if ((visual >= 0.6 && titled >= 0.6) || (boxed && share((item) => item.lines.length >= 2) >= 0.6)) return 'cards'
    if (share((item) => item.lines.length === 1) >= 0.8) return 'list'
    if (titled >= 0.6) return 'cards'
    void range
    return 'text'
  }

  /** How many columns a group's items sit in on a wide screen. */
  private columnsOf(container: number, parts: Array<{ element: number }>): number {
    const count = parts.length
    const style = this.style(container)
    const display = style.get('display') ?? ''
    if (/\bgrid\b/.test(display)) {
      const template = siteImportGridColumns(style.get('grid-template-columns'))
      if (template) return Math.max(1, Math.min(count, template.length))
      return 1
    }
    const sizes = parts.map((part) => this.cellSize(part.element))
    const classes = this.elements[container]?.attrs.class ?? ''
    if (/\bMuiGrid-container\b|(?:^|\s)row(?:\s|$)/.test(classes) && sizes[0]) {
      return Math.max(1, Math.min(count, Math.round(12 / (sizes[0] as number))))
    }
    if (/\bflex\b/.test(display) && !/column/.test(style.get('flex-direction') ?? 'row')) {
      const width = sizes[0]
      if (width && width <= 100 && /^(-?[\d.]+)%$/.test(this.style(parts[0]?.element ?? -1).get('width') ?? '')) return Math.max(1, Math.round(100 / width))
      return Math.min(count, 4)
    }
    return 1
  }

  /*---------------- tables and tabs ----------------*/

  private table(element: number, range: readonly [number, number]): SiteImportLayoutTable | null {
    const rows: number[] = []
    const visit = (at: number) => {
      for (const child of this.elements[at]?.children ?? []) {
        const tag = this.elements[child]?.tag
        if (tag === 'tr') rows.push(child)
        else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') visit(child)
      }
    }
    visit(element)
    if (!rows.length) return null
    const out: SiteImportLineRef[][][] = rows.map((row) =>
      (this.elements[row]?.children ?? [])
        .filter((cell) => /^t[dh]$/.test(this.elements[cell]?.tag ?? ''))
        .map((cell) => this.refsIn(cell, range)),
    )
    const header =
      (this.elements[rows[0] as number]?.parent !== undefined && this.elements[this.elements[rows[0] as number]?.parent as number]?.tag === 'thead') ||
      (this.elements[rows[0] as number]?.children ?? []).every((cell) => this.elements[cell]?.tag === 'th')
    // A caption, or lines outside the rows, are not lost.
    return { kind: 'table', header, rows: out.filter((row) => row.some((cell) => cell.length)) }
  }

  private refsIn(element: number, range: readonly [number, number]): SiteImportLineRef[] {
    return this.leaves(element).filter((leaf) => leaf.kind === 'line' && this.inRange(leaf, range)).map((leaf) => leaf.ref)
  }

  /** Rows of short cells built alike, laid out as rows: a table drawn with a grid. */
  private gridTable(element: number, parts: Part[], range: readonly [number, number]): SiteImportLayoutTable | null {
    const rows = parts.filter(isElementPart).map((part) => part.element)
    if (rows.length < 3 || rows.length !== parts.length) return null
    const widths = rows.map((row) => (this.elements[row]?.children ?? []).length)
    const common = mode(widths)
    if (common < 2 || widths.filter((width) => width === common).length < rows.length * 0.8) return null
    if (common === 2 && rows.length < 4) return null
    if (!rows.every((row) => this.isRow(row))) return null
    const cells = rows.map((row) => (this.elements[row]?.children ?? []).map((cell) => this.refsIn(cell, range)))
    // Cells are short and flat: a value, not a card. Two-cell rows are a label and its value.
    const longest = common === 2 ? 60 : 120
    const flat = cells.every((row) => row.every((cell) => cell.length <= 2 && cell.every((ref) => this.lineText(ref).length <= longest && this.mainBlocks()[ref]?.kind !== 'image')))
    if (!flat) return null
    // A label and its value: both cells hold words (an icon beside a line is a list, not a table).
    if (common === 2 && cells.filter((row) => row.length === 2 && row.every((cell) => cell.length > 0)).length < rows.length * 0.8) return null
    // A comparison's first row names the columns over an empty corner.
    const first = cells[0] ?? []
    const header = common >= 3 && !(first[0]?.length) && first.slice(1).every((cell) => cell.length > 0)
    return { kind: 'table', header, rows: cells }
  }

  /** Tab strips, each read at the lowest element holding it and its panels. */
  private tabStrips(): Map<number, TabStrip[]> {
    if (this.tabsMemo) return this.tabsMemo
    const at = new Map<number, TabStrip[]>()
    const panels = this.elements.filter((node) => node.attrs.role === 'tabpanel' && node.region === 'main').map((node) => node.id)
    const taken = new Set<number>()
    for (const strip of this.elements) {
      if (strip.attrs.role !== 'tablist' || strip.region !== 'main') continue
      const tabs = this.findAll(strip.id, (node) => node.attrs.role === 'tab')
      if (tabs.length < 2) continue
      const found = tabs.map((tab) => {
        const attrs = this.elements[tab]?.attrs ?? {}
        const own = (id: string | undefined) => (id ? id.replace(/^tab-?/, '') : '')
        const panel = panels.find((candidate) => {
          if (taken.has(candidate)) return false
          const panelAttrs = this.elements[candidate]?.attrs ?? {}
          return (
            (!!attrs.controls && panelAttrs.id === attrs.controls) ||
            (!!attrs.id && panelAttrs.labelledby === attrs.id) ||
            (!!attrs.id && !!panelAttrs.id && own(attrs.id) === panelAttrs.id.replace(/^tabpanel-?/, ''))
          )
        })
        if (panel !== undefined) taken.add(panel)
        return panel ?? null
      })
      // Panels the tabs do not name: the ones after the strip, in order.
      const loose = panels.filter((panel) => !taken.has(panel) && panel > strip.id)
      const resolved = found.map((panel) => {
        if (panel !== null) return panel
        const next = loose.shift()
        if (next !== undefined) taken.add(next)
        return next ?? null
      })
      const members = [strip.id, ...resolved.filter((panel): panel is number => panel !== null)]
      const home = this.commonAncestor(members)
      if (home === null) continue
      const list = at.get(home) ?? []
      list.push({ strip: strip.id, tabs, panels: resolved })
      at.set(home, list)
    }
    this.tabsMemo = at
    return at
  }

  private tabsMemo: Map<number, TabStrip[]> | null = null

  private commonAncestor(elements: number[]): number | null {
    const chains = elements.map((element) => {
      const chain: number[] = []
      for (let at = element; at >= 0; at = this.elements[at]?.parent ?? -1) chain.unshift(at)
      return chain
    })
    let common: number | null = null
    for (let depth = 0; ; depth += 1) {
      const step = chains[0]?.[depth]
      if (step === undefined || !chains.every((chain) => chain[depth] === step)) break
      common = step
    }
    // A strip with no panels is read where it sits: its parent holds it.
    if (common !== null && elements.length === 1) common = this.elements[common]?.parent ?? null
    return common !== null && common >= 0 ? common : null
  }

  private readTabs(element: number, strips: TabStrip[], range: readonly [number, number]): SiteImportLayoutNode[] {
    const inside = new Set<number>()
    for (const strip of strips) for (const member of [strip.strip, ...strip.panels]) if (member !== null) for (const leaf of this.leaves(member)) inside.add(leaf.order)
    const outside = (nodes: SiteImportLayoutNode[]) =>
      siteImportFilterNodes(nodes, (ref) => {
        const leaf = this.leaves(element).find((entry) => entry.kind === 'line' && entry.ref === ref)
        return !leaf || !inside.has(leaf.order)
      })
    const out: SiteImportLayoutNode[] = []
    const drawn = new Set<TabStrip>()
    for (const part of this.parts(element, range)) {
      if (!isElementPart(part)) {
        if (!inside.has(part.leaf.order)) out.push(this.leafNode(part.leaf))
        continue
      }
      const strip = strips.find((entry) => this.contains(part.element, entry.strip))
      const panel = strips.some((entry) => entry.panels.some((member) => member !== null && this.contains(part.element, member)))
      if (strip || panel) {
        if (part.element !== strip?.strip && !strips.some((entry) => entry.panels.includes(part.element))) out.push(...outside(this.read(part.element, range)))
        if (strip && !drawn.has(strip)) {
          drawn.add(strip)
          out.push(this.tabsNode(strip, range))
        }
        continue
      }
      out.push(...this.read(part.element, range))
    }
    return out
  }

  private tabsNode(strip: TabStrip, range: readonly [number, number]): SiteImportLayoutTabs {
    return {
      kind: 'tabs',
      tabs: strip.tabs.map((tab, index) => {
        const node = this.elements[tab] as SiteImportElement
        const panel = strip.panels[index] ?? null
        const selected = /\b(?:Mui-selected|active|is-active|selected)\b/.test(node.attrs.class ?? '')
        return {
          label: this.refsIn(tab, range)[0] ?? null,
          ...(selected ? { selected: true as const } : {}),
          panel: panel !== null ? this.read(panel, range) : [],
        }
      }),
    }
  }

  private findRole(element: number, role: string, depth: number): number | null {
    const node = this.elements[element]
    if (!node) return null
    if (node.attrs.role === role) return element
    if (depth <= 0) return null
    for (const child of node.children) {
      const found = this.findRole(child, role, depth - 1)
      if (found !== null) return found
    }
    return null
  }

  private findAll(element: number, test: (node: SiteImportElement) => boolean): number[] {
    const out: number[] = []
    const visit = (at: number) => {
      const node = this.elements[at]
      if (!node) return
      if (test(node)) {
        out.push(at)
        return
      }
      for (const child of node.children) visit(child)
    }
    for (const child of this.elements[element]?.children ?? []) visit(child)
    return out
  }

  private contains(ancestor: number, element: number): boolean {
    for (let at = element; at >= 0; at = this.elements[at]?.parent ?? -1) if (at === ancestor) return true
    return false
  }

  /*---------------- the hero ----------------*/

  private markHero(sections: SiteImportLayoutSection[]): void {
    const mainBlocks = this.mainBlocks()
    const hero = sections.find((section) => section.lines.some((ref) => mainBlocks[ref]?.kind === 'heading' && (mainBlocks[ref] as { level: number }).level === 1))
    if (!hero) return
    let picture: SiteImportHeroPicture | null = null
    if (hero.backdrop?.kind === 'picture') picture = 'behind'
    else {
      const h1 = hero.lines.find((ref) => mainBlocks[ref]?.kind === 'heading' && (mainBlocks[ref] as { level: number }).level === 1) as number
      const image = hero.lines.find((ref) => mainBlocks[ref]?.kind === 'image')
      if (image !== undefined) {
        const beside = (nodes: SiteImportLayoutNode[]): boolean =>
          nodes.some((node) => {
            if (node.kind !== 'row') return false
            const cellOf = (ref: number) => node.cells.findIndex((cell) => this.linesOf(cell).includes(ref))
            const a = cellOf(h1)
            const b = cellOf(image)
            if (a >= 0 && b >= 0 && a !== b) return true
            return node.cells.some((cell) => beside(cell))
          })
        if (beside(hero.nodes)) picture = 'beside'
        else if (this.pictureBehind(image)) picture = 'behind'
        else picture = hero.lines.indexOf(image) > hero.lines.indexOf(h1) ? 'below' : 'above'
      }
    }
    hero.hero = { picture }
  }

  /** A picture laid over its section's whole area, behind the words. */
  private pictureBehind(ref: number): boolean {
    const element = this.elements.find((node) => node.blocks.some((index) => this.mainIndex[index] === ref))
    for (let at = element?.id ?? -1, depth = 0; at >= 0 && depth < 3; at = this.elements[at]?.parent ?? -1, depth += 1) {
      const position = this.style(at).get('position')
      if (position === 'absolute' || position === 'fixed') return true
    }
    return false
  }

  linesOf(nodes: readonly SiteImportLayoutNode[]): SiteImportLineRef[] {
    return siteImportLayoutLines(nodes)
  }
}

interface TabStrip {
  strip: number
  tabs: number[]
  /** Each tab's panel, `null` for one the source did not draw. */
  panels: Array<number | null>
}

interface GroupRun {
  start: number
  end: number
}

/** A section's stretch of the page: the element it is (`null` when it is read through its container), the element its name and band come from, and its leaves' range. */
interface Cut {
  element: number | null
  anchor: number | null
  range: [number, number]
  from: SiteImportLayoutSection['from']
}

function mode(values: readonly number[]): number {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0
}

/** A solid background's band: near white is the page, light or tinted is soft, a strong color is the brand's, dark is dark. */
export function siteImportBandOfColor(color: { r: number; g: number; b: number; a: number }): SiteImportBand {
  const light = siteImportLuminance(color)
  const saturation = siteImportSaturation(color)
  if (saturation > 0.45 && light >= 0.06 && light < 0.75) return 'brand'
  if (light < 0.3) return 'dark'
  if (light >= 0.95) return 'plain'
  return 'soft'
}

/**
 * How the source draws an `<a>` or `<button>` as a button, or `null` when it
 * draws it as a link: a framework's button class, a role, or a fill or a
 * border with room around the words.
 */
export function siteImportButtonStyleOf(element: SiteImportElement, style: SiteImportComputedStyle, under: string | null): SiteImportButtonStyle | null {
  const classes = element.attrs.class ?? ''
  const fill = siteImportBackgroundOf(style)
  const filled = (!!fill.color && fill.color.a >= 0.5 && siteImportHex(fill.color) !== under) || !!fill.gradient
  const bordered = siteImportHasBorder(style)
  const padded = ['padding', 'padding-left', 'padding-top'].some((property) => {
    const value = style.get(property)
    return !!value && /[1-9]/.test(value)
  })
  const classed = BUTTON_CLASS.test(classes) || element.attrs.role === 'button'
  if (!classed && !((filled || bordered) && padded)) return null
  if (TEXT_BUTTON_CLASS.test(classes)) return 'quiet'
  if (filled || FILLED_CLASS.test(classes)) return 'primary'
  if (bordered || OUTLINED_CLASS.test(classes)) return 'secondary'
  return 'quiet'
}

/*------------------------------------------
 * The look
 *-----------------------------------------*/

/** Families a Google Fonts stylesheet address loads: `family=Roboto+Flex:wght@400` is "Roboto Flex". */
export function siteImportGoogleFamilies(urls: readonly string[]): string[] {
  const families: string[] = []
  for (const raw of urls) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    if (url.hostname !== 'fonts.googleapis.com') continue
    for (const value of url.searchParams.getAll('family')) {
      for (const entry of value.split('|')) {
        const name = entry.split(':')[0]?.replace(/\+/g, ' ').trim()
        if (name && !families.includes(name)) families.push(name)
      }
    }
  }
  return families
}

/** The look facts of a page read with its structure, through its linked stylesheets' text. */
export function siteImportLookOf(page: Pick<SiteImportLayoutSource, 'structure'>, stylesheets: readonly string[] = []): SiteImportLookFacts | null {
  if (!page.structure) return null
  const css = siteImportCssOf([...page.structure.styles, ...stylesheets])
  return siteImportLookFacts(page.structure, siteImportStylesOf(page.structure, css), css.fontFaces)
}

/**
 * The look facts of a page's markup and the stylesheets it links (AGL-4106),
 * for the look pass, which reads the home page and its stylesheets itself.
 */
export function siteImportLookOfHtml(html: string, pageUrl: string, stylesheets: readonly string[] = []): SiteImportLookFacts | null {
  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    return null
  }
  const extract = extractSiteImportPage(html, pageUrl, (url) => url.origin === origin, { structure: true })
  return extract.structure ? siteImportLookOf({ structure: extract.structure }, stylesheets) : null
}

/**
 * What the source's look is made of (AGL-4106): its fonts, its page's
 * background and text, its filled buttons' fill, text and corners, its links'
 * color and its header's background.
 */
export function siteImportLookFacts(structure: SiteImportStructure, styles: SiteImportStyles, fontFaces: readonly string[] = []): SiteImportLookFacts {
  const { elements } = structure
  const body = structure.body >= 0 ? structure.body : -2
  const bodyStyle = styles.of(body)
  const hexOf = (value: string | undefined) => {
    const color = siteImportColorOf(value)
    return color && color.a >= 0.5 ? siteImportHex(color) : null
  }
  const imports = structure.styles.flatMap((css) => [...css.matchAll(/@import\s+(?:url\()?\s*["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s;]+)/gi)].map((match) => match[1] as string))
  const google = siteImportGoogleFamilies([...structure.stylesheets, ...imports])
  const bodyFamily = siteImportFontFamilies(bodyStyle.get('font-family'))[0] ?? siteImportFontFamilies(styles.of(-2).get('font-family'))[0] ?? null
  const heading = elements.find((element) => /^h[12]$/.test(element.tag) && element.region === 'main') ?? elements.find((element) => /^h[1-3]$/.test(element.tag))
  const headingFamily = heading ? (siteImportFontFamilies(styles.of(heading.id).get('font-family'))[0] ?? bodyFamily) : bodyFamily
  const known = (family: string | null) => (family && (google.includes(family) || fontFaces.includes(family) || !/^(?:arial|helvetica|helvetica neue|segoe ui|roboto fallback|times new roman|georgia|verdana)$/i.test(family)) ? family : null)
  const background = siteImportBackgroundOf(bodyStyle).color ?? siteImportBackgroundOf(styles.of(-2)).color
  // Buttons, the page's own and its header's: the most used fill.
  const fills = new Map<string, { count: number; text: string | null; radius: number[] }>()
  const linkColors = new Map<string, number>()
  for (const element of elements) {
    if (element.tag !== 'a' && element.tag !== 'button') continue
    if (element.region === 'footer') continue
    const style = styles.of(element.id)
    let under: string | null = null
    for (let at = element.parent; at >= 0; at = elements[at]?.parent ?? -1) {
      const color = siteImportBackgroundOf(styles.of(at)).color
      if (color && color.a >= 0.5) {
        under = siteImportHex(color)
        break
      }
    }
    const kind = siteImportButtonStyleOf(element, style, under ?? (background ? siteImportHex(background) : '#ffffff'))
    if (kind === 'primary') {
      const fill = siteImportBackgroundOf(style).color
      if (!fill) continue
      const hex = siteImportHex(fill)
      const entry = fills.get(hex) ?? { count: 0, text: hexOf(style.get('color')), radius: [] }
      entry.count += 1
      const radius = siteImportRadiusPx(style)
      if (radius !== null) entry.radius.push(radius)
      fills.set(hex, entry)
    } else if (!kind && element.tag === 'a' && element.region === 'main') {
      const color = hexOf(style.get('color'))
      if (color) linkColors.set(color, (linkColors.get(color) ?? 0) + 1)
    }
  }
  const topFill = [...fills.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  const radii = topFill?.[1].radius ?? []
  const text = hexOf(bodyStyle.get('color'))
  // The links' color: the most used one that is not the body text's.
  const link = [...linkColors.entries()].filter(([hex]) => hex !== text).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const header = elements.find((element) => element.tag === 'header' && element.region === 'header') ?? elements.find((element) => element.attrs.role === 'banner')
  let headerFill: string | null = null
  for (let at = header?.id ?? -1, depth = 0; at >= 0 && depth < 3; depth += 1) {
    const color = siteImportBackgroundOf(styles.of(at)).color
    if (color && color.a >= 0.5) {
      headerFill = siteImportHex(color)
      break
    }
    const children: number[] = elements[at]?.children ?? []
    at = children.length === 1 ? (children[0] as number) : -1
  }
  return {
    fonts: { body: known(bodyFamily), headings: known(headingFamily), google },
    background: background ? siteImportHex(background) : null,
    text,
    buttonFill: topFill?.[0] ?? null,
    buttonText: topFill?.[1].text ?? null,
    buttonRadius: radii.length ? (radii.sort((a, b) => a - b)[Math.floor(radii.length / 2)] as number) : null,
    link,
    header: headerFill,
  }
}

/** What a layout holds, counted (AGL-4106): the reader's side of a fidelity score. */
export interface SiteImportLayoutCounts {
  sections: number
  bands: SiteImportBand[]
  /** Rows of two or more columns. */
  rows: number
  /** Groups by kind, and the items in them. */
  groups: Partial<Record<SiteImportGroupKind, number>>
  items: Partial<Record<SiteImportGroupKind, number>>
  tables: number
  tabs: number
  pictures: number
  /** Icons drawn: a group item's lead icon, each bullet's mark, and icons standing alone. */
  icons: number
  /** Lines the source draws as buttons. */
  buttons: number
  forms: number
  /** Lines placed, each once. */
  lines: number
}

/** Counts a layout's sections, bands, rows, groups, pictures, icons and buttons. */
export function siteImportLayoutCounts(layout: SiteImportLayout, blocks: readonly SiteImportBlock[] = []): SiteImportLayoutCounts {
  const counts: SiteImportLayoutCounts = {
    sections: layout.sections.length,
    bands: layout.sections.map((section) => section.band),
    rows: 0,
    groups: {},
    items: {},
    tables: 0,
    tabs: 0,
    pictures: 0,
    icons: 0,
    buttons: 0,
    forms: 0,
    lines: 0,
  }
  const main = blocks.filter((block) => block.region === 'main')
  const isPicture = (ref: number) => main[ref]?.kind === 'image'
  const visit = (nodes: readonly SiteImportLayoutNode[]) => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'line':
          if (node.button) counts.buttons += 1
          break
        case 'picture':
          counts.pictures += 1
          break
        case 'icon':
          counts.icons += 1
          break
        case 'form':
          counts.forms += 1
          break
        case 'row':
          if (node.cells.length >= 2) counts.rows += 1
          node.cells.forEach(visit)
          break
        case 'group':
          counts.groups[node.group] = (counts.groups[node.group] ?? 0) + 1
          counts.items[node.group] = (counts.items[node.group] ?? 0) + node.items.length
          for (const item of node.items) {
            if (item.icon !== undefined) counts.icons += 1
            if (item.listIcon !== undefined) counts.icons += item.list?.length ?? 0
            if (item.image !== undefined || (main.length && item.lines.some(isPicture))) counts.pictures += 1
          }
          break
        case 'table':
          counts.tables += 1
          break
        case 'tabs':
          counts.tabs += 1
          for (const tab of node.tabs) visit(tab.panel)
          break
        default:
          break
      }
    }
  }
  for (const section of layout.sections) {
    visit(section.nodes)
    counts.lines += section.lines.length
  }
  return counts
}
