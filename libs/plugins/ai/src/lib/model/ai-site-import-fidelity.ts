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
 * A PAGE BROUGHT IN, SCORED AGAINST ITS SOURCE (AGL-4109).
 *
 * On 10/29 an import of aglyn.com shipped with every section flattened to one
 * column of lines and a header of page titles, and nothing measured it: the
 * specs checked that words came through, never how the page was laid out.
 * This scores a built page against what the reader read of its source
 * (`SiteImportLayout`, AGL-4106), with no model and no browser, over the
 * page's nodes as the compiler draws them or as Firestore stores them:
 *
 * - **The words**: every line of the source exactly once, as written, and
 *   none of the page's own. A score of words is 1 or the page is wrong.
 * - **The structure**: its sections and their bands; its rows of columns
 *   side by side; its groups by kind, each item its own element with its
 *   parts (an FAQ's question on an accordion, a card's link on the card);
 *   its tables, tab strips, pictures, icons, buttons as the source draws
 *   them, headings and forms.
 * - **The frame** (`siteImportFrameFidelity`): the header's top-level items
 *   in order, each menu's entries with their lines and icons, the buttons,
 *   the phone menu holding all of it, labels on one line; the footer's
 *   columns, links, profiles and facts.
 *
 * Every measure is anchored to the source's own words, never to how the
 * compiler names its elements: each line of the source is found on the
 * built page, and the structure is asked of the elements holding them (are
 * a group's thirteen items thirteen elements, or one stack of lines?). So
 * the same score reads a page compiled in a spec and a page stored on a live
 * site. The score is the lowest ratio of the structure; words are held apart
 * at exactly 1.
 *=========================================*/

import type { SiteImportBlock } from '../site-import/site-import-html'
import type {
  SiteImportBand,
  SiteImportButtonStyle,
  SiteImportFooter,
  SiteImportGroupKind,
  SiteImportLayout,
  SiteImportLayoutItem,
  SiteImportLayoutNode,
  SiteImportLayoutSection,
  SiteImportLineRef,
  SiteImportNavTree,
} from './ai-site-import'

/** The lowest score of structure a page brought in ships at (AGL-4109); words are held at exactly 1. */
export const SITE_IMPORT_FIDELITY_THRESHOLD = 0.9

/** A node of a page or a layout, as the compiler draws it or Firestore stores it, decoded. */
export interface SiteImportFidelityNode {
  componentId?: string
  props?: Record<string, unknown> | null
  sx?: Record<string, unknown> | null
  nodes?: readonly string[] | null
  parentId?: string | null
  interactions?: readonly unknown[] | null
}

/** A built page or layout: its nodes and the one they hang from. */
export interface SiteImportFidelityTree {
  rootId: string
  nodes: Readonly<Record<string, SiteImportFidelityNode>>
}

/** What the source had, what the built page kept of it, and the share kept. */
export interface SiteImportFidelityCount {
  source: number
  built: number
  ratio: number
}

/** The words of a page: every one of the source's, as written, exactly once, and none of its own. */
export interface SiteImportFidelityWords {
  /** Words the source's lines hold. */
  source: number
  /** Words the built page shows. */
  built: number
  /** The source's words the page does not show (counted as often as they are missing). */
  missing: number
  /** Words the page shows that are not the source's, or are shown more often than the source says them. */
  extra: number
  /** Words shown once each, over the larger of the two. */
  ratio: number
  /** A few of the missing and extra words, for a report. */
  examples: { missing: string[]; extra: string[] }
}

export interface SiteImportFidelityGroup {
  /** Groups of the kind kept whole: every item of them its own element, with its parts. */
  groups: SiteImportFidelityCount
  /** Items of the kind kept, each its own element with its parts. */
  items: SiteImportFidelityCount
}

/** A page brought in, scored against its source. */
export interface SiteImportPageFidelity {
  /** The lowest ratio of the structure: what the page ships on, at `SITE_IMPORT_FIDELITY_THRESHOLD` or above. */
  score: number
  /** The measure that set the score; `null` when every measure is whole. */
  lowest: string | null
  words: SiteImportFidelityWords
  sections: SiteImportFidelityCount
  /** Sections drawn in the source's band, in order. */
  bands: SiteImportFidelityCount & { read: SiteImportBand[]; drawn: SiteImportBand[] }
  /** The source's rows of two or more columns, set side by side on the page. */
  rows: SiteImportFidelityCount
  /** The source's groups by kind. A group of lines that only share a shape (`text`) is drawn as its lines, and is not scored. */
  groups: Partial<Record<SiteImportGroupKind, SiteImportFidelityGroup>>
  tables: SiteImportFidelityCount
  tabs: SiteImportFidelityCount
  /** The source's pictures placed on the page. */
  pictures: SiteImportFidelityCount
  /**
   * The source's icons drawn: each group item's own, each bullet's mark. An
   * icon standing alone in the source (a video's play mark) is no word and no
   * picture of the page, and the build leaves it out (AGL-4107): it is
   * counted in `lone` and not scored.
   */
  icons: SiteImportFidelityCount & { lone: number }
  /**
   * The lines the source draws as buttons that go somewhere (a page, an
   * address, an email, a phone), drawn as buttons of the same style with
   * their destinations. A button that goes nowhere a page can send a visitor
   * (a film's play button its script runs) is kept as its words: counted in
   * `unlinked`, not scored.
   */
  buttons: SiteImportFidelityCount & { unlinked: number }
  /** The source's headings, drawn as headings. */
  headings: SiteImportFidelityCount
  /** The source's forms, where the site has a form a page places. */
  forms: SiteImportFidelityCount
}

/** A page's source as the import read it: its layout over its main-region blocks, and its photos as the library holds them. */
export interface SiteImportFidelitySource {
  layout: SiteImportLayout
  /** The page's main-region blocks, which the layout's lines are indexes of. */
  blocks: readonly SiteImportBlock[]
  /** The source's pictures as the site's library holds them (`from` → `src`); without them a picture is counted, not placed. */
  photos?: ReadonlyArray<{ from?: string; src: string }>
}

/*------------------------------------------
 * Words and lines
 *-----------------------------------------*/

const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '')

const WORD = /[\p{L}\p{N}]+/gu

/** A line's words, in order. */
const wordsOf = (text: string): string[] => text.match(WORD) ?? []

/**
 * A line's words as one string, for comparing two lines whatever their
 * spacing and marks; a line of marks alone (a table's "✓", a "—") as it is.
 */
const wordLine = (text: string): string => wordsOf(text).join(' ') || clean(text)

/** Whether a block is a line of the page: a link inside a sentence is in its sentence. */
function isLine(block: SiteImportBlock | undefined): boolean {
  if (!block) return false
  if (block.kind === 'image') return !!block.url
  if (block.kind === 'link') return !block.inline && !!clean(block.text)
  return !!clean(block.text)
}

/** A cell of the Table element's grid, its pipes unescaped. */
function tableCells(rows: string): string[] {
  return rows
    .split('\n')
    .flatMap((line) =>
      line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split(/(?<!\\)\|/)
        .map((cell) => clean(cell.replace(/\\\|/g, '|'))),
    )
    .filter(Boolean)
}

/** The words a node shows a visitor: its text, its list lines, its tab labels, its table's cells. */
function shownTexts(node: SiteImportFidelityNode | undefined): string[] {
  if (!node) return []
  const props = node.props ?? {}
  const out: string[] = []
  for (const key of ['children', 'primary', 'secondary']) {
    const value = clean(props[key])
    if (value) out.push(value)
  }
  if (node.componentId === 'muiTabs' && typeof props['labels'] === 'string') out.push(...props['labels'].split('\n').map(clean).filter(Boolean))
  if (node.componentId === 'dataTable' && typeof props['rows'] === 'string') out.push(...tableCells(props['rows']))
  return out
}

/** Where a node sends a visitor: a page, an address, a section of the page. */
function hasDestination(node: SiteImportFidelityNode | undefined): boolean {
  if (!node) return false
  const props = node.props ?? {}
  return !!clean(props['screenId']) || !!clean(props['href']) || !!clean(props['to']) || (node.interactions?.length ?? 0) > 0
}

const BUTTON_VARIANT: Readonly<Record<SiteImportButtonStyle, string>> = { primary: 'contained', secondary: 'outlined', quiet: 'text' }

/** A section's band as the compiler draws it: a dark scheme, the paper ground, the brand fill, else plain. */
export function siteImportFidelityBandOf(node: SiteImportFidelityNode | undefined): SiteImportBand {
  if (node?.props?.['colorScheme'] === 'dark') return 'dark'
  const ground = node?.sx?.['bgcolor']
  if (ground === 'background.paper') return 'soft'
  if (ground === 'primary.main') return 'brand'
  return 'plain'
}

/** The node a stored page or layout hangs from: the canvas root, else the one with no parent. */
export function siteImportFidelityTreeOf(nodes: Readonly<Record<string, SiteImportFidelityNode>>): SiteImportFidelityTree {
  const ids = Object.keys(nodes)
  const rootId = nodes['_@_'] ? '_@_' : (ids.find((id) => !nodes[id]?.parentId) ?? ids[0] ?? '_@_')
  return { rootId, nodes }
}

/*------------------------------------------
 * The built page, walked once
 *-----------------------------------------*/

interface Piece {
  node: string
  text: string
  /** Its words, joined: what lines are compared by. */
  key: string
  at: number
}

/** A built tree in document order: each node's span, its parent, and the words each shows. */
class Built {
  readonly order: string[] = []
  private readonly enter = new Map<string, number>()
  private readonly exit = new Map<string, number>()
  readonly parent = new Map<string, string>()
  readonly pieces: Piece[] = []

  constructor(readonly tree: SiteImportFidelityTree) {
    const seen = new Set<string>()
    const visit = (id: string, parent: string | null) => {
      if (seen.has(id) || !tree.nodes[id]) return
      seen.add(id)
      if (parent) this.parent.set(id, parent)
      const at = this.order.length
      this.enter.set(id, at)
      this.order.push(id)
      for (const text of shownTexts(tree.nodes[id])) this.pieces.push({ node: id, text, key: wordLine(text), at })
      for (const child of tree.nodes[id]?.nodes ?? []) visit(child, id)
      this.exit.set(id, this.order.length - 1)
    }
    visit(tree.rootId, null)
  }

  node(id: string): SiteImportFidelityNode | undefined {
    return this.tree.nodes[id]
  }

  /** Whether `a` is `b` or holds it. */
  holds(a: string, b: string): boolean {
    const start = this.enter.get(a)
    const end = this.exit.get(a)
    const point = this.enter.get(b)
    return start !== undefined && end !== undefined && point !== undefined && point >= start && point <= end
  }

  /** The nodes under one, itself included, in document order. */
  under(id: string): string[] {
    const start = this.enter.get(id)
    const end = this.exit.get(id)
    return start === undefined || end === undefined ? [] : this.order.slice(start, end + 1)
  }

  children(id: string): string[] {
    return (this.tree.nodes[id]?.nodes ?? []).filter((child) => this.enter.has(child))
  }

  /** The deepest node holding every one of `ids`. */
  common(ids: readonly string[]): string | null {
    if (!ids.length) return null
    for (let at: string | undefined = ids[0]; at; at = this.parent.get(at)) {
      if (ids.every((id) => this.holds(at as string, id))) return at
    }
    return null
  }

  /** Whether any node under `id` (itself included) is one `test` takes. */
  has(id: string, test: (node: SiteImportFidelityNode) => boolean): boolean {
    return this.under(id).some((at) => {
      const node = this.tree.nodes[at]
      return !!node && test(node)
    })
  }
}

const ratioKept = (source: number, built: number): SiteImportFidelityCount => ({ source, built, ratio: source > 0 ? Math.min(1, built / source) : 1 })

const ratioBoth = (source: number, built: number): SiteImportFidelityCount => ({
  source,
  built,
  ratio: Math.max(source, built) > 0 ? Math.min(source, built) / Math.max(source, built) : 1,
})

/*------------------------------------------
 * The page
 *-----------------------------------------*/

/**
 * Each line of the source found on the built page (AGL-4109): the element
 * showing its words, or the picture the library copy of it is. A line is
 * looked for in its own section, nearest after the line before it; an
 * element holds one line, or the run of lines a build joins into one (a
 * list item's words, a quote's).
 */
class Placement {
  /** Line → the node showing it. */
  readonly of = new Map<SiteImportLineRef, string>()
  private readonly claimedBy = new Map<Piece, SiteImportLineRef>()
  private readonly imageClaimed = new Set<string>()

  constructor(
    private readonly built: Built,
    private readonly source: SiteImportFidelitySource,
    sectionRoots: ReadonlyArray<string | null>,
  ) {
    const photoOf = new Map<string, string>()
    for (const photo of source.photos ?? []) if (photo.from) photoOf.set(photo.from, photo.src)
    source.layout.sections.forEach((section, index) => {
      const root = sectionRoots[index] ?? built.tree.rootId
      const scope = new Set(built.under(root))
      const pieces = built.pieces.filter((piece) => scope.has(piece.node))
      const images = built.under(root).filter((id) => built.node(id)?.componentId === 'image')
      let cursor = -1
      let previous: SiteImportLineRef | null = null
      for (const ref of section.lines) {
        const block = source.blocks[ref]
        if (!isLine(block)) continue
        if (block.kind === 'image') {
          const src = photoOf.get(block.url)
          const found = src ? images.find((id) => !this.imageClaimed.has(id) && built.node(id)?.props?.['src'] === src) : undefined
          if (found) {
            this.imageClaimed.add(found)
            this.of.set(ref, found)
          }
          previous = ref
          continue
        }
        const piece = this.find(pieces, clean(block.text), cursor, previous)
        if (piece) {
          this.claimedBy.set(piece, ref)
          this.of.set(ref, piece.node)
          cursor = piece.at
        }
        previous = ref
      }
    })
  }

  /** The piece showing a line: its words exactly, else a part of them (a long paragraph split), else the run it was joined into. */
  private find(pieces: readonly Piece[], text: string, cursor: number, previous: SiteImportLineRef | null): Piece | null {
    const key = wordLine(text)
    if (!key) return null
    const free = (piece: Piece) => {
      const owner = this.claimedBy.get(piece)
      // A piece holds one line, or the lines a build joined: the one before this one.
      return owner === undefined || owner === previous
    }
    // The nearest to the line placed before it: a build keeps a section's lines in their order, near enough.
    const pick = (list: Piece[]) =>
      list.reduce<Piece | null>((best, piece) => {
        if (!best) return piece
        const gap = Math.abs(piece.at - cursor)
        const bestGap = Math.abs(best.at - cursor)
        return gap < bestGap || (gap === bestGap && piece.at >= cursor && best.at < cursor) ? piece : best
      }, null)
    const exact = pieces.filter((piece) => piece.key === key && this.claimedBy.get(piece) === undefined)
    if (exact.length) return pick(exact)
    const padded = ` ${key} `
    const part = pieces.filter((piece) => free(piece) && piece.key && (` ${piece.key} `.includes(padded) || padded.includes(` ${piece.key} `)))
    return pick(part)
  }

  /** The nodes a list of lines is shown by, and whether every one of them was found. */
  nodesOf(refs: readonly SiteImportLineRef[]): { nodes: string[]; whole: boolean; measured: boolean } {
    const nodes: string[] = []
    let whole = true
    let measured = false
    const pictures = !!this.source.photos?.length
    for (const ref of refs) {
      const block = this.source.blocks[ref]
      if (!isLine(block)) continue
      if (block.kind === 'image' && !pictures) continue
      measured = true
      const node = this.of.get(ref)
      if (node) nodes.push(node)
      else whole = false
    }
    return { nodes, whole, measured }
  }
}

/** One part of the source's structure (an item, a cell), found on the built page. */
interface Unit {
  nodes: string[]
  whole: boolean
  measured: boolean
  /** The element holding all of it and nothing of the parts beside it. */
  element: string | null
}

/**
 * Units found on the page, each as the element of its own (AGL-4109): the
 * highest element holding its lines and none of the other units' lines. A
 * unit whose lines are not held apart from another's (thirteen cards' titles
 * in one stack under their thirteen lines) has no element of its own.
 */
function unitsOn(built: Built, placement: Placement, parts: ReadonlyArray<readonly SiteImportLineRef[]>, stop: string | null): Unit[] {
  const found = parts.map((refs) => placement.nodesOf(refs))
  return found.map((part, index) => {
    const others = found.flatMap((other, at) => (at === index ? [] : other.nodes))
    const anchor = built.common(part.nodes)
    if (!anchor || others.some((node) => built.holds(anchor, node))) return { ...part, element: null }
    let element = anchor
    for (let up = built.parent.get(element); up && up !== stop && !others.some((node) => built.holds(up as string, node)); up = built.parent.get(up)) {
      element = up
      if (built.node(up)?.componentId === 'section') break
    }
    return { ...part, element }
  })
}

/** Whether a node lays its children side by side: a Grid container, or a Stack set in a row. */
function setsSideBySide(node: SiteImportFidelityNode | undefined): boolean {
  if (!node) return false
  const props = node.props ?? {}
  if (node.componentId === 'muiGrid') return props['container'] === true || props['container'] === 'true'
  if (node.componentId === 'muiStack') return props['direction'] === 'row' || (typeof props['direction'] === 'string' && /\b(?:sm|md|lg):row\b/.test(props['direction']))
  return false
}

/**
 * Whether a row of the source is a byline: one cell a lone picture, the other
 * a few words (a writer's portrait beside their name and date), which the
 * build draws as the portrait, small, over its words (AGL-4107), not as two
 * columns across the page.
 */
function isByline(source: SiteImportFidelitySource, cells: ReadonlyArray<{ nodes: SiteImportLayoutNode[] }>): boolean {
  if (cells.length !== 2) return false
  const at = cells.findIndex((cell) => cell.nodes.length === 1 && cell.nodes[0]?.kind === 'picture')
  if (at === -1) return false
  const words = cells[1 - at]?.nodes ?? []
  if (!words.every((node) => node.kind === 'line')) return false
  const count = words.reduce((total, node) => {
    const block = node.kind === 'line' ? source.blocks[node.line] : undefined
    return total + (block && block.kind !== 'image' ? wordsOf(clean(block.text)).length : 0)
  }, 0)
  return count > 0 && count <= 12
}

/** Every node of a section's layout, rows, cells and tab panels opened, in order. */
function layoutNodes(nodes: readonly SiteImportLayoutNode[]): SiteImportLayoutNode[] {
  const out: SiteImportLayoutNode[] = []
  const visit = (list: readonly SiteImportLayoutNode[]) => {
    for (const node of list) {
      out.push(node)
      if (node.kind === 'row') for (const cell of node.cells) visit(cell.nodes)
      if (node.kind === 'tabs') for (const tab of node.tabs) visit(tab.panel)
    }
  }
  visit(nodes)
  return out
}

/** Every line a list of layout nodes places, rows, groups, tables and tabs opened. */
function linesOf(nodes: readonly SiteImportLayoutNode[]): SiteImportLineRef[] {
  const out: SiteImportLineRef[] = []
  for (const node of layoutNodes(nodes)) {
    if (node.kind === 'line' || node.kind === 'picture') out.push(node.line)
    else if (node.kind === 'group') for (const item of node.items) out.push(...item.lines)
    else if (node.kind === 'table') for (const row of node.rows) for (const cell of row.cells) out.push(...cell.lines)
    else if (node.kind === 'tabs') for (const tab of node.tabs) if (tab.label !== null) out.push(tab.label)
  }
  return out
}

/**
 * A built page scored against its source (AGL-4109): the words, each once;
 * the sections and their bands; the rows of columns; the groups by kind, each
 * item an element of its own with its parts; the tables, tabs, pictures,
 * icons, buttons, headings and forms. The score is the lowest ratio of the
 * structure.
 */
export function siteImportFidelity(source: SiteImportFidelitySource, tree: SiteImportFidelityTree): SiteImportPageFidelity {
  const built = new Built(tree)
  const sections = source.layout.sections
  const drawnSections = built.children(tree.rootId)
  // The build draws each of the source's sections as one, in order; a page whose count differs is searched whole.
  const aligned = drawnSections.length === sections.length
  const roots = sections.map((_, index) => (aligned ? (drawnSections[index] ?? null) : null))
  const placement = new Placement(built, source, roots)

  const words = wordsScore(source, built)
  const read = sections.map((section) => section.band)
  const drawn = drawnSections.map((id) => siteImportFidelityBandOf(built.node(id)))
  const bandsKept = read.filter((band, index) => drawn[index] === band).length

  const rows = { source: 0, built: 0 }
  const groups: Partial<Record<SiteImportGroupKind, { groups: number; groupsKept: number; items: number; itemsKept: number }>> = {}
  const tables = { source: 0, built: 0 }
  const tabs = { source: 0, built: 0 }
  const buttons = { source: 0, built: 0, unlinked: 0 }
  const icons = { source: 0, built: 0, lone: 0 }

  sections.forEach((section, index) => {
    const root = roots[index] ?? null
    for (const node of layoutNodes(section.nodes)) {
      switch (node.kind) {
        case 'icon':
          icons.lone += 1
          break
        case 'line': {
          if (!node.button) break
          const block = source.blocks[node.line]
          // A button that goes nowhere a page can send a visitor (a film's play button its script runs) is kept as its words.
          if (block?.kind !== 'link' || !/^(?:https?:|mailto:|tel:)/i.test(block.href)) {
            buttons.unlinked += 1
            break
          }
          buttons.source += 1
          const id = placement.of.get(node.line)
          const drawnAs = id ? built.node(id) : undefined
          if (drawnAs?.componentId === 'muiButton' && drawnAs.props?.['variant'] === BUTTON_VARIANT[node.button] && hasDestination(drawnAs)) buttons.built += 1
          break
        }
        case 'row': {
          const cells = node.cells.filter((cell) => linesOf(cell.nodes).length)
          if (cells.length < 2 || isByline(source, cells)) break
          rows.source += 1
          const units = unitsOn(built, placement, cells.map((cell) => linesOf(cell.nodes)), root)
          const parents = new Set(units.map((unit) => (unit.element ? built.parent.get(unit.element) : null)))
          const parent = parents.size === 1 ? [...parents][0] : null
          if (units.every((unit) => unit.whole && unit.element) && parent && setsSideBySide(built.node(parent))) rows.built += 1
          break
        }
        case 'group': {
          const units = unitsOn(built, placement, node.items.map((item) => item.lines), root)
          // Each item's own icon and its bullets' marks, in the element that is the item.
          node.items.forEach((item, at) => {
            const wanted = (item.icon !== undefined ? 1 : 0) + (item.listIcon !== undefined ? (item.list?.length ?? 0) : 0)
            if (!wanted) return
            icons.source += wanted
            const element = units[at]?.element
            if (element) icons.built += Math.min(wanted, built.under(element).filter((id) => built.node(id)?.componentId === 'icon').length)
          })
          // Lines that only share a shape are drawn as their lines: no group to keep.
          if (node.group === 'text') break
          const entry = (groups[node.group] ??= { groups: 0, groupsKept: 0, items: 0, itemsKept: 0 })
          let kept = 0
          let measured = 0
          node.items.forEach((item, at) => {
            const unit = units[at] as Unit
            if (!unit.measured) return
            measured += 1
            if (itemKept(built, node.group, item, unit)) kept += 1
          })
          entry.groups += 1
          entry.items += measured
          entry.itemsKept += kept
          if (measured > 0 && kept === measured) entry.groupsKept += 1
          break
        }
        case 'table': {
          tables.source += 1
          const cells = node.rows.flatMap((row) => row.cells.map((cell) => wordLine(cell.lines.map((ref) => clean((source.blocks[ref] as { text?: string })?.text)).join(' '))).filter(Boolean))
          // The theme's Table element, every cell of the source's in it.
          const kept = built.under(root ?? tree.rootId).some((id) => {
            const drawnAs = built.node(id)
            if (drawnAs?.componentId !== 'dataTable' || typeof drawnAs.props?.['rows'] !== 'string') return false
            const shown = new Set(tableCells(drawnAs.props['rows']).map(wordLine))
            return cells.every((cell) => shown.has(cell))
          })
          if (kept) tables.built += 1
          break
        }
        case 'tabs': {
          tabs.source += 1
          const labels = node.tabs.flatMap((tab) => (tab.label !== null ? [tab.label] : []))
          const found = placement.nodesOf(labels)
          if (!found.whole || !found.nodes.length) break
          // The Tabs element names every tab itself; a strip draws each label as an element of its own, side by side.
          const one = new Set(found.nodes).size === 1
          const strip = built.common(found.nodes)
          if (one ? built.node(found.nodes[0] as string)?.componentId === 'muiTabs' : !!strip && setsSideBySide(built.node(strip))) tabs.built += 1
          break
        }
        default:
          break
      }
    }
  })

  const pictures = picturesScore(source, built, placement)
  const headings = headingsScore(source, built, placement)
  const forms = ratioBoth(
    sections.reduce((total, section) => total + layoutNodes(section.nodes).filter((node) => node.kind === 'form').length, 0),
    built.order.filter((id) => built.node(id)?.componentId === 'form').length,
  )

  const report: Omit<SiteImportPageFidelity, 'score' | 'lowest'> = {
    words,
    sections: ratioBoth(sections.length, drawnSections.length),
    bands: { ...ratioKept(read.length, bandsKept), read, drawn },
    rows: ratioKept(rows.source, rows.built),
    groups: Object.fromEntries(
      Object.entries(groups).map(([kind, entry]) => [kind, { groups: ratioKept(entry.groups, entry.groupsKept), items: ratioKept(entry.items, entry.itemsKept) }]),
    ),
    tables: ratioKept(tables.source, tables.built),
    tabs: ratioKept(tabs.source, tabs.built),
    pictures,
    icons: { ...ratioKept(icons.source, icons.built), lone: icons.lone },
    buttons: { ...ratioKept(buttons.source, buttons.built), unlinked: buttons.unlinked },
    headings,
    forms,
  }
  return { ...lowestOf(pageMeasures(report)), ...report }
}

/** Whether an item of a group is kept: its own element, every line of it found, and the parts its kind and source say it has. */
function itemKept(built: Built, kind: SiteImportGroupKind, item: SiteImportLayoutItem, unit: Unit): boolean {
  if (!unit.whole || !unit.element) return false
  const element = unit.element
  // A question opens its answer: the theme's accordion.
  if (kind === 'faq' && !built.has(element, (node) => node.componentId === 'muiAccordion')) return false
  // An item the source made a link as a whole still goes there.
  if (item.to && !built.has(element, hasDestination)) return false
  // A picture of the item's own, where the library's copy is not known to the score.
  if (item.image !== undefined && !built.has(element, (node) => node.componentId === 'image')) return false
  return true
}

/** The words: the source's lines against what the page shows, each word as often as it is said. */
function wordsScore(source: SiteImportFidelitySource, built: Built): SiteImportFidelityWords {
  const tally = (lines: readonly string[]) => {
    const counts = new Map<string, number>()
    for (const word of lines.flatMap(wordsOf)) counts.set(word, (counts.get(word) ?? 0) + 1)
    return counts
  }
  const said = tally(source.blocks.flatMap((block) => (isLine(block) && block.kind !== 'image' ? [clean(block.text)] : [])))
  const shown = tally(built.pieces.map((piece) => piece.text))
  let sourceWords = 0
  let builtWords = 0
  let both = 0
  const missing: string[] = []
  const extra: string[] = []
  for (const [word, count] of said) {
    sourceWords += count
    const on = shown.get(word) ?? 0
    both += Math.min(count, on)
    if (on < count) missing.push(word)
  }
  for (const [word, count] of shown) {
    builtWords += count
    if (count > (said.get(word) ?? 0)) extra.push(word)
  }
  const most = Math.max(sourceWords, builtWords)
  return {
    source: sourceWords,
    built: builtWords,
    missing: sourceWords - both,
    extra: builtWords - both,
    ratio: most > 0 ? both / most : 1,
    examples: { missing: missing.slice(0, 8), extra: extra.slice(0, 8) },
  }
}

/** The pictures: placed where the library's copies are known, else counted. */
function picturesScore(source: SiteImportFidelitySource, built: Built, placement: Placement): SiteImportFidelityCount {
  const refs = source.layout.sections.flatMap((section) => section.lines).filter((ref) => source.blocks[ref]?.kind === 'image' && isLine(source.blocks[ref]))
  const drawn = built.order.filter((id) => built.node(id)?.componentId === 'image').length
  if (!source.photos?.length) return ratioBoth(refs.length, drawn)
  return ratioKept(refs.length, refs.filter((ref) => placement.of.has(ref)).length)
}

/** The headings: each of the source's drawn as a heading (an `h1`–`h6`, or the question of an accordion). */
function headingsScore(source: SiteImportFidelitySource, built: Built, placement: Placement): SiteImportFidelityCount {
  const refs = source.layout.sections.flatMap((section: SiteImportLayoutSection) => section.lines).filter((ref) => source.blocks[ref]?.kind === 'heading')
  const kept = refs.filter((ref) => {
    const id = placement.of.get(ref)
    const node = id ? built.node(id) : undefined
    return !!node && (/^h[1-6]$/.test(String(node.props?.['component'] ?? '')) || node.componentId === 'muiAccordionSummary')
  })
  return ratioKept(refs.length, kept.length)
}

/** Every structural measure of a page by name, groups by kind. */
function pageMeasures(report: Omit<SiteImportPageFidelity, 'score' | 'lowest'>): Array<[string, SiteImportFidelityCount]> {
  return [
    ['sections', report.sections],
    ['bands', report.bands],
    ['rows', report.rows],
    ...Object.entries(report.groups).map(([kind, entry]): [string, SiteImportFidelityCount] => [`${kind} items`, entry.items]),
    ['tables', report.tables],
    ['tabs', report.tabs],
    ['pictures', report.pictures],
    ['icons', report.icons],
    ['buttons', report.buttons],
    ['headings', report.headings],
    ['forms', report.forms],
  ]
}

/** The score: the lowest ratio, and the measure it came from. */
function lowestOf(measures: ReadonlyArray<[string, SiteImportFidelityCount]>): { score: number; lowest: string | null } {
  let score = 1
  let lowest: string | null = null
  for (const [name, count] of measures) {
    if (count.ratio < score) {
      score = count.ratio
      lowest = name
    }
  }
  return { score, lowest }
}

/*------------------------------------------
 * The frame
 *-----------------------------------------*/

/** A built header and footer, scored against the source's. */
export interface SiteImportFrameFidelity {
  /** The lowest ratio of the header's and footer's measures. */
  score: number
  lowest: string | null
  /** The source's top-level items, in the header's row, over the larger of the two (a row of page titles scores low). */
  items: SiteImportFidelityCount
  /** Whether the row's items are in the source's order. */
  inOrder: boolean
  /** The source's menus drawn as menus under their names. */
  menus: SiteImportFidelityCount
  /** The source's menu entries, each a link in its menu. */
  entries: SiteImportFidelityCount
  /** The lines under entries and their icons, in their menus. */
  details: SiteImportFidelityCount
  /** The header's buttons, drawn as the source draws them, each with its destination. */
  ctas: SiteImportFidelityCount
  /** Everything of the row in the phone menu: each menu's name and entries, the links, the buttons. */
  drawer: SiteImportFidelityCount
  /** A menu button shown where the row is not, opening the phone menu. */
  phone: SiteImportFidelityCount
  /** The row's labels held to one line. */
  nowrap: SiteImportFidelityCount
  /** The footer's columns under their headings. */
  columns: SiteImportFidelityCount
  /** The footer's links, its columns' and its own. */
  links: SiteImportFidelityCount
  /** Its profiles on other sites. */
  social: SiteImportFidelityCount
  /** Its words, address, phone, email and © line, word for word. */
  facts: SiteImportFidelityCount
}

/** A node's label as a menu, a link or a button carries it. */
function labelOf(node: SiteImportFidelityNode | undefined): string {
  if (!node) return ''
  return clean(node.props?.['label']) || clean(node.props?.['children']) || clean(node.props?.['ariaLabel'])
}

const LINK_COMPONENTS = new Set(['muiScreenLink', 'muiButton', 'muiLinkBox', 'muiLink'])

/**
 * A built header and footer scored against the source's (AGL-4109): the
 * header's top-level items in order, each menu's entries with the lines and
 * icons under them, its buttons, the phone menu holding all of it, the row's
 * labels on one line; the footer's columns, links, profiles and facts. The
 * score is the lowest ratio.
 */
export function siteImportFrameFidelity(source: { nav: SiteImportNavTree | null | undefined; footer: SiteImportFooter | null | undefined }, tree: SiteImportFidelityTree): SiteImportFrameFidelity {
  const built = new Built(tree)
  const all = built.order
  const is = (componentId: string) => (id: string) => built.node(id)?.componentId === componentId
  const drawer = all.find(is('muiDrawer')) ?? null
  const inDrawer = (id: string) => !!drawer && built.holds(drawer, id)
  const header = all.find((id) => built.node(id)?.componentId === 'muiAppBar' || built.node(id)?.props?.['component'] === 'header') ?? null
  const footer = all.find((id) => built.node(id)?.props?.['element'] === 'footer' || built.node(id)?.props?.['component'] === 'footer') ?? null
  const inHeader = header ? built.under(header).filter((id) => !inDrawer(id)) : []
  const row = inHeader.find((id) => built.node(id)?.props?.['component'] === 'nav') ?? null
  const nav = source.nav ?? null
  const groups = nav?.items ?? []

  // The row: its items by name, in order.
  const rowItems = row ? built.children(row).map((id) => labelOf(built.node(id))) : []
  const wanted = groups.map((item) => clean(item.label))
  const left = [...rowItems]
  let matched = 0
  for (const label of wanted) {
    const at = left.indexOf(label)
    if (at !== -1) {
      matched += 1
      left.splice(at, 1)
    }
  }
  const inOrder = rowItems.filter((label) => wanted.includes(label)).join('\n') === wanted.filter((label) => rowItems.includes(label)).join('\n')

  // Each menu: drawn as one, under its name, with its entries, their lines and icons.
  const menus = { source: 0, built: 0 }
  const entries = { source: 0, built: 0 }
  const details = { source: 0, built: 0 }
  for (const group of groups) {
    if (!group.items.length) continue
    menus.source += 1
    entries.source += group.items.length
    const menu = row
      ? built.under(row).find((id) => (built.node(id)?.componentId === 'muiMegaMenu' || built.node(id)?.componentId === 'muiNavMenu') && clean(built.node(id)?.props?.['label']) === clean(group.label))
      : undefined
    for (const entry of group.items) {
      if (entry.text) details.source += 1
      if (entry.iconPath) details.source += 1
    }
    if (!menu) continue
    menus.built += 1
    const inside = built.under(menu)
    const links = inside.filter((id) => LINK_COMPONENTS.has(built.node(id)?.componentId ?? ''))
    const texts = new Set(inside.flatMap((id) => shownTexts(built.node(id))))
    for (const entry of group.items) {
      const link = links.find((id) => labelOf(built.node(id)) === clean(entry.label) || shownTexts(built.node(id)).includes(clean(entry.label)) || built.under(id).some((at) => shownTexts(built.node(at)).includes(clean(entry.label))))
      if (!link) continue
      entries.built += 1
      if (entry.text && texts.has(clean(entry.text))) details.built += 1
      if (entry.iconPath && built.has(link, (node) => node.componentId === 'icon')) details.built += 1
    }
  }

  // The buttons, as the source draws them.
  const ctas = { source: 0, built: 0 }
  for (const cta of nav?.ctas ?? []) {
    ctas.source += 1
    const button = inHeader.find((id) => built.node(id)?.componentId === 'muiButton' && clean(built.node(id)?.props?.['children']) === clean(cta.label))
    const node = button ? built.node(button) : undefined
    if (node && node.props?.['variant'] === BUTTON_VARIANT[cta.style] && (!cta.href || hasDestination(node))) ctas.built += 1
  }

  // The phone menu: every name, entry, link and button of the row.
  const drawerTexts = new Set(drawer ? built.under(drawer).flatMap((id) => shownTexts(built.node(id))) : [])
  const drawerWanted = [
    ...groups.flatMap((group) => [clean(group.label), ...group.items.map((entry) => clean(entry.label))]),
    ...(nav?.ctas ?? []).map((cta) => clean(cta.label)),
  ].filter(Boolean)
  const toggle = inHeader.some(is('muiDrawerToggle'))
  const hasRow = groups.length > 0 || (nav?.ctas.length ?? 0) > 0

  // The footer.
  const foot = source.footer ?? null
  const footIds = footer ? built.under(footer) : []
  const footTexts = new Set(footIds.flatMap((id) => shownTexts(built.node(id))))
  const footLinks = footIds.filter((id) => LINK_COMPONENTS.has(built.node(id)?.componentId ?? ''))
  const footLinkLabels = footLinks.map((id) => labelOf(built.node(id)))
  const columnLinks = (foot?.columns ?? []).flatMap((column) => column.links)
  const linksWanted = [...columnLinks, ...(foot?.links ?? [])]
  const linkLeft = [...footLinkLabels]
  let linksKept = 0
  for (const link of linksWanted) {
    const at = linkLeft.indexOf(clean(link.label))
    if (at !== -1) {
      linksKept += 1
      linkLeft.splice(at, 1)
    }
  }
  const profiles = footIds.filter(is('socialLinks')).flatMap((id) => Object.entries(built.node(id)?.props ?? {}).filter(([, value]) => typeof value === 'string' && /^https?:/.test(value as string)))
  const hrefs = new Set(footLinks.map((id) => clean(built.node(id)?.props?.['href'])))
  const socialKept = (foot?.social ?? []).filter((profile) => profiles.some(([network, href]) => network === profile.network || href === profile.href) || hrefs.has(clean(profile.href))).length
  const facts = [...(foot?.text ?? []), foot?.address, foot?.phone, foot?.email, foot?.copyright].map(clean).filter(Boolean)

  const report: Omit<SiteImportFrameFidelity, 'score' | 'lowest'> = {
    // Over the larger of the two: a row of the site's page titles in place of the source's menus scores low.
    items: { source: wanted.length, built: matched, ratio: Math.max(wanted.length, rowItems.length) > 0 ? matched / Math.max(wanted.length, rowItems.length) : 1 },
    inOrder,
    menus: ratioKept(menus.source, menus.built),
    entries: ratioKept(entries.source, entries.built),
    details: ratioKept(details.source, details.built),
    ctas: ratioKept(ctas.source, ctas.built),
    drawer: ratioKept(drawerWanted.length, drawerWanted.filter((label) => drawerTexts.has(label)).length),
    phone: ratioKept(hasRow ? 1 : 0, hasRow && toggle && !!drawer ? 1 : 0),
    nowrap: ratioKept(row ? 1 : 0, row && built.node(row)?.sx?.['whiteSpace'] === 'nowrap' ? 1 : 0),
    columns: ratioKept(foot?.columns.length ?? 0, (foot?.columns ?? []).filter((column) => footTexts.has(clean(column.heading))).length),
    links: ratioKept(linksWanted.length, linksKept),
    social: ratioKept(foot?.social.length ?? 0, socialKept),
    facts: ratioKept(facts.length, facts.filter((fact) => footTexts.has(fact)).length),
  }
  const measures: Array<[string, SiteImportFidelityCount]> = [
    ['items', report.items],
    ['menus', report.menus],
    ['entries', report.entries],
    ['details', report.details],
    ['ctas', report.ctas],
    ['drawer', report.drawer],
    ['phone', report.phone],
    ['nowrap', report.nowrap],
    ['columns', report.columns],
    ['links', report.links],
    ['social', report.social],
    ['facts', report.facts],
  ]
  return { ...lowestOf(measures), ...report }
}
