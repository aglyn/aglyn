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
  }
  // A quote is a gap the owner fills, and a published page shows no gap (AGL-3660).
  const blocks = placePlanned(scope, raw).filter((block) => {
    if (block.kind !== 'quotes') return true
    page.settled.push({ at, what: 'a quotes group left out: a published page shows no customer words the brief did not give' })
    return false
  })
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
      ariaLabel: aiLayoutFitText(name, 'note') || `Section ${index + 1}`,
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
      group.to = component
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
              ...(scope.centered && room === 'full'
                ? { justifyContent: 'center' }
                : {}),
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
  return scope.band === 'brand' ? null : { color: 'text.secondary' }
}

/** An accent's color: the brand's, or the band's own on a brand band. */
function accent(scope: SectionScope): Record<string, unknown> | null {
  return scope.band === 'brand' ? null : { color: 'primary.main' }
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
  const label = aiLayoutFitText(block.text, 'label')
  if (!label) return null
  const destination = aiLayoutResolveLink(
    block.to,
    label,
    scope.link,
    scope.page.targets,
  )
  if (!destination) {
    scope.page.settled.push({
      at: scope.at,
      what: `the button "${label}" has nowhere to go; left out`,
    })
    return null
  }
  const style = block.style ?? 'primary'
  const onBrand = scope.band === 'brand'
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
    null,
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
  return {}
}

/**
 * A picture slot: a soft frame at a stock shape showing an icon until the
 * owner places the picture, which then fills it. Its description is its alt
 * text (rule 9), and no source is set here: the compiler stays pure, and
 * `ai-layout-pictures.ts` fills the slot with a photo the site serves itself
 * once the page is checked.
 */
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
  const picture = tree.add(
    'image',
    { alt, objectFit: 'cover' },
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
  // The card style is the site theme's (AGL-3660), as a card dropped from the drawer takes it.
  return tree.add('muiCard', null, null, [content], 'formCard')
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
function cleanItems(
  scope: SectionScope,
  items: readonly AiLayoutItem[],
): AiLayoutItem[] {
  const facts = scope.page.targets.facts
  return items
    .map((item) => ({
      ...item,
      title: aiLayoutWords(item.title, 'itemTitle', facts) ? item.title : '',
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
  if (rule1(scope)) return compactGroup(scope, block, items, perRow)
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

/** The id the compiled page's root is stored under. */
export const AI_LAYOUT_PAGE_ROOT_ID = CANVAS_ROOT_ELEMENT_ID
