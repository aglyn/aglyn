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

import { REUSABLE_INSTANCE_COMPONENT_ID } from '@aglyn/aglyn/app-utils/reusable-component-keys'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  AI_ICON_COMPONENT_ID,
  aiIconOfWord,
  AI_ICON_LIBRARY,
  type AiIconLibraryEntry,
} from '../runtime/ai-icon-library'
import { AI_INSTANCE_REF_PROP } from '../runtime/ai-node-tree'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'
import { aiPageScrollInteraction } from '../runtime/ai-page-links'
import {
  aiLayoutFitText,
  aiLayoutQuoteGap,
  aiLayoutWords,
  type AiLayoutTextPlace,
} from './ai-layout-copy'
import {
  AI_LAYOUT_GROUP_KINDS,
  AI_LAYOUT_MAX_ITEMS,
  type AiLayoutBand,
  type AiLayoutBlock,
  type AiLayoutGroupStyle,
  type AiLayoutItem,
  type AiLayoutLink,
  type AiLayoutPicture,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from './ai-layout-language'
import {
  AI_LAYOUT_HALF_HEROES,
  aiLayoutDesignChoices,
  aiLayoutFamily,
  aiLayoutGroupVariant,
  type AiLayoutDesign,
  type AiLayoutDesignChoices,
  type AiLayoutGroupVariant,
  type AiLayoutHeroVariant,
} from './ai-layout-design'
import {
  AI_LAYOUT_FEATURED_RECORDS,
  AI_LAYOUT_LISTING_ELEMENTS,
  aiLayoutIsRecordImageAlt,
  aiLayoutListingAt,
  aiLayoutRecordHref,
  aiLayoutRecordImageAltField,
  aiLayoutRepeatFilterOf,
  type AiLayoutListing,
  type AiLayoutListingFilter,
  type AiLayoutListingRole,
} from './ai-layout-listings'
import { aiStorefrontItemIcons } from './ai-layout-storefront'
import { aiLayoutContactLabel, aiLayoutWithContactLines } from './ai-layout-contact'
import { AI_LAYOUT_LABELS_EN, aiLayoutLabel } from './ai-layout-labels'
import {
  aiLayoutRenamedLabel,
  aiLayoutResolveLink,
  type AiLayoutDestination,
  type AiLayoutLinkScope,
  type AiLayoutTargets,
} from './ai-layout-links'
import {
  aiLayoutSpans,
  AI_LAYOUT_FRAMES,
  AiLayoutTreeBuilder,
  type AiLayoutRawTree,
} from './ai-layout-tree'

/**
 * The layout language compiler (AGL-3660): a page designed in the language
 * (`ai-layout-language.ts`) becomes the element tree the page stores — built
 * from the palette's elements and the theme's tokens only, so the doctrine's
 * building rules hold by construction rather than by a re-ask.
 *
 * What the compiler decides, so no model has to:
 *
 *  - STRUCTURE. A section is a semantic `section` band around a Container at
 *    a stock width, its content a Stack on the spacing scale; a row of
 *    columns is a Grid container whose items are sized `xs:12 md:N` from the
 *    relative widths, full width on a phone; a group of cards is a Grid of
 *    sized items, or a Stack where it would be one column.
 *  - THE OUTLINE. The first section's first heading is the page's one h1 (the
 *    plan's title stands in where it gave none); every other section opens at
 *    h2; a card's title is one level under its section's heading.
 *  - TOKENS. Colors are palette roles, never values: a `brand` band is
 *    `primary.main` with its contrast text, a `dark` band pins the site's dark
 *    scheme, a `soft` band is the paper surface. So a band reads in the
 *    visitor's light or dark mode alike.
 *  - LINKS. A button goes to a real page id, a section of this page through
 *    the platform's Scroll to element interaction, or an address the brief
 *    gave (`ai-layout-links.ts`); one with nowhere to go is left out.
 *  - THE PLAN. A form or a component the plan places in a section is placed
 *    there, by its id, whether or not the answer remembered it.
 *  - RULE 1. Where the workspace keeps reusable components, a section's
 *    repeated items are instances of the component its plan places; with
 *    none to place they are drawn in their compact form, a title over its
 *    text, which is smaller than a block worth a component. A workspace that
 *    keeps none (Free) draws its repeats in full.
 *  - RULES 8, 9, 14, 16. Seven items a group at most; every picture carries
 *    its description as alt text; copy fitted to its place at a clean
 *    boundary, with any phone number or email the brief did not give written
 *    as a gap; no wrapper around a lone wrapper, no empty element, and no
 *    multi-key inline style repeated across a page.
 */

export interface AiLayoutPagePlan {
  /** The page's title in its plan: the h1 where the first section names none. */
  title: string
  sections: ReadonlyArray<{
    name: string
    uses: readonly string[]
    items: number
  }>
}

export interface AiLayoutCompileOptions {
  /**
   * Whether the workspace keeps reusable components (AGL-3030). Where it does,
   * rule 1 holds: repeated items are instances of a component the plan
   * places, or drawn in their compact form.
   */
  reusableComponents: boolean
  /**
   * The ids the page stores its sections under, in plan order
   * (`aiPageSectionNodeId`): each section root is written under its own, and
   * a link to a section scrolls to it. Absent, `section-<n>`.
   */
  sectionIds?: readonly string[]
  /**
   * The site the page belongs to — its kind, its seed and whether this is its
   * home — which the designer layer draws the page's sections for
   * (`ai-layout-design.ts`): a photo hero, pictures beside words, work as an
   * uneven grid of pictures. Absent, the compiler's first design.
   */
  design?: AiLayoutDesign
  /**
   * The site's language (AGL-3760), a code such as `es`: the words the
   * compiler writes itself — "See all", a post's link — are in it where it is
   * one `ai-layout-labels.ts` lists. Absent, English.
   */
  language?: string
  /**
   * A page brought in from its owner's own website (AGL-4107): every word is
   * the source's and is drawn exactly as given — never fitted, cut, guarded
   * or left out — and so is every item of every group, every picture (the
   * source's own, never a stand-in), every band and every link. The page's
   * structure is the source's, read by code (`ai-site-import-compile.ts`), so
   * none of the moves that rearrange a model's design applies: no rhythm, no
   * like columns folded into cards, no third strong band settled soft, no
   * contact lines added. Only its opening may take a hero around the
   * source's own picture, as its design answer chose.
   */
  verbatim?: boolean
}

/** Words exactly as given, one space between them: how a page brought in shows them (AGL-4107). */
export function aiLayoutAsWritten(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * What a section is called to a screen reader: its plan name, with any note
 * the plan left in brackets taken out. A live blog plan (2026-10-09) named a
 * section "reader notes and kind words [to be added by owner]"; carried into
 * the label it read as a gap, and the page's gap pass took the section out.
 */
function sectionLabel(name: string, index: number, language?: string): string {
  return aiLayoutFitText(name.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim(), 'note', language) || `Section ${index + 1}`
}

/** A section root's id where the caller gives none. */
function sectionIdOf(index: number): string {
  return `section-${index + 1}`
}

export interface AiLayoutCompiledPage {
  tree: AiLayoutRawTree
  /** Each plan section's root, by its compiled id, in plan order. */
  sectionRoots: string[]
  /** A button's compiled id → the plan section a click scrolls to. */
  scrollTo: Record<string, number>
  settled: AiLayoutSettlement[]
  /**
   * Each plan section's repeated items — cards, steps, figures, component
   * instances, list lines and questions — by the id of the element that
   * draws each (AGL-3660), so a check can count what a visitor sees after
   * anything later takes words out.
   */
  itemIds: string[][]
  /** Plan sections whose only items were quotes, which a published page leaves out (AGL-3676). */
  quotesOnly: number[]
}

/** The most pictures a page carries; each beyond it is one more empty slot to fill. */
export const AI_LAYOUT_MAX_IMAGES = 3

/** The most characters a heading style holds; a longer heading of a page brought in is set as a subtitle (AGL-4107). */
export const AI_LAYOUT_HEADLINE_MAX_CHARS = AI_TEXT_LIMITS.headline

/** The most `brand` or `dark` bands a page shows; more and none stands out. */
export const AI_LAYOUT_MAX_STRONG_BANDS = 2

const SECTION_PADDING = { xs: 8, md: 12 } as const
const HERO_PADDING = { xs: 10, md: 14 } as const

/** Everything one page's compile shares. */
export interface PageScope {
  tree: AiLayoutTreeBuilder
  plan: AiLayoutPagePlan
  targets: AiLayoutTargets
  options: AiLayoutCompileOptions
  settled: AiLayoutSettlement[]
  scrollTo: Record<string, number>
  images: number
  strong: Record<'brand' | 'dark', number>
  /** The section of this page that places the site's form, if one does. */
  formSection: number | null
  /** The icon a picture shows until the owner places one, when its block names none. */
  pageIcon: AiIconLibraryEntry
  /** The forms this page already places, each once. */
  formsPlaced: Set<string>
  /** Each section's repeated items, by the id of the element that draws each (AGL-3660). */
  itemIds: string[][]
  /** The site's design and the choices its seed made, where the page is drawn with one. */
  design: { input: AiLayoutDesign; choices: AiLayoutDesignChoices } | null
  /** Stand-in pictures the design placed beside the model's own (`images`). */
  pictures: number
  /** Sections of words the design set beside a picture. */
  features: number
  /** The last section whose heading the design set beside its items: never two in a row. */
  splitAt: number
  /** Sections whose only items were quotes, left out (AGL-3676). */
  quotesOnly: number[]
  /**
   * The band each section was drawn in, by plan index: what the next one's
   * rhythm reads (AGL-4065). A frame, which draws no page sections, keeps none.
   */
  drawnBands?: AiLayoutBand[]
  /** How many sections in a row, up to this one, showed no picture (AGL-4065). */
  bare?: number
  /** Sections the design set beside a photo because they were the third without one (AGL-4065). */
  rhythm?: number
}

/** Everything one section's compile shares. */
export interface SectionScope {
  page: PageScope
  index: number
  at: string
  band: AiLayoutBand
  centered: boolean
  /** The level of the section's own heading: 1 on the first section, 2 after. */
  level: number
  /**
   * A section of the site's frame — its footer — whose headings are labels:
   * a layout carries no heading outline of its own, since every page brings
   * its own (rule 11).
   */
  frame?: boolean
  /** Whether the section's own heading has been written. */
  headed: boolean
  link: AiLayoutLinkScope
  /** Like items the section may still show (rule 8), across its groups. */
  itemsLeft: number
  /** What the section is about — its plan name and its headings — which picks how its groups are drawn. */
  words?: string
  /** Whether the section's words sit over a photo, where they take the band's own color. */
  overPhoto?: boolean
  /** The section's first heading as the model wrote it: what a stand-in picture is of. */
  heading?: string
  /** A group style the section's arrangement settled, over the one its words would pick. */
  groupStyle?: AiLayoutGroupVariant
}

const formIdsOf = (targets: AiLayoutTargets): Set<string> =>
  new Set(targets.forms.map((form) => form.id))
const componentOf = (targets: AiLayoutTargets, id: string | undefined) =>
  id
    ? (targets.components.find((component) => component.id === id) ?? null)
    : null

/**
 * The section of this page that places a form: one whose plan places one, or
 * whose design places one by its id.
 */
/** Whether the site's form lives on another page of the site than this one. */
function formLivesElsewhere(targets: AiLayoutTargets): boolean {
  return !!targets.formPageId && targets.formPageId !== targets.pageId
}

function formSectionOf(
  sections: readonly AiLayoutSection[],
  plan: AiLayoutPagePlan,
  targets: AiLayoutTargets,
): number | null {
  const forms = formIdsOf(targets)
  const planned = plan.sections.findIndex((section) =>
    section.uses.some((ref) => forms.has(ref)),
  )
  if (planned !== -1) return planned
  // A form drawn on a page it does not live on becomes a button to its page (AGL-3899).
  if (formLivesElsewhere(targets)) return null
  const designed = sections.findIndex((section) =>
    section.blocks.some(
      (block) => block.kind === 'form' && (!block.to || forms.has(block.to)),
    ),
  )
  return designed === -1 ? null : designed
}

/** Compiles a page designed in the layout language into the tree it stores. */
export function aiCompileLayoutPage(
  designed: readonly AiLayoutSection[],
  plan: AiLayoutPagePlan,
  targets: AiLayoutTargets,
  options: AiLayoutCompileOptions,
): AiLayoutCompiledPage {
  const tree = new AiLayoutTreeBuilder()
  const formSection = formSectionOf(designed, plan, targets)
  // The page a visitor opens to get in touch shows the phone and email the
  // business gave, as links, wherever the design did not (AGL-3979). A page
  // brought in shows what its source shows, and nothing more (AGL-4107).
  const sections = options.verbatim ? designed : aiLayoutWithContactLines(designed, formSection, targets.contact)
  const page: PageScope = {
    tree,
    plan,
    targets,
    options,
    settled: [],
    scrollTo: {},
    images: 0,
    strong: { brand: 0, dark: 0 },
    formSection,
    pageIcon: pageIconOf(sections),
    formsPlaced: new Set(),
    itemIds: plan.sections.map(() => []),
    design: options.design ? { input: options.design, choices: aiLayoutDesignChoices(options.design) } : null,
    pictures: 0,
    features: 0,
    splitAt: -2,
    quotesOnly: [],
    drawnBands: [],
    bare: 0,
    rhythm: 0,
  }
  const roots = plan.sections.map((_, index) => {
    const section = sections[index] ?? { blocks: [] }
    return compileSection(page, section, index)
  })
  const rootId = tree.add(
    'div',
    null,
    null,
    roots,
    'page',
    CANVAS_ROOT_ELEMENT_ID,
  )
  return {
    tree: { rootId, nodes: tree.nodes },
    sectionRoots: roots,
    scrollTo: page.scrollTo,
    settled: page.settled,
    itemIds: page.itemIds,
    quotesOnly: page.quotesOnly,
  }
}

/** The first icon the design names anywhere, else a sparkle: what an empty picture shows. */
function pageIconOf(sections: readonly AiLayoutSection[]): AiIconLibraryEntry {
  for (const section of sections) {
    for (const block of section.blocks) {
      const own = aiIconOfWord(block.icon)
      if (own) return own
      for (const item of block.items ?? []) {
        const icon = aiIconOfWord(item.icon)
        if (icon) return icon
      }
    }
  }
  return AI_ICON_LIBRARY.sparkle
}

// ── A section ─────────────────────────────────────────────────────────────

/** The listings whose element shows each record's picture: products, posts and events (AGL-4065). */
const PICTURED_LISTINGS: ReadonlySet<AiLayoutListing['kind']> = new Set(['products', 'posts', 'events'])

/**
 * A section drawn, and what the next one reads of it (AGL-4065): the band it
 * was drawn in, and whether it showed a picture — its own, a stand-in, a
 * record's photo or a listing that shows its records' pictures.
 */
function compileSection(
  page: PageScope,
  raw: AiLayoutSection,
  index: number,
): string {
  const scope = sectionScope(page, raw, index)
  const id = drawSection(page, raw, index, scope)
  page.drawnBands ??= []
  page.drawnBands[index] = scope.band
  const listed = aiLayoutListingAt(page.targets.listings ?? [], page.targets.pageId, index)
  const pictured = (!!listed && PICTURED_LISTINGS.has(listed.listing.kind)) || holdsPicture(page.tree, id)
  page.bare = pictured ? 0 : (page.bare ?? 0) + 1
  return id
}

/** Whether a compiled part holds an Image anywhere under it. */
function holdsPicture(tree: AiLayoutTreeBuilder, id: string): boolean {
  const node = tree.nodes[id]
  if (!node) return false
  return node.componentId === 'image' || (node.nodes ?? []).some((child) => holdsPicture(tree, child))
}

/**
 * The band a section is drawn in where the site's design keeps a rhythm
 * (AGL-4065): on a `plain` rhythm one ground, every soft band plain; on an
 * `alternate` rhythm the model's bands, except a plain or soft band that
 * would meet the same band above it, which takes the other. Brand and dark
 * bands, and the first section's, are the model's.
 */
function rhythmBand(page: PageScope, index: number, band: AiLayoutBand): AiLayoutBand {
  if (!page.design || index === 0 || (band !== 'plain' && band !== 'soft')) return band
  if (page.design.choices.bandRhythm === 'plain') return 'plain'
  const above = page.drawnBands?.[index - 1]
  if (above !== band) return band
  return band === 'plain' ? 'soft' : 'plain'
}

function sectionScope(page: PageScope, raw: AiLayoutSection, index: number): SectionScope {
  const at = `sections[${index}]`
  const asked = raw.band ?? 'plain'
  // A page brought in keeps the source's bands, every one (AGL-4107).
  const verbatim = page.options.verbatim === true
  const ruled = verbatim ? asked : rhythmBand(page, index, asked)
  if (ruled !== asked) page.settled.push({ at: `${at}.band`, what: `drawn ${ruled}: the page's ${page.design?.choices.bandRhythm} band rhythm` })
  const band = verbatim ? asked : settleBand(page, ruled, at)
  return {
    page,
    index,
    at,
    band,
    centered: raw.align === 'center',
    level: index === 0 ? 1 : 2,
    headed: false,
    itemsLeft: verbatim ? Number.POSITIVE_INFINITY : AI_LAYOUT_MAX_ITEMS,
    link: {
      sections: page.plan.sections.map((section) => section.name),
      from: index,
      formSection: page.formSection,
    },
    heading: raw.blocks.find((block) => block.kind === 'heading')?.text,
    words: [
      page.plan.sections[index]?.name ?? '',
      ...raw.blocks.filter((block) => block.kind === 'heading' || block.kind === 'eyebrow').map((block) => block.text ?? ''),
    ].join(' '),
  }
}

function drawSection(
  page: PageScope,
  raw: AiLayoutSection,
  index: number,
  scope: SectionScope,
): string {
  const { at, band } = scope
  const verbatim = page.options.verbatim === true
  // A quote is a gap the owner fills, and a published page shows no gap
  // (AGL-3660); a page brought in quotes its own customers' words (AGL-4107).
  const blocks = placePlanned(scope, raw).filter((block) => {
    if (block.kind !== 'quotes' || verbatim) return true
    page.settled.push({ at, what: 'a quotes group left out: a published page shows no customer words the brief did not give' })
    return false
  })
  // A section whose only items were those quotes has none left to show, and is
  // not asked for them again: no answer can give words the brief did not (AGL-3676).
  if (
    !verbatim &&
    raw.blocks.some((block) => block.kind === 'quotes') &&
    !blocks.some((block) => AI_LAYOUT_GROUP_KINDS.has(block.kind) || block.kind === 'component')
  ) {
    page.quotesOnly.push(index)
  }
  // A store's Shop page opens on its grid (AGL-3676): its first section is a
  // short title bar, never a hero, so the products start above the fold.
  if (!verbatim && index === 0 && shopGridAt(page) > 0) return shopTitle(scope, blocks)
  // A section the site's records fill — its catalog, its blog — shows them
  // through the element that keeps them, around the words the design gave it (AGL-3676).
  const listed = verbatim ? null : aiLayoutListingAt(page.targets.listings ?? [], page.targets.pageId, index)
  if (listed) return listingSection(scope, blocks, listed)
  // The site's design draws the sections it has an arrangement for (AGL-3660),
  // the third band in a row with no picture beside one (AGL-4065). A page
  // brought in takes only its hero, around the source's own picture (AGL-4107).
  if (verbatim) {
    const opening = index === 0 && raw.hero ? importedHero(scope, raw, blocks) : null
    if (opening) return opening
  } else if (page.design) {
    const beside = rhythmSection(scope, raw, blocks)
    if (beside) return beside
    const designed = designSection(scope, raw, blocks)
    if (designed) return designed
  }
  const cols = raw.cols && raw.cols.length >= 2 ? raw.cols : null
  // Above the row, the row's columns, and below it.
  const head: AiLayoutBlock[] = []
  const tail: AiLayoutBlock[] = []
  const columns: AiLayoutBlock[][] = cols ? cols.map(() => []) : []
  let placed = false
  for (const block of blocks) {
    if (cols && block.col !== undefined) {
      columns[Math.min(block.col, cols.length - 1)].push(block)
      placed = true
    } else if (placed) {
      tail.push(block)
    } else {
      head.push(block)
    }
  }
  let filled = columns
    .map((column, position) => ({ column, weight: cols?.[position] ?? 1 }))
    .filter((entry) => entry.column.length)
  // A row whose columns each place the same component, one instance a
  // column or more, is that component's group of cards: the compiler lays
  // its instances out once, rather than one like Grid a column (rule 1).
  // Row by row, as the columns showed them: the first of each column, then the second.
  const deepest = Math.max(0, ...filled.map((entry) => entry.column.length))
  const placedHere = Array.from({ length: deepest }, (_, row) =>
    filled.flatMap((entry) => (entry.column[row] ? [entry.column[row]] : [])),
  ).flat()
  const repeated = placedHere[0]?.kind === 'component' ? componentOf(page.targets, placedHere[0].to) : null
  if (
    !verbatim &&
    filled.length >= 2 &&
    repeated &&
    placedHere.every((block) => block.kind === 'component' && block.to === repeated.id)
  ) {
    head.push({ kind: 'cards', to: repeated.id, items: placedHere.map((block) => componentItem(block, repeated.props)) })
    page.settled.push({ at, what: `${placedHere.length} ${repeated.name} instances in ${filled.length} columns drawn as one group` })
    filled = []
  }
  // A row whose columns each hold only one kind of group — a card a column —
  // is that group, laid out by the compiler rather than column by column.
  const groups = filled.flatMap((entry) => entry.column)
  if (
    !verbatim &&
    filled.length >= 2 &&
    groups.every(
      (block) => isItemGroup(block) && block.kind === groups[0].kind && block.to === groups[0].to,
    )
  ) {
    head.push({ ...groups[0], col: undefined, items: groups.flatMap((block) => block.items ?? []) })
    page.settled.push({ at, what: `a ${groups[0].kind} group split over ${filled.length} columns drawn as one` })
    filled = []
  }
  // A row whose columns all say the same kind of thing, three or more across,
  // is a group of cards: one design, the words the columns gave.
  if (!verbatim && filled.length >= 3 && sameShape(filled.map((entry) => entry.column))) {
    head.push(...columnsAsCards(filled.map((entry) => entry.column)))
    page.settled.push({
      at,
      what: `${filled.length} like columns drawn as cards`,
    })
    filled = []
  }
  if (filled.length === 1) {
    // One column with anything in it is no row.
    head.push(...filled[0].column)
    filled = []
  }
  // The section's heading leads its outline: a heading with no words is no
  // heading, the first section always carries the page's one h1, and a
  // heading written after a group whose titles sit under it moves above it.
  const inOrder = () =>
    head.concat(
      filled.flatMap((entry) => entry.column),
      tail,
    )
  const speaks = (block: AiLayoutBlock) =>
    block.kind === 'heading' &&
    !!(verbatim ? aiLayoutAsWritten(block.text) : aiLayoutWords(block.text, 'heading', page.targets.facts, page.options.language))
  for (const list of [head, tail, ...filled.map((entry) => entry.column)]) {
    for (let at = list.length - 1; at >= 0; at -= 1)
      if (list[at].kind === 'heading' && !speaks(list[at])) list.splice(at, 1)
  }
  if (index === 0 && !inOrder().some(speaks)) {
    head.unshift({ kind: 'heading', text: page.plan.title })
    page.settled.push({
      at,
      what: "no heading; the page's title written as its h1",
    })
  }
  const order = inOrder()
  const first = order.findIndex(speaks)
  if (
    !verbatim &&
    first > 0 &&
    order
      .slice(0, first)
      .some(
        (block) =>
          block.kind === 'cards' ||
          block.kind === 'steps' ||
          block.kind === 'component',
      )
  ) {
    const lead = order[first]
    for (const list of [head, tail, ...filled.map((entry) => entry.column)]) {
      const at = list.indexOf(lead)
      if (at !== -1) list.splice(at, 1)
    }
    head.unshift({ ...lead, col: undefined })
    page.settled.push({
      at,
      what: 'the heading moved above the group it heads',
    })
  }
  filled = filled.filter((entry) => entry.column.length)
  if (filled.length === 1) {
    head.push(...filled[0].column)
    filled = []
  }
  const wide =
    filled.length > 0 || [...head, ...tail].some((block) => isWideGroup(block))
  const parts: string[] = []
  const headId = compileFlow(scope, head, 'full')
  if (headId) parts.push(centered(scope, headId, wide))
  if (filled.length) parts.push(compileRow(scope, filled))
  const tailId = compileFlow(scope, tail, 'full')
  if (tailId) parts.push(centered(scope, tailId, wide))
  // A frame whose content came to nothing is taken out, leaves first.
  for (let at = parts.length - 1; at >= 0; at -= 1) {
    page.tree.prune(parts[at])
    const part = page.tree.nodes[parts[at]]
    if (AI_LAYOUT_FRAMES.has(part.componentId) && !part.nodes?.length) {
      delete page.tree.nodes[parts[at]]
      parts.splice(at, 1)
    }
  }
  if (!parts.length) {
    // Nothing the design gave this section could be shown: it keeps its
    // place on the page under the name its plan gives it.
    const fallback = compileFlow(
      scope,
      [
        {
          kind: 'heading',
          text: page.plan.sections[index]?.name || page.plan.title,
        },
      ],
      'full',
    )
    if (fallback) parts.push(fallback)
    page.settled.push({
      at,
      what: 'nothing to show; the section named by its plan',
    })
  }
  const tree = page.tree
  const content =
    parts.length === 1
      ? parts[0]
      : // Gap, not margins: a stack's margin spacing resets its children's
        // margins, which un-centers a reading-width head (AGL-3660).
        tree.add('muiStack', { spacing: '6', useFlexGap: true }, null, parts, 'content')
  const container = tree.add(
    'muiContainer',
    { maxWidth: wide ? 'lg' : 'md' },
    { py: index === 0 ? { ...HERO_PADDING } : { ...SECTION_PADDING } },
    [content],
    'container',
  )
  const name = page.plan.sections[index]?.name?.trim() || `Section ${index + 1}`
  return tree.add(
    'section',
    {
      element: 'section',
      ariaLabel: sectionLabel(name, index, page.options.language),
      ...(band === 'dark' ? { colorScheme: 'dark' } : {}),
    },
    bandSx(band),
    [container],
    'section',
    page.options.sectionIds?.[index] ?? sectionIdOf(index),
  )
}

/**
 * A component block's prop values as a card item: its title-like prop as the
 * title and its text-like prop as the text, which `instanceValues` writes
 * back into the same props.
 */
function componentItem(block: AiLayoutBlock, props: Record<string, string>): AiLayoutItem {
  // An item that names no prop is the card itself, written as a cards item.
  const own = (block.items ?? []).find((item) => !(item.title in props) && (item.title.trim() || item.text.trim()))
  if (own && !(block.items ?? []).some((item) => item.title in props)) return { title: own.title, text: own.text }
  const value = (pattern: RegExp) =>
    (block.items ?? []).find((item) => item.title in props && pattern.test(item.title) && item.text.trim())?.text ?? ''
  const title = value(/title|name|heading|label|question|figure|value/i) || block.text || ''
  const text = value(/text|description|body|summary|copy|answer|detail|caption/i)
  return { title, text }
}

/** A band the page has room for: past two brand or two dark bands, a soft one instead. */
function settleBand(
  page: PageScope,
  band: AiLayoutBand,
  at: string,
): AiLayoutBand {
  if (band !== 'brand' && band !== 'dark') return band
  // A storefront keeps one dark band at most (AGL-3676): the beta.237 Willow
  // Wick home ran its text bands dark, and read as big empty dark slabs
  // between the products.
  const most = band === 'dark' && page.design && aiLayoutFamily(page.design.input.kind) === 'retail' ? 1 : AI_LAYOUT_MAX_STRONG_BANDS
  if (page.strong[band] >= most) {
    page.settled.push({
      at: `${at}.band`,
      what: `a third ${band} band drawn soft`,
    })
    return 'soft'
  }
  page.strong[band] += 1
  return band
}

/** A band's own colors, as palette roles: the dark band pins the scheme instead. */
export function bandSx(band: AiLayoutBand): Record<string, unknown> | null {
  if (band === 'soft') return { bgcolor: 'background.paper' }
  if (band === 'brand')
    return { bgcolor: 'primary.main', color: 'primary.contrastText' }
  return null
}

/** A group whose items sit side by side. */
function isItemGroup(block: AiLayoutBlock): boolean {
  return block.kind === 'cards' || block.kind === 'steps' || block.kind === 'stats' || block.kind === 'quotes'
}

/** Whether a block spans more than a reading column: a row of several items, or a table, tabs or logos of a page brought in. */
function isWideGroup(block: AiLayoutBlock): boolean {
  if (block.kind === 'table' || block.kind === 'tabs' || block.kind === 'logos') return true
  return (
    (block.kind === 'cards' ||
      block.kind === 'steps' ||
      block.kind === 'stats' ||
      block.kind === 'quotes') &&
    (block.items?.length ?? 0) >= 2 &&
    // A page brought in lays a group out as its source does: one to a row reads at a reading width.
    block.columns !== 1
  )
}

/** A full-width flow centered on a wide section is held to a reading width. */
function centered(scope: SectionScope, flowId: string, wide: boolean): string {
  const flow = scope.page.tree.nodes[flowId]
  const holdsGroup = (flow.nodes ?? []).some(
    (id) => scope.page.tree.nodes[id]?.componentId === 'muiGrid',
  )
  if (!wide || !scope.centered || holdsGroup) return flowId
  return scope.page.tree.add(
    'muiContainer',
    { maxWidth: 'md', disableGutters: true },
    null,
    [flowId],
    'measure',
  )
}

/**
 * The section's blocks with what its plan places in it: a form or a
 * component the plan line names and the design left out is added where the
 * section ends, and a `form` or `component` block naming nothing takes the
 * one the plan line names.
 */
function placePlanned(
  scope: SectionScope,
  raw: AiLayoutSection,
): AiLayoutBlock[] {
  const { page, index, at } = scope
  const forms = formIdsOf(page.targets)
  const uses = page.plan.sections[index]?.uses ?? []
  const plannedForms = uses.filter((ref) => forms.has(ref))
  const plannedComponents = uses.filter((ref) => componentOf(page.targets, ref))
  const blocks = raw.blocks.map((block) => ({
    ...block,
    ...(block.items ? { items: [...block.items] } : {}),
  }))
  const lastCol =
    raw.cols && raw.cols.length >= 2 ? raw.cols.length - 1 : undefined
  // A form the design drew where the plan places none, on a page the form
  // does not live on, is that page's way to it (AGL-3899): a button to the
  // page that holds the form, never a second copy of the form.
  if (!plannedForms.length && formLivesElsewhere(page.targets)) {
    const at0 = blocks.findIndex((block) => block.kind === 'form')
    if (at0 !== -1) {
      const asks = blocks.some((block) => block.kind === 'button' && (block.to === 'form' || block.to === `page:${page.targets.formPageId}`))
      const col = blocks[at0].col
      const kept = blocks.filter((block) => block.kind !== 'form')
      if (!asks) {
        kept.splice(at0, 0, {
          kind: 'button',
          text: aiLayoutLabel('getInTouch', page.options.language),
          to: 'form',
          ...(col !== undefined ? { col } : {}),
        })
      }
      blocks.splice(0, blocks.length, ...kept)
      page.settled.push({ at, what: 'a form on a page it does not live on; a button to its page instead' })
    }
  }
  for (const block of blocks) {
    if (block.kind === 'form' && !(block.to && forms.has(block.to))) {
      const only =
        page.targets.forms.length === 1 ? page.targets.forms[0].id : undefined
      block.to = plannedForms[0] ?? only
    }
    if (
      (block.kind === 'component' || block.kind === 'cards') &&
      block.to &&
      !componentOf(page.targets, block.to)
    ) {
      if (block.kind === 'component') block.to = plannedComponents[0]
      else delete block.to
    }
    if (block.kind === 'component' && !block.to) block.to = plannedComponents[0]
    // A group whose every item names the same component is that component's
    // placements (AGL-3660): the design put the id on its items, not the block.
    if (AI_LAYOUT_GROUP_KINDS.has(block.kind) && !block.to && block.items?.length) {
      const named = block.items[0]?.to
      if (named && componentOf(page.targets, named) && block.items.every((item) => item.to === named)) {
        block.to = named
        block.items = block.items.map(({ to: _to, ...item }) => item)
      }
    }
  }
  for (const form of plannedForms) {
    if (!blocks.some((block) => block.kind === 'form' && block.to === form)) {
      blocks.push({
        kind: 'form',
        to: form,
        ...(lastCol !== undefined ? { col: lastCol } : {}),
      })
      page.settled.push({ at, what: `the planned form ${form} placed` })
    }
  }
  for (const component of plannedComponents) {
    if (
      blocks.some(
        (block) =>
          (block.kind === 'component' || block.kind === 'cards') &&
          block.to === component,
      )
    )
      continue
    // A group the design drew where the plan places a component is that component's placements.
    const group = blocks.find(
      (block) =>
        AI_LAYOUT_GROUP_KINDS.has(block.kind) &&
        block.kind !== 'faq' &&
        block.kind !== 'list' &&
        !block.to,
    )
    if (group) {
      // Every group of that kind the design split over the row's columns, so
      // each item of the row is drawn alike (AGL-3660), never the first alone.
      for (const like of blocks) {
        if (like.kind === group.kind && !like.to) like.to = component
      }
      continue
    }
    blocks.push({
      kind: 'component',
      to: component,
      ...(lastCol !== undefined ? { col: lastCol } : {}),
    })
    page.settled.push({ at, what: `the planned component ${component} placed` })
  }
  return blocks.filter((block) => {
    if ((block.kind === 'form' || block.kind === 'component') && !block.to) {
      page.settled.push({
        at,
        what: `a ${block.kind} with nothing to place; left out`,
      })
      return false
    }
    // A form is placed once a page: a second copy of the same form asks a
    // visitor the same thing twice.
    if (block.kind === 'form' && block.to) {
      if (page.formsPlaced.has(block.to)) {
        page.settled.push({ at, what: `the form ${block.to} again; left out` })
        return false
      }
      page.formsPlaced.add(block.to)
    }
    return true
  })
}

/** The block kinds a column holds, as a column's shape is compared. */
function shapeOf(column: readonly AiLayoutBlock[]): string {
  return column.map((block) => block.kind).join(',')
}

/** What a like column may hold and still be read as a card: its words, a picture and one button. */
const CARD_COLUMN_KINDS: ReadonlySet<string> = new Set(['heading', 'text', 'lede', 'eyebrow', 'image', 'note', 'button'])

/** The words of a column a card says: its heading, or its first words. */
const WORDS_KINDS: ReadonlySet<string> = new Set(['heading', 'text', 'lede', 'note'])

/**
 * Whether a row's columns all say the same kind of thing (AGL-3660): the
 * same blocks in the same order, words among them, one button at most. The
 * beta.270 Sugar Hollow Galleries page (AGL-3988) was refused for rule 1,
 * "The same Grid block appears 4 times": four like columns this read did not
 * fold, each of them drawn as a Grid cell of its own.
 */
function sameShape(columns: readonly AiLayoutBlock[][]): boolean {
  const first = shapeOf(columns[0])
  return (
    columns.every((column) => shapeOf(column) === first) &&
    columns[0].some((block) => WORDS_KINDS.has(block.kind)) &&
    columns[0].every((block) => CARD_COLUMN_KINDS.has(block.kind)) &&
    columns[0].filter((block) => block.kind === 'button').length <= 1
  )
}

/**
 * Like columns as one group of cards: each column's heading its title, its
 * words its text. Their buttons follow the group (AGL-3988): one, where they
 * all go to the same place, else a list of links, each named by its card.
 */
function columnsAsCards(columns: readonly AiLayoutBlock[][]): AiLayoutBlock[] {
  const cards: AiLayoutBlock = {
    kind: 'cards',
    items: columns.map((column) => {
      const title = column.find((block) => block.kind === 'heading')?.text ?? ''
      const words = column
        .filter(
          (block) =>
            block.kind === 'text' ||
            block.kind === 'lede' ||
            block.kind === 'note',
        )
        .map((block) => block.text ?? '')
        .join(' ')
      const icon = column.find((block) => block.icon)?.icon
      return { title, text: words, ...(icon ? { icon } : {}) }
    }),
  }
  const buttons = columns.flatMap((column) => {
    const button = column.find((block) => block.kind === 'button')
    return button?.to?.trim() ? [{ button, column }] : []
  })
  if (!buttons.length) return [cards]
  const places = new Set(buttons.map(({ button }) => (button.to ?? '').trim().toLowerCase()))
  if (places.size === 1) {
    const { button } = buttons[0] as { button: AiLayoutBlock }
    return [cards, { kind: 'button', text: button.text ?? '', to: button.to, ...(button.style ? { style: button.style } : {}) }]
  }
  return [
    cards,
    {
      kind: 'list',
      items: buttons.map(({ button, column }) => ({
        title: column.find((block) => block.kind === 'heading')?.text || button.text || '',
        text: '',
        to: button.to ?? '',
      })),
    },
  ]
}

// ── A row of columns ──────────────────────────────────────────────────────

// Spans out of twelve live with the tree, so a frame's repair reads them without the compiler (AGL-3735).
export { aiLayoutSpans }

export function compileRow(
  scope: SectionScope,
  columns: Array<{ column: AiLayoutBlock[]; weight: number }>,
  /** How the columns sit against each other: centered on a page, top-aligned in a footer (AGL-3735). */
  alignItems: 'center' | 'flex-start' = 'center',
): string {
  const tree = scope.page.tree
  const spans = aiLayoutSpans(columns.map((entry) => entry.weight))
  const items = columns.map((entry, position) => {
    const span = spans[position]
    const flow = compileFlow(
      scope,
      entry.column,
      span >= 8 ? 'full' : span >= 5 ? 'half' : 'narrow',
    )
    const size =
      columns.length >= 4 ? `xs:12 sm:6 md:${span}` : `xs:12 md:${span}`
    return tree.add('muiGrid', { size }, null, [flow], 'column')
  })
  return tree.add(
    'muiGrid',
    { container: true, spacing: columns.length >= 3 ? '4' : '6' },
    { alignItems },
    items,
    'row',
  )
}

// ── A flow of blocks ─────────────────────────────────────────────────────

export type Room = 'full' | 'half' | 'narrow'

/** A column of blocks, top to bottom, with buttons side by side; `null` when nothing in it compiles. */
export function compileFlow(
  scope: SectionScope,
  blocks: readonly AiLayoutBlock[],
  room: Room,
): string | null {
  const tree = scope.page.tree
  const children: string[] = []
  let buttons: string[] = []
  const flushButtons = () => {
    if (!buttons.length) return
    children.push(
      buttons.length === 1
        ? buttons[0]
        : tree.add(
            'muiStack',
            {
              direction: 'row',
              spacing: '2',
              useFlexGap: true,
              flexWrap: 'wrap',
              ...(scope.centered ? { justifyContent: 'center' } : {}),
            },
            null,
            buttons,
            'actions',
          ),
    )
    buttons = []
  }
  for (const block of blocks) {
    if (block.kind === 'button') {
      const id = compileButton(scope, block)
      if (id) buttons.push(id)
      continue
    }
    flushButtons()
    const id = compileBlock(scope, block, room)
    if (id) children.push(id)
  }
  flushButtons()
  if (!children.length) return null
  // One block needs no flow around it.
  if (children.length === 1) return children[0]
  const align = scope.centered && room === 'full'
  // A flow whose words open with a label, a heading and a lede reads as one
  // block at a tighter spacing than the groups under it.
  return tree.add(
    'muiStack',
    {
      spacing: hasGroup(tree, children) ? '4' : '2.5',
      ...(align ? { alignItems: 'center' } : {}),
    },
    null,
    children,
    'flow',
  )
}

function hasGroup(tree: AiLayoutTreeBuilder, ids: readonly string[]): boolean {
  return ids.some((id) =>
    ['muiGrid', 'muiList'].includes(tree.nodes[id]?.componentId ?? ''),
  )
}

function compileBlock(
  scope: SectionScope,
  block: AiLayoutBlock,
  room: Room,
): string | null {
  switch (block.kind) {
    case 'eyebrow':
      return words(
        scope,
        block,
        'eyebrow',
        'overline',
        { component: 'p' },
        accent(scope),
      )
    case 'heading':
      return heading(scope, block)
    case 'lede':
      return words(scope, block, 'lede', 'lede', {}, muted(scope))
    case 'text':
      return words(scope, block, 'text', 'body1', {}, muted(scope))
    case 'note':
      return words(scope, block, 'note', 'body2', {}, muted(scope))
    case 'image':
      return image(scope, block, room)
    case 'form':
      return form(scope, block)
    case 'component':
      return component(scope, block)
    case 'list':
      return list(scope, block, room)
    case 'faq':
      return faq(scope, block)
    case 'cards':
    case 'steps':
    case 'stats':
    case 'quotes':
      return group(scope, block, room)
    case 'table':
      return table(scope, block)
    case 'tabs':
      return tabs(scope, block, room)
    case 'logos':
      return logos(scope, block)
    default:
      return null
  }
}

/** Secondary words' color: muted text, or the band's own on a brand band. */
function muted(scope: SectionScope): Record<string, unknown> | null {
  return scope.band === 'brand' || scope.overPhoto ? null : { color: 'text.secondary' }
}

/**
 * A List Item Text's secondary words: MUI draws them in the muted text color
 * whatever they sit on, so on a brand band, or over a photo, they take the
 * band's own color as the primary words do (AGL-3886).
 */
function mutedSecondary(scope: SectionScope): Record<string, unknown> {
  return scope.band === 'brand' || scope.overPhoto ? { secondaryColor: 'inherit' } : {}
}

/** An accent's color: the brand's, or the band's own on a brand band. */
function accent(scope: SectionScope): Record<string, unknown> | null {
  return scope.band === 'brand' || scope.overPhoto ? null : { color: 'primary.main' }
}

function align(scope: SectionScope): Record<string, unknown> {
  return scope.centered ? { align: 'center' } : {}
}

/**
 * Words as a page shows them: fitted to their place at a clean boundary, or,
 * on a page brought in (AGL-4107), exactly as the source wrote them.
 */
function say(scope: SectionScope, value: unknown, place: AiLayoutTextPlace): string {
  if (scope.page.options.verbatim) return aiLayoutAsWritten(value)
  return aiLayoutWords(value, place, scope.page.targets.facts, scope.page.options.language)
}

function words(
  scope: SectionScope,
  block: AiLayoutBlock,
  place: AiLayoutTextPlace,
  variant: string,
  props: Record<string, unknown>,
  sx: Record<string, unknown> | null,
): string | null {
  const text = say(scope, block.text, place)
  if (!text) return null
  return scope.page.tree.add(
    'muiTypography',
    { children: text, variant, ...props, ...align(scope) },
    sx,
    null,
    place,
  )
}

/** A heading at its place in the outline: the section's own, or one under it. */
function heading(scope: SectionScope, block: AiLayoutBlock): string | null {
  if (scope.frame) {
    const label = aiLayoutWords(
      block.text,
      'itemTitle',
      scope.page.targets.facts,
      scope.page.options.language,
    )
    return label
      ? scope.page.tree.add(
          'muiTypography',
          {
            children: label,
            variant: 'subtitle1',
            component: 'p',
            ...align(scope),
          },
          null,
          null,
          'label',
        )
      : null
  }
  const own = !scope.headed
  const level = own ? scope.level : scope.level + 1
  const place: AiLayoutTextPlace =
    level === 1 ? 'title' : own ? 'heading' : 'itemTitle'
  const text = say(scope, block.text, place)
  if (!text) return null
  scope.headed = scope.headed || own
  // A source's heading longer than a heading style holds is set in a subtitle
  // style, still a heading at its level (AGL-4107): every word of it is kept.
  const long = scope.page.options.verbatim === true && text.length > AI_LAYOUT_HEADLINE_MAX_CHARS
  const variant = long
    ? 'subtitle1'
    : level === 1
      ? block.style === 'large'
        ? 'displayXl'
        : 'h1'
      : own
        ? 'h2'
        : 'h4'
  return scope.page.tree.add(
    'muiTypography',
    { children: text, variant, component: `h${level}`, ...align(scope) },
    null,
    null,
    'heading',
  )
}

/** The level an item's title takes: one under the section's heading, or h2 in a section with none yet. */
function itemLevel(scope: SectionScope): number {
  return scope.headed ? scope.level + 1 : Math.max(2, scope.level)
}

/** The element an item's title renders as: a heading on a page, a label in the frame. */
function itemElement(scope: SectionScope): string {
  return scope.frame ? 'p' : `h${itemLevel(scope)}`
}

function compileButton(
  scope: SectionScope,
  block: AiLayoutBlock,
): string | null {
  const verbatim = scope.page.options.verbatim === true
  // Words that carry the phone or the email are kept whole (AGL-3979).
  const asked = verbatim
    ? aiLayoutAsWritten(block.text)
    : aiLayoutContactLabel(block.text, scope.page.targets.contact) ||
      aiLayoutFitText(block.text, 'label', scope.page.options.language)
  if (!asked) return null
  const destination = verbatim
    ? aiLayoutImportedDestination(block.to, scope.page.plan.sections.length)
    : aiLayoutResolveLink(
        block.to,
        asked,
        scope.link,
        scope.page.targets,
      )
  if (!destination) {
    // A page brought in keeps the words of a link that goes nowhere here (AGL-4107).
    if (verbatim) return words(scope, block, 'text', 'body1', {}, muted(scope))
    scope.page.settled.push({
      at: scope.at,
      what: `the button "${asked}" has nowhere to go; left out`,
    })
    return null
  }
  // A link of a page brought in longer than a button's label holds is its
  // words, as a link (AGL-4107): every word kept, and it still goes there.
  if (verbatim && asked.length > AI_TEXT_LIMITS.button) return linkedWords(scope, asked, destination)
  // A button to a page merged into the blog names the blog (AGL-3676).
  const label = verbatim ? asked : aiLayoutRenamedLabel(asked, destination)
  if (label !== asked) scope.page.settled.push({ at: scope.at, what: `the button "${asked}" named for the blog: "${label}"` })
  const style = block.style ?? 'primary'
  // Over a photo, a quiet or outlined button takes the words' own color, as on a brand band.
  const onBrand = scope.band === 'brand' || (!!scope.overPhoto && style !== 'primary')
  const look =
    style === 'quiet'
      ? { variant: 'text', color: onBrand ? 'inherit' : 'primary' }
      : style === 'secondary'
        ? { variant: 'outlined', color: onBrand ? 'inherit' : 'primary' }
        : { variant: 'contained', color: onBrand ? 'secondary' : 'primary' }
  const id = scope.page.tree.add(
    'muiButton',
    {
      children: label,
      ...look,
      size: scope.index === 0 || block.style === 'large' ? 'large' : 'medium',
      ...destinationProps(destination),
    },
    // Sized to its words, never stretched across the column a Stack would
    // stretch it over (AGL-3660), and aligned with its section.
    { alignSelf: scope.centered ? 'center' : 'flex-start' },
    null,
    'button',
  )
  linkTo(scope, id, destination)
  return id
}

/**
 * Where a link of a page brought in goes (AGL-4107), as its compile wrote it:
 * `page:<id>` a page of the site by its id — any page the import plans, which
 * a visitor reaches once that page is live and sees as words until then —
 * `#<n>` section n of this page, a `mailto:` or `tel:` link, or the
 * `https:` address the source linked. Anything else goes nowhere.
 */
export function aiLayoutImportedDestination(to: string | undefined, sections: number): AiLayoutDestination | null {
  const value = (to ?? '').trim()
  if (!value) return null
  const page = /^page:([A-Za-z0-9_-]{1,128})$/.exec(value)
  if (page) return { kind: 'page', screenId: page[1] }
  const section = /^#(\d{1,3})$/.exec(value)
  if (section) {
    const index = Number(section[1]) - 1
    return index >= 0 && index < sections ? { kind: 'section', index } : null
  }
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value) || /^tel:\+?[\d\s().-]{3,}$/i.test(value)) return { kind: 'contact', href: value }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? { kind: 'href', href: url.toString() } : null
  } catch {
    return null
  }
}

/**
 * A link to a section of this page carries the platform's Scroll to element
 * interaction to that section's root (AGL-3097), by the id the page stores it
 * under.
 */
function linkTo(
  scope: SectionScope,
  id: string,
  destination: AiLayoutDestination,
): void {
  if (destination.kind !== 'section') return
  const { page } = scope
  page.scrollTo[id] = destination.index
  const target =
    page.options.sectionIds?.[destination.index] ??
    sectionIdOf(destination.index)
  const name =
    page.plan.sections[destination.index]?.name ??
    `section ${destination.index + 1}`
  page.tree.nodes[id].interactions = [aiPageScrollInteraction(target, name)]
}

export function destinationProps(
  destination: AiLayoutDestination,
): Record<string, unknown> {
  if (destination.kind === 'page') return { screenId: destination.screenId }
  if (destination.kind === 'href')
    return { href: destination.href, target: '_blank' }
  if (destination.kind === 'path') return { href: destination.href }
  // A call or an email opens the phone or the mail app, never a new tab (AGL-3979).
  if (destination.kind === 'contact') return { href: destination.href }
  return {}
}

/**
 * A picture slot: a soft frame at a stock shape showing an icon until the
 * owner places the picture, which then fills it. Its description is its alt
 * text (rule 9), and no source is set here: the compiler stays pure, and
 * `ai-layout-pictures.ts` fills the slot with a photo the site serves itself
 * once the page is checked.
 */
/**
 * The site kinds whose galleries open in a lightbox by default (AGL-3717): a
 * portfolio's or a photographer's work is looked at, not skimmed, and a
 * visitor who presses a picture expects to see it large and step through the
 * rest. Every other kind opens a picture only where the design says so.
 */
export const AI_LIGHTBOX_GALLERY_KINDS: ReadonlySet<string> = new Set([
  'portfolio',
  'photography',
])

/** The `to` that opens an image block's picture in a lightbox (AGL-3717). */
export const AI_LAYOUT_LIGHTBOX_TO = 'lightbox'

/** Whether this page's galleries open in a lightbox by default. */
export function aiOpensGalleriesInLightbox(page: { design: PageScope['design'] }): boolean {
  const kind = page.design?.input.kind
  return Boolean(kind && AI_LIGHTBOX_GALLERY_KINDS.has(kind))
}

/**
 * The Image props that make a picture open in a lightbox: as one gallery
 * with the section's other pictures, named for the section, and with the
 * item's title as its caption. The Image element reads exactly these.
 */
function lightboxProps(scope: SectionScope, caption?: string): Record<string, unknown> {
  const name =
    aiLayoutFitText(scope.heading, 'alt', scope.page.options.language) ||
    aiLayoutFitText(scope.page.plan.sections[scope.index]?.name, 'alt', scope.page.options.language) ||
    `Gallery ${scope.index + 1}`
  const words = aiLayoutFitText(caption, 'alt', scope.page.options.language)
  return { lightbox: true, lightboxGallery: name, ...(words ? { lightboxCaption: words } : {}) }
}

function image(
  scope: SectionScope,
  block: AiLayoutBlock,
  room: Room,
): string | null {
  const { page } = scope
  // A page brought in places the source's own picture, as the library holds it (AGL-4107).
  if (page.options.verbatim) return block.picture ? sourcePicture(scope, block.picture, room) : null
  const alt = aiLayoutFitText(block.text, 'alt', scope.page.options.language)
  if (!alt) return null
  if (page.images >= maxImages(page)) {
    page.settled.push({
      at: scope.at,
      what: `a picture past the page's ${AI_LAYOUT_MAX_IMAGES}; left out`,
    })
    return null
  }
  page.images += 1
  const icon = aiIconOfWord(block.icon) ?? page.pageIcon
  const tree = page.tree
  const mark = tree.add(
    AI_ICON_COMPONENT_ID,
    { iconId: icon.id, size: '64' },
    { color: 'primary.main' },
    null,
    'imageIcon',
  )
  // `to: lightbox` opens the picture large (AGL-3717); one picture is its
  // own gallery, so it opens alone unless the section has more.
  const opensLarge = block.to?.trim().toLowerCase() === AI_LAYOUT_LIGHTBOX_TO
  const picture = tree.add(
    'image',
    { alt, objectFit: 'cover', ...(opensLarge ? lightboxProps(scope) : {}) },
    { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
    null,
    'image',
  )
  return tree.add(
    'muiBox',
    null,
    {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      // In multiples of the theme's corner radius, so a sharp site's frames are sharp.
      borderRadius: 2,
      bgcolor: 'action.hover',
      // The frame's shape follows its room, so no two slots of a page share one style.
      aspectRatio:
        room === 'full'
          ? page.images === 1
            ? '16 / 9'
            : '21 / 9'
          : room === 'half'
            ? '4 / 3'
            : page.images === 1
              ? '1 / 1'
              : '3 / 4',
    },
    [mark, picture],
    'frame',
  )
}

/** A saved form, framed as a card so it reads as the section's one task. */
function form(scope: SectionScope, block: AiLayoutBlock): string | null {
  const tree = scope.page.tree
  const placed = tree.add('form', { formId: block.to }, null, null, 'form')
  const content = tree.add(
    'muiCardContent',
    null,
    { p: { xs: 3, md: 4 } },
    [placed],
    'formContent',
  )
  // The card style is the site theme's (AGL-3660), as a card dropped from the
  // drawer takes it; it takes the flow's width, so a centered section never
  // shrinks a form to its button.
  return tree.add('muiCard', null, { alignSelf: 'stretch' }, [content], 'formCard')
}

/** A reusable component placed by its id, its props filled from the block's items. */
function component(scope: SectionScope, block: AiLayoutBlock): string | null {
  const declared = componentOf(scope.page.targets, block.to)
  if (!declared) return null
  const values: Record<string, unknown> = {}
  for (const item of block.items ?? []) {
    const name = item.title.trim()
    if (name in declared.props && item.text.trim())
      values[name] = aiLayoutWords(item.text, 'text', scope.page.targets.facts, scope.page.options.language)
  }
  // An instance fills at least one prop (rule 1): the block's words, else the
  // name its section has in the plan, rather than the component's placeholder.
  if (!Object.values(values).some(Boolean)) {
    const first = textProps(declared.props)[0]
    const words =
      aiLayoutWords(block.text, 'text', scope.page.targets.facts, scope.page.options.language) ||
      aiLayoutWords(
        scope.page.plan.sections[scope.index]?.name,
        'itemTitle',
        scope.page.targets.facts,
        scope.page.options.language,
      )
    if (first && words) values[first] = words
  }
  for (const [name, value] of Object.entries(values))
    if (!value) delete values[name]
  return scope.page.tree.add(
    REUSABLE_INSTANCE_COMPONENT_ID,
    {
      [AI_INSTANCE_REF_PROP]: declared.id,
      ...(Object.keys(values).length ? { propValues: values } : {}),
    },
    null,
    null,
    'instance',
  )
}

function textProps(props: Record<string, string>): string[] {
  return Object.entries(props)
    .filter(([, type]) => type === 'text' || type === 'richText')
    .map(([name]) => name)
}

/** An item's words as the props of the component that draws it. */
function instanceValues(
  props: Record<string, string>,
  item: AiLayoutItem,
  facts: string,
  language?: string,
): Record<string, unknown> {
  const texts = textProps(props)
  const titleProp =
    texts.find((name) =>
      /title|name|heading|label|question|figure|value/i.test(name),
    ) ?? texts[0]
  const textProp =
    texts.find(
      (name) =>
        name !== titleProp &&
        /text|description|body|summary|copy|answer|detail|caption/i.test(name),
    ) ?? texts.find((name) => name !== titleProp)
  const values: Record<string, unknown> = {}
  if (titleProp && item.title.trim())
    values[titleProp] = aiLayoutWords(item.title, 'itemTitle', facts, language)
  if (textProp && item.text.trim())
    values[textProp] = aiLayoutWords(item.text, 'itemText', facts, language)
  const first = titleProp ?? textProp
  if (!Object.values(values).some(Boolean) && first)
    values[first] = aiLayoutWords(item.title || item.text, 'itemTitle', facts, language)
  return values
}

// ── Groups ────────────────────────────────────────────────────────────────

/** Records the elements that draw a section's repeated items, and hands them back. */
function noted<T extends readonly string[]>(scope: SectionScope, ids: T): T {
  if (!scope.frame) scope.page.itemIds[scope.index]?.push(...ids)
  return ids
}

/** How many items sit side by side in a room. */
function across(
  count: number,
  room: Room,
  kind: AiLayoutBlock['kind'],
): number {
  if (room === 'narrow') return 1
  if (room === 'half') return count >= 2 && kind === 'stats' ? 2 : 1
  if (count <= 3) return count
  if (count === 4) return 4
  if (count === 7) return 4
  return 3
}

function itemSize(perRow: number): string {
  if (perRow === 2) return 'xs:12 sm:6'
  if (perRow === 3) return 'xs:12 md:4'
  return 'xs:12 sm:6 md:3'
}

/** Items laid out side by side as a Grid of sized items, or stacked where they sit one to a row. */
function layOut(
  scope: SectionScope,
  items: readonly string[],
  perRow: number,
  spacing: string,
  role: string,
): string {
  const tree = scope.page.tree
  if (items.length === 1) return items[0]
  if (perRow <= 1) {
    return tree.add('muiStack', { spacing }, null, items, role)
  }
  const size = itemSize(perRow)
  const cells = items.map((id) =>
    tree.add('muiGrid', { size }, null, [id], 'cell'),
  )
  return tree.add('muiGrid', { container: true, spacing }, null, cells, role)
}

/**
 * Whether repeats must be components here (rule 1): the workspace keeps
 * them. Rule 1 counts like blocks across the whole page, so where it holds
 * every group the plan places no component for is drawn compact, however
 * few its items — two sections of two cards are four like cards.
 */
function rule1(scope: SectionScope): boolean {
  return scope.page.options.reusableComponents
}

/** The most pictures this page carries: two where rule 1 counts three like frames as a repeat. */
function maxImages(page: PageScope): number {
  return page.options.reusableComponents ? 2 : AI_LAYOUT_MAX_IMAGES
}

/**
 * The items a group may still show in its section (rule 8): seven like items
 * a section, across all its groups, since eight are a list typed by hand.
 */
/** Whether an item has words left once they are cleaned and fitted: an item with none is no item. */
function speaks(scope: SectionScope, item: AiLayoutItem): boolean {
  const facts = scope.page.targets.facts
  return !!(
    aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language) ||
    aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language)
  )
}

/** A group's items with every part that has no words left once cleaned emptied, and wordless items left out. */
/** A title that only names the kind of thing it is: "Card", "Item 2", "Title". */
const AI_LAYOUT_PLACEHOLDER_TITLE = /^(?:card|item|title|heading|placeholder|tile|box|feature|service|post|article|entry)\s*\d*$/i

function cleanItems(
  scope: SectionScope,
  items: readonly AiLayoutItem[],
): AiLayoutItem[] {
  const facts = scope.page.targets.facts
  // A title that is only the name or id of what places it — a "Card" item of
  // the Card component (AGL-3660) — is no words a visitor reads.
  const references = new Set(
    scope.page.targets.components.flatMap((component) => [component.name, component.id]).map((name) => name.trim().toLowerCase()),
  )
  return items
    .map((item) => ({
      ...item,
      title:
        aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language) &&
        !references.has(item.title.trim().toLowerCase()) &&
        !AI_LAYOUT_PLACEHOLDER_TITLE.test(item.title.trim())
          ? item.title
          : '',
      text: aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language) ? item.text : '',
    }))
    .filter((item) => speaks(scope, item))
}

function takeItems<T>(scope: SectionScope, items: readonly T[]): T[] {
  const kept = items.slice(0, Math.max(0, scope.itemsLeft))
  if (kept.length < items.length) {
    scope.page.settled.push({
      at: scope.at,
      what: `${items.length - kept.length} items past the section's ${AI_LAYOUT_MAX_ITEMS}; left out`,
    })
  }
  scope.itemsLeft -= kept.length
  return kept
}

/** `takeItems` on a list it shortens where it stands. */
function takeItemsInPlace<T>(scope: SectionScope, items: T[]): void {
  const kept = takeItems(scope, items)
  items.length = kept.length
}

function group(
  scope: SectionScope,
  block: AiLayoutBlock,
  room: Room,
): string | null {
  if (scope.page.options.verbatim) return importedGroup(scope, block, room)
  const items = takeItems(scope, cleanItems(scope, block.items ?? []))
  if (!items.length) return null
  const perRow = across(items.length, room, block.kind)
  const placed = componentOf(scope.page.targets, block.to)
  if (placed) return instances(scope, placed, items, perRow)
  const design = scope.page.design
  const retail = !!design && aiLayoutFamily(design.input.kind) === 'retail'
  // A store's making, shown: its steps as pictures over their words (AGL-3676),
  // where the page has the pictures for them.
  if (retail && block.kind === 'steps' && room === 'full' && items.length >= 2 && items.length <= 4 && picturesLeft(scope.page) >= items.length) {
    const drawn = designedGroup(scope, 'articles', items, room)
    if (drawn) return drawn
  }
  if (rule1(scope)) {
    // Picture cards the design draws are the compiler's, not a block typed out
    // by hand (`repeatsCompiled`, AGL-3660), and so are a storefront's icon
    // columns (AGL-3676): the beta.237 Willow Wick home, on a paid plan, drew
    // every other group compact — four bands of a title and a sentence.
    const variant = design && block.kind === 'cards' && block.style !== 'quiet' ? aiLayoutGroupVariant(design.input, design.choices, scope.words ?? '') : null
    // Icon columns side by side, where rule 1 knows them by their cells; any
    // site's groups may take them (AGL-3899), and one to a row outside a
    // store they are drawn compact.
    if (variant === 'icons' && (retail || perRow > 1)) return iconColumns(scope, items, room)
    const pictured = (variant === 'pictures' || variant === 'articles') && room === 'full' && picturesLeft(scope.page) >= items.length
    return (pictured && designedGroup(scope, variant, items, room)) || compactGroup(scope, block, items, perRow)
  }
  if (design && block.kind === 'steps' && (design.choices.steps === 'timeline' || room !== 'full')) {
    return timeline(scope, items)
  }
  if (design && block.kind === 'cards' && block.style !== 'quiet') {
    const variant = scope.groupStyle ?? aiLayoutGroupVariant(design.input, design.choices, scope.words ?? '')
    const drawn = designedGroup(scope, variant, items, room)
    if (drawn) return drawn
  }
  switch (block.kind) {
    case 'steps':
      return layOut(
        scope,
        noted(scope, items.map((item, position) => step(scope, item, position))),
        perRow,
        '4',
        'steps',
      )
    case 'stats':
      return layOut(
        scope,
        noted(scope, items.map((item) => stat(scope, item))),
        perRow,
        '4',
        'stats',
      )
    case 'quotes':
      return layOut(
        scope,
        noted(scope, items.map((item) => quote(scope, item))),
        perRow,
        '3',
        'quotes',
      )
    default:
      return layOut(
        scope,
        noted(scope, items.map((item) => card(scope, block, item))),
        perRow,
        '3',
        'cards',
      )
  }
}

function instances(
  scope: SectionScope,
  placed: { id: string; props: Record<string, string> },
  items: readonly AiLayoutItem[],
  perRow: number,
): string {
  const tree = scope.page.tree
  const ids = items.map((item) => {
    const values = instanceValues(placed.props, item, scope.page.targets.facts, scope.page.options.language)
    return tree.add(
      REUSABLE_INSTANCE_COMPONENT_ID,
      {
        [AI_INSTANCE_REF_PROP]: placed.id,
        ...(Object.keys(values).length ? { propValues: values } : {}),
      },
      null,
      null,
      'instance',
    )
  })
  return layOut(scope, noted(scope, ids), perRow, '3', 'instances')
}

/**
 * A group in its compact form, a title over its text: two elements an item,
 * under the three a block must have before rule 1 asks for a component.
 */
function compactGroup(
  scope: SectionScope,
  block: AiLayoutBlock,
  items: readonly AiLayoutItem[],
  perRow: number,
): string {
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  const pairs = items.map((item, position) => {
    const title =
      block.kind === 'quotes'
        ? aiLayoutQuoteGap(item.text || item.title, scope.page.options.language)
        : block.kind === 'stats'
          ? aiLayoutWords(item.title, 'stat', facts, scope.page.options.language)
          : `${block.kind === 'steps' ? `${position + 1}. ` : ''}${aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language)}`
    const text =
      block.kind === 'quotes'
        ? '[Customer name]'
        : aiLayoutWords(
            item.text,
            block.kind === 'stats' ? 'statLabel' : 'itemText',
            facts,
            scope.page.options.language,
          )
    return tree.add(
      'muiListItemText',
      { primary: title, ...(text ? { secondary: text, ...mutedSecondary(scope) } : {}) },
      null,
      null,
      'pair',
    )
  })
  return layOut(scope, noted(scope, pairs), perRow, '3', 'compact')
}

/** A card: an optional icon, its title one level under the section's heading, and its words. */
function card(
  scope: SectionScope,
  block: AiLayoutBlock,
  item: AiLayoutItem,
): string {
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  const icon = aiIconOfWord(item.icon) ?? aiIconOfWord(block.icon)
  // A quiet card draws no surface of its own, so it is colored as the band it sits on.
  const quiet = block.style === 'quiet'
  const children = [
    icon
      ? tree.add(
          AI_ICON_COMPONENT_ID,
          { iconId: icon.id, size: '32' },
          quiet ? accent(scope) : { color: 'primary.main' },
          null,
          'icon',
        )
      : null,
    item.title.trim()
      ? tree.add(
          'muiTypography',
          {
            children: aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language),
            variant: 'h5',
            component: itemElement(scope),
          },
          null,
          null,
          'title',
        )
      : null,
    item.text.trim()
      ? tree.add(
          'muiTypography',
          {
            children: aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language),
            variant: 'body1',
          },
          quiet ? muted(scope) : { color: 'text.secondary' },
          null,
          'text',
        )
      : null,
  ]
  const stack = tree.add(
    'muiStack',
    { spacing: '1.5' },
    null,
    children,
    'cardStack',
  )
  if (quiet) return stack
  const content = tree.add(
    'muiCardContent',
    null,
    { p: 3 },
    [stack],
    'cardContent',
  )
  // Flat, outlined, raised, tinted or ruled is the site theme's card style
  // (AGL-3660), never a choice stamped on this card.
  return tree.add('muiCard', null, { height: '100%' }, [content], 'card')
}

/** A numbered step: its number in the brand color, its title and its words. */
function step(
  scope: SectionScope,
  item: AiLayoutItem,
  position: number,
): string {
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  return tree.add(
    'muiStack',
    { spacing: '1' },
    null,
    [
      tree.add(
        'muiTypography',
        {
          children: String(position + 1).padStart(2, '0'),
          variant: 'h3',
          component: 'p',
        },
        accent(scope),
        null,
        'number',
      ),
      item.title.trim()
        ? tree.add(
            'muiTypography',
            {
              children: aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language),
              variant: 'h5',
              component: itemElement(scope),
            },
            null,
            null,
            'title',
          )
        : null,
      item.text.trim()
        ? tree.add(
            'muiTypography',
            {
              children: aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language),
              variant: 'body1',
            },
            muted(scope),
            null,
            'text',
          )
        : null,
    ],
    'step',
  )
}

/** A figure and its label. A figure the brief did not give is the model's bracketed gap. */
function stat(scope: SectionScope, item: AiLayoutItem): string {
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  return tree.add(
    'muiStack',
    { spacing: '0.5', ...(scope.centered ? { alignItems: 'center' } : {}) },
    null,
    [
      tree.add(
        'muiTypography',
        {
          children: aiLayoutWords(item.title, 'stat', facts, scope.page.options.language) || '[figure]',
          variant: 'h2',
          component: 'p',
          ...align(scope),
        },
        accent(scope),
        null,
        'figure',
      ),
      item.text.trim()
        ? tree.add(
            'muiTypography',
            {
              children: aiLayoutWords(item.text, 'statLabel', facts, scope.page.options.language),
              variant: 'body2',
              ...align(scope),
            },
            muted(scope),
            null,
            'label',
          )
        : null,
    ],
    'stat',
  )
}

/** A quote slot: what a customer should be quoted saying, as the gap the owner fills. */
function quote(scope: SectionScope, item: AiLayoutItem): string {
  const tree = scope.page.tree
  const words = aiLayoutQuoteGap(item.text || item.title, scope.page.options.language)
  const who =
    item.text && item.title ? aiLayoutFitText(item.title, 'statLabel', scope.page.options.language) : ''
  const stack = tree.add(
    'muiStack',
    { spacing: '2' },
    null,
    [
      tree.add(
        AI_ICON_COMPONENT_ID,
        { iconId: AI_ICON_LIBRARY.quote.id, size: '32' },
        { color: 'primary.main' },
        null,
        'quoteMark',
      ),
      tree.add(
        'muiTypography',
        { children: words, variant: 'body1' },
        null,
        null,
        'quote',
      ),
      tree.add(
        'muiTypography',
        {
          children:
            aiLayoutFitText(
              who ? `[Customer name], ${who.replace(/^\[|\]$/g, '')}` : '',
              'note',
              scope.page.options.language,
            ) || '[Customer name]',
          variant: 'subtitle2',
          component: 'p',
        },
        null,
        null,
        'attribution',
      ),
    ],
    'quoteStack',
  )
  const content = tree.add(
    'muiCardContent',
    null,
    { p: 3 },
    [stack],
    'quoteContent',
  )
  return tree.add('muiCard', null, { height: '100%' }, [content], 'quoteCard')
}

/** A list: check-marked lines, or plain lines where rule 1 holds and the list is long. */
function list(scope: SectionScope, block: AiLayoutBlock, room: Room = 'full'): string | null {
  if (scope.page.options.verbatim) return importedList(scope, block, room)
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  // A list whose lines go somewhere is a list of links: each line that
  // resolves is a Page Link, and one that does not is left out (rule 10).
  if ((block.items ?? []).some((item) => item.to)) {
    const links = (block.items ?? []).flatMap((item) => {
      const label =
        aiLayoutContactLabel(item.title || item.text, scope.page.targets.contact) ||
        aiLayoutFitText(item.title || item.text, 'label', scope.page.options.language)
      const destination = label
        ? aiLayoutResolveLink(item.to, label, scope.link, scope.page.targets)
        : null
      if (!destination) return []
      const id = tree.add(
        'muiScreenLink',
        {
          children: label,
          renderAs: 'link',
          color: 'inherit',
          ...destinationProps(destination),
        },
        null,
        null,
        'link',
      )
      linkTo(scope, id, destination)
      return [id]
    })
    return links.length
      ? tree.add('muiStack', { spacing: '1' }, null, noted(scope, links), 'links')
      : null
  }
  const lines = cleanItems(scope, block.items ?? [])
    .map((item) =>
      aiLayoutWords(
        [item.title, item.text].filter((part) => part.trim()).join(' — '),
        'listItem',
        facts,
        scope.page.options.language,
      ),
    )
    .filter(Boolean)
  takeItemsInPlace(scope, lines)
  if (!lines.length) return null
  if (rule1(scope)) {
    const rows = lines.map((line) =>
      tree.add(
        'muiListItem',
        { disableGutters: true },
        null,
        [tree.add('muiListItemText', { primary: line }, null, null, 'line')],
        'row',
      ),
    )
    return tree.add('muiList', { disablePadding: true }, null, noted(scope, rows), 'list')
  }
  const check = aiIconOfWord(block.icon) ?? AI_ICON_LIBRARY.check
  const rows = lines.map((line) =>
    tree.add(
      'muiStack',
      { direction: 'row', spacing: '1.5', alignItems: 'flex-start' },
      null,
      [
        tree.add(
          AI_ICON_COMPONENT_ID,
          { iconId: check.id, size: '22' },
          accent(scope),
          null,
          'check',
        ),
        tree.add(
          'muiTypography',
          { children: line, variant: 'body1' },
          null,
          null,
          'line',
        ),
      ],
      'row',
    ),
  )
  return tree.add('muiStack', { spacing: '1.5' }, null, noted(scope, rows), 'list')
}

/** Questions and answers: an accordion each, or question-over-answer pairs where rule 1 holds. */
function faq(scope: SectionScope, block: AiLayoutBlock): string | null {
  if (scope.page.options.verbatim) return importedFaq(scope, block)
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  const items = takeItems(
    scope,
    cleanItems(scope, block.items ?? []).filter(
      (item) => !!aiLayoutWords(item.title, 'question', facts, scope.page.options.language),
    ),
  )
  if (!items.length) return null
  if (rule1(scope)) {
    const rows = items.map((item) =>
      tree.add(
        'muiListItem',
        { disableGutters: true, divider: true },
        null,
        [
          tree.add(
            'muiListItemText',
            {
              primary: aiLayoutWords(item.title, 'question', facts, scope.page.options.language),
              ...(item.text.trim()
                ? {
                    secondary: aiLayoutWords(item.text, 'answer', facts, scope.page.options.language),
                    ...mutedSecondary(scope),
                  }
                : {}),
            },
            null,
            null,
            'qa',
          ),
        ],
        'row',
      ),
    )
    return tree.add('muiList', { disablePadding: true }, null, noted(scope, rows), 'faq')
  }
  const panels = items.map((item, position) =>
    tree.add(
      'muiAccordion',
      {
        disableGutters: true,
        ...(position === 0 ? { defaultExpanded: true } : {}),
      },
      null,
      [
        tree.add(
          'muiAccordionSummary',
          { children: aiLayoutWords(item.title, 'question', facts, scope.page.options.language) },
          null,
          null,
          'question',
        ),
        item.text.trim()
          ? tree.add(
              'muiAccordionDetails',
              null,
              null,
              [
                tree.add(
                  'muiTypography',
                  {
                    children: aiLayoutWords(item.text, 'answer', facts, scope.page.options.language),
                    variant: 'body1',
                  },
                  { color: 'text.secondary' },
                  null,
                  'answer',
                ),
              ],
              'details',
            )
          : null,
      ],
      'panel',
    ),
  )
  return tree.add('muiStack', { spacing: '1.5' }, null, noted(scope, panels), 'faq')
}

// ── The designer layer (AGL-3660) ─────────────────────────────────────────
//
// What `ai-layout-design.ts` chose for the site, drawn: the hero, a section
// of words beside a picture, a closing band over a photo, a heading beside
// its items, and groups drawn as pictures, articles, a menu or open ruled
// columns. Every variant is built from the same palette elements and theme
// tokens as the rest of the compiler, so the doctrine holds by construction.

/** The most pictures a designed page carries, the model's and the stand-ins together. */
export const AI_LAYOUT_MAX_DESIGN_PICTURES = 8

/** The block kinds a section of words holds. */
const WORD_KINDS: ReadonlySet<AiLayoutBlock['kind']> = new Set(['eyebrow', 'heading', 'lede', 'text', 'note', 'button'])

/** How many more pictures the page has room for. */
function picturesLeft(page: PageScope): number {
  return AI_LAYOUT_MAX_DESIGN_PICTURES - page.images - page.pictures
}

/** Whether a heading block has words left once fitted: one with none is no heading. */
function speaksHeading(scope: SectionScope, block: AiLayoutBlock): boolean {
  return block.kind === 'heading' && !!say(scope, block.text, 'heading')
}

/** The section root every designed section is written under, as `compileSection` writes its own. */
function designedRoot(
  scope: SectionScope,
  children: readonly string[],
  sx: Record<string, unknown> | null,
  dark: boolean,
): string {
  const { page, index } = scope
  const name = page.plan.sections[index]?.name?.trim() || `Section ${index + 1}`
  return page.tree.add(
    'section',
    {
      element: 'section',
      ariaLabel: sectionLabel(name, index, page.options.language),
      ...(dark ? { colorScheme: 'dark' } : {}),
      // A photo cover that opens the page runs up under the header, which sits over it.
      ...(index === 0 && scope.overPhoto ? { underHeader: true } : {}),
    },
    sx,
    children,
    'section',
    page.options.sectionIds?.[index] ?? sectionIdOf(index),
  )
}

/** A picture a design places: what it shows, whether anyone described it, and the source's own copy on a page brought in (AGL-4107). */
interface DesignedPicture {
  alt: string
  given: boolean
  src?: string
}

/**
 * A picture the design places: the model's own where it described one, else
 * a stand-in — marked decorative, since no one described it, with the
 * section's words as what a stock search looks for. Either is filled by
 * `ai-layout-pictures.ts` after the page is checked, as any slot is.
 */
function designPicture(
  scope: SectionScope,
  picture: DesignedPicture,
  frameSx: Record<string, unknown>,
  role = 'designFrame',
  imageSx: Record<string, unknown> = {},
): string {
  const tree = scope.page.tree
  // The picture fills its frame by its own size props, so the frame alone
  // carries a style: a page of many pictures repeats no inline style (rule 16).
  const image = designImage(scope, picture, { width: '100%', height: '100%' }, Object.keys(imageSx).length ? imageSx : null)
  return tree.add('muiBox', null, { position: 'relative', overflow: 'hidden', bgcolor: 'action.hover', ...frameSx }, [image], role)
}

/**
 * The `image` a designed picture is: its alt, its fit and, for a stand-in,
 * decorative. Its slot is filled after the page is checked.
 */
function designImage(
  scope: SectionScope,
  picture: DesignedPicture,
  props: Record<string, unknown>,
  sx: Record<string, unknown> | null,
): string {
  const { page } = scope
  if (picture.given) page.images += 1
  else page.pictures += 1
  // A page brought in places the source's own picture (AGL-4107), described as
  // the source described it, and decorative where it was not described.
  const described = picture.alt ? { alt: picture.alt } : { decorative: true }
  return page.tree.add(
    'image',
    picture.src
      ? { src: picture.src, ...described, objectFit: 'cover', ...(page.images > 1 ? { loading: 'lazy' } : {}), ...props }
      : { alt: picture.alt, objectFit: 'cover', ...(picture.given ? {} : { decorative: true }), ...props },
    sx,
    null,
    'image',
  )
}

/** What a stand-in picture is of, for a stock search: the section's subject, else the site's. */
function standInAlt(scope: SectionScope, words?: string): string {
  return (
    aiLayoutFitText(words, 'alt', scope.page.options.language) ||
    aiLayoutFitText(scope.heading, 'alt', scope.page.options.language) ||
    aiLayoutFitText(scope.page.plan.sections[scope.index]?.name, 'alt', scope.page.options.language) ||
    aiLayoutFitText(scope.page.plan.title, 'alt', scope.page.options.language) ||
    'A photo'
  )
}

/** A grid row of sized cells, as `compileRow` writes one, from ids already compiled. */
function designRow(
  scope: SectionScope,
  cells: ReadonlyArray<{ id: string; size: string; sx?: Record<string, unknown> }>,
  spacing: string,
  alignItems = 'center',
): string {
  const tree = scope.page.tree
  return tree.add(
    'muiGrid',
    { container: true, spacing },
    { alignItems },
    cells.map((cell) => tree.add('muiGrid', { size: cell.size }, cell.sx ?? null, [cell.id], 'column')),
    'row',
  )
}

/** A section's own arrangement where the design has one; `null` to draw it the compiler's first way. */
function designSection(scope: SectionScope, raw: AiLayoutSection, blocks: readonly AiLayoutBlock[]): string | null {
  const { page, index } = scope
  const design = page.design
  if (!design) return null
  const images = blocks.filter((block) => block.kind === 'image')
  const words = blocks.filter((block) => block.kind !== 'image')
  const ofWords = words.length > 0 && words.every((block) => WORD_KINDS.has(block.kind))
  if (index === 0) {
    if (!ofWords || images.length > 1 || picturesLeft(page) < 1) return null
    const flow = [...words]
    if (!flow.some((block) => speaksHeading(scope, block))) {
      flow.unshift({ kind: 'heading', text: page.plan.title })
      page.settled.push({ at: scope.at, what: "no heading; the page's title written as its h1" })
    }
    // A designed hero's title is display-sized; beside a photo, in half the
    // page, it is the page's title size, so a long one still reads in a few lines.
    const lead = flow.findIndex((block) => speaksHeading(scope, block))
    const { style: _style, ...title } = flow[lead]
    flow[lead] = AI_LAYOUT_HALF_HEROES.has(design.choices.hero) ? title : { ...title, style: 'large' }
    sellingHero(scope, flow)
    const given = images[0] ? aiLayoutFitText(images[0].text, 'alt', scope.page.options.language) : ''
    return hero(
      scope,
      flow,
      given ? { alt: given, given: true } : { alt: standInAlt(scope, words.find((block) => speaksHeading(scope, block))?.text), given: false },
    )
  }
  if (ofWords && !images.length && words.some((block) => speaksHeading(scope, block))) {
    const last = index === page.plan.sections.length - 1
    const asks = words.some((block) => block.kind === 'button')
    const strong = scope.band === 'brand' || scope.band === 'dark'
    const told = words.some((block) => block.kind === 'text' || block.kind === 'lede')
    if (last && asks && (strong || scope.centered) && design.choices.coverClose && picturesLeft(page) >= 1) {
      return coverBand(scope, words)
    }
    if (design.choices.features && told && page.features < 2 && picturesLeft(page) >= 1 && !(last && asks && strong)) {
      return feature(scope, words)
    }
    return null
  }
  // A heading over one group of items: the heading beside them.
  if (!design.choices.splitHeads || images.length || page.splitAt === index - 1) return null
  const at = words.findIndex((block) => block.kind === 'cards' || block.kind === 'steps')
  if (at <= 0) return null
  const head = words.slice(0, at)
  const group = words[at]
  const tail = words.slice(at + 1)
  const variant = aiLayoutGroupVariant(design.input, design.choices, scope.words ?? '')
  if (
    !head.every((block) => WORD_KINDS.has(block.kind) && block.kind !== 'button') ||
    !head.some((block) => speaksHeading(scope, block)) ||
    !tail.every((block) => WORD_KINDS.has(block.kind)) ||
    (group.items?.length ?? 0) < 2 ||
    (group.items?.length ?? 0) > 6 ||
    group.to ||
    (group.kind === 'cards' && variant !== 'cards' && variant !== 'ruled') ||
    // A store's making is shown as pictures across the page (AGL-3676), never
    // ruled words in half of it: set beside its heading, a seed that splits
    // headings left a storefront's "how it is made" a band of text (AGL-3985).
    (group.kind === 'steps' && aiLayoutFamily(design.input.kind) === 'retail')
  ) {
    return null
  }
  return splitSection(scope, head, group, tail)
}

/** The first section, in the site's hero arrangement. */
function hero(
  scope: SectionScope,
  flow: readonly AiLayoutBlock[],
  picture: DesignedPicture,
  /** The hero a page brought in opens as (AGL-4107), over the site's own. */
  asked?: AiLayoutHeroVariant,
): string {
  const { page } = scope
  const tree = page.tree
  const design = page.design as NonNullable<PageScope['design']>
  const home = design.input.home
  // A collage holds two pictures: on a page with room for one, it is drawn
  // split, and so it is on a page brought in, which shows only its own.
  const chosen: AiLayoutHeroVariant = asked ?? design.choices.hero
  const variant: AiLayoutHeroVariant = chosen === 'collage' && (picturesLeft(page) < 2 || page.options.verbatim) ? 'split' : chosen
  page.settled.push({ at: scope.at, what: `drawn as a ${variant} hero` })
  if (variant === 'cover' || variant === 'poster') {
    scope.band = 'dark'
    // A cover sets its words at the start of the page; a poster centers them,
    // taller, as a restaurant's or a band's opening does (AGL-3985).
    scope.centered = variant === 'poster'
    const tall = variant === 'poster'
    return cover(
      scope,
      flow,
      picture,
      home ? (tall ? { xs: '84vh', md: '94vh' } : { xs: '78vh', md: '86vh' }) : tall ? { xs: '52vh', md: '62vh' } : { xs: '46vh', md: '54vh' },
    )
  }
  if (variant === 'bleed') return bleedHero(scope, flow, picture, home)
  if (variant === 'column') return columnHero(scope, flow, picture, home)
  if (variant === 'collage') return collageHero(scope, flow, picture, home)
  if (variant === 'panel') return panelHero(scope, flow, picture, home)
  if (variant === 'portrait') return portraitHero(scope, flow, picture)
  const band = scope.band
  scope.centered = false
  if (variant === 'split') {
    const words = compileFlow(scope, flow, 'half') as string
    const photo = designPicture(scope, picture, {
      aspectRatio: home ? { xs: '4 / 3', md: '4 / 5' } : { xs: '4 / 3', md: '1 / 1' },
      borderRadius: 2,
    })
    const right = design.choices.featureLeft
    const row = designRow(
      scope,
      [
        { id: words, size: 'xs:12 md:6', ...(right ? { sx: { order: { xs: 0, md: 1 } } } : {}) },
        { id: photo, size: 'xs:12 md:6' },
      ],
      '8',
    )
    const container = tree.add('muiContainer', { maxWidth: 'lg' }, { py: { xs: 6, md: 10 } }, [row], 'container')
    return designedRoot(scope, [container], bandSx(band), band === 'dark')
  }
  // Editorial: display type across the page, the rest in a row under it, a wide photo below.
  const top = flow.filter((block) => block.kind === 'eyebrow' || block.kind === 'heading')
  const rest = flow.filter((block) => block.kind !== 'eyebrow' && block.kind !== 'heading')
  const lede = rest.filter((block) => block.kind !== 'button')
  const actions = rest.filter((block) => block.kind === 'button')
  const headId = compileFlow(scope, top, 'full')
  const ledeId = compileFlow(scope, lede, 'half')
  const actionsId = compileFlow(scope, actions, 'half')
  const under =
    ledeId && actionsId
      ? designRow(
          scope,
          [
            { id: ledeId, size: 'xs:12 md:7' },
            { id: actionsId, size: 'xs:12 md:5', sx: { display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } } },
          ],
          '4',
          'flex-end',
        )
      : (ledeId ?? actionsId)
  const photo = designPicture(scope, picture, {
    aspectRatio: home ? { xs: '4 / 3', md: '21 / 9' } : { xs: '16 / 9', md: '3 / 1' },
    borderRadius: 2,
  })
  const stack = tree.add('muiStack', { spacing: '6', useFlexGap: true }, null, [headId, under, photo], 'content')
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { pt: { xs: 8, md: 12 }, pb: { xs: 6, md: 10 } }, [stack], 'container')
  return designedRoot(scope, [container], bandSx(band), band === 'dark')
}

/** Words over a full-bleed photo, on a scrim that keeps them readable, in the site's dark scheme. */
function cover(
  scope: SectionScope,
  flow: readonly AiLayoutBlock[],
  picture: DesignedPicture,
  minHeight: Record<string, string>,
): string {
  const tree = scope.page.tree
  // The photo dimmed over black: the scrim that keeps the words over it readable.
  const photo = designPicture(
    scope,
    picture,
    { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', bgcolor: 'common.black' },
    'coverPhoto',
    { opacity: 0.42 },
  )
  scope.overPhoto = true
  const words = compileFlow(scope, flow, 'full') as string
  const measure = tree.add(
    'muiBox',
    null,
    scope.centered ? { maxWidth: { xs: '100%', md: '75%' }, mx: 'auto' } : { maxWidth: { xs: '100%', md: '62%' } },
    [words],
    'measure',
  )
  const container = tree.add(
    'muiContainer',
    { maxWidth: 'lg' },
    { position: 'relative', zIndex: 1, py: { xs: 10, md: 14 } },
    [measure],
    'container',
  )
  return designedRoot(
    scope,
    [photo, container],
    { position: 'relative', overflow: 'hidden', display: 'flex', alignItems: { xs: 'flex-end', md: 'center' }, minHeight },
    true,
  )
}

/** The surface a band paints, as a palette role: what a picture laid over another is edged in. */
function bandSurface(band: AiLayoutBand): string {
  if (band === 'soft') return 'background.paper'
  if (band === 'brand') return 'primary.main'
  return 'background.default'
}

/**
 * A bleed hero (AGL-3985): the band in two halves, a photo filling one of
 * them edge to edge, top to bottom, and the words in the other, centered in
 * its height. On a phone the photo sits over the words.
 */
function bleedHero(scope: SectionScope, flow: readonly AiLayoutBlock[], picture: DesignedPicture, home: boolean): string {
  const { page } = scope
  const tree = page.tree
  const design = page.design as NonNullable<PageScope['design']>
  const band = scope.band
  scope.centered = false
  const words = compileFlow(scope, flow, 'half') as string
  const measure = tree.add('muiBox', null, { maxWidth: { xs: '100%', md: '88%' }, px: { xs: 3, sm: 6, md: 8 }, py: { xs: 6, md: 10 } }, [words], 'measure')
  const photo = designPicture(scope, picture, { height: '100%', minHeight: home ? { xs: '46vh', md: '84vh' } : { xs: '36vh', md: '56vh' } }, 'bleedPhoto')
  const right = design.choices.featureLeft
  const row = tree.add(
    'muiGrid',
    { container: true, spacing: '0' },
    { alignItems: 'stretch' },
    [
      tree.add('muiGrid', { size: 'xs:12 md:6' }, right ? { order: { xs: 0, md: 1 } } : null, [photo], 'column'),
      tree.add('muiGrid', { size: 'xs:12 md:6' }, { display: 'flex', alignItems: 'center', justifyContent: right ? 'flex-end' : 'flex-start' }, [measure], 'column'),
    ],
    'row',
  )
  return designedRoot(scope, [row], bandSx(band), band === 'dark')
}

/**
 * A masthead (AGL-3985): the words centered in a narrow column, as a journal
 * or a quiet practice opens, and a wide photo under them.
 */
function columnHero(scope: SectionScope, flow: readonly AiLayoutBlock[], picture: DesignedPicture, home: boolean): string {
  const tree = scope.page.tree
  const band = scope.band
  scope.centered = true
  const words = compileFlow(scope, flow, 'full') as string
  const measure = tree.add('muiBox', null, { maxWidth: { xs: '100%', md: '72%' }, mx: 'auto' }, [words], 'measure')
  const photo = designPicture(scope, picture, {
    aspectRatio: home ? { xs: '4 / 3', md: '16 / 7' } : { xs: '16 / 9', md: '3 / 1' },
    borderRadius: 2,
  })
  const stack = tree.add('muiStack', { spacing: '8', useFlexGap: true }, null, [measure, photo], 'content')
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { pt: { xs: 8, md: 12 }, pb: { xs: 6, md: 10 } }, [stack], 'container')
  return designedRoot(scope, [container], bandSx(band), band === 'dark')
}

/**
 * A collage hero (AGL-3985): the words beside two pictures, a tall one and a
 * smaller one laid over its lower corner, edged in the band's own surface, as
 * a shop shows two of its things or an event two moments of its day.
 */
function collageHero(scope: SectionScope, flow: readonly AiLayoutBlock[], picture: DesignedPicture, home: boolean): string {
  const { page } = scope
  const tree = page.tree
  const design = page.design as NonNullable<PageScope['design']>
  const band = scope.band
  scope.centered = false
  const words = compileFlow(scope, flow, 'half') as string
  const tall = designPicture(scope, picture, { width: { xs: '78%', md: '76%' }, aspectRatio: home ? '4 / 5' : '1 / 1', borderRadius: 2 })
  const small = designPicture(
    scope,
    { alt: standInAlt(scope, page.plan.sections[scope.index]?.name), given: false },
    {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: { xs: '48%', md: '50%' },
      aspectRatio: '1 / 1',
      borderRadius: 2,
      border: 6,
      borderColor: bandSurface(band),
    },
    'collagePhoto',
  )
  const pictures = tree.add('muiBox', null, { position: 'relative', pb: { xs: 6, md: 10 } }, [tall, small], 'collage')
  const right = design.choices.featureLeft
  const row = designRow(
    scope,
    [
      { id: words, size: 'xs:12 md:5', ...(right ? { sx: { order: { xs: 0, md: 1 } } } : {}) },
      { id: pictures, size: 'xs:12 md:7' },
    ],
    '8',
  )
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { py: { xs: 6, md: 10 } }, [row], 'container')
  return designedRoot(scope, [container], bandSx(band), band === 'dark')
}

/**
 * A panel hero (AGL-3985): a full-bleed photo shown as it is, undimmed, and
 * the words on a card of the page's own surface over its lower corner, as an
 * agent's listing or a firm's office opens. The card carries its own colors,
 * so the words read whatever the photo is.
 */
function panelHero(scope: SectionScope, flow: readonly AiLayoutBlock[], picture: DesignedPicture, home: boolean): string {
  const tree = scope.page.tree
  // The words sit on the card, never on the band the model chose.
  scope.band = 'plain'
  scope.centered = false
  const photo = designPicture(scope, picture, { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, 'panelPhoto')
  const words = compileFlow(scope, flow, 'half') as string
  const card = tree.add(
    'muiBox',
    null,
    { bgcolor: 'background.paper', color: 'text.primary', borderRadius: 2, boxShadow: 3, p: { xs: 4, md: 6 }, maxWidth: { xs: '100%', md: '52%' } },
    [words],
    'panel',
  )
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { position: 'relative', zIndex: 1, pt: { xs: 28, md: 36 }, pb: { xs: 4, md: 8 } }, [card], 'container')
  return designedRoot(
    scope,
    [photo, container],
    { position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', minHeight: home ? { xs: '72vh', md: '84vh' } : { xs: '48vh', md: '56vh' } },
    false,
  )
}

/**
 * A portrait hero (AGL-3985): a person's own page opens on their round
 * photo, the words centered under it.
 */
function portraitHero(scope: SectionScope, flow: readonly AiLayoutBlock[], picture: DesignedPicture): string {
  const tree = scope.page.tree
  const band = scope.band
  scope.centered = true
  const photo = designPicture(scope, picture, { width: { xs: '44%', sm: '30%', md: '22%' }, aspectRatio: '1 / 1', borderRadius: '50%', flexShrink: 0 })
  const words = compileFlow(scope, flow, 'full') as string
  const measure = tree.add('muiBox', null, { maxWidth: { xs: '100%', md: '72%' }, mx: 'auto' }, [words], 'measure')
  const stack = tree.add('muiStack', { spacing: '5', useFlexGap: true, alignItems: 'center' }, null, [photo, measure], 'content')
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { py: { xs: 8, md: 12 } }, [stack], 'container')
  return designedRoot(scope, [container], bandSx(band), band === 'dark')
}

/** A closing section of words over a photo. */
function coverBand(scope: SectionScope, words: readonly AiLayoutBlock[]): string {
  scope.band = 'dark'
  scope.centered = true
  scope.page.settled.push({ at: scope.at, what: 'drawn over a photo' })
  return cover(scope, words, { alt: standInAlt(scope), given: false }, { xs: '56vh', md: '64vh' })
}

/** A section of words beside a picture, the side turning section by section. */
function feature(scope: SectionScope, words: readonly AiLayoutBlock[]): string {
  const { page } = scope
  const design = page.design as NonNullable<PageScope['design']>
  const left = design.choices.featureLeft !== (page.features % 2 === 1)
  page.features += 1
  page.settled.push({ at: scope.at, what: `set beside a picture on the ${left ? 'left' : 'right'}` })
  scope.centered = false
  const flow = compileFlow(scope, words, 'half') as string
  const photo = designPicture(scope, { alt: standInAlt(scope), given: false }, {
    aspectRatio: { xs: '4 / 3', md: page.features === 1 ? '4 / 5' : '1 / 1' },
    borderRadius: 2,
  })
  const row = designRow(
    scope,
    left
      ? [
          { id: photo, size: 'xs:12 md:6' },
          { id: flow, size: 'xs:12 md:6' },
        ]
      : [
          { id: flow, size: 'xs:12 md:6' },
          { id: photo, size: 'xs:12 md:6' },
        ],
    '8',
  )
  const container = page.tree.add('muiContainer', { maxWidth: 'lg' }, { py: { ...SECTION_PADDING } }, [row], 'container')
  return designedRoot(scope, [container], bandSx(scope.band), scope.band === 'dark')
}

/** The most sections a page sets beside a photo for being the third in a row with none (AGL-4065). */
const AI_LAYOUT_RHYTHM_MOST = 2

/** What the compiler notes of a section it set beside a photo for the page's rhythm (AGL-4065). */
export const AI_LAYOUT_RHYTHM_NOTE = 'drawn beside a photo: third text-only band'

/**
 * NO THREE TEXT-ONLY BANDS IN A ROW (AGL-4065). The booth-kit trades homes
 * of 2026-10-25 stacked their middles as bands of words with no picture —
 * Holeshot Moto Repair's numbered steps, its repair list and its reasons to
 * trust the shop, one under another. On a page drawn with a design, whose
 * stand-in pictures the stock library fills, a section that would be the
 * third in a row to show no picture is set beside one instead: its words
 * and its items in one half, a photo of its heading's subject in the other,
 * the side turning as the design's own photo-led sections turn. At most
 * twice a page, and only where the page has a picture left.
 *
 * A section of words or of one group of cards or lines qualifies. Steps,
 * questions and figures read best as text and stay so; a section with a
 * picture, a form, a component or a row of columns of its own is drawn as
 * designed; a group the design draws as pictures, articles or a menu
 * already is one; and the page's closing call to action is the design's to
 * draw (`coverClose`). `null` leaves the section to the design.
 */
function rhythmSection(scope: SectionScope, raw: AiLayoutSection, blocks: readonly AiLayoutBlock[]): string | null {
  const { page, index } = scope
  const design = page.design
  if (!design || index === 0 || (page.bare ?? 0) < 2 || (page.rhythm ?? 0) >= AI_LAYOUT_RHYTHM_MOST || picturesLeft(page) < 1) return null
  if (raw.cols && raw.cols.length >= 2) return null
  const words = blocks.filter((block) => WORD_KINDS.has(block.kind))
  const groups = blocks.filter((block) => !WORD_KINDS.has(block.kind))
  if (groups.length > 1 || !words.some((block) => speaksHeading(scope, block))) return null
  const group = groups[0]
  if (group && ((group.kind !== 'cards' && group.kind !== 'list') || group.to || (group.items?.length ?? 0) > 6)) return null
  if (group?.kind === 'cards' && group.style !== 'quiet' && aiLayoutGroupVariant(design.input, design.choices, scope.words ?? '') !== design.choices.group) return null
  const last = index === page.plan.sections.length - 1
  if (last && words.some((block) => block.kind === 'button')) return null
  if (!group) {
    // A section of words the design already sets beside a photo needs no rule.
    if (!words.some((block) => block.kind === 'text' || block.kind === 'lede') || (design.choices.features && page.features < 2)) return null
    page.rhythm = (page.rhythm ?? 0) + 1
    page.settled.push({ at: scope.at, what: AI_LAYOUT_RHYTHM_NOTE })
    return feature(scope, words)
  }
  page.rhythm = (page.rhythm ?? 0) + 1
  page.settled.push({ at: scope.at, what: AI_LAYOUT_RHYTHM_NOTE })
  return featureGroup(scope, words, group)
}

/**
 * A section's words and its one group beside a picture of its subject
 * (AGL-4065): the words over the items in the wider half, the photo at 4:3
 * in the other, on the side the design's photo-led sections turn to next.
 */
function featureGroup(scope: SectionScope, words: readonly AiLayoutBlock[], group: AiLayoutBlock): string {
  const { page } = scope
  const design = page.design as NonNullable<PageScope['design']>
  const left = design.choices.featureLeft !== (page.features % 2 === 1)
  page.features += 1
  scope.centered = false
  // The heading and its words open the half, the group under them, any button last.
  const flow = compileFlow(scope, [...words.filter((block) => block.kind !== 'button'), group, ...words.filter((block) => block.kind === 'button')], 'half') as string
  const photo = designPicture(scope, { alt: standInAlt(scope), given: false }, { aspectRatio: '4 / 3', borderRadius: 2 })
  const row = designRow(
    scope,
    left
      ? [
          { id: photo, size: 'xs:12 md:5' },
          { id: flow, size: 'xs:12 md:7' },
        ]
      : [
          { id: flow, size: 'xs:12 md:7' },
          { id: photo, size: 'xs:12 md:5' },
        ],
    '8',
  )
  const container = page.tree.add('muiContainer', { maxWidth: 'lg' }, { py: { ...SECTION_PADDING } }, [row], 'container')
  return designedRoot(scope, [container], bandSx(scope.band), scope.band === 'dark')
}

/**
 * The variant a designed group's item title takes (AGL-4065): the heading
 * style it names, or — where the site's seed sets its titles as labels — the
 * theme's own overline, spaced capitals over the item's words.
 */
function itemTitleVariant(scope: SectionScope, heading: string): string {
  return scope.page.design?.choices.headingCase === 'caps' ? 'overline' : heading
}

/** A heading beside its items: the words in a narrow column, the items ruled in the wide one. */
function splitSection(
  scope: SectionScope,
  head: readonly AiLayoutBlock[],
  group: AiLayoutBlock,
  tail: readonly AiLayoutBlock[],
): string {
  const { page } = scope
  scope.centered = false
  scope.groupStyle = 'ruled'
  page.splitAt = scope.index
  page.settled.push({ at: scope.at, what: 'the heading set beside its items' })
  const words = compileFlow(scope, [...head, ...tail], 'half')
  const items = compileFlow(scope, [group], 'half')
  if (!words || !items) {
    const flow = [words, items].filter((id): id is string => !!id)
    const container = page.tree.add('muiContainer', { maxWidth: 'lg' }, { py: { ...SECTION_PADDING } }, flow, 'container')
    return designedRoot(scope, [container], bandSx(scope.band), scope.band === 'dark')
  }
  const row = designRow(
    scope,
    [
      { id: words, size: 'xs:12 md:5' },
      { id: items, size: 'xs:12 md:7' },
    ],
    '8',
    'flex-start',
  )
  const container = page.tree.add('muiContainer', { maxWidth: 'lg' }, { py: { ...SECTION_PADDING } }, [row], 'container')
  return designedRoot(scope, [container], bandSx(scope.band), scope.band === 'dark')
}

/**
 * Items under rules, one a line, each opening under a thin rule in the
 * text's own color. One style key an element, so a long list repeats no
 * multi-key inline style (rule 16); and no Stack `divider`, which a
 * published page's renderer hands a Stack as one child and so never draws.
 */
function ruledList(scope: SectionScope, ids: readonly string[], role: string): string {
  const tree = scope.page.tree
  return tree.add(
    'muiStack',
    { spacing: '2' },
    null,
    ids.map((id) => tree.add('muiBox', null, { borderTop: 1 }, [tree.add('muiBox', null, { pt: 2 }, [id], 'ruledWords')], 'ruledLine')),
    role,
  )
}

/** Numbered items as a ruled list: each number beside its title and words. */
function timeline(scope: SectionScope, items: readonly AiLayoutItem[]): string {
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  const rows = items.map((item, position) =>
    tree.add(
      'muiStack',
      { direction: 'row', spacing: '3', alignItems: 'baseline' },
      null,
      [
        // The numbers keep one column, so every title starts at the same line.
        tree.add(
          'muiBox',
          null,
          { flex: '0 0 3.5rem' },
          [tree.add('muiTypography', { children: String(position + 1).padStart(2, '0'), variant: 'h4', component: 'p' }, accent(scope), null, 'number')],
          'numberColumn',
        ),
        tree.add(
          'muiStack',
          { spacing: '1' },
          null,
          [
            item.title.trim()
              ? tree.add('muiTypography', { children: aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language), variant: itemTitleVariant(scope, 'h5'), component: itemElement(scope) }, null, null, 'title')
              : null,
            item.text.trim()
              ? tree.add('muiTypography', { children: aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language), variant: 'body1' }, muted(scope), null, 'text')
              : null,
          ],
          'stepWords',
        ),
      ],
      'step',
    ),
  )
  return ruledList(scope, noted(scope, rows), 'timeline')
}

/** A group drawn the design's way; `null` to draw it as the theme's cards. */
function designedGroup(
  scope: SectionScope,
  variant: AiLayoutGroupVariant,
  items: readonly AiLayoutItem[],
  room: Room,
): string | null {
  const { page } = scope
  const tree = page.tree
  const facts = page.targets.facts
  const title = (item: AiLayoutItem, type = 'h5') =>
    item.title.trim()
      ? tree.add('muiTypography', { children: aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language), variant: type, component: itemElement(scope) }, null, null, 'title')
      : null
  const words = (item: AiLayoutItem, type = 'body1') =>
    item.text.trim()
      ? tree.add('muiTypography', { children: aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language), variant: type }, muted(scope), null, 'text')
      : null
  if (variant === 'cards') return null
  if (variant === 'icons') return iconColumns(scope, items, room)
  const pictured = variant === 'pictures' || variant === 'articles'
  if (variant === 'ruled' || (pictured && (room !== 'full' || picturesLeft(page) < items.length))) {
    const perRow = across(items.length, room, 'cards')
    if (perRow <= 1) {
      // Stacked, the rules run between the items.
      const ids = items.map((item) => tree.add('muiStack', { spacing: '1' }, null, [title(item, itemTitleVariant(scope, 'h5')), words(item)], 'ruled'))
      return ruledList(scope, noted(scope, ids), 'ruledItems')
    }
    // Side by side, each column opens under a rule in the text's own color.
    const ids = items.map((item) =>
      tree.add('muiBox', null, { borderTop: 1 }, [tree.add('muiStack', { spacing: '1' }, { pt: 2.5 }, [title(item, itemTitleVariant(scope, 'h5')), words(item)], 'ruledWords')], 'ruled'),
    )
    return layOut(scope, noted(scope, ids), perRow, '5', 'ruledItems')
  }
  if (variant === 'menu') {
    const ids = items.map((item) => tree.add('muiStack', { spacing: '0.5' }, null, [title(item, 'h6'), words(item, 'body2')], 'dish'))
    noted(scope, ids)
    // Two columns of lines under rules, the first half and the second.
    const half = room === 'full' && ids.length >= 4 ? Math.ceil(ids.length / 2) : ids.length
    const lists = [ids.slice(0, half), ids.slice(half)].filter((list) => list.length).map((list) => ruledList(scope, list, 'menu'))
    if (lists.length === 1) return lists[0]
    // On a phone the two columns read as one list, the second opening under
    // its own rule a line's gap below the first; side by side, a gutter.
    const [first, second] = lists
    return tree.add(
      'muiGrid',
      { container: true, rowSpacing: '2', columnSpacing: '8' },
      { alignItems: 'flex-start' },
      [
        tree.add('muiGrid', { size: 'xs:12 md:6' }, null, [first], 'column'),
        tree.add('muiGrid', { size: 'xs:12 md:6' }, null, [second], 'column'),
      ],
      'menuRow',
    )
  }
  // Pictures over each item's title and words.
  const design = page.design as NonNullable<PageScope['design']>
  const mosaic = variant === 'pictures' && design.choices.pictures === 'mosaic' && items.length >= 2
  const portrait = design.input.kind === 'photography'
  const perRow = items.length === 4 || items.length === 2 ? 2 : Math.min(3, items.length)
  page.settled.push({ at: scope.at, what: `${items.length} items drawn as ${mosaic ? 'a mosaic of pictures' : variant}` })
  const cells = items.map((item, position) => {
    // A mosaic's rows turn wide-narrow, narrow-wide; an odd one out spans the row.
    const row = Math.floor(position / 2)
    const lone = mosaic && position === items.length - 1 && items.length % 2 === 1
    const wide = mosaic && !lone && position % 2 === row % 2
    const span = !mosaic ? 12 / perRow : lone ? 12 : wide ? 7 : 5
    const aspect = !mosaic ? (variant === 'articles' ? '3 / 2' : portrait ? '4 / 5' : '4 / 3') : lone ? '21 / 9' : wide ? '4 / 3' : '4 / 5'
    // The picture is its own frame: its shape its one style, so a grid of them repeats no inline style.
    // A portfolio's or a photographer's gallery opens in a lightbox, its
    // pictures one gallery with the item's title as each caption (AGL-3717).
    const opens = variant === 'pictures' && aiOpensGalleriesInLightbox(page)
    // A store's collection tiles open its Shop page (AGL-3676).
    const shop = variant === 'pictures' && !opens && aiLayoutFamily(design.input.kind) === 'retail' ? shopPageOf(page) : null
    const photo = designImage(
      scope,
      { alt: standInAlt(scope, item.title || item.text), given: false },
      { width: '100%', ...(opens ? lightboxProps(scope, item.title) : {}), ...(shop ? { screenId: shop } : {}) },
      { aspectRatio: { xs: '4 / 3', md: aspect } },
    )
    const id = tree.add(
      'muiStack',
      { spacing: '1.5' },
      null,
      [photo, title(item, variant === 'articles' ? 'h5' : 'h6'), words(item, 'body2')],
      variant === 'articles' ? 'article' : 'work',
    )
    return { id, size: span === 12 ? 'xs:12 sm:12' : `xs:12 ${span === 6 ? 'sm' : 'md'}:${span}` }
  })
  noted(
    scope,
    cells.map((cell) => cell.id),
  )
  return tree.add(
    'muiGrid',
    { container: true, spacing: mosaic ? '5' : '4' },
    { alignItems: 'flex-start' },
    cells.map((cell) => tree.add('muiGrid', { size: cell.size }, null, [cell.id], 'cell')),
    variant,
  )
}

// ── A section the site's records fill (AGL-3676) ──────────────────────────
//
// The section's words — its eyebrow, heading and lede — are the design's;
// what it lists is the site's: its products through the commerce plugin's
// Product grid, its posts through the content plugin's Collection Entries.
// Any group the design drew for those records (cards naming products, a list
// of post titles) stands in for them, and is left out.

/** The block kinds a listing stands in for: the records the design described in words. */
const LISTING_REPLACES: ReadonlySet<AiLayoutBlock['kind']> = new Set([
  'cards',
  'steps',
  'stats',
  'quotes',
  'list',
  'image',
  'component',
])

/** The tokens a post's card binds, filled per post when the page renders. */
export const AI_LAYOUT_POST_CARD_TOKENS = [
  '{{entry.title}}',
  '{{entry.excerpt}}',
  '{{entry.date}}',
  '{{entry.author}}',
  '{{entry.url}}',
  '{{entry.coverImage}}',
] as const

/** The tokens a post's card puts in a link or a picture, which the page's store admits whole. */
export const AI_LAYOUT_POST_ADDRESS_TOKENS: readonly string[] = ['{{entry.url}}', '{{entry.coverImage}}']

/** The button under a featured band that opens the whole list, where the site has one and the design gave none. */
function listingAllButton(page: PageScope, listing: AiLayoutListing): AiLayoutBlock | null {
  const language = page.options.language
  if (listing.kind === 'posts')
    return listing.href ? { kind: 'button', text: aiLayoutLabel('allPosts', language), to: listing.href, style: 'secondary' } : null
  const index = listing.placements.find((placement) => placement.role === 'index' && placement.screenId !== page.targets.pageId)
  if (!index) return null
  const text = aiLayoutLabel(
    listing.kind === 'tracks' ? 'allMusic' : listing.kind === 'events' ? 'allEvents' : listing.kind === 'records' ? 'seeAll' : 'shopAll',
    language,
  )
  return { kind: 'button', text, to: `page:${index.screenId}`, style: 'secondary' }
}

function listingSection(
  scope: SectionScope,
  blocks: readonly AiLayoutBlock[],
  placed: { listing: AiLayoutListing; role: AiLayoutListingRole; filter?: AiLayoutListingFilter },
): string {
  const { page, index, at } = scope
  const { listing, role, filter } = placed
  if (listing.kind === 'reviews') return reviewsSection(scope, blocks)
  if (listing.kind === 'signup') return signupSection(scope, blocks)
  // The grid straight under a Shop page's title bar opens on the products:
  // the title bar already heads the page (AGL-3676).
  const underTitle = listing.kind === 'products' && role === 'index' && index === 1 && shopGridAt(page) === 1
  const left = blocks.filter((block) => LISTING_REPLACES.has(block.kind))
  if (left.length) {
    page.settled.push({
      at,
      what: `${left.map((block) => block.kind).join(', ')} left out: the section lists the site's own ${listing.kind}`,
    })
  }
  const kept = underTitle ? [] : blocks.filter((block) => !LISTING_REPLACES.has(block.kind)).map(({ col: _col, ...block }) => block)
  const words = kept.filter((block) => block.kind !== 'button' && block.kind !== 'form')
  let actions = kept.filter((block) => block.kind === 'button')
  if (!actions.length && role === 'featured') {
    const all = listingAllButton(page, listing)
    if (all) actions = [all]
  }
  if (!underTitle && !words.some((block) => speaksHeading(scope, block))) {
    // Every band of records is headed: the plan's name for it, or on a first section the page's title.
    words.unshift({ kind: 'heading', text: index === 0 ? page.plan.title : page.plan.sections[index]?.name || page.plan.title })
  }
  page.settled.push({ at, what: `lists the site's ${listing.kind} (${role})` })
  const tree = page.tree
  const centered = scope.centered
  const head = compileFlow(scope, words, centered ? 'full' : 'half')
  const link = compileFlow(scope, actions, 'half')
  // An editorial band's head: the words on the left, the way to the whole list on the right.
  const top =
    head && link && !centered
      ? designRow(
          scope,
          [
            { id: head, size: 'xs:12 md:8' },
            { id: link, size: 'xs:12 md:4', sx: { display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } } },
          ],
          '3',
          'flex-end',
        )
      : head
  const records = listingElement(scope, listing, role, filter)
  const parts = [
    top ? (centered ? tree.add('muiContainer', { maxWidth: 'md', disableGutters: true }, null, [top], 'measure') : top) : null,
    records,
    centered || !head ? link : null,
  ].filter((id): id is string => !!id)
  const content = tree.add('muiStack', { spacing: '6', useFlexGap: true, ...(centered ? { alignItems: 'center' } : {}) }, null, parts, 'content')
  const container = tree.add(
    'muiContainer',
    { maxWidth: 'lg' },
    underTitle
      ? { pt: { xs: 2, md: 3 }, pb: { ...SECTION_PADDING } }
      : { py: index === 0 ? { ...HERO_PADDING } : { ...SECTION_PADDING } },
    [content],
    'container',
  )
  const name = page.plan.sections[index]?.name?.trim() || `Section ${index + 1}`
  return tree.add(
    'section',
    {
      element: 'section',
      ariaLabel: sectionLabel(name, index, page.options.language),
      ...(scope.band === 'dark' ? { colorScheme: 'dark' } : {}),
    },
    underTitle ? null : bandSx(scope.band),
    [container],
    'section',
    page.options.sectionIds?.[index] ?? sectionIdOf(index),
  )
}

/** What a store's reviews are headed with where neither the design nor the plan says. */
export const AI_LAYOUT_REVIEWS_HEADING = AI_LAYOUT_LABELS_EN.reviewsHeading

/**
 * A store's own customer reviews (AGL-3676): the commerce plugin's Product
 * reviews in its store-wide scope, carrying the section's heading itself.
 * It lists approved reviews with their star ratings, and on a published page
 * with none — every store that just opened — it shows nothing, heading and
 * all, so the band takes no room until a shopper has written one. No review
 * is ever written here: the design's quotes, if it gave any, were left out.
 */
function reviewsSection(scope: SectionScope, blocks: readonly AiLayoutBlock[]): string {
  const { page, index, at } = scope
  const tree = page.tree
  const given = blocks.find((block) => speaksHeading(scope, block))
  const heading =
    aiLayoutWords(given?.text, 'heading', page.targets.facts, scope.page.options.language) ||
    aiLayoutFitText(page.plan.sections[index]?.name, 'heading', scope.page.options.language) ||
    aiLayoutLabel('reviewsHeading', page.options.language)
  page.settled.push({ at, what: "the store's own reviews placed: shown once shoppers leave them, never written for them" })
  const id = tree.add(
    AI_LAYOUT_LISTING_ELEMENTS.reviews,
    { scope: 'store', heading, maxItems: String(AI_LAYOUT_FEATURED_RECORDS.reviews) },
    // The padding is the element's, so a store with no reviews yet keeps no empty band.
    { py: { ...SECTION_PADDING } },
    null,
    'reviews',
  )
  // The reviews are what the section shows: its shoppers' to write.
  noted(scope, [id, id])
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, null, [id], 'container')
  return designedRoot(scope, [container], bandSx(scope.band), scope.band === 'dark')
}

/** What a store's sign-up is headed with where neither the design nor the plan says. */
export const AI_LAYOUT_SIGNUP_HEADING = AI_LAYOUT_LABELS_EN.signupHeading

/**
 * A store's newsletter sign-up (AGL-3676): the design's heading and words
 * beside the commerce plugin's Newsletter signup field, or over it on a
 * centered band. Any form or button the design drew for it is the field's.
 */
function signupSection(scope: SectionScope, blocks: readonly AiLayoutBlock[]): string {
  const { page, index, at } = scope
  const tree = page.tree
  const flow = blocks
    .filter((block) => WORD_KINDS.has(block.kind) && block.kind !== 'button')
    .map(({ col: _col, ...block }) => block)
  if (!flow.some((block) => speaksHeading(scope, block))) {
    flow.unshift({ kind: 'heading', text: page.plan.sections[index]?.name || aiLayoutLabel('signupHeading', page.options.language) })
  }
  page.settled.push({ at, what: "the store's newsletter sign-up placed" })
  const field = tree.add(AI_LAYOUT_LISTING_ELEMENTS.signup, { buttonLabel: aiLayoutLabel('subscribe', page.options.language) }, null, null, 'signup')
  noted(scope, [field, field])
  const words = compileFlow(scope, flow, scope.centered ? 'full' : 'half')
  const body = scope.centered
    ? tree.add(
        'muiStack',
        { spacing: '4', alignItems: 'center' },
        null,
        [words, tree.add('muiContainer', { maxWidth: 'sm', disableGutters: true }, null, [field], 'measure')],
        'content',
      )
    : designRow(
        scope,
        [...(words ? [{ id: words, size: 'xs:12 md:6' }] : []), { id: field, size: 'xs:12 md:6' }],
        '6',
      )
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { py: { ...SECTION_PADDING } }, [body], 'container')
  return designedRoot(scope, [container], bandSx(scope.band), scope.band === 'dark')
}

/** A store's Shop page's grid section on this page, by plan index; -1 where this page is not its Shop page. */
function shopGridAt(page: PageScope): number {
  const products = (page.targets.listings ?? []).find((listing) => listing.kind === 'products')
  return (
    products?.placements.find((placement) => placement.role === 'index' && placement.screenId === page.targets.pageId)?.section ??
    -1
  )
}

/** A store's Shop page, by its id, where this page is another page of the store; `null` otherwise. */
function shopPageOf(page: PageScope): string | null {
  const products = (page.targets.listings ?? []).find((listing) => listing.kind === 'products')
  const shop = products?.placements.find((placement) => placement.role === 'index')?.screenId
  return shop && shop !== page.targets.pageId && page.targets.pages.some((entry) => entry.id === shop) ? shop : null
}

/**
 * A Shop page's opening, as a storefront's collection page opens (AGL-3676):
 * the page's title and one line under it, on the page's own ground, with
 * little room around them — no photo and no buttons — so the grid that
 * follows starts above the fold. The beta.237 Willow Wick /shop opened on a
 * tall candle photo and its words, the products below the fold.
 */
function shopTitle(scope: SectionScope, blocks: readonly AiLayoutBlock[]): string {
  const { page, at } = scope
  const left = blocks.filter((block) => !['eyebrow', 'heading', 'lede', 'text'].includes(block.kind))
  if (left.length) {
    page.settled.push({ at, what: `${left.map((block) => block.kind).join(', ')} left out: a Shop page opens on its title and its grid` })
  }
  const heading = blocks.find((block) => speaksHeading(scope, block))
  const line = blocks.find((block) => block.kind === 'lede' || block.kind === 'text')
  const eyebrow = blocks.find((block) => block.kind === 'eyebrow')
  const flow: AiLayoutBlock[] = [
    ...(eyebrow ? [eyebrow] : []),
    { kind: 'heading', text: heading?.text ?? page.plan.title },
    ...(line ? [{ kind: 'lede' as const, text: line.text }] : []),
  ]
  scope.band = 'plain'
  scope.centered = false
  page.settled.push({ at, what: "drawn as the Shop page's title bar, the grid under it" })
  const words = compileFlow(scope, flow, 'half') as string
  const container = page.tree.add('muiContainer', { maxWidth: 'lg' }, { pt: { xs: 5, md: 7 }, pb: { xs: 1, md: 2 } }, [words], 'container')
  return designedRoot(scope, [container], null, false)
}

/**
 * A storefront's home hero sells (AGL-3676): it opens the shop. Where the
 * design gave it no button to the Shop page, "Shop all" leads its buttons,
 * and any other primary button steps back to secondary beside it.
 */
function sellingHero(scope: SectionScope, flow: AiLayoutBlock[]): void {
  const design = scope.page.design
  if (!design?.input.home || aiLayoutFamily(design.input.kind) !== 'retail') return
  const shop = shopPageOf(scope.page)
  if (!shop || flow.some((block) => block.kind === 'button' && block.to === `page:${shop}`)) return
  const firstButton = flow.findIndex((block) => block.kind === 'button')
  for (const [at, block] of flow.entries()) {
    if (block.kind === 'button' && (block.style ?? 'primary') === 'primary') flow[at] = { ...block, style: 'secondary' }
  }
  const text = aiLayoutLabel('shopAll', scope.page.options.language)
  const shopAll: AiLayoutBlock = { kind: 'button', text, to: `page:${shop}`, style: 'primary' }
  if (firstButton === -1) flow.push(shopAll)
  else flow.splice(firstButton, 0, shopAll)
  scope.page.settled.push({ at: scope.at, what: `the hero opens the shop: "${text}" leads its buttons` })
}

/** The button a storefront's hero opens its shop with. */
export const AI_LAYOUT_SHOP_ALL = AI_LAYOUT_LABELS_EN.shopAll

/**
 * A storefront's reasons to buy as open columns, each led by an icon over its
 * title and words (AGL-3676): the icon the design named for it, else one its
 * words suggest (shipping a truck, returns the arrows, small batch the hand),
 * else one neutral icon along the row; a row of places ("Areas we serve")
 * shows the place marker for every place (AGL-4065). One style key an
 * element, so a row repeats no multi-key inline style (rule 16).
 */
function iconColumns(scope: SectionScope, items: readonly AiLayoutItem[], room: Room): string {
  const { page } = scope
  const tree = page.tree
  const facts = page.targets.facts
  const iconWords = aiStorefrontItemIcons(items, (word) => !!aiIconOfWord(word), {
    section: scope.words ?? '',
    ...(page.design ? { kind: page.design.input.kind } : {}),
  })
  const perRow = across(items.length, room, 'cards')
  const textAlign = scope.centered ? { align: 'center' } : {}
  page.settled.push({ at: scope.at, what: `${items.length} items drawn as icon columns` })
  const ids = items.map((item, position) => {
    const icon = aiIconOfWord(iconWords[position]) ?? AI_ICON_LIBRARY.star
    return tree.add(
      'muiStack',
      { spacing: '1.5', ...(scope.centered ? { alignItems: 'center' } : {}) },
      null,
      [
        tree.add(AI_ICON_COMPONENT_ID, { iconId: icon.id, size: '32' }, accent(scope), null, 'icon'),
        item.title.trim()
          ? tree.add(
              'muiTypography',
              { children: aiLayoutWords(item.title, 'itemTitle', facts, scope.page.options.language), variant: itemTitleVariant(scope, 'h6'), component: itemElement(scope), ...textAlign },
              null,
              null,
              'title',
            )
          : null,
        item.text.trim()
          ? tree.add('muiTypography', { children: aiLayoutWords(item.text, 'itemText', facts, scope.page.options.language), variant: 'body2', ...textAlign }, muted(scope), null, 'text')
          : null,
      ],
      'iconItem',
    )
  })
  return layOut(scope, noted(scope, ids), perRow, '5', 'icons')
}

/**
 * The element that lists the records, bound to them: the Product grid over
 * the site's catalog, or Collection Entries over its blog with one post's
 * card as the template it repeats. Its records count as the section's items.
 */
function listingElement(
  scope: SectionScope,
  listing: AiLayoutListing,
  role: AiLayoutListingRole,
  filter?: AiLayoutListingFilter,
): string {
  const { page } = scope
  const tree = page.tree
  const featured = role === 'featured'
  const shown = featured ? AI_LAYOUT_FEATURED_RECORDS[listing.kind] : 12
  const element = AI_LAYOUT_LISTING_ELEMENTS[listing.kind]
  let id: string
  if (listing.kind === 'tracks') {
    // An empty player (AGL-3716): its "add your tracks" state, which the owner
    // fills from their own media library. No source, ever — the section's
    // heading and words are the model's, the recordings the owner's.
    id = tree.add(element, null, null, null, 'player')
    page.settled.push({ at: scope.at, what: 'an empty music player placed for the owner’s own tracks' })
    // The player is what the section shows: its tracks are the owner's to add.
    noted(scope, [id, id])
    return id
  }
  if (listing.kind === 'events') {
    // The site's published events (AGL-3755), each with its date, place and
    // cover: the section's heading is the model's, so the list adds none.
    id = tree.add(element, featured ? { maxItems: String(shown) } : null, null, null, 'events')
    page.settled.push({ at: scope.at, what: 'the site’s events listed by the Event List' })
    noted(scope, [id, id])
    return id
  }
  if (listing.kind === 'products') {
    id = tree.add(
      element,
      {
        source: 'all',
        sort: 'newest',
        columns: String(featured ? Math.min(AI_LAYOUT_FEATURED_RECORDS.products, Math.max(3, listing.records.length)) : 3),
        // The shop's own page browses: a sort and the store's categories as
        // filter chips (shown once it has any), never categories drawn as cards.
        ...(featured ? { maxItems: String(shown) } : { pageSize: String(shown), showSort: true, showCategories: true }),
        cardStyle: 'photo',
        // A storefront's cards sell from the grid (AGL-3676): Add to cart on a
        // product with one variant, Choose options on one with several.
        quickAdd: true,
        // A store that opens before its first products are in says so, with a
        // way to hear when they land (AGL-3676): never placeholder products.
        emptyTitle: aiLayoutLabel('storeEmptyTitle', page.options.language),
        emptyText: aiLayoutLabel(listing.emptyAction ? 'storeEmptyText' : 'storeEmptyTextAlone', page.options.language),
        ...(listing.emptyAction
          ? {
              emptyActionLabel:
                listing.emptyAction.label === AI_LAYOUT_LABELS_EN.getInTouch
                  ? aiLayoutLabel('getInTouch', page.options.language)
                  : listing.emptyAction.label,
              emptyActionHref: listing.emptyAction.href,
            }
          : {}),
      },
      null,
      null,
      'products',
    )
  } else if (listing.kind === 'records') {
    id = recordsElement(scope, listing, featured ? shown : null, filter)
  } else {
    id = postsElement(scope, listing, featured ? shown : COLLECTION_INDEX_POSTS)
  }
  // What a visitor sees here is the site's records, however many it keeps —
  // a section named for one group, that group's (AGL-3921): the section shows
  // its planned items when it has any to show.
  const listed = filter?.records.length ? filter.records.length : listing.records.length
  noted(scope, Array.from({ length: Math.max(2, Math.min(shown, listed)) }, () => id))
  return id
}

/** What a store's Product grid says while the store lists nothing yet (AGL-3676). */
export const AI_LAYOUT_STORE_EMPTY = {
  title: AI_LAYOUT_LABELS_EN.storeEmptyTitle,
  text: AI_LAYOUT_LABELS_EN.storeEmptyText,
  /** Said where the site has no page to get in touch on. */
  textAlone: AI_LAYOUT_LABELS_EN.storeEmptyTextAlone,
} as const

/** The most posts a page of the site lists where it is the writing's own page. */
const COLLECTION_INDEX_POSTS = 9

/** The blog's posts as the site's design lists them: a grid of covers, or a ruled list with the dates. */
function postsElement(scope: SectionScope, listing: AiLayoutListing, limit: number): string {
  const { page } = scope
  const tree = page.tree
  const ruled = page.design?.choices.writing === 'ruled'
  const titleElement = itemElement(scope)
  const cover = (sx: Record<string, unknown>) =>
    tree.add(
      'image',
      { src: '{{entry.coverImage}}', alt: '{{entry.title}}', href: '{{entry.url}}', objectFit: 'cover', width: '100%', loading: 'lazy' },
      sx,
      null,
      'postCover',
    )
  const meta = tree.add('muiTypography', { children: '{{entry.date}} · {{entry.author}}', variant: 'caption', component: 'p' }, muted(scope), null, 'postMeta')
  const title = tree.add('muiTypography', { children: '{{entry.title}}', variant: ruled ? 'h5' : 'h6', component: titleElement }, null, null, 'postTitle')
  const excerpt = tree.add('muiTypography', { children: '{{entry.excerpt}}', variant: 'body2' }, muted(scope), null, 'postExcerpt')
  const more = tree.add(
    'muiScreenLink',
    { children: aiLayoutLabel('readPost', page.options.language), href: '{{entry.url}}', renderAs: 'link', color: 'inherit' },
    { alignSelf: 'flex-start' },
    null,
    'postLink',
  )
  page.settled.push({ at: scope.at, what: `posts listed as ${ruled ? 'a ruled list' : 'a grid of covers'}` })
  const card = ruled
    ? tree.add(
        'muiBox',
        null,
        { borderTop: 1, pt: 3 },
        [
          tree.add(
            'muiStack',
            { direction: 'row', spacing: '3', alignItems: 'flex-start' },
            null,
            [
              tree.add('muiStack', { spacing: '1' }, { flex: '1 1 auto', minWidth: 0 }, [meta, title, excerpt, more], 'postWords'),
              tree.add('muiBox', null, { flex: '0 0 auto', width: { xs: '30%', md: '24%' } }, [cover({ aspectRatio: '4 / 3', borderRadius: 2 })], 'postThumb'),
            ],
            'postRow',
          ),
        ],
        'post',
      )
    : tree.add('muiStack', { spacing: '1.5' }, null, [cover({ aspectRatio: '3 / 2', borderRadius: 2 }), meta, title, excerpt, more], 'post')
  return tree.add(
    AI_LAYOUT_LISTING_ELEMENTS.posts,
    { collectionSlug: listing.collectionSlug, entriesLimit: String(limit), spacing: ruled ? '3' : '0' },
    ruled ? null : { display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 5 },
    [card],
    'posts',
  )
}

// ── A dataset's records (AGL-3616) ───────────────────────────────────────

/** The words of the link under each record's card to its own page (AGL-3727). */
export const AI_LAYOUT_RECORD_LINK_LABEL = AI_LAYOUT_LABELS_EN.viewDetails

/** A field whose name says it is a record's kicker: its category, role, time or place. */
const RECORD_KICKER = /\b(category|categories|type|kind|role|title|position|section|course|date|dates|time|times|when|day|days|location|place|where|venue|city|duration|level|tag|tags)\b/i
/** A field whose name says it is a record's words: its description, bio or answer. */
const RECORD_BODY = /\b(description|summary|details?|about|bio|biography|answer|text|notes?|body|blurb|overview|excerpt|ingredients|includes)\b/i
/** A dataset of questions and answers, listed as a ruled list rather than cards. */
const RECORD_QUESTIONS = /\b(faqs?|questions?|q ?& ?a)\b/i
/** A dataset of people, whose photos are portraits. */
const RECORD_PEOPLE = /\b(team|staff|people|crew|instructors?|teachers?|stylists?|therapists?|coaches?|trainers?|chefs?|doctors?|dentists?|artists?|founders?|members?)\b/i

/** The fields a record's card shows: its name, a kicker line and its words, each by id. */
export function aiLayoutRecordCardFields(
  fields: readonly { id: string; name: string; type: string }[],
): { title: string | null; kicker: string | null; body: string | null } {
  const texts = fields.filter((field) => (field.type === 'text' || field.type === 'sorted') && !aiLayoutIsRecordImageAlt(field.name))
  const title = texts.find((field) => field.type === 'text')?.id ?? null
  const rest = texts.filter((field) => field.id !== title)
  const body = rest.find((field) => field.type === 'text' && RECORD_BODY.test(field.name))?.id ?? null
  const kicker = rest.find((field) => field.id !== body && RECORD_KICKER.test(field.name))?.id ?? null
  // Failing a named one, the next text field is the record's words.
  const words = body ?? rest.find((field) => field.type === 'text' && field.id !== kicker)?.id ?? null
  return { title, kicker, body: words }
}

/**
 * A dataset's records, as the site's design lists them: a Box that repeats
 * its one card over the dataset — the platform's own repeat, which the page
 * renders once per record — or, for questions and answers, a ruled list.
 * The card binds the record's fields as `{{item.<field>}}`: its name as the
 * item's title, a kicker over it (its category, role or time), and its words.
 * A dataset whose records carry a photo (AGL-3616) leads each card with it,
 * an Image bound to the record's photo field — a portfolio's or a
 * photographer's opening in a lightbox, as one gallery captioned with each
 * record's name, as the design's own picture cards do (AGL-3717) — so a list
 * of pieces stays the image-led gallery it was before it was a dataset.
 * A featured band shows the first few; a page of its own, every record.
 */
function recordsElement(scope: SectionScope, listing: AiLayoutListing, limit: number | null, filter?: AiLayoutListingFilter): string {
  const { page } = scope
  const tree = page.tree
  const fields = aiLayoutRecordCardFields(listing.fields ?? [])
  const questions = RECORD_QUESTIONS.test(listing.name)
  const textAlign = scope.centered && !questions ? { align: 'center' } : {}
  const kicker = fields.kicker
    ? tree.add('muiTypography', { children: `{{item.${fields.kicker}}}`, variant: 'overline', component: 'p', ...textAlign }, accent(scope), null, 'recordKicker')
    : null
  const title = fields.title
    ? tree.add(
        'muiTypography',
        { children: `{{item.${fields.title}}}`, variant: questions ? 'h6' : 'h5', component: itemElement(scope), ...textAlign },
        null,
        null,
        'recordTitle',
      )
    : null
  const body = fields.body
    ? tree.add('muiTypography', { children: `{{item.${fields.body}}}`, variant: 'body2', ...textAlign }, muted(scope), null, 'recordBody')
    : null
  const photoField = !questions && listing.imageField ? listing.imageField : null
  const altField = photoField ? aiLayoutRecordImageAltField(listing.fields ?? []) : null
  const opens = Boolean(photoField) && aiOpensGalleriesInLightbox(page)
  // Each card opens its record's own page where the dataset has one (AGL-3727):
  // `/{base}/{{item.<address>}}`, filled per record as the card repeats.
  const recordHref = aiLayoutRecordHref(listing)
  const portrait = page.design?.input.kind === 'photography' || RECORD_PEOPLE.test(listing.name)
  const picture = photoField
    ? tree.add(
        'image',
        {
          src: `{{item.${photoField}}}`,
          // What the photo shows, where the dataset keeps it; a record's name is what it is called (AGL-3856).
          alt: altField
            ? `{{item.${altField}}}`
            : fields.title
              ? `{{item.${fields.title}}}`
              : aiLayoutFitText(listing.name, 'alt', scope.page.options.language) || 'A photo',
          objectFit: 'cover',
          width: '100%',
          loading: 'lazy',
          ...(opens ? { ...lightboxProps(scope), ...(fields.title ? { lightboxCaption: `{{item.${fields.title}}}` } : {}) } : {}),
          // A photo that does not open in a lightbox opens the record's page.
          ...(recordHref && !opens ? { href: recordHref } : {}),
        },
        { aspectRatio: portrait ? '4 / 5' : '4 / 3', borderRadius: 2 },
        null,
        'recordImage',
      )
    : null
  const more = recordHref
    ? tree.add(
        'muiScreenLink',
        { children: aiLayoutLabel('viewDetails', page.options.language), href: recordHref, renderAs: 'link', color: 'inherit' },
        { alignSelf: scope.centered && !questions ? 'center' : 'flex-start' },
        null,
        'recordLink',
      )
    : null
  page.settled.push({
    at: scope.at,
    what: `${listing.name} listed from its dataset${questions ? ' as a ruled list' : picture ? ' as picture cards' : ' as cards'}${
      recordHref ? `, each linking its page under /${listing.recordBase}` : ''
    }${filter ? `, only those filed “${filter.value}”` : ''}`,
  })
  const card = questions
    ? tree.add('muiStack', { spacing: '1' }, { borderTop: 1, pt: 3 }, [title, body, more], 'record')
    : tree.add(
        'muiStack',
        { spacing: picture ? '1.5' : '1', ...(scope.centered ? { alignItems: 'center' } : {}) },
        null,
        [picture, kicker, title, body, more],
        'record',
      )
  return tree.add(
    AI_LAYOUT_LISTING_ELEMENTS.records,
    {
      repeatDataset: listing.datasetId,
      ...(limit ? { repeatLimit: String(limit) } : {}),
      // A section named for one group lists that group's records (AGL-3921).
      ...(filter ? { repeatFilter: aiLayoutRepeatFilterOf(filter) } : {}),
    },
    questions
      ? { display: 'grid', gap: 3 }
      : { display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 5 },
    [card],
    'records',
  )
}

// ── A page brought in (AGL-4107) ──────────────────────────────────────────
//
// What a page brought in from its owner's own website draws that a designed
// page never does: the source's own pictures and icons, every item of every
// group with all its parts (its figure, its paragraphs, its bullet points,
// its own links), its tables, its tabs and its strips of logos. Every word is
// the source's, as written, and every element is the palette's with the
// theme's tokens, as the rest of the compiler draws: a card is the theme's
// Card, a question the Accordion, a link the Button. One style key on each
// repeated element, so a page of many items repeats no inline style (rule 16).

/** The source's picture, at its own shape, rounded as the theme rounds a frame. */
function sourcePicture(scope: SectionScope, picture: AiLayoutPicture, role = 'image'): string {
  const { page } = scope
  page.images += 1
  const destination = picture.to ? aiLayoutImportedDestination(picture.to, page.plan.sections.length) : null
  return page.tree.add(
    'image',
    {
      src: picture.src,
      ...(picture.alt ? { alt: picture.alt } : { decorative: true }),
      objectFit: 'cover',
      // A byline's portrait is drawn at a portrait's size, round.
      ...(picture.small ? { width: AI_LAYOUT_PORTRAIT_SIZE, height: AI_LAYOUT_PORTRAIT_SIZE } : {}),
      // The first picture of the page loads at once, the rest as they are reached.
      ...(page.images > 1 ? { loading: 'lazy' } : {}),
      ...(destination ? destinationProps(destination) : {}),
    },
    { borderRadius: picture.small ? '50%' : 2 },
    null,
    role,
  )
}

/** The size a byline's portrait is drawn at on a page brought in (AGL-4107): the Image element's own size field, as an author sets it. */
export const AI_LAYOUT_PORTRAIT_SIZE = '4rem'

/** An item's picture, over its words: the card's own top, at one shape across its group. */
function itemPicture(scope: SectionScope, picture: AiLayoutPicture): string {
  const { page } = scope
  page.images += 1
  return page.tree.add(
    'image',
    {
      src: picture.src,
      ...(picture.alt ? { alt: picture.alt } : { decorative: true }),
      objectFit: 'cover',
      ...(page.images > 1 ? { loading: 'lazy' } : {}),
    },
    { aspectRatio: '16 / 9' },
    null,
    'itemPicture',
  )
}

/** An icon of a page brought in: the source's own drawing, else the library icon its word names. */
function sourceIcon(scope: SectionScope, own: { iconPath?: string; icon?: string }, size: string, sx: Record<string, unknown> | null, role = 'icon'): string | null {
  const tree = scope.page.tree
  if (own.iconPath) return tree.add(AI_ICON_COMPONENT_ID, { iconPath: own.iconPath, size }, sx, null, role)
  const icon = aiIconOfWord(own.icon)
  return icon ? tree.add(AI_ICON_COMPONENT_ID, { iconId: icon.id, size }, sx, null, role) : null
}

/** Lines of words as paragraphs of one style, each its own element. */
function paragraphs(scope: SectionScope, lines: readonly (string | undefined)[], variant: string, sx: Record<string, unknown> | null, role = 'text'): string[] {
  const tree = scope.page.tree
  return lines
    .map((line) => aiLayoutAsWritten(line))
    .filter(Boolean)
    .map((line) => tree.add('muiTypography', { children: line, variant, ...align(scope) }, sx, null, role))
}

/**
 * Words of a page brought in that are a link longer than a button's label
 * holds (AGL-4107): the words in the brand color, inside a Link Container
 * that goes where the source's link went.
 */
function linkedWords(scope: SectionScope, text: string, destination: AiLayoutDestination): string {
  const tree = scope.page.tree
  const words = tree.add('muiTypography', { children: text, variant: 'body1', ...align(scope) }, accent(scope), null, 'linkWords')
  if (destination.kind === 'section') {
    linkTo(scope, words, destination)
    return words
  }
  return tree.add(
    'muiLinkBox',
    { ...destinationProps(destination), ariaLabel: text.slice(0, AI_TEXT_LIMITS.label), ...(destination.kind === 'href' ? { newTab: true } : {}) },
    null,
    [words],
    'longLink',
  )
}

/** An item's bullet points: each led by the source's mark where it drew one, else one under another. */
function bullets(scope: SectionScope, lines: readonly string[], iconPath: string | undefined): string | null {
  const tree = scope.page.tree
  const said = lines.map((line) => aiLayoutAsWritten(line)).filter(Boolean)
  if (!said.length) return null
  if (!iconPath) {
    const rows = said.map((line) => tree.add('muiTypography', { children: line, variant: 'body2' }, null, null, 'line'))
    return tree.add('muiStack', { spacing: '1' }, null, rows, 'bullets')
  }
  const rows = said.map((line) =>
    tree.add(
      'muiStack',
      { direction: 'row', spacing: '1', alignItems: 'flex-start' },
      null,
      [sourceIcon(scope, { iconPath }, '20', accent(scope), 'check'), tree.add('muiTypography', { children: line, variant: 'body2' }, null, null, 'line')],
      'row',
    ),
  )
  return tree.add('muiStack', { spacing: '1' }, null, rows, 'bullets')
}

/** An item's own calls to action, side by side, each as the source drew it. */
function itemLinks(scope: SectionScope, links: readonly AiLayoutLink[]): string | null {
  const tree = scope.page.tree
  const ids = links
    .map((link) => compileButton(scope, { kind: 'button', text: link.text, ...(link.to ? { to: link.to } : {}), style: link.style ?? 'quiet' }))
    .filter((id): id is string => !!id)
  if (!ids.length) return null
  if (ids.length === 1) return ids[0]
  return tree.add('muiStack', { direction: 'row', spacing: '2', useFlexGap: true, flexWrap: 'wrap' }, null, ids, 'actions')
}

/** How many items of a page brought in sit side by side: as the source lays them out, within the room. */
function importedAcross(block: AiLayoutBlock, count: number, room: Room): number {
  const source = block.columns && block.columns > 0 ? block.columns : count <= 3 ? count : 3
  const wide = Math.max(1, Math.min(4, source, count))
  if (room === 'narrow') return 1
  if (room === 'half') return Math.min(2, wide)
  return wide
}

/** Whether an item has anything to show. */
function itemShows(item: AiLayoutItem): boolean {
  return Boolean(
    item.title.trim() || item.text.trim() || item.figure?.trim() || item.more?.length || item.list?.length || item.links?.length || item.picture || item.iconPath,
  )
}

/**
 * A group of a page brought in: every item of it, each with all its parts,
 * laid out in the source's columns and drawn the way its design answer chose
 * (`variant`): the theme's cards, open columns under a rule, open columns led
 * by their icons, or pictures over their words.
 */
function importedGroup(scope: SectionScope, block: AiLayoutBlock, room: Room): string | null {
  const items = (block.items ?? []).filter(itemShows)
  if (!items.length) return null
  const perRow = importedAcross(block, items.length, room)
  const ids = items.map((item) => importedItem(scope, block, item))
  return layOut(scope, noted(scope, ids), perRow, block.kind === 'stats' ? '4' : '3', block.kind === 'cards' ? 'cards' : block.kind)
}

/** The style an item of a group is drawn in: the design answer's, else the source's own box or none. */
function itemStyle(block: AiLayoutBlock): AiLayoutGroupStyle | 'open' {
  if (block.variant) return block.variant
  if (block.kind === 'stats') return 'open'
  return block.style === 'quiet' ? 'open' : 'cards'
}

/** One item of a group of a page brought in, every part of it in the source's order. */
function importedItem(scope: SectionScope, block: AiLayoutBlock, item: AiLayoutItem): string {
  const tree = scope.page.tree
  const style = itemStyle(block)
  const kind = block.kind
  const parts: Array<string | null> = []
  const title = aiLayoutAsWritten(item.title)
  const figure = aiLayoutAsWritten(item.figure)
  const titleNode = () =>
    title ? tree.add('muiTypography', { children: title, variant: itemTitleVariant(scope, 'h5'), component: itemElement(scope), ...align(scope) }, null, null, 'title') : null
  if (kind === 'quotes') {
    parts.push(tree.add(AI_ICON_COMPONENT_ID, { iconId: AI_ICON_LIBRARY.quote.id, size: '32' }, { color: 'primary.main' }, null, 'quoteMark'))
    parts.push(...paragraphs(scope, [item.text, ...(item.more ?? [])], 'body1', null, 'quote'))
    if (title) parts.push(tree.add('muiTypography', { children: title, variant: 'subtitle2', component: 'p', ...align(scope) }, null, null, 'attribution'))
  } else if (kind === 'stats') {
    const lead = figure || title
    if (lead) parts.push(tree.add('muiTypography', { children: lead, variant: 'h2', component: 'p', ...align(scope) }, accent(scope), null, 'figure'))
    if (figure && title) parts.push(titleNode())
    parts.push(...paragraphs(scope, [item.text, ...(item.more ?? [])], 'body2', muted(scope), 'label'))
  } else {
    if (item.picture) parts.push(itemPicture(scope, item.picture))
    parts.push(sourceIcon(scope, item, '32', style === 'cards' ? { color: 'primary.main' } : accent(scope)))
    const number = figure ? tree.add('muiTypography', { children: figure, variant: kind === 'steps' ? 'h3' : 'h4', component: 'p', ...align(scope) }, accent(scope), null, kind === 'steps' ? 'number' : 'figure') : null
    // A step's number leads it; a plan's price follows its name.
    if (kind === 'steps') parts.push(number, titleNode())
    else parts.push(titleNode(), number)
    parts.push(...paragraphs(scope, [item.text, ...(item.more ?? [])], 'body1', muted(scope)))
    if (item.list?.length) parts.push(bullets(scope, item.list, item.listIconPath))
    if (item.links?.length) parts.push(itemLinks(scope, item.links))
  }
  const shown = parts.filter((id): id is string => !!id)
  // The picture of a card is its top, edge to edge; the rest sit in its padding.
  const picture = style === 'cards' || style === 'articles' ? (shown[0] && tree.nodes[shown[0]]?.componentId === 'image' ? shown.shift() : null) : null
  const stack = tree.add('muiStack', { spacing: '1.5', ...(scope.centered && (kind === 'stats' || style === 'icons') ? { alignItems: 'center' } : {}) }, null, shown, kind === 'steps' ? 'step' : kind === 'stats' ? 'stat' : 'cardStack')
  let drawn: string
  if (style === 'cards' || style === 'articles') {
    const content = tree.add('muiCardContent', null, { p: 3 }, [stack], 'cardContent')
    drawn = tree.add('muiCard', null, { height: '100%' }, picture ? [picture, content] : [content], kind === 'quotes' ? 'quoteCard' : 'card')
  } else if (style === 'ruled') {
    drawn = tree.add('muiBox', null, { borderTop: 1 }, [tree.add('muiBox', null, { pt: 2.5 }, [stack], 'ruledWords')], 'ruled')
  } else {
    drawn = stack
  }
  // An item the source made one link as a whole is one here (AGL-4107): its
  // words keep their places, and pressing anywhere on it goes where it went.
  const whole = !item.links?.length && item.to ? aiLayoutImportedDestination(item.to, scope.page.plan.sections.length) : null
  if (!whole || whole.kind === 'section') return drawn
  return tree.add(
    'muiLinkBox',
    { ...destinationProps(whole), ...(title ? { ariaLabel: title.slice(0, 200) } : {}), ...(whole.kind === 'href' ? { newTab: true } : {}) },
    { height: '100%' },
    [drawn],
    'linked',
  )
}

/** A list of a page brought in: each line as written, led by the source's mark where it drew one, a link where it was one. */
function importedList(scope: SectionScope, block: AiLayoutBlock, room: Room): string | null {
  const tree = scope.page.tree
  const items = (block.items ?? []).filter((item) => aiLayoutAsWritten(item.title || item.text))
  if (!items.length) return null
  const rows = items.map((item) => {
    const line = aiLayoutAsWritten([item.title, item.text].filter((part) => part.trim()).join(' '))
    const destination = item.to ? aiLayoutImportedDestination(item.to, scope.page.plan.sections.length) : null
    const words = !destination
      ? tree.add('muiTypography', { children: line, variant: 'body1' }, null, null, 'line')
      : line.length > AI_TEXT_LIMITS.button
        ? linkedWords(scope, line, destination)
        : tree.add('muiScreenLink', { children: line, renderAs: 'link', color: 'inherit', ...destinationProps(destination) }, null, null, 'link')
    if (destination && line.length <= AI_TEXT_LIMITS.button) linkTo(scope, words, destination)
    const mark = item.iconPath || item.icon ? sourceIcon(scope, item, '22', accent(scope), 'check') : null
    return mark ? tree.add('muiStack', { direction: 'row', spacing: '1.5', alignItems: 'flex-start' }, null, [mark, words], 'row') : words
  })
  noted(scope, rows)
  const perRow = importedAcross({ ...block, columns: block.columns ?? 1 }, rows.length, room)
  if (perRow > 1) return layOut(scope, rows, perRow, '2', 'list')
  return tree.add('muiStack', { spacing: '1.5' }, null, rows, 'list')
}

/** Questions and answers of a page brought in: an accordion each, the first open, every answer's paragraphs in it. */
function importedFaq(scope: SectionScope, block: AiLayoutBlock): string | null {
  const tree = scope.page.tree
  const items = (block.items ?? []).filter((item) => aiLayoutAsWritten(item.title))
  if (!items.length) return null
  const panels = items.map((item, position) => {
    const answer = paragraphs(scope, [item.text, ...(item.more ?? [])], 'body1', { color: 'text.secondary' }, 'answer')
    if (item.list?.length) answer.push(bullets(scope, item.list, item.listIconPath) as string)
    if (item.links?.length) {
      const links = itemLinks(scope, item.links)
      if (links) answer.push(links)
    }
    const shown = answer.filter(Boolean)
    return tree.add(
      'muiAccordion',
      { disableGutters: true, ...(position === 0 ? { defaultExpanded: true } : {}) },
      null,
      [
        tree.add('muiAccordionSummary', { children: aiLayoutAsWritten(item.title) }, null, null, 'question'),
        shown.length
          ? tree.add('muiAccordionDetails', null, null, [shown.length === 1 ? shown[0] : tree.add('muiStack', { spacing: '1.5' }, null, shown, 'answerStack')], 'details')
          : null,
      ],
      'panel',
    )
  })
  noted(scope, panels)
  return tree.add('muiStack', { spacing: '1.5' }, null, panels, 'faq')
}

/** A table's cell as the Table element's grid holds it: one line, its pipes escaped. */
function tableCell(text: string): string {
  return aiLayoutAsWritten(text).replace(/\|/g, '\\|')
}

/** A table of a page brought in: the theme's Table element, every cell's words as written. */
function table(scope: SectionScope, block: AiLayoutBlock): string | null {
  const rows = (block.rows ?? []).filter((row) => row.cells.some((cell) => aiLayoutAsWritten(cell)))
  if (!rows.length) return null
  const width = Math.max(...rows.map((row) => row.cells.length))
  const grid = rows.map((row) => `| ${Array.from({ length: width }, (_, at) => tableCell(row.cells[at] ?? '')).join(' | ')} |`).join('\n')
  return scope.page.tree.add('dataTable', { rows: grid, headerRow: block.header === true }, null, null, 'table')
}

/** A label the Tabs element can name a panel by: its words on one line, with no comma it would split at. */
function tabLabel(label: string): string | null {
  const text = aiLayoutAsWritten(label)
  return text && !text.includes(',') && text.length <= AI_TEXT_LIMITS.label ? text : null
}

/**
 * Tabs of a page brought in: the Tabs element with a panel for each tab,
 * opening on the one the source shows open, where every tab has its panel.
 * A source whose script draws its other panels only when clicked gives a
 * page the open one alone (aglyn.com's plan tabs): then its labels are drawn
 * as the strip they are — the open one filled, the rest outlined — over the
 * panel the source showed, so every label and every word is on the page and
 * no tab opens onto nothing.
 */
function tabs(scope: SectionScope, block: AiLayoutBlock, room: Room): string | null {
  const tree = scope.page.tree
  const given = (block.tabs ?? []).filter((tab) => aiLayoutAsWritten(tab.label) || tab.blocks.length)
  if (!given.length) return null
  const labels = given.map((tab) => tabLabel(tab.label))
  const panels = given.map((tab) => (tab.blocks.length ? compileFlow(scope, tab.blocks, room) : null))
  const whole =
    given.length >= 2 &&
    given.length <= 8 &&
    labels.every((label): label is string => !!label) &&
    new Set(labels.map((label) => label.toLowerCase())).size === labels.length &&
    panels.every(Boolean)
  if (whole) {
    const open = given.findIndex((tab) => tab.selected)
    return tree.add(
      'muiTabs',
      { labels: (labels as string[]).join('\n'), variant: 'scrollable', ...(open > 0 ? { opensOn: labels[open] } : {}) },
      null,
      given.map((_, at) => tree.add('muiTabPanel', { label: labels[at] }, null, [panels[at] as string], 'tabPanel')),
      'tabs',
    )
  }
  const strip = given
    .map((tab) => ({ text: aiLayoutAsWritten(tab.label), selected: tab.selected === true }))
    .filter((tab) => tab.text)
    .map((tab) =>
      tab.selected
        ? tree.add(
            'muiPaper',
            { variant: 'elevation', elevation: '0' },
            { bgcolor: 'primary.main' },
            [tree.add('muiBox', null, { py: 0.75, color: 'primary.contrastText' }, [tree.add('muiTypography', { children: tab.text, variant: 'body2' }, { px: 2 }, null, 'tabLabel')], 'tabWords')],
            'tab',
          )
        : chip(scope, tab.text, 'tab'),
    )
  const parts = [
    strip.length ? tree.add('muiStack', { direction: 'row', spacing: '1', useFlexGap: true, flexWrap: 'wrap', ...(scope.centered ? { justifyContent: 'center' } : {}) }, null, strip, 'tabStrip') : null,
    ...panels,
  ].filter((id): id is string => !!id)
  if (!parts.length) return null
  return parts.length === 1 ? parts[0] : tree.add('muiStack', { spacing: '4' }, null, parts, 'tabs')
}

/** A short line on an outlined surface of the theme's own shape: a label, a tag, a tab the source draws as one. */
function chip(scope: SectionScope, words: string, role: string): string {
  const tree = scope.page.tree
  return tree.add('muiPaper', { variant: 'outlined' }, { py: 0.75 }, [tree.add('muiTypography', { children: words, variant: 'body2' }, { px: 2 }, null, `${role}Label`)], role)
}

/** A strip of logos of a page brought in: each picture at one height, or each short line as a label on an outlined surface. */
function logos(scope: SectionScope, block: AiLayoutBlock): string | null {
  const tree = scope.page.tree
  const ids = (block.items ?? []).flatMap((item): string[] => {
    if (item.picture) {
      scope.page.images += 1
      return [
        tree.add(
          'image',
          { src: item.picture.src, ...(item.picture.alt ? { alt: item.picture.alt } : { decorative: true }), objectFit: 'contain', width: 'auto', ...(scope.page.images > 1 ? { loading: 'lazy' } : {}) },
          { height: { xs: 32, md: 40 } },
          null,
          'logo',
        ),
      ]
    }
    const words = aiLayoutAsWritten([item.title, item.text].filter((part) => part.trim()).join(' '))
    return words ? [chip(scope, words, 'chip')] : []
  })
  if (!ids.length) return null
  return tree.add(
    'muiStack',
    { direction: 'row', spacing: block.items?.some((item) => item.picture) ? '5' : '1.5', useFlexGap: true, flexWrap: 'wrap', alignItems: 'center', ...(scope.centered ? { justifyContent: 'center' } : {}) },
    null,
    noted(scope, ids),
    'logos',
  )
}

/**
 * The opening of a page brought in, as the hero its design answer chose
 * around the source's own picture (AGL-4107): its words and one picture of
 * the source's, nothing else. Any other opening is drawn as its source lays
 * it out, its picture where the source placed it.
 */
function importedHero(scope: SectionScope, raw: AiLayoutSection, blocks: readonly AiLayoutBlock[]): string | null {
  const { page } = scope
  if (!page.design || !raw.hero) return null
  const pictures = blocks.filter((block) => block.kind === 'image' && block.picture)
  if (pictures.length !== 1) return null
  const flow = blocks.filter((block) => block.kind !== 'image')
  if (!flow.length || !flow.every((block) => WORD_KINDS.has(block.kind))) return null
  if (!flow.some((block) => speaksHeading(scope, block))) {
    flow.unshift({ kind: 'heading', text: page.plan.title })
    page.settled.push({ at: scope.at, what: "no heading; the page's title written as its h1" })
  }
  const lead = flow.findIndex((block) => speaksHeading(scope, block))
  const { style: _style, ...title } = flow[lead]
  flow[lead] = AI_LAYOUT_HALF_HEROES.has(raw.hero) ? title : { ...title, style: 'large' }
  const picture = pictures[0].picture as AiLayoutPicture
  return hero(scope, flow, { alt: picture.alt, given: true, src: picture.src }, raw.hero)
}

/** The id the compiled page's root is stored under. */
export const AI_LAYOUT_PAGE_ROOT_ID = CANVAS_ROOT_ELEMENT_ID
