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
  type AiLayoutItem,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from './ai-layout-language'
import {
  aiLayoutDesignChoices,
  aiLayoutGroupVariant,
  type AiLayoutDesign,
  type AiLayoutDesignChoices,
  type AiLayoutGroupVariant,
} from './ai-layout-design'
import {
  AI_LAYOUT_FEATURED_RECORDS,
  AI_LAYOUT_LISTING_ELEMENTS,
  aiLayoutListingAt,
  type AiLayoutListing,
  type AiLayoutListingRole,
} from './ai-layout-listings'
import {
  aiLayoutRenamedLabel,
  aiLayoutResolveLink,
  type AiLayoutDestination,
  type AiLayoutLinkScope,
  type AiLayoutTargets,
} from './ai-layout-links'
import {
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
}

/**
 * What a section is called to a screen reader: its plan name, with any note
 * the plan left in brackets taken out. A live blog plan (2026-10-09) named a
 * section "reader notes and kind words [to be added by owner]"; carried into
 * the label it read as a gap, and the page's gap pass took the section out.
 */
function sectionLabel(name: string, index: number): string {
  return aiLayoutFitText(name.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim(), 'note') || `Section ${index + 1}`
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
  const designed = sections.findIndex((section) =>
    section.blocks.some(
      (block) => block.kind === 'form' && (!block.to || forms.has(block.to)),
    ),
  )
  return designed === -1 ? null : designed
}

/** Compiles a page designed in the layout language into the tree it stores. */
export function aiCompileLayoutPage(
  sections: readonly AiLayoutSection[],
  plan: AiLayoutPagePlan,
  targets: AiLayoutTargets,
  options: AiLayoutCompileOptions,
): AiLayoutCompiledPage {
  const tree = new AiLayoutTreeBuilder()
  const page: PageScope = {
    tree,
    plan,
    targets,
    options,
    settled: [],
    scrollTo: {},
    images: 0,
    strong: { brand: 0, dark: 0 },
    formSection: formSectionOf(sections, plan, targets),
    pageIcon: pageIconOf(sections),
    formsPlaced: new Set(),
    itemIds: plan.sections.map(() => []),
    design: options.design ? { input: options.design, choices: aiLayoutDesignChoices(options.design) } : null,
    pictures: 0,
    features: 0,
    splitAt: -2,
    quotesOnly: [],
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

function compileSection(
  page: PageScope,
  raw: AiLayoutSection,
  index: number,
): string {
  const at = `sections[${index}]`
  const band = settleBand(page, raw.band ?? 'plain', at)
  const scope: SectionScope = {
    page,
    index,
    at,
    band,
    centered: raw.align === 'center',
    level: index === 0 ? 1 : 2,
    headed: false,
    itemsLeft: AI_LAYOUT_MAX_ITEMS,
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
  // A quote is a gap the owner fills, and a published page shows no gap (AGL-3660).
  const blocks = placePlanned(scope, raw).filter((block) => {
    if (block.kind !== 'quotes') return true
    page.settled.push({ at, what: 'a quotes group left out: a published page shows no customer words the brief did not give' })
    return false
  })
  // A section whose only items were those quotes has none left to show, and is
  // not asked for them again: no answer can give words the brief did not (AGL-3676).
  if (raw.blocks.some((block) => block.kind === 'quotes') && !blocks.some((block) => AI_LAYOUT_GROUP_KINDS.has(block.kind) || block.kind === 'component')) {
    page.quotesOnly.push(index)
  }
  // A section the site's records fill — its catalog, its blog — shows them
  // through the element that keeps them, around the words the design gave it (AGL-3676).
  const listed = aiLayoutListingAt(page.targets.listings ?? [], page.targets.pageId, index)
  if (listed) return listingSection(scope, blocks, listed)
  // The site's design draws the sections it has an arrangement for (AGL-3660).
  if (page.design) {
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
  if (filled.length >= 3 && sameShape(filled.map((entry) => entry.column))) {
    head.push(columnsAsCards(filled.map((entry) => entry.column)))
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
    !!aiLayoutWords(block.text, 'heading', page.targets.facts)
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
      ariaLabel: sectionLabel(name, index),
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
  if (page.strong[band] >= AI_LAYOUT_MAX_STRONG_BANDS) {
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

/** Whether a block spans more than a reading column: a row of several items. */
function isWideGroup(block: AiLayoutBlock): boolean {
  return (
    (block.kind === 'cards' ||
      block.kind === 'steps' ||
      block.kind === 'stats' ||
      block.kind === 'quotes') &&
    (block.items?.length ?? 0) >= 2
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

function sameShape(columns: readonly AiLayoutBlock[][]): boolean {
  const first = shapeOf(columns[0])
  return (
    columns.every((column) => shapeOf(column) === first) &&
    columns[0].some((block) => block.kind === 'heading') &&
    columns[0].every((block) =>
      ['heading', 'text', 'lede', 'eyebrow', 'image', 'note'].includes(
        block.kind,
      ),
    )
  )
}

/** Like columns as one group of cards: each column's heading its title, its words its text. */
function columnsAsCards(columns: readonly AiLayoutBlock[][]): AiLayoutBlock {
  return {
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
}

// ── A row of columns ──────────────────────────────────────────────────────

/** Spans out of twelve for relative widths: each at least three, summing to twelve. */
export function aiLayoutSpans(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const spans = weights.map((weight) =>
    Math.max(3, Math.round((weight / total) * 12)),
  )
  let over = spans.reduce((sum, span) => sum + span, 0) - 12
  while (over !== 0) {
    // Take from (or give to) the widest column that can spare it.
    const order = spans
      .map((span, position) => ({ span, position }))
      .sort((a, b) => (over > 0 ? b.span - a.span : a.span - b.span))
    const pick = order.find((entry) => (over > 0 ? entry.span > 3 : true))
    if (!pick) break
    spans[pick.position] += over > 0 ? -1 : 1
    over += over > 0 ? -1 : 1
  }
  return spans
}

export function compileRow(
  scope: SectionScope,
  columns: Array<{ column: AiLayoutBlock[]; weight: number }>,
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
    { alignItems: 'center' },
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
      return list(scope, block)
    case 'faq':
      return faq(scope, block)
    case 'cards':
    case 'steps':
    case 'stats':
    case 'quotes':
      return group(scope, block, room)
    default:
      return null
  }
}

/** Secondary words' color: muted text, or the band's own on a brand band. */
function muted(scope: SectionScope): Record<string, unknown> | null {
  return scope.band === 'brand' || scope.overPhoto ? null : { color: 'text.secondary' }
}

/** An accent's color: the brand's, or the band's own on a brand band. */
function accent(scope: SectionScope): Record<string, unknown> | null {
  return scope.band === 'brand' || scope.overPhoto ? null : { color: 'primary.main' }
}

function align(scope: SectionScope): Record<string, unknown> {
  return scope.centered ? { align: 'center' } : {}
}

function words(
  scope: SectionScope,
  block: AiLayoutBlock,
  place: AiLayoutTextPlace,
  variant: string,
  props: Record<string, unknown>,
  sx: Record<string, unknown> | null,
): string | null {
  const text = aiLayoutWords(block.text, place, scope.page.targets.facts)
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
  const text = aiLayoutWords(block.text, place, scope.page.targets.facts)
  if (!text) return null
  scope.headed = scope.headed || own
  const variant =
    level === 1
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
  const asked = aiLayoutFitText(block.text, 'label')
  if (!asked) return null
  const destination = aiLayoutResolveLink(
    block.to,
    asked,
    scope.link,
    scope.page.targets,
  )
  if (!destination) {
    scope.page.settled.push({
      at: scope.at,
      what: `the button "${asked}" has nowhere to go; left out`,
    })
    return null
  }
  // A button to a page merged into the blog names the blog (AGL-3676).
  const label = aiLayoutRenamedLabel(asked, destination)
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
    aiLayoutFitText(scope.heading, 'alt') ||
    aiLayoutFitText(scope.page.plan.sections[scope.index]?.name, 'alt') ||
    `Gallery ${scope.index + 1}`
  const words = aiLayoutFitText(caption, 'alt')
  return { lightbox: true, lightboxGallery: name, ...(words ? { lightboxCaption: words } : {}) }
}

function image(
  scope: SectionScope,
  block: AiLayoutBlock,
  room: Room,
): string | null {
  const { page } = scope
  const alt = aiLayoutFitText(block.text, 'alt')
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
      values[name] = aiLayoutWords(item.text, 'text', scope.page.targets.facts)
  }
  // An instance fills at least one prop (rule 1): the block's words, else the
  // name its section has in the plan, rather than the component's placeholder.
  if (!Object.values(values).some(Boolean)) {
    const first = textProps(declared.props)[0]
    const words =
      aiLayoutWords(block.text, 'text', scope.page.targets.facts) ||
      aiLayoutWords(
        scope.page.plan.sections[scope.index]?.name,
        'itemTitle',
        scope.page.targets.facts,
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
    values[titleProp] = aiLayoutWords(item.title, 'itemTitle', facts)
  if (textProp && item.text.trim())
    values[textProp] = aiLayoutWords(item.text, 'itemText', facts)
  const first = titleProp ?? textProp
  if (!Object.values(values).some(Boolean) && first)
    values[first] = aiLayoutWords(item.title || item.text, 'itemTitle', facts)
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
    aiLayoutWords(item.title, 'itemTitle', facts) ||
    aiLayoutWords(item.text, 'itemText', facts)
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
        aiLayoutWords(item.title, 'itemTitle', facts) &&
        !references.has(item.title.trim().toLowerCase()) &&
        !AI_LAYOUT_PLACEHOLDER_TITLE.test(item.title.trim())
          ? item.title
          : '',
      text: aiLayoutWords(item.text, 'itemText', facts) ? item.text : '',
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
  const items = takeItems(scope, cleanItems(scope, block.items ?? []))
  if (!items.length) return null
  const perRow = across(items.length, room, block.kind)
  const placed = componentOf(scope.page.targets, block.to)
  if (placed) return instances(scope, placed, items, perRow)
  const design = scope.page.design
  if (rule1(scope)) {
    // Picture cards the design draws are the compiler's, not a block typed out
    // by hand (`repeatsCompiled`, AGL-3660); every other repeat stays compact.
    const variant = design && block.kind === 'cards' && block.style !== 'quiet' ? aiLayoutGroupVariant(design.input, design.choices, scope.words ?? '') : null
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
    const values = instanceValues(placed.props, item, scope.page.targets.facts)
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
        ? aiLayoutQuoteGap(item.text || item.title)
        : block.kind === 'stats'
          ? aiLayoutWords(item.title, 'stat', facts)
          : `${block.kind === 'steps' ? `${position + 1}. ` : ''}${aiLayoutWords(item.title, 'itemTitle', facts)}`
    const text =
      block.kind === 'quotes'
        ? '[Customer name]'
        : aiLayoutWords(
            item.text,
            block.kind === 'stats' ? 'statLabel' : 'itemText',
            facts,
          )
    return tree.add(
      'muiListItemText',
      { primary: title, ...(text ? { secondary: text } : {}) },
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
  const children = [
    icon
      ? tree.add(
          AI_ICON_COMPONENT_ID,
          { iconId: icon.id, size: '32' },
          { color: 'primary.main' },
          null,
          'icon',
        )
      : null,
    item.title.trim()
      ? tree.add(
          'muiTypography',
          {
            children: aiLayoutWords(item.title, 'itemTitle', facts),
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
            children: aiLayoutWords(item.text, 'itemText', facts),
            variant: 'body1',
          },
          { color: 'text.secondary' },
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
  if (block.style === 'quiet') return stack
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
              children: aiLayoutWords(item.title, 'itemTitle', facts),
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
              children: aiLayoutWords(item.text, 'itemText', facts),
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
          children: aiLayoutWords(item.title, 'stat', facts) || '[figure]',
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
              children: aiLayoutWords(item.text, 'statLabel', facts),
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
  const words = aiLayoutQuoteGap(item.text || item.title)
  const who =
    item.text && item.title ? aiLayoutFitText(item.title, 'statLabel') : ''
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
function list(scope: SectionScope, block: AiLayoutBlock): string | null {
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  // A list whose lines go somewhere is a list of links: each line that
  // resolves is a Page Link, and one that does not is left out (rule 10).
  if ((block.items ?? []).some((item) => item.to)) {
    const links = (block.items ?? []).flatMap((item) => {
      const label = aiLayoutFitText(item.title || item.text, 'label')
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
  const tree = scope.page.tree
  const facts = scope.page.targets.facts
  const items = takeItems(
    scope,
    cleanItems(scope, block.items ?? []).filter(
      (item) => !!aiLayoutWords(item.title, 'question', facts),
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
              primary: aiLayoutWords(item.title, 'question', facts),
              ...(item.text.trim()
                ? { secondary: aiLayoutWords(item.text, 'answer', facts) }
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
          { children: aiLayoutWords(item.title, 'question', facts) },
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
                    children: aiLayoutWords(item.text, 'answer', facts),
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
  return block.kind === 'heading' && !!aiLayoutWords(block.text, 'heading', scope.page.targets.facts)
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
      ariaLabel: sectionLabel(name, index),
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

/**
 * A picture the design places: the model's own where it described one, else
 * a stand-in — marked decorative, since no one described it, with the
 * section's words as what a stock search looks for. Either is filled by
 * `ai-layout-pictures.ts` after the page is checked, as any slot is.
 */
function designPicture(
  scope: SectionScope,
  picture: { alt: string; given: boolean },
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
  picture: { alt: string; given: boolean },
  props: Record<string, unknown>,
  sx: Record<string, unknown> | null,
): string {
  const { page } = scope
  if (picture.given) page.images += 1
  else page.pictures += 1
  return page.tree.add(
    'image',
    { alt: picture.alt, objectFit: 'cover', ...(picture.given ? {} : { decorative: true }), ...props },
    sx,
    null,
    'image',
  )
}

/** What a stand-in picture is of, for a stock search: the section's subject, else the site's. */
function standInAlt(scope: SectionScope, words?: string): string {
  return (
    aiLayoutFitText(words, 'alt') ||
    aiLayoutFitText(scope.heading, 'alt') ||
    aiLayoutFitText(scope.page.plan.sections[scope.index]?.name, 'alt') ||
    aiLayoutFitText(scope.page.plan.title, 'alt') ||
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
    flow[lead] = design.choices.hero === 'split' ? title : { ...title, style: 'large' }
    const given = images[0] ? aiLayoutFitText(images[0].text, 'alt') : ''
    return hero(
      scope,
      raw,
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
    (group.kind === 'cards' && variant !== 'cards' && variant !== 'ruled')
  ) {
    return null
  }
  return splitSection(scope, head, group, tail)
}

/** The first section, in the site's hero arrangement. */
function hero(
  scope: SectionScope,
  raw: AiLayoutSection,
  flow: readonly AiLayoutBlock[],
  picture: { alt: string; given: boolean },
): string {
  const { page } = scope
  const tree = page.tree
  const design = page.design as NonNullable<PageScope['design']>
  const home = design.input.home
  const variant = design.choices.hero
  page.settled.push({ at: scope.at, what: `drawn as a ${variant} hero` })
  if (variant === 'cover') {
    scope.band = 'dark'
    scope.centered = raw.align === 'center'
    return cover(scope, flow, picture, home ? { xs: '78vh', md: '86vh' } : { xs: '46vh', md: '54vh' })
  }
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
  picture: { alt: string; given: boolean },
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
              ? tree.add('muiTypography', { children: aiLayoutWords(item.title, 'itemTitle', facts), variant: 'h5', component: itemElement(scope) }, null, null, 'title')
              : null,
            item.text.trim()
              ? tree.add('muiTypography', { children: aiLayoutWords(item.text, 'itemText', facts), variant: 'body1' }, muted(scope), null, 'text')
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
      ? tree.add('muiTypography', { children: aiLayoutWords(item.title, 'itemTitle', facts), variant: type, component: itemElement(scope) }, null, null, 'title')
      : null
  const words = (item: AiLayoutItem, type = 'body1') =>
    item.text.trim()
      ? tree.add('muiTypography', { children: aiLayoutWords(item.text, 'itemText', facts), variant: type }, muted(scope), null, 'text')
      : null
  if (variant === 'cards') return null
  const pictured = variant === 'pictures' || variant === 'articles'
  if (variant === 'ruled' || (pictured && (room !== 'full' || picturesLeft(page) < items.length))) {
    const perRow = across(items.length, room, 'cards')
    if (perRow <= 1) {
      // Stacked, the rules run between the items.
      const ids = items.map((item) => tree.add('muiStack', { spacing: '1' }, null, [title(item), words(item)], 'ruled'))
      return ruledList(scope, noted(scope, ids), 'ruledItems')
    }
    // Side by side, each column opens under a rule in the text's own color.
    const ids = items.map((item) =>
      tree.add('muiBox', null, { borderTop: 1 }, [tree.add('muiStack', { spacing: '1' }, { pt: 2.5 }, [title(item), words(item)], 'ruledWords')], 'ruled'),
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
    const photo = designImage(
      scope,
      { alt: standInAlt(scope, item.title || item.text), given: false },
      { width: '100%', ...(opens ? lightboxProps(scope, item.title) : {}) },
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
  if (listing.kind === 'posts') return listing.href ? { kind: 'button', text: 'All posts', to: listing.href, style: 'secondary' } : null
  const index = listing.placements.find((placement) => placement.role === 'index' && placement.screenId !== page.targets.pageId)
  return index ? { kind: 'button', text: 'Shop all', to: `page:${index.screenId}`, style: 'secondary' } : null
}

function listingSection(
  scope: SectionScope,
  blocks: readonly AiLayoutBlock[],
  placed: { listing: AiLayoutListing; role: AiLayoutListingRole },
): string {
  const { page, index, at } = scope
  const { listing, role } = placed
  const left = blocks.filter((block) => LISTING_REPLACES.has(block.kind))
  if (left.length) {
    page.settled.push({
      at,
      what: `${left.map((block) => block.kind).join(', ')} left out: the section lists the site's own ${listing.kind}`,
    })
  }
  const kept = blocks.filter((block) => !LISTING_REPLACES.has(block.kind)).map(({ col: _col, ...block }) => block)
  const words = kept.filter((block) => block.kind !== 'button' && block.kind !== 'form')
  let actions = kept.filter((block) => block.kind === 'button')
  if (!actions.length && role === 'featured') {
    const all = listingAllButton(page, listing)
    if (all) actions = [all]
  }
  if (!words.some((block) => speaksHeading(scope, block))) {
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
  const records = listingElement(scope, listing, role)
  const parts = [
    top ? (centered ? tree.add('muiContainer', { maxWidth: 'md', disableGutters: true }, null, [top], 'measure') : top) : null,
    records,
    centered || !head ? link : null,
  ].filter((id): id is string => !!id)
  const content = tree.add('muiStack', { spacing: '6', useFlexGap: true, ...(centered ? { alignItems: 'center' } : {}) }, null, parts, 'content')
  const container = tree.add(
    'muiContainer',
    { maxWidth: 'lg' },
    { py: index === 0 ? { ...HERO_PADDING } : { ...SECTION_PADDING } },
    [content],
    'container',
  )
  const name = page.plan.sections[index]?.name?.trim() || `Section ${index + 1}`
  return tree.add(
    'section',
    {
      element: 'section',
      ariaLabel: sectionLabel(name, index),
      ...(scope.band === 'dark' ? { colorScheme: 'dark' } : {}),
    },
    bandSx(scope.band),
    [container],
    'section',
    page.options.sectionIds?.[index] ?? sectionIdOf(index),
  )
}

/**
 * The element that lists the records, bound to them: the Product grid over
 * the site's catalog, or Collection Entries over its blog with one post's
 * card as the template it repeats. Its records count as the section's items.
 */
function listingElement(scope: SectionScope, listing: AiLayoutListing, role: AiLayoutListingRole): string {
  const { page } = scope
  const tree = page.tree
  const featured = role === 'featured'
  const shown = featured ? AI_LAYOUT_FEATURED_RECORDS[listing.kind] : 12
  const element = AI_LAYOUT_LISTING_ELEMENTS[listing.kind]
  let id: string
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
        // A store that opens before its first products are in says so, with a
        // way to hear when they land (AGL-3676): never placeholder products.
        emptyTitle: AI_LAYOUT_STORE_EMPTY.title,
        emptyText: listing.emptyAction ? AI_LAYOUT_STORE_EMPTY.text : AI_LAYOUT_STORE_EMPTY.textAlone,
        ...(listing.emptyAction ? { emptyActionLabel: listing.emptyAction.label, emptyActionHref: listing.emptyAction.href } : {}),
      },
      null,
      null,
      'products',
    )
  } else {
    id = postsElement(scope, listing, featured ? shown : COLLECTION_INDEX_POSTS)
  }
  // What a visitor sees here is the site's records, however many it keeps:
  // the section shows its planned items when it has any to show.
  noted(scope, Array.from({ length: Math.max(2, Math.min(shown, listing.records.length)) }, () => id))
  return id
}

/** What a store's Product grid says while the store lists nothing yet (AGL-3676). */
export const AI_LAYOUT_STORE_EMPTY = {
  title: 'New pieces are on the way',
  text: 'Our first pieces are being finished now. Get in touch and we will let you know the moment they land.',
  /** Said where the site has no page to get in touch on. */
  textAlone: 'Our first pieces are being finished now. Check back soon.',
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
    { children: 'Read the post', href: '{{entry.url}}', renderAs: 'link', color: 'inherit' },
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

/** The id the compiled page's root is stored under. */
export const AI_LAYOUT_PAGE_ROOT_ID = CANVAS_ROOT_ELEMENT_ID
