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
 * - **The structure**: its sections, their bands and how wide they run; its
 *   rows of columns side by side; its groups by kind, each item its own
 *   element with its parts (an FAQ's question on an accordion, a card's link
 *   on the card); its tables, tab strips, pictures, icons, buttons as the
 *   source draws them, headings and forms.
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
 *
 * How the owner asked the site to be finished (AGL-4152) changes what the
 * score means, and each finish is asked for by name; a page scored with
 * neither a finish nor its words scores as it did before the choice:
 *
 * - **Keep my site**: the structure, and the look's pins at 1.0: each
 *   section's alignment and its groups' boxes as the source has them, each
 *   ground within OKLab ΔE 0.05 of the source's, the hero heading's measure
 *   within 10%, and the buttons in the source's case and fill.
 * - **Improve it**: the content alone (words, sections, items, tables, tabs,
 *   pictures, icons, buttons, headings, forms, films); the bands, widths,
 *   rows, framing, grounds, measure, alignment and boxes are free, and the
 *   `design` lines say whether the build reads better than its source.
 * - **Improved words** (lane G): the words are free, and every fact, every
 *   line and most of each line's meaning are held instead.
 *=========================================*/

import { contrastRatio } from '@aglyn/aglyn/app-utils/site-theme'
import type { SiteImportBlock } from '../site-import/site-import-html'
import { SITE_IMPORT_PLAY_WORDS, siteImportWidthOf, type AiSiteImportFinish, type AiSiteImportWords } from './ai-site-import'
import { aiHexOklch } from './ai-site-look'
import type {
  SiteImportBand,
  SiteImportButtonStyle,
  SiteImportFooter,
  SiteImportGroupKind,
  SiteImportLayout,
  SiteImportLayoutGroup,
  SiteImportLayoutItem,
  SiteImportLayoutNode,
  SiteImportLayoutSection,
  SiteImportLineRef,
  SiteImportNavTree,
  SiteImportPictureFit,
  SiteImportWidth,
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
  /** Sections drawn as wide as the source runs them, or wider (AGL-4083); one the source sets no cap on counts as kept. */
  widths: SiteImportFidelityCount
  /** The source's rows of two or more columns, set side by side on the page. */
  rows: SiteImportFidelityCount
  /** The source's groups by kind. A group of lines that only share a shape (`text`) is drawn as its lines, and is not scored. */
  groups: Partial<Record<SiteImportGroupKind, SiteImportFidelityGroup>>
  tables: SiteImportFidelityCount
  tabs: SiteImportFidelityCount
  /** The source's pictures placed on the page. */
  pictures: SiteImportFidelityCount
  /**
   * The source's pictures framed as the source frames them (AGL-4138): each
   * in a box of the shape the source shows it at — the box or the height it
   * crops it to, else its own — within 5%, or in no box at all where the
   * source crops nothing. A round portrait, and a picture the source lays
   * behind its words, are framed by design and not scored.
   */
  framing: SiteImportFidelityCount
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
  buttons: SiteImportFidelityCount & {
    unlinked: number
    /**
     * Under Keep my site (AGL-4152), the buttons set in the source's case, and
     * its filled ones in its own fill within OKLab ΔE 0.05: counted where the
     * source's look and the theme say them, and a button short of either is
     * not kept.
     */
    case?: SiteImportFidelityCount
    fill?: SiteImportFidelityCount
  }
  /** The source's headings, drawn as headings. */
  headings: SiteImportFidelityCount
  /** The source's forms, where the site has a form a page places. */
  forms: SiteImportFidelityCount
  /**
   * The source's videos (AGL-4140): each drawn as the Video element, playing
   * from an address. One on a host the element has no player for is drawn as
   * its poster, linking to it, and is not kept. A film that plays on its own
   * behind a section's words is drawn as its poster there and is not counted
   * here: its poster is among the pictures.
   */
  videos: SiteImportFidelityCount
  /**
   * What the page was scored as (AGL-4152): its finish and its words. Absent
   * on a page scored with neither, whose score is the one before the choice,
   * and which carries none of the measures below.
   */
  scoredAs?: { finish: AiSiteImportFinish; words: AiSiteImportWords }
  /** The measures this finish prints as free: reported, never scored. */
  free?: string[]
  /** Sections whose words are set as the source sets them, centered or at the start. */
  align?: SiteImportFidelityCount
  /** Groups whose items are boxed where the source boxes them, and open where it leaves them open. */
  boxed?: SiteImportFidelityCount
  /**
   * Sections with a ground of their own drawn on a ground of the theme
   * within OKLab ΔE 0.05 of it (`SITE_IMPORT_GROUND_DELTA`): `theme` says
   * where the theme's colors were read from, `null` where none was given and
   * nothing is measured; `worst` is the farthest one.
   */
  ground?: SiteImportFidelityCount & { theme: SiteImportFidelityTheme['from'] | null; worst: number | null }
  /**
   * The hero heading's box as a share of its section, within 10% of the
   * source's (`SITE_IMPORT_MEASURE_SHARE`): measured where the reader kept the
   * source's measure. `shares` are the two shares compared.
   */
  measure?: SiteImportFidelityCount & { shares: { source: number; built: number } | null }
  /** Each section's ink on its ground, and a filled button's label on its fill, at 4.5:1 or better: measured where a theme is given. */
  readable?: SiteImportFidelityCount
  /** The lines Improve it scores the build on against its source: whether it reads better (AGL-4152). */
  design?: SiteImportDesignFidelity
  /** Under improved words (G4): every fact of the source (prices, numbers, emails, phones, addresses, names) as often as it says it. */
  facts?: SiteImportFidelityFacts
  /** Under improved words (G4): every line of the source placed once, and none the page added (`extra`). */
  lines?: SiteImportFidelityCount & { extra: number }
  /** Under improved words (G4): how much of each line's content its rewrite keeps, held at `floor` a line. */
  meaning?: SiteImportFidelityMeaning
}

/** How a page was finished and its words kept (AGL-4152), and the theme it is drawn in. */
export interface SiteImportFidelityOptions {
  /** Keep my site or Improve it. Scored with neither this nor `words`, the page scores as it did before the choice. */
  finish?: AiSiteImportFinish | null
  /** Whether its words were kept as written or improved (lane G). */
  words?: AiSiteImportWords | null
  /**
   * The theme the page is drawn in (`siteImportFidelityThemeOf`). A tree
   * names roles (`background.paper`, `primary.main`), not colors: without a
   * theme the grounds, the inks and the buttons' case and fill are not
   * measured.
   */
  theme?: SiteImportFidelityTheme | null
}

/** One scheme of a theme, as the fidelity reads it. */
export interface SiteImportFidelityScheme {
  /** `background.default`: a plain band's ground. */
  ground: string | null
  /** `background.paper`: a soft band's. */
  paper: string | null
  /** `primary.main`: a brand band's, and a filled button's where the theme sets none apart. */
  brand: string | null
  /** `primary.contrastText`: the words on it. */
  onBrand: string | null
  /** `text.primary`: the words' ink. */
  ink: string | null
}

/** The colors and button style of the theme a page is drawn in, `#rrggbb`. */
export interface SiteImportFidelityTheme {
  /** Where they were read from: the site's theme as stored, or computed from its site style. */
  from: 'theme' | 'style'
  light: SiteImportFidelityScheme
  dark: SiteImportFidelityScheme | null
  /** A filled button's own fill and label where the theme sets them apart from the brand's (`MuiButton`), and the case its words are set in. */
  button: { fill: string | null; label: string | null; case: 'upper' | 'none' | null }
}

/** One line of the design measure: the share of what it asks that the source and the build each do, 0 to 1. */
export interface SiteImportDesignLine {
  source: number
  built: number
}

/**
 * Whether a page improved reads better than its source (AGL-4152), with no
 * model: each line the share of what it asks that the page does. A line is
 * `null` where the page gives it nothing to ask. Better is the build at or
 * above the source on every line and above it on one at least; a build that
 * is merely different is not better.
 */
export interface SiteImportDesignFidelity {
  /** Neighboring sections set apart by their bands, or a rule between them. */
  rhythm: SiteImportDesignLine | null
  /** Sections whose words run no wider than `lg`, and a long read no wider than `md`. */
  measure: SiteImportDesignLine | null
  /** A first section holding a picture opens as the page's hero, its heading and its picture together. */
  opening: SiteImportDesignLine | null
  /** Runs of three or more like items drawn as one group, each item an element of its own. */
  grouped: SiteImportDesignLine | null
  /** Inks and grounds that read at 4.5:1. */
  readable: SiteImportDesignLine | null
  better: boolean
}

/** The facts of a page's words (G4): each found on the built page as often as the source has it, and none of its own. */
export interface SiteImportFidelityFacts {
  source: number
  built: number
  missing: number
  extra: number
  /** Facts found as often as said, over the larger of the two: exactly 1 or the page is wrong. */
  ratio: number
  examples: { missing: string[]; extra: string[] }
}

/** How much of each line's content its rewrite keeps (G4). */
export interface SiteImportFidelityMeaning {
  /** The lines rewritten: placed, and drawn in words other than the source's. */
  lines: number
  /** Those keeping less than `floor` of their content words. */
  below: number
  /** The least any line kept; 1 where none was rewritten. */
  lowest: number
  /** The lines at `floor` or above, over the lines rewritten. */
  ratio: number
  floor: number
  /** The lines below the floor, for a report. */
  examples: Array<{ line: SiteImportLineRef; kept: number; source: string; built: string }>
}

/** How far a ground of the theme may sit from the source's (AGL-4152), in OKLab. */
export const SITE_IMPORT_GROUND_DELTA = 0.05

/** How far the hero heading's share of its section may sit from the source's (AGL-4152), relatively. */
export const SITE_IMPORT_MEASURE_SHARE = 0.1

/** The least share of a line's content words a rewrite keeps (G4). */
export const SITE_IMPORT_MEANING_FLOOR = 0.4

/** The measures Improve it prints as free (AGL-4152): what it may change. */
export const SITE_IMPORT_IMPROVE_FREE: readonly string[] = ['bands', 'widths', 'rows', 'framing', 'ground', 'measure', 'align', 'boxed']

/** A page's source as the import read it: its layout over its main-region blocks, and its photos as the library holds them. */
export interface SiteImportFidelitySource {
  layout: SiteImportLayout
  /** The page's main-region blocks, which the layout's lines are indexes of. */
  blocks: readonly SiteImportBlock[]
  /** The source's pictures as the site's library holds them (`from` → `src`, and their size); without them a picture is counted, not placed. */
  photos?: ReadonlyArray<{ from?: string; src: string; width?: number; height?: number }>
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

  /** A node's place in document order; -1 for one not on the page. */
  at(id: string): number {
    return this.enter.get(id) ?? -1
  }

  /** A node and the nodes holding it, nearest first, up to the page's root. */
  ancestry(id: string): string[] {
    const out: string[] = []
    for (let at: string | undefined = id; at; at = this.parent.get(at)) out.push(at)
    return out
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
  /** Line → the words it is shown in, where a rewrite placed it (AGL-4152). */
  readonly rewrittenAs = new Map<SiteImportLineRef, string>()
  private readonly claimedBy = new Map<Piece, SiteImportLineRef>()
  private readonly imageClaimed = new Set<string>()
  /** Each section's pieces, in order. */
  private readonly scopes: Piece[][] = []

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
      this.scopes[index] = pieces
      // A film's poster is placed as its Video element's (AGL-4140).
      const images = built.under(root).filter((id) => built.node(id)?.componentId === 'image' || built.node(id)?.componentId === 'video')
      let cursor = -1
      let previous: SiteImportLineRef | null = null
      for (const ref of section.lines) {
        const block = source.blocks[ref]
        if (!isLine(block)) continue
        if (block.kind === 'image') {
          const src = photoOf.get(block.url)
          const found = src ? images.find((id) => !this.imageClaimed.has(id) && built.node(id)?.props?.[built.node(id)?.componentId === 'video' ? 'poster' : 'src'] === src) : undefined
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
    // A line of marks a build joined to the line before it (a "—" beside its label) is in that line's piece,
    // never the same mark further down the page, which would leave that one's line with nothing.
    if (!wordsOf(text).length && previous !== null) {
      const joined = pieces.find((piece) => this.claimedBy.get(piece) === previous && clean(piece.text) !== text && clean(piece.text).endsWith(text))
      if (joined) return joined
    }
    const exact = pieces.filter((piece) => piece.key === key && this.claimedBy.get(piece) === undefined)
    if (exact.length) return pick(exact)
    const padded = ` ${key} `
    const part = pieces.filter((piece) => free(piece) && piece.key && (` ${piece.key} `.includes(padded) || padded.includes(` ${piece.key} `)))
    return pick(part)
  }

  /**
   * The lines a rewrite changed (G4), placed after the lines found as
   * written: in each section, each run of lines still unplaced is set to the
   * free pieces between the lines placed either side of it, in order, each
   * piece to one line, the pairs sharing most content words chosen. A line a
   * rewrite dropped has no piece to take, and stays unplaced.
   */
  placeRewritten(): void {
    this.source.layout.sections.forEach((section, index) => {
      const pieces = this.scopes[index] ?? []
      const lines = section.lines.filter((ref) => isLine(this.source.blocks[ref]) && this.source.blocks[ref]?.kind !== 'image')
      let run: SiteImportLineRef[] = []
      let from = -1
      const settle = (to: number) => {
        if (run.length) this.align(run, pieces.filter((piece) => piece.at >= from && piece.at <= to && this.claimedBy.get(piece) === undefined))
        run = []
      }
      for (const ref of lines) {
        const node = this.of.get(ref)
        if (node === undefined) {
          run.push(ref)
          continue
        }
        const at = this.built.at(node)
        settle(at)
        from = at
      }
      settle(Number.POSITIVE_INFINITY)
      // A line its neighbors leave no room for (one drawn out of the source's order) is looked for among the section's free pieces.
      const left = lines.filter((ref) => !this.of.has(ref))
      if (left.length) this.align(left, pieces.filter((piece) => this.claimedBy.get(piece) === undefined))
    })
  }

  /** A run of lines set to free pieces in order (G4): as many pairs as can be, then the most content kept. */
  private align(lines: readonly SiteImportLineRef[], pieces: readonly Piece[]): void {
    if (!lines.length || !pieces.length) return
    const text = (ref: SiteImportLineRef) => clean((this.source.blocks[ref] as { text?: string } | undefined)?.text)
    const best: number[][] = Array.from({ length: lines.length + 1 }, () => new Array<number>(pieces.length + 1).fill(0))
    for (let i = 1; i <= lines.length; i += 1) {
      for (let j = 1; j <= pieces.length; j += 1) {
        const pair = (best[i - 1]?.[j - 1] ?? 0) + 1 + contentKept(text(lines[i - 1] as number), (pieces[j - 1] as Piece).text)
        ;(best[i] as number[])[j] = Math.max(pair, best[i - 1]?.[j] ?? 0, best[i]?.[j - 1] ?? 0)
      }
    }
    for (let i = lines.length, j = pieces.length; i > 0 && j > 0; ) {
      const here = best[i]?.[j] ?? 0
      if (here === (best[i - 1]?.[j] ?? 0)) i -= 1
      else if (here === (best[i]?.[j - 1] ?? 0)) j -= 1
      else {
        const ref = lines[i - 1] as SiteImportLineRef
        const piece = pieces[j - 1] as Piece
        this.claimedBy.set(piece, ref)
        this.of.set(ref, piece.node)
        this.rewrittenAs.set(ref, piece.text)
        i -= 1
        j -= 1
      }
    }
  }

  /** The pieces of the page's sections no line of the source claimed, nor holds as a part of its words: lines the page added. */
  unclaimed(): Piece[] {
    const pieces = [...new Set(this.scopes.flat())]
    const said = this.source.layout.sections.flatMap((section) => section.lines).map((ref) => ` ${wordLine(clean((this.source.blocks[ref] as { text?: string } | undefined)?.text))} `)
    return pieces.filter((piece) => this.claimedBy.get(piece) === undefined && !!piece.key && !said.some((line) => line.includes(` ${piece.key} `)))
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
 *
 * Scored with a `finish` or its `words` (AGL-4152), the page is scored as
 * that finish asks, with the measures it adds; with neither, as before.
 */
export function siteImportFidelity(source: SiteImportFidelitySource, tree: SiteImportFidelityTree, options: SiteImportFidelityOptions = {}): SiteImportPageFidelity {
  const finished = !!options.finish || !!options.words
  // An import that names no finish reads as Keep my site (AGL-4152).
  const finish: AiSiteImportFinish = options.finish ?? 'keep'
  const improvedWords = options.words === 'improved'
  const theme = options.theme ?? null
  // Keep my site holds the buttons to the source's case and fill too.
  const pinned = finished && finish === 'keep'
  const built = new Built(tree)
  const sections = source.layout.sections
  const drawnSections = built.children(tree.rootId)
  // The build draws each of the source's sections as one, in order; a page whose count differs is searched whole.
  const aligned = drawnSections.length === sections.length
  const roots = sections.map((_, index) => (aligned ? (drawnSections[index] ?? null) : null))
  const placement = new Placement(built, source, roots)
  // Lines a rewrite changed are found by their place and their content (G4).
  if (improvedWords) placement.placeRewritten()
  const look = new LookOf(built, source.layout.look, theme)

  const words = wordsScore(source, built)
  const read = sections.map((section) => section.band)
  const drawn = drawnSections.map((id) => siteImportFidelityBandOf(built.node(id)))
  const bandsKept = read.filter((band, index) => drawn[index] === band).length

  const rows = { source: 0, built: 0 }
  const groups: Partial<Record<SiteImportGroupKind, { groups: number; groupsKept: number; items: number; itemsKept: number }>> = {}
  const tables = { source: 0, built: 0 }
  const tabs = { source: 0, built: 0 }
  const buttons = { source: 0, built: 0, unlinked: 0 }
  // Keep my site's buttons in the source's case, and its filled ones in its fill (AGL-4152).
  const buttonCase = { source: 0, built: 0 }
  const buttonFill = { source: 0, built: 0 }
  const boxed = { source: 0, built: 0 }
  const icons = { source: 0, built: 0, lone: 0 }
  // The films drawn as the Video element, playing from an address (AGL-4140).
  const drawnFilms = built.order.filter((id) => built.node(id)?.componentId === 'video' && !!clean(built.node(id)?.props?.['src'])).length
  const films = drawnFilms > 0
  /** Whether a button of the source is drawn in its style, going where it goes; under Keep my site, in its case and fill too. */
  const buttonKept = (line: SiteImportLineRef, style: SiteImportButtonStyle): boolean => {
    const id = placement.of.get(line)
    const drawnAs = id ? built.node(id) : undefined
    const drawn = drawnAs?.componentId === 'muiButton' && drawnAs.props?.['variant'] === BUTTON_VARIANT[style] && hasDestination(drawnAs)
    if (!pinned) return drawn
    const cased = look.caseKept(id ?? null)
    if (cased !== null) {
      buttonCase.source += 1
      if (drawn && cased) buttonCase.built += 1
    }
    const filled = style === 'primary' ? look.fillKept(id ?? null) : null
    if (filled !== null) {
      buttonFill.source += 1
      if (drawn && filled) buttonFill.built += 1
    }
    return drawn && cased !== false && filled !== false
  }

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
          // A button whose words say it plays a film plays the page's film where one is drawn (AGL-4140).
          if (block?.kind === 'paragraph' && films && SITE_IMPORT_PLAY_WORDS.test(block.text)) {
            buttons.source += 1
            if (buttonKept(node.line, node.button)) buttons.built += 1
            break
          }
          // A button that goes nowhere a page can send a visitor (a film's play button its script runs) is kept as its words.
          if (block?.kind !== 'link' || !/^(?:https?:|mailto:|tel:)/i.test(block.href)) {
            buttons.unlinked += 1
            break
          }
          buttons.source += 1
          if (buttonKept(node.line, node.button)) buttons.built += 1
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
            // Its corner arrow too (AGL-4138): a card's "↗" is an icon of its own.
            const wanted = (item.icon !== undefined ? 1 : 0) + (item.mark !== undefined ? 1 : 0) + (item.listIcon !== undefined ? (item.list?.length ?? 0) : 0)
            if (!wanted) return
            icons.source += wanted
            const element = units[at]?.element
            if (element) icons.built += Math.min(wanted, built.under(element).filter((id) => built.node(id)?.componentId === 'icon').length)
          })
          // Lines that only share a shape are drawn as their lines: no group to keep.
          if (node.group === 'text') break
          // Its items boxed where the source boxes them, open where it leaves them open (AGL-4152).
          const judged = units.filter((unit) => unit.measured && unit.element)
          if (finished && boxesKept(node) && judged.length) {
            boxed.source += 1
            if (judged.every((unit) => boxedOn(built, unit) === node.boxed)) boxed.built += 1
          }
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
  const framing = framingScore(source, built, placement)
  const headings = headingsScore(source, built, placement)
  const widths = widthsScore(sections, built, roots)
  const forms = ratioBoth(
    sections.reduce((total, section) => total + layoutNodes(section.nodes).filter((node) => node.kind === 'form').length, 0),
    built.order.filter((id) => built.node(id)?.componentId === 'form').length,
  )
  // A film playing behind a section's words is drawn as its poster there, and is the pictures' to count.
  const videos = ratioKept(
    sections.reduce(
      (total, section) => total + layoutNodes(section.nodes).reduce((count, node) => count + (node.kind === 'video' ? 1 : node.kind === 'group' ? node.items.filter((item) => item.video !== undefined).length : 0), 0),
      0,
    ),
    drawnFilms,
  )

  const report: Omit<SiteImportPageFidelity, 'score' | 'lowest'> = {
    words,
    sections: ratioBoth(sections.length, drawnSections.length),
    bands: { ...ratioKept(read.length, bandsKept), read, drawn },
    widths,
    rows: ratioKept(rows.source, rows.built),
    groups: Object.fromEntries(
      Object.entries(groups).map(([kind, entry]) => [kind, { groups: ratioKept(entry.groups, entry.groupsKept), items: ratioKept(entry.items, entry.itemsKept) }]),
    ),
    tables: ratioKept(tables.source, tables.built),
    tabs: ratioKept(tabs.source, tabs.built),
    pictures,
    framing,
    icons: { ...ratioKept(icons.source, icons.built), lone: icons.lone },
    buttons: { ...ratioKept(buttons.source, buttons.built), unlinked: buttons.unlinked },
    headings,
    forms,
    videos,
  }
  if (!finished) return { ...lowestOf(pageMeasures(report)), ...report }

  // The measures a finish adds (AGL-4152).
  if (pinned) report.buttons = { ...report.buttons, case: ratioKept(buttonCase.source, buttonCase.built), fill: ratioKept(buttonFill.source, buttonFill.built) }
  const added: Partial<SiteImportPageFidelity> = {
    scoredAs: { finish, words: improvedWords ? 'improved' : 'kept' },
    free: finish === 'improve' ? [...SITE_IMPORT_IMPROVE_FREE, ...(improvedWords ? ['words'] : [])] : improvedWords ? ['words'] : [],
    align: alignScore(source, built, placement),
    boxed: ratioKept(boxed.source, boxed.built),
    ground: groundScore(sections, look, roots),
    measure: measureScore(source, built, placement, roots),
    readable: look.readable(drawnSections),
    ...(finish === 'improve' ? { design: designScore(source, built, placement, look, roots, drawnSections) } : {}),
    ...(improvedWords ? wordingScores(source, built, placement) : {}),
  }
  const full = { ...report, ...added }
  return { ...lowestOf(finishMeasures(full)), ...full }
}

/**
 * The measures a finished page is scored on (AGL-4152). Keep my site: the
 * structure and the look's pins, its words held apart. Improve it: the
 * content alone, its words among it unless they were improved; everything it
 * may change prints as free.
 */
function finishMeasures(report: Omit<SiteImportPageFidelity, 'score' | 'lowest'>): Array<[string, SiteImportFidelityCount]> {
  const free = new Set(report.free ?? [])
  const pins: Array<[string, SiteImportFidelityCount | undefined]> = [
    ['align', report.align],
    ['boxed', report.boxed],
    ['ground', report.ground],
    ['measure', report.measure],
  ]
  const words: Array<[string, SiteImportFidelityCount]> = report.scoredAs?.finish === 'improve' && !free.has('words') ? [['words', report.words]] : []
  return [...words, ...pageMeasures(report), ...pins.filter((entry): entry is [string, SiteImportFidelityCount] => !!entry[1])].filter(([name]) => !free.has(name))
}

/**
 * Whether a page ships (AGL-4109, AGL-4152): its score at the bar, and what
 * is held at exactly 1 whole. Its words, as written, or under improved words
 * every fact and every line, and each line's meaning at the floor; under
 * Keep my site, its alignment, boxes, grounds and measure.
 */
export function siteImportFidelityHolds(report: SiteImportPageFidelity, threshold = SITE_IMPORT_FIDELITY_THRESHOLD): boolean {
  if (report.score < threshold) return false
  const improvedWords = report.scoredAs?.words === 'improved'
  if (improvedWords ? report.facts?.ratio !== 1 || report.lines?.ratio !== 1 || (report.meaning?.below ?? 0) > 0 : report.words.ratio !== 1) return false
  if (report.scoredAs?.finish !== 'keep') return true
  return [report.align, report.boxed, report.ground, report.measure].every((count) => !count || count.ratio === 1)
}

/** Whether an item of a group is kept: its own element, every line of it found, and the parts its kind and source say it has. */
function itemKept(built: Built, kind: SiteImportGroupKind, item: SiteImportLayoutItem, unit: Unit): boolean {
  if (!unit.whole || !unit.element) return false
  const element = unit.element
  // A question opens its answer: the theme's accordion.
  if (kind === 'faq' && !built.has(element, (node) => node.componentId === 'muiAccordion')) return false
  // An item the source made a link as a whole still goes there.
  if (item.to && !built.has(element, hasDestination)) return false
  // A picture of the item's own, where the library's copy is not known to the score; a film's poster is its Video element's (AGL-4140).
  if (item.image !== undefined && !built.has(element, (node) => node.componentId === 'image' || node.componentId === 'video')) return false
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

const WIDTH_RANK: Readonly<Record<SiteImportWidth, number>> = { sm: 0, md: 1, lg: 2, xl: 3 }

/** The sections as wide as their source: each section's Container against the cap the source sets; a section nothing caps runs the whole page. */
function widthsScore(sections: readonly SiteImportLayoutSection[], built: Built, roots: ReadonlyArray<string | null>): SiteImportFidelityCount {
  const kept = sections.filter((section, index) => {
    const wanted = siteImportWidthOf(section.width)
    if (!wanted) return true
    const root = roots[index]
    if (!root) return false
    const container = built.under(root).find((id) => built.node(id)?.componentId === 'muiContainer' && !built.node(id)?.props?.['disableGutters'])
    if (!container) return true
    const rank = WIDTH_RANK[built.node(container)?.props?.['maxWidth'] as SiteImportWidth]
    return rank !== undefined && rank >= WIDTH_RANK[wanted]
  })
  return ratioKept(sections.length, kept.length)
}

/** The pictures: placed where the library's copies are known, else counted. */
function picturesScore(source: SiteImportFidelitySource, built: Built, placement: Placement): SiteImportFidelityCount {
  const refs = source.layout.sections.flatMap((section) => section.lines).filter((ref) => source.blocks[ref]?.kind === 'image' && isLine(source.blocks[ref]))
  // A film's poster is a picture drawn, on its Video element (AGL-4140).
  const drawn = built.order.filter((id) => built.node(id)?.componentId === 'image' || (built.node(id)?.componentId === 'video' && !!clean(built.node(id)?.props?.['poster']))).length
  if (!source.photos?.length) return ratioBoth(refs.length, drawn)
  return ratioKept(refs.length, refs.filter((ref) => placement.of.has(ref)).length)
}

/** How near two shapes must be to be one (AGL-4138): 5%. */
const SAME_SHAPE = 0.05

/** A box's shape as the compiler writes it, width over height: "1600 / 900", "1.7778", 1.5. */
function shapeOf(value: unknown): number | null {
  if (typeof value === 'number') return value > 0 ? value : null
  if (typeof value !== 'string') return null
  const match = /^\s*(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?\s*$/.exec(value)
  if (!match) return null
  const width = Number(match[1])
  const height = match[2] === undefined ? 1 : Number(match[2])
  return width > 0 && height > 0 ? width / height : null
}

/** A height in px as the compiler writes one: "320px", 320. */
function heightOf(value: unknown): number | null {
  if (typeof value === 'number') return value > 1 ? value : null
  const match = typeof value === 'string' ? /^\s*(\d*\.?\d+)px\s*$/.exec(value) : null
  return match ? Number(match[1]) : null
}

/**
 * The box a built picture is shown in: its own `aspectRatio` or height, else
 * the frame holding it alone that sets one; `whole` where nothing frames it, or
 * it is fitted inside its box (`contain`), which cuts nothing.
 */
function builtFrame(built: Built, id: string): { ratios: number[]; height: number | null } | 'whole' {
  const image = built.node(id)
  if (!image) return 'whole'
  if (image.props?.['objectFit'] === 'contain') return 'whole'
  const read = (node: SiteImportFidelityNode | undefined): { ratios: number[]; height: number | null } | null => {
    const sx = node?.sx ?? {}
    const height = heightOf(node?.componentId === 'image' ? (node.props?.['height'] ?? sx['height']) : sx['height'])
    if (height !== null) return { ratios: [], height }
    const ratio = sx['aspectRatio']
    const ratios = (ratio && typeof ratio === 'object' ? Object.values(ratio) : [ratio]).map(shapeOf).filter((value): value is number => value !== null)
    return ratios.length ? { ratios, height: null } : null
  }
  const own = read(image)
  if (own) return own
  const frame = built.parent.get(id)
  const holder = frame ? built.node(frame) : undefined
  if (holder && built.children(frame as string).length === 1 && holder.componentId === 'muiBox') return read(holder) ?? 'whole'
  return 'whole'
}

/**
 * The pictures framed as their source frames them (AGL-4138): each placed
 * picture's box against the shape the source shows it at — the box or the
 * height it crops it to, else its own, by the library's copy's size or its
 * `width` and `height` — within 5%; a picture the source shows whole may be
 * shown in no box. A round portrait and the picture a section lays behind
 * its words are not scored, nor a picture whose own shape is not known.
 */
function framingScore(source: SiteImportFidelitySource, built: Built, placement: Placement): SiteImportFidelityCount {
  const sizes = new Map<string, number>()
  for (const photo of source.photos ?? []) if (photo.from && photo.width && photo.height) sizes.set(photo.from, photo.width / photo.height)
  let measured = 0
  let kept = 0
  const score = (ref: SiteImportLineRef, fit: SiteImportPictureFit | undefined) => {
    const block = source.blocks[ref]
    const id = placement.of.get(ref)
    if (block?.kind !== 'image' || !id || (fit?.radius ?? 0) >= 999) return
    const frame = builtFrame(built, id)
    const own = sizes.get(block.url) ?? fit?.ratio ?? null
    if (fit?.height) {
      measured += 1
      if (frame !== 'whole' && frame.height !== null && Math.abs(frame.height / fit.height - 1) <= SAME_SHAPE) kept += 1
      return
    }
    const wanted = fit?.box ?? own
    if (wanted === null || wanted === undefined) return
    measured += 1
    if (frame === 'whole') {
      if (!fit?.box) kept += 1
      return
    }
    if (frame.height === null && frame.ratios.every((ratio) => Math.abs(ratio / wanted - 1) <= SAME_SHAPE)) kept += 1
  }
  for (const section of source.layout.sections) {
    // A picture the section lays behind its words fills the band, as it is meant to.
    const behind = section.hero?.picture === 'behind' ? section.lines.find((ref) => source.blocks[ref]?.kind === 'image') : undefined
    for (const node of layoutNodes(section.nodes)) {
      if (node.kind === 'picture' && node.line !== behind) score(node.line, node.fit)
      // A film's poster is framed as any picture is (AGL-4140).
      if (node.kind === 'video' && node.poster !== undefined && node.poster !== behind) score(node.poster, node.fit)
      if (node.kind === 'group') for (const item of node.items) if (item.image !== undefined && item.image !== behind) score(item.image, item.imageFit)
    }
  }
  return ratioKept(measured, kept)
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
    ['widths', report.widths],
    ['rows', report.rows],
    ...Object.entries(report.groups).map(([kind, entry]): [string, SiteImportFidelityCount] => [`${kind} items`, entry.items]),
    ['tables', report.tables],
    ['tabs', report.tabs],
    ['pictures', report.pictures],
    ['framing', report.framing],
    ['icons', report.icons],
    ['buttons', report.buttons],
    ['headings', report.headings],
    ['forms', report.forms],
    ['videos', report.videos],
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
 * The finish: the look kept, the design improved, the words held (AGL-4152)
 *-----------------------------------------*/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What a path of keys holds in a record, or `undefined`. */
const pathIn = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value)

const round = (value: number) => Math.round(value * 1000) / 1000

/** A color as `#rrggbb`, or `null` for anything else. */
function hexOf(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) return null
  const hex = value.trim().toLowerCase()
  return hex.length === 4 ? `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}` : hex
}

/** How far apart two `#rrggbb` colors sit in OKLab (AGL-4152). */
export function siteImportOklabDelta(a: string, b: string): number {
  const one = aiHexOklch(a)
  const two = aiHexOklch(b)
  const at = (color: { C: number; h: number }, part: 'a' | 'b') => color.C * (part === 'a' ? Math.cos((color.h * Math.PI) / 180) : Math.sin((color.h * Math.PI) / 180))
  return Math.hypot(one.L - two.L, at(one, 'a') - at(two, 'a'), at(one, 'b') - at(two, 'b'))
}

/** The contrast an ink and its ground read at: the doctrine's 4.5:1. */
const READS_AT = 4.5

const reads = (ink: string, ground: string) => (contrastRatio(ink, ground) ?? 0) >= READS_AT

function schemeOf(colors: unknown): SiteImportFidelityScheme | null {
  if (!isRecord(colors)) return null
  const scheme: SiteImportFidelityScheme = {
    ground: hexOf(pathIn(colors, 'background', 'default')),
    paper: hexOf(pathIn(colors, 'background', 'paper')),
    brand: hexOf(pathIn(colors, 'primary', 'main')),
    onBrand: hexOf(pathIn(colors, 'primary', 'contrastText')),
    ink: hexOf(pathIn(colors, 'text', 'primary')),
  }
  return Object.values(scheme).some(Boolean) ? scheme : null
}

/** A color a style names, in a scheme: a palette path (`primary.main`) as the scheme draws it, a color as itself. */
function colorIn(value: unknown, scheme: SiteImportFidelityScheme): string | null {
  const own = hexOf(value)
  if (own || typeof value !== 'string') return own
  const paths: Readonly<Record<string, string | null>> = {
    'primary.main': scheme.brand,
    'primary.contrastText': scheme.onBrand,
    'background.default': scheme.ground,
    'background.paper': scheme.paper,
    'text.primary': scheme.ink,
  }
  return paths[value] ?? null
}

/** A CSS `text-transform` as the case a button's words are set in. */
const CASE_OF: Readonly<Record<string, 'upper' | 'none'>> = { uppercase: 'upper', none: 'none', capitalize: 'none', lowercase: 'none' }

/**
 * The colors and buttons of a theme, as a page is drawn in them (AGL-4152):
 * each scheme's grounds, brand and ink, and a filled button's own fill and
 * label where the button's component style sets them apart from the brand's
 * (a `contained` variant, or the contained style overrides), with the case
 * its words are set in: the component's own, else the button Text Style's.
 * `from` says whether the theme is the one the site stores or one computed
 * from its site style. `null` for a theme with no light ground.
 */
export function siteImportFidelityThemeOf(theme: unknown, from: SiteImportFidelityTheme['from'] = 'theme'): SiteImportFidelityTheme | null {
  const light = schemeOf(pathIn(theme, 'colorSchemes', 'light'))
  if (!light?.ground) return null
  const button = pathIn(theme, 'components', 'MuiButton')
  const variants = pathIn(button, 'variants')
  const contained = (Array.isArray(variants) ? variants : []).filter((entry) => {
    const color = pathIn(entry, 'props', 'color')
    return pathIn(entry, 'props', 'variant') === 'contained' && (color === undefined || color === 'primary')
  })
  const styles = [...contained.flatMap((entry) => [pathIn(entry, 'style'), pathIn(entry, 'sx')]), pathIn(button, 'styleOverrides', 'containedPrimary'), pathIn(button, 'styleOverrides', 'contained')].filter(isRecord)
  const pick = (...keys: string[]) => styles.flatMap((style) => keys.map((key) => colorIn(style[key], light))).find((color): color is string => !!color) ?? null
  const transform = [
    pathIn(button, 'styleOverrides', 'root', 'textTransform'),
    pathIn(button, 'sx', 'root', 'textTransform'),
    pathIn(theme, 'typography', 'variants', 'button', 'textTransform'),
    pathIn(theme, 'typography', 'button', 'textTransform'),
  ].find((value): value is string => typeof value === 'string')
  return {
    from,
    light,
    dark: schemeOf(pathIn(theme, 'colorSchemes', 'dark')),
    button: { fill: pick('backgroundColor', 'bgcolor', 'background'), label: pick('color'), case: transform ? (CASE_OF[transform] ?? null) : null },
  }
}

/** The look a built page is drawn in, read through its theme: each node's scheme, a section's ground and ink, a button's case and fill. */
class LookOf {
  constructor(
    private readonly built: Built,
    private readonly facts: SiteImportLayout['look'] | null | undefined,
    readonly theme: SiteImportFidelityTheme | null,
  ) {}

  /** The scheme a node is drawn in: the one the nearest node holding it sets. */
  scheme(id: string): SiteImportFidelityScheme | null {
    if (!this.theme) return null
    for (const at of this.built.ancestry(id)) {
      const scheme = this.built.node(at)?.props?.['colorScheme']
      if (scheme === 'dark') return this.theme.dark
      if (scheme === 'light') return this.theme.light
    }
    return this.theme.light
  }

  /** The color a section is drawn on: its band's role in its scheme. */
  ground(id: string): string | null {
    const scheme = this.scheme(id)
    const fill = this.built.node(id)?.sx?.['bgcolor']
    return scheme ? (fill === undefined || fill === null ? scheme.ground : colorIn(fill, scheme)) : null
  }

  /** The words' ink on that ground: the brand's label on a brand band, the scheme's ink elsewhere. */
  ink(id: string): string | null {
    const scheme = this.scheme(id)
    return scheme ? (this.built.node(id)?.sx?.['bgcolor'] === 'primary.main' ? scheme.onBrand : scheme.ink) : null
  }

  /** A filled button's fill: its own, else the theme's for filled buttons, else its scheme's brand. */
  fill(id: string): string | null {
    const scheme = this.scheme(id)
    if (!scheme) return null
    const own = this.built.node(id)?.sx?.['bgcolor'] ?? this.built.node(id)?.sx?.['backgroundColor']
    return own !== undefined ? colorIn(own, scheme) : (this.theme?.button.fill ?? scheme.brand)
  }

  /** A filled button's label: its own, else the theme's for filled buttons, else the words on its scheme's brand. */
  label(id: string): string | null {
    const scheme = this.scheme(id)
    if (!scheme) return null
    const own = this.built.node(id)?.sx?.['color']
    return own !== undefined ? colorIn(own, scheme) : (this.theme?.button.label ?? scheme.onBrand)
  }

  /** Whether a button is set in the source's case: its own `textTransform`, else the theme's. `null` where either is not known. */
  caseKept(id: string | null): boolean | null {
    const wanted = this.facts?.buttonCase
    if (wanted !== 'upper' && wanted !== 'none') return null
    const own = id ? this.built.node(id)?.sx?.['textTransform'] : undefined
    const drawn = typeof own === 'string' ? (CASE_OF[own] ?? 'none') : (this.theme?.button.case ?? null)
    return drawn === null ? null : drawn === wanted
  }

  /** Whether a filled button is drawn in the source's own fill, within OKLab ΔE 0.05. `null` where either is not known. */
  fillKept(id: string | null): boolean | null {
    const wanted = hexOf(this.facts?.buttonFill)
    if (!wanted || !this.theme) return null
    // A fill its own label cannot be read on is deepened by the look's reading rule, Keep's polish, and is not a loss.
    const label = hexOf(this.facts?.buttonText)
    if (label && !reads(label, wanted)) return null
    const drawn = id ? this.fill(id) : (this.theme.button.fill ?? this.theme.light.brand)
    return drawn ? siteImportOklabDelta(wanted, drawn) <= SITE_IMPORT_GROUND_DELTA : null
  }

  /** The inks and grounds the page shows: each section's, and each filled button's label on its fill, once each. */
  pairs(sectionIds: readonly string[]): Array<[string, string]> {
    if (!this.theme) return []
    const out = new Map<string, [string, string]>()
    const add = (ink: string | null, ground: string | null) => {
      if (ink && ground) out.set(`${ink}/${ground}`, [ink, ground])
    }
    for (const id of sectionIds) add(this.ink(id), this.ground(id))
    for (const id of this.built.order) {
      const node = this.built.node(id)
      if (node?.componentId === 'muiButton' && node.props?.['variant'] === 'contained') add(this.label(id), this.fill(id))
    }
    return [...out.values()]
  }

  /** The inks and grounds that read at 4.5:1, over those the theme says. */
  readable(sectionIds: readonly string[]): SiteImportFidelityCount {
    const pairs = this.pairs(sectionIds)
    return ratioKept(pairs.length, pairs.filter(([ink, ground]) => reads(ink, ground)).length)
  }
}

/**
 * The groups whose boxing is scored (AGL-4152): a group drawn as the source's
 * own rows draws no box per row, and an FAQ's questions are the theme's
 * accordions, boxed as the theme boxes them.
 */
function boxesKept(group: SiteImportLayoutGroup): boolean {
  return !group.inline && group.group !== 'faq' && group.group !== 'text'
}

/** Whether a node draws a box: a card or a paper, or a fill, a shadow or a border on two sides or more of its own. */
function drawsBox(node: SiteImportFidelityNode | undefined): boolean {
  if (!node || node.componentId === 'section') return false
  if (node.componentId === 'muiCard' || node.componentId === 'muiPaper') return true
  const sx = node.sx ?? {}
  const sides = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'].filter((side) => !!sx[side]).length
  return (sx['bgcolor'] !== undefined && sx['bgcolor'] !== 'transparent') || !!sx['border'] || sides >= 2 || (!!sx['boxShadow'] && sx['boxShadow'] !== 'none')
}

/** Whether an item of a group is drawn boxed: a box under its element holding every part of it. */
function boxedOn(built: Built, unit: Unit): boolean {
  if (!unit.element) return false
  return built.under(unit.element).some((id) => drawsBox(built.node(id)) && unit.nodes.every((node) => built.holds(id, node)))
}

/** The lines a section sets in its own flow: its lines and its rows' cells', not its groups', tables' or tabs'. */
function flowLines(nodes: readonly SiteImportLayoutNode[]): SiteImportLineRef[] {
  return nodes.flatMap((node) => (node.kind === 'line' && !node.button ? [node.line] : node.kind === 'row' ? node.cells.flatMap((cell) => flowLines(cell.nodes)) : []))
}

/** The paragraphs past which a section is a long read, set at `md` and at the start (the compile's own count). */
const LONG_READ_PARAGRAPHS = 4

/** Whether a section of the source is a long read: more paragraphs in its own flow (not its groups') than a section's words, which a page sets at the start to be read. */
const longRead = (source: SiteImportFidelitySource, section: SiteImportLayoutSection) => flowLines(section.nodes).filter((ref) => source.blocks[ref]?.kind === 'paragraph').length > LONG_READ_PARAGRAPHS

/**
 * The sections set as the source sets them (AGL-4152): their headings, else
 * their words, centered or at the start. The opening a hero draws is the
 * hero's to place, and is measured by its framing and pictures; a long read
 * set at the start, as text is read, is kept whatever its source centers.
 */
function alignScore(source: SiteImportFidelitySource, built: Built, placement: Placement): SiteImportFidelityCount {
  let measured = 0
  let kept = 0
  for (const [index, section] of source.layout.sections.entries()) {
    if (index === 0 && section.hero?.picture) continue
    const own = flowLines(section.nodes)
    const headings = own.filter((ref) => source.blocks[ref]?.kind === 'heading')
    const lines = (headings.length ? headings : own.filter((ref) => ['paragraph', 'list-item', 'quote'].includes(source.blocks[ref]?.kind ?? ''))).flatMap((ref) => {
      const id = placement.of.get(ref)
      const node = id ? built.node(id) : undefined
      return node?.componentId === 'muiTypography' ? [node] : []
    })
    if (!lines.length) continue
    measured += 1
    const centered = lines.filter((node) => node.props?.['align'] === 'center').length
    const drawn = centered * 2 > lines.length ? 'center' : 'start'
    if (drawn === section.align || (drawn === 'start' && longRead(source, section))) kept += 1
  }
  return ratioKept(measured, kept)
}

/** Each section with a ground of its own on a ground of the theme within OKLab ΔE 0.05 of it. A picture or a film behind its words is its ground, and is not scored. */
function groundScore(sections: readonly SiteImportLayoutSection[], look: LookOf, roots: ReadonlyArray<string | null>): NonNullable<SiteImportPageFidelity['ground']> {
  if (!look.theme) return { ...ratioKept(0, 0), theme: null, worst: null }
  let measured = 0
  let kept = 0
  let worst: number | null = null
  for (const [index, section] of sections.entries()) {
    const wanted = hexOf(section.background)
    if (!wanted || section.backdrop?.kind === 'picture' || section.backdrop?.kind === 'video') continue
    measured += 1
    const root = roots[index]
    const drawn = root ? look.ground(root) : null
    if (!drawn) continue
    const delta = siteImportOklabDelta(wanted, drawn)
    worst = Math.max(worst ?? 0, delta)
    if (delta <= SITE_IMPORT_GROUND_DELTA) kept += 1
  }
  return { ...ratioKept(measured, kept), theme: look.theme.from, worst: worst === null ? null : round(worst) }
}

/** The width a page is measured at (AGL-4152): the 1280 the 11/4 live checks set the source beside the import at. */
const VIEW_PX = 1280

/** The Container element's Max Width steps, in px, as the theme's breakpoints set them. */
const CONTAINER_PX: Readonly<Record<string, number>> = { xs: 444, sm: 600, md: 900, lg: 1200, xl: 1536 }

/** What a responsive value is at the width a page is measured at: its `lg`, else the nearest below. */
function atView(value: unknown): unknown {
  if (!isRecord(value)) return value
  for (const key of ['lg', 'md', 'sm', 'xs']) if (value[key] !== undefined) return value[key]
  return undefined
}

/** A Grid item's columns, of 12, at the width a page is measured at: `xs:12 md:6` is 6. */
function gridSpan(size: unknown): number | null {
  if (typeof size === 'number') return size
  const steps = typeof size === 'string' ? Object.fromEntries(size.split(/\s+/).flatMap((part) => (/^(\w+):(\d+)$/.exec(part) ? [[part.split(':')[0], Number(part.split(':')[1])]] : []))) : isRecord(size) ? size : null
  const span = steps ? atView(steps) : null
  return typeof span === 'number' && span > 0 ? Math.min(12, span) : null
}

/** How wide a node's box runs at the width a page is measured at, in px, from its section down, and how wide its section's content runs. */
function boxPx(built: Built, id: string, root: string | null): { box: number; section: number } {
  const chain = built.ancestry(id).reverse()
  const from = root ? chain.indexOf(root) : 0
  let width = VIEW_PX
  let section: number | null = null
  for (const at of chain.slice(Math.max(0, from))) {
    const node = built.node(at)
    if (!node) continue
    if (node.componentId === 'muiContainer') {
      const cap = CONTAINER_PX[String(atView(node.props?.['maxWidth']))]
      if (cap) width = Math.min(width, cap)
      section ??= width
    }
    if (node.componentId === 'muiGrid' && !setsSideBySide(node)) width *= (gridSpan(node.props?.['size']) ?? 12) / 12
    const max = atView(node.sx?.['maxWidth'])
    if (typeof max === 'number') width = max <= 1 ? width * max : Math.min(width, max)
    else if (typeof max === 'string' && CONTAINER_PX[max]) width = Math.min(width, CONTAINER_PX[max] as number)
    else if (typeof max === 'string' && /^\d+(?:\.\d+)?%$/.test(max)) width *= parseFloat(max) / 100
    else if (typeof max === 'string' && /^\d+(?:\.\d+)?px$/.test(max)) width = Math.min(width, parseFloat(max))
  }
  return { box: width, section: section ?? VIEW_PX }
}

/** The hero heading's box as a share of its section, against the source's measure: within 10%, where the reader kept it. */
function measureScore(source: SiteImportFidelitySource, built: Built, placement: Placement, roots: ReadonlyArray<string | null>): NonNullable<SiteImportPageFidelity['measure']> {
  const index = source.layout.sections.findIndex((section) => !!section.hero)
  const section = source.layout.sections[index]
  const wanted = section?.hero?.measure
  if (!section || typeof wanted !== 'number' || !(wanted > 0)) return { ...ratioKept(0, 0), shares: null }
  const across = Math.min(section.width ?? VIEW_PX, VIEW_PX)
  const share = Math.min(1, wanted / across)
  const heading = section.lines.find((ref) => {
    const block = source.blocks[ref]
    return block?.kind === 'heading' && block.level === 1
  })
  const id = heading === undefined ? undefined : placement.of.get(heading)
  if (!id) return { ...ratioKept(1, 0), shares: { source: round(share), built: 0 } }
  const drawn = boxPx(built, id, roots[index] ?? null)
  const builtShare = Math.min(1, drawn.box / drawn.section)
  return { ...ratioKept(1, Math.abs(builtShare / share - 1) <= SITE_IMPORT_MEASURE_SHARE ? 1 : 0), shares: { source: round(share), built: round(builtShare) } }
}

/** How wide a section's words run at the width a page is measured at: its first Container's Max Width, else the page. */
function runPx(built: Built, root: string | undefined | null): number {
  const container = root ? built.under(root).find((id) => built.node(id)?.componentId === 'muiContainer') : undefined
  const cap = container ? CONTAINER_PX[String(atView(built.node(container)?.props?.['maxWidth']))] : undefined
  return Math.min(cap ?? VIEW_PX, VIEW_PX)
}

/** A line of the design measure: the share of what it asks the source and the build each do, `null` where neither is asked anything. */
function designLine(source: [number, number], built: [number, number]): SiteImportDesignLine | null {
  if (!source[1] || !built[1]) return null
  return { source: round(source[0] / source[1]), built: round(built[0] / built[1]) }
}

/**
 * Whether the build reads better than its source (AGL-4152), line by line:
 * its rhythm, its measure, its opening, its groups and its colors. Better is
 * at or above the source on every line and above it on one.
 */
function designScore(source: SiteImportFidelitySource, built: Built, placement: Placement, look: LookOf, roots: ReadonlyArray<string | null>, drawnSections: readonly string[]): SiteImportDesignFidelity {
  const sections = source.layout.sections
  // Rhythm: neighbors set apart by their bands, or a rule between them.
  const apart = (pairs: number, at: (index: number) => boolean): [number, number] => [Array.from({ length: pairs }, (_, index) => at(index)).filter(Boolean).length, pairs]
  const ruled = (id: string | undefined) => !!id && (!!built.node(id)?.sx?.['borderTop'] || !!built.node(id)?.sx?.['borderBottom'])
  const drawnBand = (id: string | undefined) => siteImportFidelityBandOf(id ? built.node(id) : undefined)
  const rhythm = designLine(
    apart(Math.max(0, sections.length - 1), (index) => sections[index]?.band !== sections[index + 1]?.band),
    apart(Math.max(0, drawnSections.length - 1), (index) => drawnBand(drawnSections[index]) !== drawnBand(drawnSections[index + 1]) || ruled(drawnSections[index]) || ruled(drawnSections[index + 1])),
  )
  // Measure: words that run no wider than `lg`, a long read no wider than `md`, each section as its Container runs it.
  const caps = sections.map((section) => (longRead(source, section) ? (CONTAINER_PX['md'] as number) : (CONTAINER_PX['lg'] as number)))
  const measure = designLine(
    // The source's cap read as the Container step a page brought in draws it at; a section it sets none on runs the page.
    [sections.filter((section, index) => Math.min(CONTAINER_PX[siteImportWidthOf(section.width) ?? 'xl'] as number, VIEW_PX) <= (caps[index] as number)).length, sections.length],
    [drawnSections.filter((id, index) => runPx(built, id) <= (caps[index] ?? (CONTAINER_PX['lg'] as number))).length, drawnSections.length],
  )
  // Opening: a first section holding a picture opens as the hero, its heading and its picture together.
  const first = sections[0]
  const pictured = !!first && (first.lines.some((ref) => source.blocks[ref]?.kind === 'image') || first.backdrop?.kind === 'picture' || first.backdrop?.kind === 'video')
  const title = sections.flatMap((section) => section.lines).find((ref) => {
    const block = source.blocks[ref]
    return block?.kind === 'heading' && block.level === 1
  })
  const titleNode = title === undefined ? undefined : placement.of.get(title)
  const opener = drawnSections[0]
  const opens = !!opener && !!titleNode && built.holds(opener, titleNode) && built.has(opener, (node) => node.componentId === 'image' || node.componentId === 'video')
  const opening = pictured ? designLine([first?.hero?.picture ? 1 : 0, 1], [opens ? 1 : 0, 1]) : null
  // Grouped: three or more like items drawn as one group: each its own element, held together apart from the section's other lines.
  let runs = 0
  let sourceGrouped = 0
  let builtGrouped = 0
  for (const [index, section] of sections.entries()) {
    for (const node of layoutNodes(section.nodes)) {
      if (node.kind !== 'group' || node.items.length < 3) continue
      runs += 1
      if (node.group !== 'text') sourceGrouped += 1
      const units = unitsOn(built, placement, node.items.map((item) => item.lines), roots[index] ?? null).filter((unit) => unit.measured)
      const parents = new Set(units.map((unit) => (unit.element ? built.parent.get(unit.element) : null)))
      const parent = parents.size === 1 ? [...parents][0] : null
      const mine = new Set(node.items.flatMap((item) => item.lines))
      const others = section.lines.flatMap((ref) => (mine.has(ref) ? [] : [placement.of.get(ref)])).filter((id): id is string => !!id)
      if (units.length >= 3 && parent && units.every((unit) => unit.element) && !others.some((id) => built.holds(parent, id))) builtGrouped += 1
    }
  }
  const grouped = designLine([sourceGrouped, runs], [builtGrouped, runs])
  // Readable: the source's words on its grounds and its buttons' labels on their fill, against the build's.
  const facts = source.layout.look
  const sourcePairs: Array<[string, string]> = []
  const ink = hexOf(facts?.text)
  for (const section of sections) {
    const ground = hexOf(section.background)
    if (ink && ground && (section.band === 'plain' || section.band === 'soft')) sourcePairs.push([ink, ground])
  }
  const buttonFill = hexOf(facts?.buttonFill)
  const buttonText = hexOf(facts?.buttonText)
  if (buttonFill && buttonText) sourcePairs.push([buttonText, buttonFill])
  const builtPairs = look.pairs(drawnSections)
  const readable = designLine([sourcePairs.filter(([a, b]) => reads(a, b)).length, sourcePairs.length], [builtPairs.filter(([a, b]) => reads(a, b)).length, builtPairs.length])
  const lines = [rhythm, measure, opening, grouped, readable].filter((line): line is SiteImportDesignLine => !!line)
  const better = lines.length > 0 && lines.every((line) => line.built >= line.source) && lines.some((line) => line.built > line.source)
  return { rhythm, measure, opening, grouped, readable, better }
}

/*------------------------------------------
 * Improved words (G4)
 *-----------------------------------------*/

/** The words that carry no content of a line: what a rewrite may change freely. */
const STOP_WORDS = new Set(
  'a about all also an and any are as at be been but by can do does each for from get had has have he her here his how i if in into is it its just me more most my no not of on one only or our out over own so some such than that the their them then there these they this those to too up us very was we were what when where which who why will with you your yours'.split(' '),
)

/** A word's crude stem (G4): its case and one ending dropped, so "builds", "building" and "build" read as one word. */
function stemOf(word: string): string {
  let stem = word.toLowerCase().replace(/['’]s$/, '')
  for (const [ending, to] of [
    [/ies$/, 'y'],
    [/ing$/, ''],
    [/ed$/, ''],
    [/ly$/, ''],
    [/(?<!s)s$/, ''],
  ] as const) {
    if (ending.test(stem) && stem.replace(ending, to).length >= 3) {
      stem = stem.replace(ending, to)
      break
    }
  }
  return stem.length > 3 ? stem.replace(/e$/, '') : stem
}

/** A line's content words, by stem. */
const contentOf = (text: string): Set<string> => new Set(wordsOf(text).filter((word) => word.length >= 2 && !STOP_WORDS.has(word.toLowerCase())).map(stemOf))

/**
 * The share of a line's content words another keeps (G4): 1 for a line with
 * none. A rewrite's `meaning`, and the floor the wording pass holds each
 * rewritten line to (`ai-site-import-wording.ts`), so a rewrite it keeps
 * never scores under it here.
 */
export function siteImportContentKept(line: string, rewrite: string): number {
  return contentKept(line, rewrite)
}

/** The share of a line's content words another keeps: 1 for a line with none. */
function contentKept(line: string, rewrite: string): number {
  const said = contentOf(line)
  if (!said.size) return 1
  const kept = contentOf(rewrite)
  return [...said].filter((stem) => kept.has(stem)).length / said.size
}

/** The facts a run of words carries, each by its kind, in the order they are taken: emails, addresses, phones, numbers. */
const FACTS: ReadonlyArray<readonly [string, RegExp, (found: string) => string | null]> = [
  ['email', /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, (found) => found.toLowerCase()],
  [
    'url',
    /\bhttps?:\/\/[^\s<>"'()]+|\bwww\.[^\s<>"'()]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|us|uk|ca|au|de|fr|info|biz|me|shop|store|site|online)\b(?:\/[^\s<>"'()]*)?/giu,
    (found) => found.toLowerCase().replace(/[.,;:!?]+$/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''),
  ],
  ['phone', /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/g, (found) => (found.replace(/\D/g, '').length >= 7 ? found.replace(/\D/g, '') : null)],
  ['number', /[$€£¥₹]?\s?\d+(?:[.,]\d+)*\s?%?/gu, (found) => found.replace(/\s+/g, '').replace(/[.,]+$/, '')],
]

/** A line's facts: its prices and numbers with their currency, emails, phones and addresses, each as often as it says it. */
function factsIn(text: string): string[] {
  let rest = text
  const out: string[] = []
  for (const [kind, pattern, normal] of FACTS) {
    rest = rest.replace(pattern, (found) => {
      const value = normal(found)
      if (!value) return found
      out.push(`${kind}:${value}`)
      return ' '.repeat(found.length)
    })
  }
  return out
}

/** The words of a line in capitals, each with whether it opens a sentence. */
function capitalsIn(text: string): Array<{ word: string; opens: boolean }> {
  const out: Array<{ word: string; opens: boolean }> = []
  let last = 0
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)) {
    const at = match.index ?? 0
    const opens = last === 0 || /[.!?:;•·|—–"“(]/.test(text.slice(last, at))
    last = at + match[0].length
    if (/^\p{Lu}/u.test(match[0])) out.push({ word: match[0], opens })
  }
  return out
}

/** Whether a line is set all in capitals or in title case: its capitals say nothing of its names. */
function shouted(text: string): boolean {
  if (!/\p{Ll}/u.test(text)) return true
  const long = wordsOf(text).filter((word) => word.length >= 4)
  return long.length >= 3 && long.every((word) => /^\p{Lu}/u.test(word))
}

/** What a page's facts are told apart by (G4): the names its source says, and every word it says in any case. */
export interface SiteImportFactScope {
  /** Each word the source capitalizes past a sentence's first, in a line not set all in capitals. */
  names: ReadonlySet<string>
  /** Every word the source says, lowercased. */
  said: ReadonlySet<string>
}

/** The fact scope of a page's source lines. */
export function siteImportFactScope(sourceTexts: readonly string[]): SiteImportFactScope {
  return {
    names: new Set(sourceTexts.filter((text) => !shouted(text)).flatMap((text) => capitalsIn(text).filter((entry) => !entry.opens && entry.word.length > 1).map((entry) => entry.word))),
    said: new Set(sourceTexts.flatMap(wordsOf).map((word) => word.toLowerCase())),
  }
}

/**
 * The fact tokens one line says (G4), each as often as it says it: its
 * prices and numbers with their currency, emails, web addresses and phones,
 * and its names. `own` is a rewrite's line, where a word capitalized past a
 * sentence's first that the source never says is a name the rewrite made up.
 * Two lines with the same tokens keep the same facts, which is how the
 * wording pass holds each line it rewrites (`ai-site-import-wording.ts`).
 */
export function siteImportFactTokens(text: string, scope: SiteImportFactScope, own: boolean): string[] {
  const out = factsIn(text)
  for (const entry of capitalsIn(text)) {
    if (scope.names.has(entry.word)) out.push(`name:${entry.word}`)
    // A name the source never says, past a sentence's first word, is one the rewrite made up.
    else if (own && !entry.opens && entry.word.length > 1 && !shouted(text) && !scope.said.has(entry.word.toLowerCase())) out.push(`name:${entry.word}`)
  }
  return out
}

/**
 * The facts of a page's words (G4): every price and number with its
 * currency, email, phone and address, and every name — a word the source
 * capitalizes past a sentence's first — as often as the source says it,
 * and no fact or name the source does not have.
 */
function factsScore(sourceTexts: readonly string[], builtTexts: readonly string[]): SiteImportFidelityFacts {
  const scope = siteImportFactScope(sourceTexts)
  const tally = (texts: readonly string[], own: boolean) => {
    const counts = new Map<string, number>()
    for (const text of texts) for (const token of siteImportFactTokens(text, scope, own)) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  }
  const from = tally(sourceTexts, false)
  const to = tally(builtTexts, true)
  let source = 0
  let builtCount = 0
  let both = 0
  const missing: string[] = []
  const extra: string[] = []
  for (const [token, count] of from) {
    source += count
    const on = to.get(token) ?? 0
    both += Math.min(count, on)
    if (on < count) missing.push(token)
  }
  for (const [token, count] of to) {
    builtCount += count
    if (count > (from.get(token) ?? 0)) extra.push(token)
  }
  const most = Math.max(source, builtCount)
  return { source, built: builtCount, missing: source - both, extra: builtCount - both, ratio: most > 0 ? both / most : 1, examples: { missing: missing.slice(0, 8), extra: extra.slice(0, 8) } }
}

/** A page's words improved (G4): its facts, its lines each placed once, and each rewrite's meaning. */
function wordingScores(source: SiteImportFidelitySource, built: Built, placement: Placement): Pick<SiteImportPageFidelity, 'facts' | 'lines' | 'meaning'> {
  const text = (ref: SiteImportLineRef) => clean((source.blocks[ref] as { text?: string } | undefined)?.text)
  const lines = source.layout.sections.flatMap((section) => section.lines).filter((ref) => isLine(source.blocks[ref]) && source.blocks[ref]?.kind !== 'image')
  const placed = lines.filter((ref) => placement.of.has(ref)).length
  const extra = placement.unclaimed().length
  const rewritten = [...placement.rewrittenAs].flatMap(([ref, rewrite]) => (contentOf(text(ref)).size ? [{ line: ref, kept: round(contentKept(text(ref), rewrite)), source: text(ref), built: rewrite }] : []))
  const below = rewritten.filter((line) => line.kept < SITE_IMPORT_MEANING_FLOOR)
  return {
    facts: factsScore(source.blocks.flatMap((block) => (isLine(block) && block.kind !== 'image' ? [clean(block.text)] : [])), built.pieces.map((piece) => piece.text)),
    lines: { source: lines.length, built: placed, ratio: lines.length + extra > 0 ? placed / (lines.length + extra) : 1, extra },
    meaning: {
      lines: rewritten.length,
      below: below.length,
      lowest: rewritten.reduce((least, line) => Math.min(least, line.kept), 1),
      ratio: rewritten.length ? (rewritten.length - below.length) / rewritten.length : 1,
      floor: SITE_IMPORT_MEANING_FLOOR,
      examples: below.slice(0, 8),
    },
  }
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
  /** Each column of a menu's panel drawn as its own part of the panel's row, in the source's order, with its heading, words and entries (AGL-4139). */
  menuColumns: SiteImportFidelityCount
  /** The source's filled columns and footer boxes, each drawn in a filled box (AGL-4139). */
  panels: SiteImportFidelityCount
  /** The entries whose icon sits in a filled tile, drawn so (AGL-4139). */
  tiles: SiteImportFidelityCount
  /** The pictures a menu's columns show, placed in them (AGL-4139). */
  pictures: SiteImportFidelityCount
  /** The menus the source opens on hover, opening on hover (AGL-4139). */
  hover: SiteImportFidelityCount
  /** The footer opens with the logo, where the source's does (AGL-4139). */
  logo: SiteImportFidelityCount
  /** The footer's columns under their headings. */
  columns: SiteImportFidelityCount
  /** The footer's links, its columns' and its own. */
  links: SiteImportFidelityCount
  /** Its profiles on other sites. */
  social: SiteImportFidelityCount
  /** Its words, address, phone, email and © line, word for word. */
  facts: SiteImportFidelityCount
}

/**
 * A menu of the header's row as it is built (AGL-4139): the Dropdown or Mega
 * Menu element under its name, or its name as a link and the panel its hover
 * shows; what it holds, and whether it opens on hover.
 */
function siteImportBuiltMenu(built: Built, row: string, name: string): { inside: string[]; hover: boolean } | null {
  const named = (id: string) => clean(labelOf(built.node(id))) === clean(name)
  const hoverSteps = (id: string): Array<Record<string, unknown>> =>
    (built.node(id)?.interactions ?? []).flatMap((interaction) => {
      const record = interaction as { enabled?: boolean; trigger?: { event?: string }; steps?: unknown[] }
      return record.enabled !== false && record.trigger?.event === 'elementHoverEnter' ? ((record.steps ?? []) as Array<Record<string, unknown>>) : []
    })
  const element = built.under(row).find((id) => (built.node(id)?.componentId === 'muiMegaMenu' || built.node(id)?.componentId === 'muiNavMenu') && named(id))
  if (element) return { inside: built.under(element), hover: hoverSteps(element).some((step) => step['type'] === 'openMenu') }
  const link = built.under(row).find((id) => LINK_COMPONENTS.has(built.node(id)?.componentId ?? '') && named(id))
  if (!link) return null
  // The panel its hover shows: on the name itself, or on the item that holds the name and its panel.
  const item = built.children(row).find((id) => built.holds(id, link)) ?? link
  const shown = [...hoverSteps(link), ...hoverSteps(item)].filter((step) => step['type'] === 'showElement')
  const panelId = shown.map((step) => /^\[data-aglyn="leaf:(.+)"\]$/.exec(String(step['selector'] ?? ''))?.[1]).find((id): id is string => !!id && !!built.node(id))
  if (!panelId) return null
  return { inside: [...new Set([...built.under(item), ...built.under(panelId)])], hover: true }
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

  // The row: its items by name, in order; a menu drawn as its name and its panel by its name's.
  const itemLabel = (id: string) => labelOf(built.node(id)) || labelOf(built.node(built.children(id).find((child) => LINK_COMPONENTS.has(built.node(child)?.componentId ?? '')) ?? ''))
  const rowItems = row ? built.children(row).map(itemLabel) : []
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
  const menuColumns = { source: 0, built: 0 }
  const panels = { source: 0, built: 0 }
  const tiles = { source: 0, built: 0 }
  const pictures = { source: 0, built: 0 }
  const hover = { source: 0, built: 0 }
  const filled = (id: string) => {
    const node = built.node(id)
    return !!node && (node.componentId === 'muiCard' || node.props?.['colorScheme'] === 'dark' || node.sx?.['bgcolor'] !== undefined)
  }
  const label = (id: string) => labelOf(built.node(id)) || shownTexts(built.node(id))[0] || ''
  for (const group of groups) {
    if (!group.items.length) continue
    menus.source += 1
    entries.source += group.items.length
    if (group.panel?.hover) hover.source += 1
    const drawnMenu = row ? siteImportBuiltMenu(built, row, group.label) : null
    for (const entry of group.items) {
      if (entry.text) details.source += 1
      if (entry.iconPath) details.source += 1
      if (entry.tile) tiles.source += 1
    }
    const columns = group.columns ?? []
    const panelled = columns.length >= 2 || columns.some((column) => column.band !== 'plain' || !!column.image || column.lines.length > 0)
    if (panelled) {
      menuColumns.source += columns.length
      panels.source += columns.filter((column) => column.band !== 'plain').length
      pictures.source += columns.filter((column) => !!column.image).length
    }
    if (!drawnMenu) continue
    menus.built += 1
    if (group.panel?.hover && drawnMenu.hover) hover.built += 1
    const inside = drawnMenu.inside
    if (panelled) {
      // The panel's row: the part of it whose children hold the source's columns, each in its place.
      const wanted = columns.map((column, index) => ({ column, labels: group.items.filter((entry) => Math.min(entry.at ?? 0, columns.length - 1) === index).map((entry) => clean(entry.label)) }))
      const placed = (cell: string, want: (typeof wanted)[number]) => {
        const texts = new Set(built.under(cell).map(label))
        return want.labels.every((name) => texts.has(name)) && (!want.column.heading || texts.has(clean(want.column.heading))) && want.column.lines.every((line) => texts.has(clean(line)))
      }
      let best: string[] = []
      for (const id of inside) {
        const cells = built.children(id)
        if (cells.length < columns.length) continue
        const kept = wanted.filter((want, index) => !!cells[index] && placed(cells[index] as string, want)).length
        if (kept > best.filter(Boolean).length) best = wanted.map((want, index) => (cells[index] && placed(cells[index] as string, want) ? (cells[index] as string) : ''))
      }
      menuColumns.built += best.filter(Boolean).length
      columns.forEach((column, index) => {
        const cell = best[index]
        if (!cell) return
        if (column.band !== 'plain' && built.under(cell).some(filled)) panels.built += 1
        if (column.image && built.has(cell, (node) => node.componentId === 'image')) pictures.built += 1
      })
    }
    const links = inside.filter((id) => LINK_COMPONENTS.has(built.node(id)?.componentId ?? ''))
    const texts = new Set(inside.flatMap((id) => shownTexts(built.node(id))))
    for (const entry of group.items) {
      const link = links.find((id) => labelOf(built.node(id)) === clean(entry.label) || shownTexts(built.node(id)).includes(clean(entry.label)) || built.under(id).some((at) => shownTexts(built.node(at)).includes(clean(entry.label))))
      if (!link) continue
      entries.built += 1
      if (entry.text && texts.has(clean(entry.text))) details.built += 1
      if (entry.iconPath && built.has(link, (node) => node.componentId === 'icon')) details.built += 1
      // A tile: the icon held in a filled box of its own.
      const icon = built.under(link).find((id) => built.node(id)?.componentId === 'icon')
      const box = icon ? built.parent.get(icon) : undefined
      if (entry.tile && box && box !== link && filled(box)) tiles.built += 1
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
    ...groups.flatMap((group) => [
      clean(group.label),
      ...group.items.map((entry) => clean(entry.label)),
      // Every word of a menu's panel too (AGL-4139): its columns' headings and lines.
      ...(group.columns ?? []).flatMap((column) => [...(column.heading ? [clean(column.heading)] : []), ...column.lines.map(clean)]),
    ]),
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
  // Its filled boxes, each a filled box holding its heading, words and links (AGL-4139).
  for (const box of foot?.panels ?? []) {
    panels.source += 1
    const want = [box.heading, ...box.lines, ...(box.links ?? []).map((entry) => entry.label)].filter((text): text is string => !!text).map(clean)
    if (footIds.some((id) => filled(id) && want.every((text) => built.under(id).some((at) => label(at) === text)))) panels.built += 1
  }
  // It opens with the logo: a picture before any of its words.
  const firstWords = footIds.find((id) => shownTexts(built.node(id)).length > 0)
  const firstPicture = footIds.find((id) => built.node(id)?.componentId === 'image')
  const logo = ratioKept(foot?.logo ? 1 : 0, foot?.logo && firstPicture && (!firstWords || footIds.indexOf(firstPicture) < footIds.indexOf(firstWords)) ? 1 : 0)

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
    menuColumns: ratioKept(menuColumns.source, menuColumns.built),
    panels: ratioKept(panels.source, panels.built),
    tiles: ratioKept(tiles.source, tiles.built),
    pictures: ratioKept(pictures.source, pictures.built),
    hover: ratioKept(hover.source, hover.built),
    logo,
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
    ['menuColumns', report.menuColumns],
    ['panels', report.panels],
    ['tiles', report.tiles],
    ['pictures', report.pictures],
    ['hover', report.hover],
    ['logo', report.logo],
    ['columns', report.columns],
    ['links', report.links],
    ['social', report.social],
    ['facts', report.facts],
  ]
  return { ...lowestOf(measures), ...report }
}
