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

import { sanitizeAuthorHtml } from '@aglyn/aglyn/app-utils/author-html'
import {
  formatBytes,
  measureNodeMap,
  nodeMapBytes,
} from '@aglyn/aglyn/app-utils/measure-node-map'
import {
  MEDIA_CDN_VARIANT_WIDTHS,
  parseMediaRef,
} from '@aglyn/aglyn/app-utils/media-ref'
import {
  ESTIMATED_PAGE_TRANSFER_BYTES,
  FREE_AI_TASTE_CREDITS_PER_MONTH,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import { parseBreakpointSpan } from '@aglyn/shared-data-enums/breakpoint-span'
import { renderEmailHtml } from '@aglyn/shared-util-email/email-render'
import {
  aiPlanCreateFor,
  aiPlanUndeclaredRefs,
  isAiPlanNewRef,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
  type AiBuildPlanSection,
  type AiPlanUndeclaredRef,
} from '../model/ai-build-plan'
import {
  aiCreationNoun,
  aiPlanUncreatable,
  aiPlanUncreatableKind,
  type AiPlanCapabilities,
} from '../model/ai-plan-capabilities'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import {
  AI_INSTANCE_REF_PROP,
  validateAiNodeTree,
  type AiNodeTreeContext,
  type AiNodeTreeResult,
} from './ai-node-tree'
import {
  AI_EMAIL_CLIP_BYTES,
  AI_OUTPUT_BUDGETS,
  AI_OUTPUT_SURFACE,
  isHeadlineVariant,
  type AiBudgetMetric,
  type AiLoadEstimate,
  type AiOutputKind,
} from './ai-palette'
import { AI_PALETTE, AI_SX_TOKENS } from './ai-palette.generated'

/**
 * The building doctrine's validators (AGL-2935): the rules a generated
 * document is held to, each checked by code rather than asked of a prompt.
 *
 * A generator's system prompt carries the doctrine (`ai-doctrine.ts`), and a
 * model mostly follows it. "Mostly" is what these are for. Every tree and
 * every plan passes through them inside `runValidatedGeneration`; a finding
 * is a VIOLATION that names its rule and says, in a sentence a customer can
 * read, what was refused and what to do instead. The runtime re-asks the
 * model once with the findings, and stops for a person when the second
 * answer still breaks one.
 *
 * Trees are checked AFTER `validateAiNodeTree` (AGL-2905) has admitted them,
 * never instead of it: the palette validator decides what may be stored at
 * all, and these decide whether it was built the way a careful author would
 * build it. Plans are checked against the site inventory, which is where
 * "reuse before create" becomes checkable.
 *
 * Rule 17 is a MEASUREMENT, in the platform's existing units: the stored
 * node map in the bytes the save counts (`nodeMapBytes`), images at the size
 * the media library recorded, an email's HTML as the send path renders it,
 * and a page's load on top of the page weight the platform already measured.
 * Nothing here invents a second measure of a page.
 */

export type AiDoctrineRuleNumber =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17

/** Each rule's title, in the words the proposal and the docs page use. */
export const AI_DOCTRINE_RULES: Readonly<Record<AiDoctrineRuleNumber, string>> = {
  1: 'Repeats become one reusable component',
  2: 'Site-wide regions live in the layout',
  3: 'Forms are built on the Forms page, then placed',
  4: 'Similar pages share one template',
  5: 'Colors, spacing and type come from the theme',
  6: 'Emails use the brand',
  7: 'Reuse before creating',
  8: 'Data is bound, not typed',
  9: 'Images come from the media library, with alt text',
  10: 'Navigation and SEO travel with a page',
  11: 'One main landmark and an ordered outline',
  12: "Responsive by the theme's breakpoints",
  13: 'Drafts only',
  14: 'Your voice, with no filler copy',
  15: 'Start from a duplicate of the nearest thing',
  16: 'The smallest document that does the job',
  17: 'A measured budget for every output',
}

export const AI_DOCTRINE_RULE_NUMBERS = Object.keys(AI_DOCTRINE_RULES).map(
  Number,
) as AiDoctrineRuleNumber[]

export interface AiDoctrineViolation {
  /**
   * The rule broken; `null` when the answer could not be read as the output
   * at all, or asks for what its job does not build rather than breaking a
   * building rule.
   */
  rule: AiDoctrineRuleNumber | null
  /** Stable per finding, for specs and logs. */
  code: string
  /** One customer-safe sentence: what was refused and what to do instead. */
  message: string
  /** What the model is told beyond `message`, when the validator's own words say more. */
  detail?: string
  /** Offending nodes, by the ids of the tree that was checked. */
  nodeIds?: string[]
  /** Offending plan entries or answer fields, as `screens[1].sections[2]`. */
  paths?: string[]
  /** Rule 17: the measured figure against its budget. */
  figure?: { metric: AiBudgetMetric; value: number; budget: number }
}

/** A violation as one line: the rule's number and title, then its sentence. */
export function aiDoctrineViolationText(violation: AiDoctrineViolation): string {
  return violation.rule === null
    ? violation.message
    : `Rule ${violation.rule} (${AI_DOCTRINE_RULES[violation.rule]}): ${violation.message}`
}

/** Who the copy is framed for; agency and enterprise copy holds to the judgment-word rule. */
export type AiCopyFraming = 'agency' | 'enterprise' | null

// ── Trees ────────────────────────────────────────────────────────────────

export interface AiDoctrineNode {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
}

/** A validated flat node map, as `validateAiNodeTree` returns it. */
export interface AiDoctrineTree {
  rootId: string
  nodes: Record<string, AiDoctrineNode>
}

/** What a library asset records about itself, for the image weight. */
export interface AiAssetFacts {
  sizeBytes?: number
  width?: number
  height?: number
}

export interface AiDoctrineTreeContext extends AiNodeTreeContext {
  /** The brand an email is held to: palette path → color, and the families. */
  brand?: { colors: Record<string, string>; fonts: string[] } | null
  /** Placed library assets by media id. */
  assets?: Record<string, AiAssetFacts>
  /** The plan named a third-party embed the brief asked for, and its cost. */
  allowEmbeds?: boolean
  framing?: AiCopyFraming
  /**
   * Whether the workspace keeps reusable components and saved forms
   * (AGL-3030). `false` builds inline, the one way such a workspace can: a
   * form is a Form holding its fields, and a repeated block is drawn where it
   * repeats. Absent is `true`, the doctrine whole.
   */
  reusableComponents?: boolean
  /**
   * The site's home screens, by id (AGL-3056): the screen a link falls back
   * to when the site has none for what it promises. Absent: none is known.
   */
  homeScreenIds?: readonly string[]
}

/** One node of a walk: its id, its depth, and its ancestors' ids from the root down. */
export interface Visit {
  id: string
  node: AiDoctrineNode
  depth: number
  ancestors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every reachable node in document order, each once. Exported for a door's
 * own checks (`extend`), which read a tree the way these detectors do.
 */
export function walkTree(tree: AiDoctrineTree): Visit[] {
  const visits: Visit[] = []
  const seen = new Set<string>()
  const stack: Array<{ id: string; depth: number; ancestors: string[] }> = [
    { id: tree.rootId, depth: 0, ancestors: [] },
  ]
  while (stack.length) {
    const { id, depth, ancestors } = stack.pop() as (typeof stack)[number]
    const node = tree.nodes[id]
    if (!node || seen.has(id)) continue
    seen.add(id)
    visits.push({ id, node, depth, ancestors })
    const children = node.nodes ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ id: children[index], depth: depth + 1, ancestors: [...ancestors, id] })
    }
  }
  return visits
}

function displayName(componentId: string): string {
  return AI_PALETTE[componentId]?.displayName ?? componentId
}

/** The HTML element a node was told to render as. */
function elementOf(node: AiDoctrineNode | undefined): string {
  const value = node?.props?.['component'] ?? node?.props?.['element']
  return typeof value === 'string' ? value : ''
}

function hasAncestor(
  tree: AiDoctrineTree,
  visit: Visit,
  test: (node: AiDoctrineNode) => boolean,
): boolean {
  return visit.ancestors.some((id) => {
    const node = tree.nodes[id]
    return node ? test(node) : false
  })
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function listNames(ids: string[], tree: AiDoctrineTree): string {
  const names = unique(ids.map((id) => displayName(tree.nodes[id]?.componentId ?? '')))
  return names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Rule 1 and rule 8 read the same index: which subtrees share a shape.

/** Below this, a repeat is a row of buttons, not a block worth a component. */
export const AI_REPEAT_MIN_NODES = 3
/** Rule 1: a block on one page this many times is a component. */
export const AI_REPEAT_MIN_COUNT = 3
/** Rule 1 across pages: a block this large on two pages is a component. */
export const AI_REPEAT_ACROSS_PAGES_MIN_NODES = 5
/** Rule 8: a hand-typed list this long is data. */
export const AI_TYPED_LIST_MIN_ITEMS = 8

interface ShapeIndex {
  visits: Visit[]
  shapeOf: Map<string, string>
  sizeOf: Map<string, number>
}

/**
 * A subtree's shape: element ids, the prop NAMES it sets, and the values of
 * the props that change structure (enums, switches, numbers) — but never the
 * values of copy, links or media, which is what differs between the twelve
 * cards that should have been one component.
 */
function indexShapes(tree: AiDoctrineTree): ShapeIndex {
  const shapeOf = new Map<string, string>()
  const sizeOf = new Map<string, number>()
  const visits = walkTree(tree)
  for (let index = visits.length - 1; index >= 0; index -= 1) {
    const { id, node } = visits[index]
    const schema = AI_PALETTE[node.componentId]?.propsSchema.properties ?? {}
    const props = Object.keys(node.props ?? {})
      .sort()
      .map((key) => {
        const declared = schema[key]
        const structural =
          Boolean(declared?.enum) ||
          declared?.type === 'boolean' ||
          declared?.type === 'number' ||
          declared?.type === 'integer'
        return structural ? `${key}=${String(node.props?.[key])}` : key
      })
      .join(',')
    const children = (node.nodes ?? []).filter((child) => shapeOf.has(child))
    shapeOf.set(
      id,
      `${node.componentId}(${props})[${children.map((child) => shapeOf.get(child)).join('|')}]`,
    )
    sizeOf.set(id, 1 + children.reduce((sum, child) => sum + (sizeOf.get(child) ?? 0), 0))
  }
  return { visits, shapeOf, sizeOf }
}

/** Whether a node sits inside a collection repeater, whose child is authored once and repeated by data. */
function repeatedByData(tree: AiDoctrineTree, visit: Visit): boolean {
  return hasAncestor(tree, visit, (node) => node.componentId === 'collectionEntries')
}

/**
 * Shapes that repeat at least `minCount` times, reported only where they are
 * the outermost repeat: the header inside each of twelve cards repeats
 * because the card does, and the fix is the card. `groupOf` counts each
 * group's repeats apart; absent, the whole tree is one group.
 */
function repeatedShapes(
  tree: AiDoctrineTree,
  index: ShapeIndex,
  minNodes: number,
  minCount: number,
  groupOf: (visit: Visit) => string = () => tree.rootId,
): Array<{ shape: string; ids: string[] }> {
  const byShape = new Map<string, string[]>()
  for (const visit of index.visits) {
    if (visit.id === tree.rootId) continue
    if ((index.sizeOf.get(visit.id) ?? 0) < minNodes) continue
    if (repeatedByData(tree, visit)) continue
    const shape = JSON.stringify([groupOf(visit), index.shapeOf.get(visit.id)])
    byShape.set(shape, [...(byShape.get(shape) ?? []), visit.id])
  }
  const repeated = [...byShape.entries()].filter(([, ids]) => ids.length >= minCount)
  const repeatedIds = new Set(repeated.flatMap(([, ids]) => ids))
  const ancestorsOf = new Map(index.visits.map((visit) => [visit.id, visit.ancestors]))
  return repeated
    .filter(
      ([, ids]) =>
        !ids.every((id) => (ancestorsOf.get(id) ?? []).some((ancestor) => repeatedIds.has(ancestor))),
    )
    .map(([shape, ids]) => ({ shape, ids }))
}

/**
 * Rule 1. A block repeated on one page, or a block this page shares with
 * another page generated beside it, is one component placed as instances.
 *
 * A workspace that keeps no reusable components can place no instance, so
 * there a repeated block is drawn where it repeats, and nothing is refused.
 */
export function detectRepeatedSubtrees(
  tree: AiDoctrineTree,
  otherPages: readonly AiDoctrineTree[] = [],
  context: Pick<AiDoctrineTreeContext, 'reusableComponents'> = {},
): AiDoctrineViolation[] {
  if (context.reusableComponents === false) return []
  const index = indexShapes(tree)
  const violations: AiDoctrineViolation[] = repeatedShapes(
    tree,
    index,
    AI_REPEAT_MIN_NODES,
    AI_REPEAT_MIN_COUNT,
  ).map(({ ids }) => {
    const name = displayName(tree.nodes[ids[0]].componentId)
    return {
      rule: 1,
      code: 'repeated-subtree',
      message: `The same ${name} block appears ${ids.length} times. Make it one reusable component with props for what changes, and place it ${ids.length} times.`,
      nodeIds: ids,
    }
  })
  if (otherPages.length) {
    const elsewhere = new Set<string>()
    for (const other of otherPages) {
      const otherIndex = indexShapes(other)
      for (const visit of otherIndex.visits) {
        if (visit.id === other.rootId) continue
        if ((otherIndex.sizeOf.get(visit.id) ?? 0) >= AI_REPEAT_ACROSS_PAGES_MIN_NODES) {
          elsewhere.add(otherIndex.shapeOf.get(visit.id) as string)
        }
      }
    }
    const shared = index.visits.filter(
      (visit) =>
        visit.id !== tree.rootId &&
        (index.sizeOf.get(visit.id) ?? 0) >= AI_REPEAT_ACROSS_PAGES_MIN_NODES &&
        elsewhere.has(index.shapeOf.get(visit.id) as string),
    )
    const sharedIds = new Set(shared.map((visit) => visit.id))
    const outermost = shared.filter((visit) => !visit.ancestors.some((id) => sharedIds.has(id)))
    for (const visit of outermost) {
      violations.push({
        rule: 1,
        code: 'repeated-across-pages',
        message: `This page and another share the same ${displayName(visit.node.componentId)} block. Make it one reusable component and place it on both.`,
        nodeIds: [visit.id],
      })
    }
  }
  return violations
}

const REGION_ELEMENTS = new Set(['header', 'footer', 'nav'])
const REGION_WORDS: Record<string, string> = {
  header: 'header',
  footer: 'footer',
  nav: 'navigation',
}

/**
 * Rule 2. A page carries no copy of what every page carries: an app bar, or
 * a header, navigation or footer element near the top of the document. The
 * header of an article inside the page is the article's, not the site's.
 */
export function detectLayoutRegions(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
): AiDoctrineViolation[] {
  if (outputKind !== 'page' && outputKind !== 'template') return []
  const found: Array<{ id: string; region: string }> = []
  for (const visit of walkTree(tree)) {
    if (visit.id === tree.rootId) continue
    if (visit.node.componentId === 'muiAppBar') {
      found.push({ id: visit.id, region: 'header' })
      continue
    }
    const element = elementOf(visit.node)
    if (
      REGION_ELEMENTS.has(element) &&
      visit.depth <= 3 &&
      !hasAncestor(tree, visit, (node) => elementOf(node) === 'article')
    ) {
      found.push({ id: visit.id, region: REGION_WORDS[element] })
    }
  }
  if (!found.length) return []
  const regions = unique(found.map((entry) => entry.region)).join(' and ')
  return [
    {
      rule: 2,
      code: 'layout-region-in-screen',
      message: `This page carries its own site ${regions}. Headers, navigation and footers live in the site's layout; put the page in the layout instead of copying them onto it.`,
      nodeIds: found.map((entry) => entry.id),
    },
  ]
}

/**
 * Rule 3. A form on a page is a Form bound by id to a form built on the
 * Forms page — fields, validation, consent and routing kept in one place.
 * Loose fields, an unbound Form, and fields drawn inside a bound Form (which
 * the page never renders: the placed form's own design replaces them) are
 * refused. A form's own design is the one place fields are drawn.
 *
 * A workspace that keeps no saved forms (AGL-3030) has no Forms page to build
 * one on, so there the form IS the page's: an unbound Form holding its Form
 * Fields, which the site's submit route collects like any other. Loose fields
 * are still refused, and so is an unbound Form with no field to send.
 */
export function detectInlineForms(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  context: Pick<AiDoctrineTreeContext, 'reusableComponents'> = {},
): AiDoctrineViolation[] {
  if (outputKind === 'form' || outputKind === 'email') return []
  const inline = context.reusableComponents === false
  const loose: string[] = []
  const unbound: string[] = []
  const shadowed: string[] = []
  const empty: string[] = []
  const visits = walkTree(tree)
  for (const visit of visits) {
    if (
      visit.node.componentId === 'formField' &&
      !hasAncestor(tree, visit, (node) => node.componentId === 'form')
    ) {
      loose.push(visit.id)
    }
    if (visit.node.componentId === 'form') {
      const bound = visit.node.props?.['formId']
      if (typeof bound === 'string' && bound) {
        if ((visit.node.nodes ?? []).length) shadowed.push(visit.id)
      } else if (!inline) {
        unbound.push(visit.id)
      } else if (
        !visits.some(
          (inner) => inner.node.componentId === 'formField' && inner.ancestors.includes(visit.id),
        )
      ) {
        empty.push(visit.id)
      }
    }
  }
  const violations: AiDoctrineViolation[] = []
  if (inline && loose.length) {
    violations.push({
      rule: 3,
      code: 'loose-form-field',
      message:
        'This draws form fields outside a form, where nothing sends them. Put every Form Field inside the Form it belongs to.',
      nodeIds: loose,
    })
  }
  if (empty.length) {
    violations.push({
      rule: 3,
      code: 'form-without-fields',
      message: 'This form has no field to send. Give it the Form Fields it collects.',
      nodeIds: empty,
    })
  }
  if (!inline && (loose.length || unbound.length)) {
    violations.push({
      rule: 3,
      code: 'inline-form',
      message:
        'This draws a form inline. Build the form on the Forms page, with its fields, validation, consent and routing, then place it here by its id.',
      nodeIds: [...unbound, ...loose],
    })
  }
  if (shadowed.length) {
    violations.push({
      rule: 3,
      code: 'fields-inside-bound-form',
      message:
        'This form is placed by its id, so its fields come from the Forms page. Remove the copies of the fields drawn inside it.',
      nodeIds: shadowed,
    })
  }
  return violations
}

const COLOR_SX_KEYS = new Set(['color', 'bgcolor', 'backgroundColor', 'borderColor'])
const COLOR_IN_VALUE_SX_KEYS = new Set([
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'boxShadow',
])
const SPACING_SX_KEYS = new Set([
  'm',
  'mt',
  'mr',
  'mb',
  'ml',
  'mx',
  'my',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'p',
  'pt',
  'pr',
  'pb',
  'pl',
  'px',
  'py',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gap',
  'rowGap',
  'columnGap',
])
const TYPE_SX_KEYS = new Set(['fontSize', 'lineHeight', 'letterSpacing'])
const COLOR_KEYWORDS = new Set([
  'inherit',
  'transparent',
  'currentcolor',
  'initial',
  'unset',
  'none',
])
const LITERAL_COLOR =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(|\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|cyan|magenta|navy|teal|maroon|olive|lime|aqua|silver|gold|indigo|violet|beige|coral|crimson|salmon|tomato|turquoise|khaki|lavender|ivory|azure)\b/i
const LENGTH_WITH_UNIT = /-?\d*\.?\d+\s*(?:px|rem|em|pt|vh|vw|ch)\b/i
const paletteTokens = new Set<string>(AI_SX_TOKENS.palette)

/** Whether a value names a color by value rather than by theme token. */
function hasLiteralColor(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = value
    .trim()
    .split(/\s+/)
    .filter((part) => !paletteTokens.has(part) && !COLOR_KEYWORDS.has(part.toLowerCase()))
  return LITERAL_COLOR.test(parts.join(' '))
}

/** An `sx` value and each of its responsive values. */
function sxValues(value: unknown): unknown[] {
  return isRecord(value) ? Object.values(value) : [value]
}

/**
 * Rule 5. Every color, spacing, radius and type size is a theme token. A
 * color the theme lacks is a theme change for the theme door to draft, not a
 * value written onto one element.
 */
export function detectLiteralStyles(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
): AiDoctrineViolation[] {
  if (outputKind === 'email') return []
  const colors: string[] = []
  const lengths: string[] = []
  for (const { id, node } of walkTree(tree)) {
    for (const [key, raw] of Object.entries(node.sx ?? {})) {
      for (const value of sxValues(raw)) {
        if ((COLOR_SX_KEYS.has(key) || COLOR_IN_VALUE_SX_KEYS.has(key)) && hasLiteralColor(value)) {
          colors.push(id)
        } else if (
          (SPACING_SX_KEYS.has(key) || key === 'borderRadius' || TYPE_SX_KEYS.has(key)) &&
          typeof value === 'string' &&
          LENGTH_WITH_UNIT.test(value)
        ) {
          lengths.push(id)
        } else if (key === 'fontSize' && typeof value === 'number' && value > 0) {
          lengths.push(id)
        }
      }
    }
    const schema = AI_PALETTE[node.componentId]?.propsSchema.properties ?? {}
    for (const [name, value] of Object.entries(node.props ?? {})) {
      if (
        /(?:^|[a-z])(?:color|Color|bgcolor)$/.test(name) &&
        !schema[name]?.enum &&
        hasLiteralColor(value)
      ) {
        colors.push(id)
      }
    }
  }
  const violations: AiDoctrineViolation[] = []
  if (colors.length) {
    violations.push({
      rule: 5,
      code: 'literal-color',
      message:
        "This sets colors by value. Use the theme's color tokens, and propose a theme change for a color the theme does not have.",
      nodeIds: unique(colors),
    })
  }
  if (lengths.length) {
    violations.push({
      rule: 5,
      code: 'literal-length',
      message:
        "This sets spacing, corners or type sizes in fixed units. Use the theme's spacing scale, shape and typography styles.",
      nodeIds: unique(lengths),
    })
  }
  return violations
}

function normalizeHex(value: string): string {
  const hex = value.trim().toLowerCase()
  return /^#[0-9a-f]{3}$/.test(hex)
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex
}

/**
 * Rule 6. An email is painted with the brand: its colors are the site's
 * brand colors and its fonts the brand's. A mail client cannot resolve a
 * theme token, so the brand's own values are what an email may name — and
 * with no brand recorded, the blocks' own defaults.
 */
export function detectOffBrandEmail(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  brand: AiDoctrineTreeContext['brand'],
): AiDoctrineViolation[] {
  if (outputKind !== 'email') return []
  const allowed = new Set(Object.values(brand?.colors ?? {}).map(normalizeHex))
  const fonts = new Set((brand?.fonts ?? []).map((font) => font.toLowerCase()))
  const offBrand: string[] = []
  const values: string[] = []
  for (const { id, node } of walkTree(tree)) {
    const candidates: unknown[] = []
    for (const name of ['color', 'backgroundColor']) candidates.push(node.props?.[name])
    for (const [key, raw] of Object.entries(node.sx ?? {})) {
      if (COLOR_SX_KEYS.has(key)) candidates.push(...sxValues(raw))
      if (key === 'fontFamily') {
        for (const family of sxValues(raw)) {
          if (typeof family === 'string' && !fonts.has(family.trim().toLowerCase())) {
            offBrand.push(id)
            values.push(family.trim())
          }
        }
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      if (!allowed.has(normalizeHex(candidate))) {
        offBrand.push(id)
        values.push(candidate.trim())
      }
    }
  }
  if (!offBrand.length) return []
  return [
    {
      rule: 6,
      code: 'off-brand-email',
      message: `This email uses ${unique(values).slice(0, 3).join(', ')}, outside the brand. Use the brand's colors and fonts so every email reads as the same sender.`,
      nodeIds: unique(offBrand),
    },
  ]
}

/**
 * Rule 8 (tree). A long list typed out item by item is data: bound to a
 * dataset or a content collection it stays current; typed, it is a copy that
 * goes stale. Instances of one component filled in side by side are the same
 * list in a component's clothes, and are counted the same way.
 *
 * A list is counted within the Section it sits in, the unit a plan counts a
 * section's items in (AGL-3061): a page's four practice areas and its four
 * steps are two short lists that happen to share a card, not one long one,
 * and a plan that kept them must not build a page this refuses. The same
 * list split across a section's columns is still one list. A tree with no
 * Section is one group.
 */
export function detectTypedData(tree: AiDoctrineTree): AiDoctrineViolation[] {
  const index = indexShapes(tree)
  const sectionOf = (visit: Visit): string =>
    [...visit.ancestors].reverse().find((id) => tree.nodes[id]?.componentId === 'section') ?? tree.rootId
  const violations: AiDoctrineViolation[] = repeatedShapes(
    tree,
    index,
    AI_REPEAT_MIN_NODES - 1,
    AI_TYPED_LIST_MIN_ITEMS,
    sectionOf,
  ).map(({ ids }) => ({
    rule: 8,
    code: 'typed-list',
    message: `${ids.length} ${displayName(tree.nodes[ids[0]].componentId)} items are typed out by hand. Bind the list to a dataset or content collection, or propose a dataset for data the site does not have yet.`,
    nodeIds: ids,
  }))
  for (const visit of index.visits) {
    if (repeatedByData(tree, visit) || visit.node.componentId === 'collectionEntries') continue
    const byComponent = new Map<string, string[]>()
    for (const childId of visit.node.nodes ?? []) {
      const child = tree.nodes[childId]
      const ref = child?.props?.[AI_INSTANCE_REF_PROP]
      if (child?.componentId !== REUSABLE_INSTANCE_COMPONENT_ID || typeof ref !== 'string') continue
      byComponent.set(ref, [...(byComponent.get(ref) ?? []), childId])
    }
    for (const ids of byComponent.values()) {
      if (ids.length < AI_TYPED_LIST_MIN_ITEMS) continue
      violations.push({
        rule: 8,
        code: 'typed-instances',
        message: `${ids.length} copies of one component are filled in by hand. Bind them to a dataset or content collection, or propose a dataset for data the site does not have yet.`,
        nodeIds: ids,
      })
    }
  }
  return violations
}

/** The media-role props of a node, with the declared image props of an instance. */
function mediaValues(
  node: AiDoctrineNode,
  context: AiNodeTreeContext,
): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  const roles = AI_PALETTE[node.componentId]?.propRoles ?? {}
  for (const [name, value] of Object.entries(node.props ?? {})) {
    if (roles[name] === 'media' && typeof value === 'string' && value.trim()) {
      out.push({ name, value: value.trim() })
    }
  }
  const refId = node.props?.[AI_INSTANCE_REF_PROP]
  const values = node.props?.[REUSABLE_INSTANCE_PROP_VALUES_KEY]
  if (typeof refId === 'string' && isRecord(values)) {
    const declared = context.componentProps?.[refId] ?? {}
    for (const [name, value] of Object.entries(values)) {
      if (declared[name] === 'image' && typeof value === 'string' && value.trim()) {
        out.push({ name: `${REUSABLE_INSTANCE_PROP_VALUES_KEY}.${name}`, value: value.trim() })
      }
    }
  }
  return out
}

/**
 * Rule 9. Images are placed from the media library — an asset, or an empty
 * slot for the author to fill — never hot-linked from another site, and
 * every picture carries alt text (or says it is decorative).
 */
export function detectImageSources(
  tree: AiDoctrineTree,
  context: AiNodeTreeContext = {},
): AiDoctrineViolation[] {
  const hotlinked: string[] = []
  const missingAlt: string[] = []
  for (const { id, node } of walkTree(tree)) {
    if (mediaValues(node, context).some(({ value }) => /^https?:\/\//i.test(value))) {
      hotlinked.push(id)
    }
    if (node.componentId === 'image' || node.componentId === 'emailImage') {
      const alt = node.props?.['alt']
      const decorative = node.props?.['decorative'] === true
      if (!decorative && (typeof alt !== 'string' || !alt.trim())) missingAlt.push(id)
    }
  }
  const violations: AiDoctrineViolation[] = []
  if (hotlinked.length) {
    violations.push({
      rule: 9,
      code: 'hotlinked-image',
      message:
        'This loads images from another website. Place images from the media library, or leave the slot empty for an upload.',
      nodeIds: hotlinked,
    })
  }
  if (missingAlt.length) {
    violations.push({
      rule: 9,
      code: 'missing-alt',
      message:
        'An image has no alt text. Describe what each picture shows, or mark a purely decorative one as decorative.',
      nodeIds: missingAlt,
    })
  }
  return violations
}

/**
 * A heading's level: the element it renders as, else the variant's own.
 * Exported for a door's own checks, which read an outline the way rule 11
 * reads a page's.
 */
export function aiHeadingLevel(node: AiDoctrineNode): number | null {
  if (node.componentId !== 'muiTypography') return null
  const element =
    typeof node.props?.['component'] === 'string' ? String(node.props['component']) : ''
  const match = /^h([1-6])$/.exec(element || String(node.props?.['variant'] ?? ''))
  return match ? Number(match[1]) : null
}

/**
 * Rule 11. One `main` landmark per document, and a heading outline that
 * starts at one `h1` and never skips a level. The platform places the one
 * landmark on the layout's slot, or on a page's root when it has no layout
 * (`stampDocumentLandmark`); a tree that declares two leaves it to pick the
 * wrong one. A component, a form or an email is placed inside pages, so it
 * carries no landmark of its own, and a layout carries no `h1`: every page
 * placed in it brings its own.
 */
export function detectDocumentStructure(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
): AiDoctrineViolation[] {
  const visits = walkTree(tree)
  const mains = visits.filter((visit) => elementOf(visit.node) === 'main').map((visit) => visit.id)
  const violations: AiDoctrineViolation[] = []
  if (outputKind === 'component' || outputKind === 'email' || outputKind === 'form') {
    if (mains.length) {
      violations.push({
        rule: 11,
        code: 'landmark-in-fragment',
        message: `A ${outputKind} is placed inside pages, so it cannot carry the main landmark. Leave the element unset.`,
        nodeIds: mains,
      })
    }
  } else if (mains.length > 1) {
    violations.push({
      rule: 11,
      code: 'multiple-main',
      message: 'This declares more than one main landmark. A page has exactly one.',
      nodeIds: mains,
    })
  }
  if (outputKind === 'layout') {
    const slots = visits.filter((visit) => visit.node.componentId === 'layoutSlot')
    const rootElement = elementOf(tree.nodes[tree.rootId])
    const slotElement = slots[0] ? elementOf(slots[0].node) : ''
    // The landmark goes on the slot, else on the root — unless an author
    // chose another element for each.
    const chosenAway =
      rootElement !== '' &&
      rootElement !== 'main' &&
      (!slots.length || (slotElement !== '' && slotElement !== 'main'))
    if (slots.length !== 1 || chosenAway) {
      violations.push({
        rule: 11,
        code: 'layout-slot',
        message:
          'A layout has exactly one Layout Slot, where each page renders, and the slot is the main landmark.',
        nodeIds: slots.map((slot) => slot.id),
      })
    }
  }
  if (outputKind === 'email' || outputKind === 'form') return violations

  const headings = visits
    .map((visit) => ({ id: visit.id, level: aiHeadingLevel(visit.node) }))
    .filter((entry): entry is { id: string; level: number } => entry.level !== null)
  const h1s = headings.filter((heading) => heading.level === 1).map((heading) => heading.id)
  const page = outputKind === 'page' || outputKind === 'template'
  if (page && h1s.length !== 1) {
    violations.push({
      rule: 11,
      code: h1s.length ? 'multiple-h1' : 'missing-h1',
      message: h1s.length
        ? `This page has ${h1s.length} top-level headings. A page has one h1; make the others h2.`
        : "This page has no top-level heading. Give the page's title one h1.",
      nodeIds: h1s,
    })
  } else if (!page && h1s.length > (outputKind === 'layout' ? 0 : 1)) {
    violations.push({
      rule: 11,
      code: 'multiple-h1',
      message:
        outputKind === 'layout'
          ? 'A layout wraps pages that bring their own h1, so it carries none.'
          : 'A component carries at most one h1.',
      nodeIds: h1s,
    })
  }
  const skipped: string[] = []
  let previous = page ? 0 : (headings[0]?.level ?? 1) - 1
  for (const heading of headings) {
    if (heading.level > previous + 1) skipped.push(heading.id)
    previous = heading.level
  }
  if (skipped.length) {
    violations.push({
      rule: 11,
      code: 'skipped-heading',
      message:
        'The heading outline skips a level. Step down one level at a time — an h2 before any h3.',
      nodeIds: skipped,
    })
  }
  return violations
}

const WIDTH_SX_KEYS = new Set(['width', 'minWidth', 'maxWidth'])

/**
 * Rule 12. Widths follow the theme's breakpoints and the palette's
 * responsive props — a Container's max width, a Grid's span — never a fixed
 * pixel or viewport width that holds at one screen size. An email's column
 * is fixed by the medium, and is exempt.
 */
export function detectAdHocWidths(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
): AiDoctrineViolation[] {
  if (outputKind === 'email') return []
  const fixed: string[] = []
  for (const { id, node } of walkTree(tree)) {
    for (const [key, raw] of Object.entries(node.sx ?? {})) {
      if (!WIDTH_SX_KEYS.has(key)) continue
      for (const value of sxValues(raw)) {
        // MUI reads a number up to 1 as a fraction of the parent.
        if (
          (typeof value === 'number' && value > 1) ||
          (typeof value === 'string' && LENGTH_WITH_UNIT.test(value))
        ) {
          fixed.push(id)
        }
      }
    }
  }
  return fixed.length
    ? [
        {
          rule: 12,
          code: 'fixed-width',
          message:
            "This sets fixed widths. Size elements with the theme's breakpoints — a Container's max width, a Grid span, or a percentage.",
          nodeIds: unique(fixed),
        },
      ]
    : []
}

const GRID = 'muiGrid'
/** A Grid's props that only a container reads; on an item they do nothing. */
const GRID_CONTAINER_PROPS = ['direction', 'wrap', 'spacing', 'rowSpacing', 'columnSpacing', 'columns']
/** `sx` keys that space a container's columns outside the widths its items are sized by. */
const GRID_GAP_SX_KEYS = ['gap', 'columnGap']
/** The columns a container divides a row into when it names none. */
const GRID_DEFAULT_COLUMNS = 12

/** A Grid's columns: its own `columns` when it names a count, else the renderer's twelve. */
function gridColumns(node: AiDoctrineNode): number {
  const columns = Number(node.props?.['columns'])
  return Number.isInteger(columns) && columns > 0 ? columns : GRID_DEFAULT_COLUMNS
}

/**
 * Whether a Grid item's size is one the renderer reads, full width on a phone,
 * and whether it steps down to a column at a larger width. The size is the
 * stored string the besigner's breakpoint row writes and the Grid renderer
 * parses (`parseBreakpointSpan`): a bare span at every width, or pairs such as
 * `xs:12 md:4`.
 */
function gridItemSpan(size: unknown, columns: number): { phoneFull: boolean; steps: boolean } {
  if (typeof size !== 'string' && typeof size !== 'number') return { phoneFull: false, steps: false }
  const span = parseBreakpointSpan(size)
  if (span.raw !== undefined) return { phoneFull: false, steps: false }
  if (span.base !== undefined) return { phoneFull: span.base === columns, steps: false }
  const values = span.values ?? {}
  return {
    phoneFull: values.xs === columns,
    steps: Object.entries(values).some(([breakpoint, value]) => breakpoint !== 'xs' && value !== columns),
  }
}

/** The size a container's column is asked for: full width on a phone, a row of up to four from md. */
function gridItemSizeFor(items: number, columns: number): string {
  const across = Math.min(Math.max(items, 2), 4)
  const md = Math.max(1, Math.floor(columns / (items > 4 ? 3 : across)))
  const sm = Math.floor(columns / 2)
  return items >= 4 && sm !== md ? `xs:${columns} sm:${sm} md:${md}` : `xs:${columns} md:${md}`
}

/**
 * Rule 12, for a Grid (AGL-3055). The palette's Grid is one element in both
 * roles: a CONTAINER lays its direct Grid children out in columns, and an ITEM
 * takes a size. The sizes are fractions of the container's columns, so an
 * item under a Grid that is not a container is sized against nothing, and a
 * row of them stacks one under another at every width; a size that holds at
 * every width keeps a phone's columns as narrow as a desktop's; and an `sx`
 * gap on a container spaces the columns outside the widths the items were
 * sized by, so the last column wraps onto a row of its own. A live About
 * page's practice areas were the first: a Grid with no container holding three
 * items sized "4", one column at every width.
 *
 * - `grid-not-container`: a Grid that is not a container but holds sized Grid
 *   items, sets a prop only a container reads, or holds two or more elements
 *   without being an item of a container.
 * - `grid-item-size`: a container's child that is not a Grid item sized full
 *   width on a phone, or a container of several whose items never step down
 *   to columns at a larger width.
 * - `grid-gap`: a container spaced by an `sx` gap rather than its spacing.
 *
 * Each re-ask names the Grid or its items by the model's own ids and says what
 * to write, in the size format the renderer reads.
 */
export function detectUnresponsiveGrids(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
): AiDoctrineViolation[] {
  if (outputKind === 'email' || outputKind === 'form') return []
  const notContainers: string[] = []
  const unsized: string[] = []
  const suggested: string[] = []
  const gapped: Array<{ id: string; spacing: unknown }> = []
  for (const visit of walkTree(tree)) {
    const { id, node } = visit
    if (node.componentId !== GRID) continue
    const children = (node.nodes ?? []).filter((child) => tree.nodes[child])
    const parent = tree.nodes[visit.ancestors[visit.ancestors.length - 1] ?? '']
    const isItem = parent?.componentId === GRID && parent.props?.['container'] === true
    if (node.props?.['container'] !== true) {
      const holdsSizedItems = children.some(
        (child) => tree.nodes[child].componentId === GRID && tree.nodes[child].props?.['size'] !== undefined,
      )
      const setsContainerProps = GRID_CONTAINER_PROPS.some((name) => node.props?.[name] !== undefined)
      if (holdsSizedItems || setsContainerProps || (!isItem && children.length >= 2)) notContainers.push(id)
      continue
    }
    const columns = gridColumns(node)
    let steps = false
    const offending: string[] = []
    for (const child of children) {
      const item = tree.nodes[child]
      const span = item.componentId === GRID ? gridItemSpan(item.props?.['size'], columns) : null
      if (!span?.phoneFull) offending.push(child)
      if (span?.steps) steps = true
    }
    if (offending.length) {
      unsized.push(...offending)
    } else if (children.length >= 2 && !steps) {
      unsized.push(...children)
    }
    if (offending.length || (children.length >= 2 && !steps)) {
      suggested.push(gridItemSizeFor(children.length, columns))
    }
    const sx = node.sx ?? {}
    const gap = GRID_GAP_SX_KEYS.find((key) => sx[key] !== undefined)
    if (gap) gapped.push({ id, spacing: sx[gap] })
  }
  const violations: AiDoctrineViolation[] = []
  if (notContainers.length) {
    violations.push({
      rule: 12,
      code: 'grid-not-container',
      message:
        'A Grid lays out columns only as a container: this one is not, so what it holds stacks at every width. Set "container": true on it, and put each column in a Grid item sized like "xs:12 md:4".',
      nodeIds: unique(notContainers),
    })
  }
  if (unsized.length) {
    violations.push({
      rule: 12,
      code: 'grid-item-size',
      message: `Every child of a Grid container is a Grid item whose size is full width on a phone and steps up to columns at a larger width, written as one string. Size these like "${suggested[0]}", and wrap any other element in such an item.`,
      nodeIds: unique(unsized),
    })
  }
  if (gapped.length) {
    const [first] = gapped
    const spacing = typeof first.spacing === 'number' ? first.spacing : 2
    violations.push({
      rule: 12,
      code: 'grid-gap',
      message: `A Grid container's items are sized by its "spacing", so an sx gap pushes its last column onto a row of its own. Remove the sx gap and set "spacing": ${spacing}.`,
      nodeIds: gapped.map((entry) => entry.id),
    })
  }
  return violations
}

/** The palette colors a link or a button can take, and a band can be painted in. */
const LINK_COLOR_FAMILIES = new Set(['primary', 'secondary', 'success', 'error', 'info', 'warning'])
/** The elements a page links with; each draws its words in its `color` unless told otherwise. */
const LINK_COMPONENTS = new Set(['muiButton', 'muiScreenLink'])
/** Surfaces that paint their own background, whatever band they sit on. */
const PAPER_COMPONENTS = new Set(['muiCard', 'muiPaper', 'muiAccordion', 'muiDrawer'])
/** A palette color token of a link family: `primary.main`, `secondary.dark`. */
const FAMILY_TOKEN = /^([a-z]+)\.(?:main|dark|light)$/

/** The link family a color value names, if it names one. */
function familyOf(value: unknown): string | null {
  const family = typeof value === 'string' ? FAMILY_TOKEN.exec(value.trim())?.[1] : undefined
  return family && LINK_COLOR_FAMILIES.has(family) ? family : null
}

/**
 * The band a node sits on: the nearest ancestor that paints a background. An
 * `sx` background in a link family's color is a band of that family, and an
 * App Bar is one in its `color`, which is primary when it names none. Any
 * other background, and every paper surface, is not.
 */
function bandOf(tree: AiDoctrineTree, visit: Visit): { family: string; token: string } | null {
  for (const id of [...visit.ancestors].reverse()) {
    const node = tree.nodes[id]
    if (!node) continue
    const background = node.sx?.['bgcolor'] ?? node.sx?.['backgroundColor']
    if (background !== undefined) {
      const token = sxValues(background).find((value) => familyOf(value) !== null)
      return typeof token === 'string' ? { family: familyOf(token) as string, token: token.trim() } : null
    }
    if (node.componentId === 'muiAppBar') {
      const color = typeof node.props?.['color'] === 'string' ? node.props['color'] : 'primary'
      return LINK_COLOR_FAMILIES.has(color) ? { family: color, token: `${color}.main` } : null
    }
    if (PAPER_COMPONENTS.has(node.componentId)) return null
  }
  return null
}

/**
 * The palette family a link or a button draws its words in: its own `sx`
 * color when it sets one, else its `color` (primary when it names none). A
 * link told to inherit takes the band's own, and a contained button draws its
 * label in the family's contrast text on a fill of its own.
 */
function linkWordsFamily(node: AiDoctrineNode): string | null {
  const own = node.sx?.['color']
  if (own !== undefined) {
    return sxValues(own).map(familyOf).find((family) => family !== null) ?? null
  }
  const color = typeof node.props?.['color'] === 'string' ? node.props['color'] : 'primary'
  if (!LINK_COLOR_FAMILIES.has(color)) return null
  const styledAsButton = node.componentId === 'muiButton' || node.props?.['renderAs'] !== 'link'
  return styledAsButton && node.props?.['variant'] === 'contained' ? null : color
}

/**
 * Rule 5, for a link on a colored band (AGL-3056). The doctrine asks for
 * palette tokens, and a band in `primary.main` holding a Screen Link that
 * sets no color is two valid tokens: but the link keeps the theme's primary
 * color, so its words are navy on navy. A live About page's footer was the
 * first, a "Request a Consultation" link on a primary band. A link or a button
 * whose words are drawn in the family of the band it sits on is refused, with
 * a re-ask to inherit the band's contrast text or to set it.
 */
export function detectInvisibleLinks(tree: AiDoctrineTree, outputKind: AiOutputKind): AiDoctrineViolation[] {
  if (outputKind === 'email' || outputKind === 'form') return []
  const hidden: Array<{ id: string; family: string; token: string }> = []
  for (const visit of walkTree(tree)) {
    if (!LINK_COMPONENTS.has(visit.node.componentId)) continue
    const family = linkWordsFamily(visit.node)
    const band = family ? bandOf(tree, visit) : null
    if (band && band.family === family) hidden.push({ id: visit.id, ...band })
  }
  if (!hidden.length) return []
  const [first] = hidden
  return [
    {
      rule: 5,
      code: 'link-color-on-band',
      message: `A link or button on a ${first.token} band draws its words in the theme's ${first.family} color, the band's own, so they cannot be read. Give it "color": "inherit" under a band whose sx color is ${first.family}.contrastText, or set its own sx color to ${first.family}.contrastText.`,
      nodeIds: unique(hidden.map((entry) => entry.id)),
    },
  ]
}

/** A link's words that say it goes home. */
const HOME_WORDS = /\bhome(?:\s?page)?\b/i

/**
 * Rule 10, for a link sent where the site has nothing for it (AGL-3056). A
 * link whose purpose the site has no screen for is left out; it never goes to
 * a screen that does something else. The site inventory cannot say what each
 * screen is for, but it can name the one a model falls back to: a live About
 * page's footer sent "Request a Consultation" to the home screen, because the
 * site had no consultation screen. So a Screen Link or a Button, outside the
 * header and the navigation, that links the home screen with words that do
 * not say home is refused, with a re-ask to link the screen that does what it
 * says, or to leave the link out.
 */
export function detectUnrelatedScreenLinks(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  context: Pick<AiDoctrineTreeContext, 'homeScreenIds'> = {},
): AiDoctrineViolation[] {
  if (outputKind === 'email' || outputKind === 'form') return []
  const home = new Set(context.homeScreenIds ?? [])
  const sent: Array<{ id: string; label: string }> = []
  for (const visit of walkTree(tree)) {
    const { node } = visit
    if (!LINK_COMPONENTS.has(node.componentId)) continue
    const screenId = node.props?.['screenId']
    const linksHome = (typeof screenId === 'string' && home.has(screenId)) || node.props?.['href'] === '/'
    const label = typeof node.props?.['children'] === 'string' ? node.props['children'].trim() : ''
    if (!linksHome || !label || HOME_WORDS.test(label)) continue
    // The header and the navigation link home by name and by the site's own brand.
    const inNavigation = hasAncestor(
      tree,
      visit,
      (ancestor) => ancestor.componentId === 'muiAppBar' || ['header', 'nav'].includes(elementOf(ancestor)),
    )
    if (!inNavigation) sent.push({ id: visit.id, label })
  }
  if (!sent.length) return []
  return [
    {
      rule: 10,
      code: 'link-unrelated-screen',
      message: `"${sent[0].label}" links the home page, which does not do what its words say. Link the screen that does, or leave the link out when the site has none.`,
      nodeIds: unique(sent.map((entry) => entry.id)),
    },
  ]
}

/** A prop value with something in it: a destination, or words. */
function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Rule 10, for a link that goes nowhere (AGL-3072). A Button or a Screen Link
 * goes where its `screenId` or its `href` says, and those are the only
 * destinations either element carries: the palette validator keeps a
 * `screenId` the site has, and an `href` that is a path on the site, an
 * `https:` address or a binding the caller admitted. Nothing else can stand
 * in for one. A form is sent by the button the Form draws from its own
 * `submitLabel`, the elements a page places carry no id an anchor could name
 * (AGL-2867), and a generated node sets no interaction. So a link with
 * neither is a dead control: a live About page's hero carried a "Request a
 * Consultation" button with no destination. It is refused, with a re-ask
 * naming its words and what it may link.
 */
export function detectLinksWithoutDestination(tree: AiDoctrineTree, outputKind: AiOutputKind): AiDoctrineViolation[] {
  if (outputKind === 'email' || outputKind === 'form') return []
  const dead: Array<{ id: string; label: string; inForm: boolean }> = []
  for (const visit of walkTree(tree)) {
    const { node } = visit
    if (!LINK_COMPONENTS.has(node.componentId)) continue
    if (isFilled(node.props?.['screenId']) || isFilled(node.props?.['href'])) continue
    dead.push({
      id: visit.id,
      label: typeof node.props?.['children'] === 'string' ? node.props['children'].trim() : '',
      inForm: hasAncestor(tree, visit, (ancestor) => ancestor.componentId === 'form'),
    })
  }
  if (!dead.length) return []
  const [first] = dead
  const words = first.label ? `"${first.label}"` : `A ${displayName(tree.nodes[first.id].componentId)}`
  const instead = dead.some((entry) => entry.inForm)
    ? ' A Form draws its own send button from its "submitLabel", so take out a button drawn inside one and set that label instead.'
    : ' When the site has no page for it, take it out: a form on this page is sent by its own button, and no element can be reached by an anchor.'
  return [
    {
      rule: 10,
      code: 'link-without-destination',
      message: `${words} goes nowhere. Give it the "screenId" of a screen the site has that does what its words say, or an "href" that is a path on this site or an https: address the brief gives.${instead}`,
      nodeIds: unique(dead.map((entry) => entry.id)),
    },
  ]
}

/** Answer fields that say "publish", wherever the answer put them. */
const PUBLISH_KEYS = /^(?:publish|published|publishNow|publishAt|goLive|isLive|live|makeLive)$/i

/**
 * Rule 13. The AI writes drafts. An answer that asks for anything to be
 * published, or to go live, is refused whatever else it got right; nothing
 * downstream reads such a field, and the refusal is what keeps a future
 * reader from starting to.
 */
export function detectPublishIntent(answer: unknown): AiDoctrineViolation[] {
  const paths: string[] = []
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 12 || paths.length >= 5) return
    if (Array.isArray(value)) {
      value.forEach((inner, index) => visit(inner, `${path}[${index}]`, depth + 1))
      return
    }
    if (!isRecord(value)) return
    for (const [key, inner] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key
      // An element's props and styles are page content, not instructions.
      if (key === 'props' || key === 'sx') continue
      if (
        PUBLISH_KEYS.test(key) &&
        inner !== false &&
        inner !== null &&
        inner !== undefined &&
        inner !== ''
      ) {
        paths.push(here)
      } else if (
        key === 'status' &&
        typeof inner === 'string' &&
        /^(?:published|live|public)$/i.test(inner.trim())
      ) {
        paths.push(here)
      } else {
        visit(inner, here, depth + 1)
      }
    }
  }
  visit(answer, '', 0)
  return paths.length
    ? [
        {
          rule: 13,
          code: 'publish-intent',
          message:
            'The answer asked to publish. Everything the AI builds is a new draft; review it and publish it yourself.',
          paths,
        },
      ]
    : []
}

/** A fact the brief never gave, marked in square brackets: `[Office phone number]`. */
const BRACKETED_FACT = /\[([^[\]{}\n]{1,80})\]/g

/**
 * The facts in square brackets copy holds (rule 14), each once whatever its
 * case, in the order they first appear, as the copy spells them
 * (AGL-3056): what a member fills in before a draft is published.
 */
export function aiBracketedFacts(texts: Iterable<string>): string[] {
  const facts = new Map<string, string>()
  for (const text of texts) {
    for (const match of text.matchAll(BRACKETED_FACT)) {
      const fact = match[1].trim()
      if (fact && !facts.has(fact.toLowerCase())) facts.set(fact.toLowerCase(), `[${fact}]`)
    }
  }
  return [...facts.values()]
}

/**
 * Filler that stands in for copy. A bracketed marker for a fact the brief
 * never gave — `[phone number]` — is deliberately NOT here: it is the honest
 * alternative to inventing the fact, and refusing it would push the re-ask
 * toward a made-up number.
 */
const FILLER_COPY =
  /\blorem\b|\bipsum\b|\bdolor sit\b|\b(?:your|insert|add) (?:text|copy|content|headline|title|description|tagline) here\b|\b(?:placeholder|sample|dummy|filler) (?:text|copy|content)\b|\b(?:text|copy|content) goes here\b/i
const JUDGMENT =
  /\b(?:simply|obviously|no-brainer|cheap|effortless(?:ly)?|dead simple|super easy|just (?:a|one) click)\b/i

export interface AiCopySample {
  /** A node id for a tree, a path for a plan. */
  at: string
  text: string
}

/**
 * Rule 14. Copy in the site's voice: no lorem ipsum or "your text here"
 * filler, and — for copy framed for agencies and enterprises — no words that
 * judge the reader's work as simple or cheap.
 */
export function detectOffVoiceCopy(
  samples: readonly AiCopySample[],
  framing: AiCopyFraming = null,
): AiDoctrineViolation[] {
  const filler = samples.filter((sample) => FILLER_COPY.test(sample.text))
  const judged =
    framing === 'agency' || framing === 'enterprise'
      ? samples.filter((sample) => JUDGMENT.test(sample.text))
      : []
  const at = (list: readonly AiCopySample[]) => {
    const ids = unique(list.map((sample) => sample.at))
    const paths = ids.filter((id) => /[.[\]]/.test(id))
    const nodeIds = ids.filter((id) => !/[.[\]]/.test(id))
    return { ...(nodeIds.length ? { nodeIds } : {}), ...(paths.length ? { paths } : {}) }
  }
  const violations: AiDoctrineViolation[] = []
  if (filler.length) {
    violations.push({
      rule: 14,
      code: 'filler-copy',
      message:
        "This leaves filler copy. Write the real words in the site's voice, from what the brief and the site already say.",
      ...at(filler),
    })
  }
  if (judged.length) {
    violations.push({
      rule: 14,
      code: 'judgment-words',
      message:
        'This copy calls the work simple or cheap, which reads as a judgment to an agency or enterprise audience. Say what it does instead.',
      ...at(judged),
    })
  }
  return violations
}

/** Every piece of copy a tree carries, with the node it sits on. */
export function aiTreeCopy(
  tree: AiDoctrineTree,
  context: AiNodeTreeContext = {},
): AiCopySample[] {
  const samples: AiCopySample[] = []
  for (const { id, node } of walkTree(tree)) {
    const roles = AI_PALETTE[node.componentId]?.propRoles ?? {}
    for (const [name, value] of Object.entries(node.props ?? {})) {
      if (roles[name] === 'text' && typeof value === 'string' && value.trim()) {
        samples.push({ at: id, text: value })
      }
    }
    const refId = node.props?.[AI_INSTANCE_REF_PROP]
    const values = node.props?.[REUSABLE_INSTANCE_PROP_VALUES_KEY]
    if (typeof refId === 'string' && isRecord(values)) {
      const declared = context.componentProps?.[refId] ?? {}
      for (const [name, value] of Object.entries(values)) {
        const type = declared[name] ?? 'text'
        if ((type === 'text' || type === 'richText') && typeof value === 'string') {
          samples.push({ at: id, text: value })
        }
      }
    }
  }
  return samples
}

/**
 * The props a heading, a subhead or a body text shows as a line a reader
 * reads, by element. A button's or a link's label, a form field's label, a
 * run of inline text inside a sentence and every accessible name are not
 * lines, and how they end is not held.
 */
const LINE_PROPS: Readonly<Record<string, readonly string[]>> = {
  muiTypography: ['children'],
  muiListItemText: ['primary', 'secondary'],
  muiCardHeader: ['title', 'subheader'],
  muiAccordionSummary: ['children'],
  emailText: ['children'],
}

/** Text styles that label rather than say: a caption, an overline, a micro label. */
const LABEL_VARIANTS = new Set(['caption', 'overline', 'micro'])

/**
 * Words no finished line ends on: an article, or a conjunction that joins two
 * parts. "a" counts only in lowercase, since "Plan A" ends on a name.
 */
const DANGLING_WORDS = new Set(['an', 'the', 'and', 'or', 'but', 'nor', '&'])

/**
 * Words that open a phrase. A title may end on one it strands, as "What we
 * help with" does, but a line that ends on one right after a comma or a dash
 * opened a phrase it never wrote: "…that matter most, with".
 */
const OPENING_WORDS = new Set([
  'about',
  'across',
  'after',
  'against',
  'along',
  'among',
  'as',
  'at',
  'because',
  'before',
  'between',
  'by',
  'for',
  'from',
  'if',
  'in',
  'into',
  'like',
  'of',
  'on',
  'onto',
  'since',
  'so',
  'than',
  'that',
  'through',
  'to',
  'toward',
  'towards',
  'unless',
  'until',
  'upon',
  'via',
  'when',
  'where',
  'whereas',
  'while',
  'with',
  'within',
  'without',
])

/** A line that closes itself: a sentence's end, a closing quote or bracket, or a colon that introduces what follows. */
const CLOSED_LINE = /[.!?…:;"'”’»)\]]$/

/**
 * The word a line ends on when that word leaves it unfinished (AGL-3072), or
 * `null`. A line that closes itself, ends on a binding or a bracketed fact the
 * member fills, or ends on any other word, is finished as far as a check can
 * tell. Exported for the specs that hold the closed list.
 */
export function aiDanglingWord(line: string): string | null {
  const text = line.trim()
  if (!text || CLOSED_LINE.test(text)) return null
  const word = /(?:^|[^A-Za-z&'’])([A-Za-z]+|&)$/.exec(text)?.[1]
  if (!word) return null
  const lower = word.toLowerCase()
  if (word === 'a' || DANGLING_WORDS.has(lower)) return word
  // A comma, a semicolon or a dash breaks the line before the word; the hyphen
  // of "Drop-in" or "Add-on" joins one word and breaks nothing.
  const before = text.slice(0, text.length - word.length)
  return OPENING_WORDS.has(lower) && /(?:[,;—–]|\s-)\s*$/.test(before) ? word : null
}

/** The last words of a line, as a re-ask quotes them. */
function lineTail(line: string): string {
  const words = line.trim().split(/\s+/)
  return words.length > 6 ? `…${words.slice(-6).join(' ')}` : words.join(' ')
}

/**
 * Rule 14, for a line cut short (AGL-3072). Copy in the site's voice is
 * finished copy: a heading, a subhead or a body text that ends on an article
 * or a joining conjunction, or on a word that opens a phrase right after a
 * comma, with no closing punctuation, reads as a sentence cut off mid-thought.
 * A live About page's hero subhead ended "…that matter most, with". A closed
 * list of words, on the lines a reader reads, keeps it deterministic: a
 * label, a button, a caption and a bracketed fact are never held to it.
 */
export function detectDanglingWords(tree: AiDoctrineTree): AiDoctrineViolation[] {
  const found: Array<{ id: string; line: string; word: string }> = []
  for (const { id, node } of walkTree(tree)) {
    const props = LINE_PROPS[node.componentId]
    if (!props) continue
    if (node.componentId === 'muiTypography' && LABEL_VARIANTS.has(String(node.props?.['variant'] ?? ''))) continue
    if (node.componentId === 'emailText' && node.props?.['variant'] === 'caption') continue
    for (const name of props) {
      const line = node.props?.[name]
      const word = typeof line === 'string' ? aiDanglingWord(line) : null
      if (word) found.push({ id, line: line as string, word })
    }
  }
  if (!found.length) return []
  const [first] = found
  return [
    {
      rule: 14,
      code: 'dangling-word',
      message: `"${lineTail(first.line)}" has no closing punctuation, and its last word, "${first.word}", leaves the sentence unfinished. Finish the sentence, or end the line before "${first.word}".`,
      nodeIds: unique(found.map((entry) => entry.id)),
    },
  ]
}

/** The labels a button or a link shows, beside the lines: cut, they read as broken too. */
const LABEL_PROPS: Readonly<Record<string, readonly string[]>> = {
  muiButton: ['children'],
  muiScreenLink: ['children'],
  emailButton: ['children'],
}

/** The line the palette validator writes when it cuts a prop at its ceiling. */
const CUT_REPAIR = /^(.+)\.([A-Za-z0-9_]+) was over (\d+) characters; truncated$/

/** The first words of a line, as a re-ask quotes them. */
function lineHead(line: string): string {
  const words = line.trim().split(/\s+/)
  return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : words.join(' ')
}

/**
 * Rule 14, for a line cut at its ceiling (AGL-3076). The palette validator
 * holds copy to a ceiling for its role and cuts what runs past it, and says so
 * only in its repairs. A cut line is unfinished wherever the cut falls, after
 * a word or inside one, and a heading style's ceiling of
 * `AI_TEXT_LIMITS.headline` characters is one the catalog never shows a model:
 * a live About page's hero subhead, a Typography in the h5 style, was cut at
 * 120 characters to "…that matter most, with". So a heading, a subhead, a body
 * line, or a button's or a link's label the validator cut is refused, with a
 * re-ask naming the ceiling.
 *
 * `repairs` are the palette validator's, naming nodes by the ids of the tree
 * it was given, `written`; `idOf` turns such an id into the id the violation
 * names.
 */
export function detectCutLines(
  repairs: readonly string[],
  written: Readonly<Record<string, unknown>>,
  idOf: (id: string) => string = (id) => id,
): AiDoctrineViolation[] {
  const cut: Array<{ id: string; line: string; limit: number; heading: boolean }> = []
  for (const repair of repairs) {
    const match = CUT_REPAIR.exec(repair)
    if (!match) continue
    const [, nodeId, name, limit] = match
    const node = written[nodeId]
    if (!isRecord(node) || typeof node['componentId'] !== 'string') continue
    const props = isRecord(node['props']) ? node['props'] : {}
    const shown = LINE_PROPS[node['componentId']] ?? LABEL_PROPS[node['componentId']] ?? []
    const line = props[name]
    if (!shown.includes(name) || typeof line !== 'string') continue
    cut.push({
      id: idOf(nodeId),
      line,
      limit: Number(limit),
      heading: node['componentId'] === 'muiTypography' && isHeadlineVariant(props['variant']),
    })
  }
  if (!cut.length) return []
  const [first] = cut
  const message = first.heading
    ? `A line in a heading style holds at most ${first.limit} characters, and "${lineHead(first.line)}" runs past them, so it was cut off where they end. Write it whole within ${first.limit} characters, or give a longer line a subtitle or body style.`
    : `"${lineHead(first.line)}" runs past the ${first.limit} characters its element holds, so it was cut off where they end. Write it whole within ${first.limit} characters.`
  return [{ rule: 14, code: 'copy-cut-at-ceiling', message, nodeIds: unique(cut.map((entry) => entry.id)) }]
}

const PURE_CONTAINERS = new Set(['muiBox', 'muiStack', 'muiContainer', 'muiGrid', 'section'])
const EMBED_COMPONENTS = new Set(['videoEmbed', 'custom-html', 'functionWidget'])
const DUPLICATE_SX_MIN_KEYS = 2
const DUPLICATE_SX_MIN_NODES = 4

/**
 * Rule 16. The flattest tree that renders the design: no container that
 * wraps one other container and adds nothing, no empty containers, no inline
 * style repeated where a token or a component prop would carry it, no font
 * beyond the theme's, images lazy below the first, video by poster rather
 * than autoplay, and no third-party embed the plan did not name.
 */
export function detectHeavyDocument(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  context: AiDoctrineTreeContext = {},
): AiDoctrineViolation[] {
  const visits = walkTree(tree)
  const wrappers: string[] = []
  const empty: string[] = []
  const fonts: string[] = []
  const eager: string[] = []
  const video: string[] = []
  const embeds: string[] = []
  const sxSeen = new Map<string, string[]>()
  let images = 0
  for (const { id, node } of visits) {
    const entry = AI_PALETTE[node.componentId]
    const children = (node.nodes ?? []).filter((child) => tree.nodes[child])
    const ownProps = Object.entries(node.props ?? {}).filter(
      ([name, value]) => !(name === 'component' && value === 'div'),
    )
    if (
      id !== tree.rootId &&
      PURE_CONTAINERS.has(node.componentId) &&
      children.length === 1 &&
      PURE_CONTAINERS.has(tree.nodes[children[0]].componentId) &&
      !ownProps.length &&
      !Object.keys(node.sx ?? {}).length
    ) {
      wrappers.push(id)
    }
    const boundForm = node.componentId === 'form' && typeof node.props?.['formId'] === 'string'
    if (entry?.acceptsChildren && !children.length && !boundForm) empty.push(id)
    if (outputKind !== 'email' && node.sx?.['fontFamily'] !== undefined) fonts.push(id)
    if (node.componentId === 'image') {
      images += 1
      if (images > 1 && node.props?.['loading'] === 'eager') eager.push(id)
    }
    if (
      node.componentId === 'video' &&
      (node.props?.['autoPlay'] === true ||
        node.props?.['preload'] === 'auto' ||
        (typeof node.props?.['src'] === 'string' && node.props['src'] && !node.props?.['poster']))
    ) {
      video.push(id)
    }
    if (EMBED_COMPONENTS.has(node.componentId) && !context.allowEmbeds) embeds.push(id)
    const sx = node.sx ?? {}
    if (Object.keys(sx).length >= DUPLICATE_SX_MIN_KEYS) {
      const key = JSON.stringify(Object.keys(sx).sort().map((name) => [name, sx[name]]))
      sxSeen.set(key, [...(sxSeen.get(key) ?? []), id])
    }
  }
  const duplicatedSx = [...sxSeen.values()]
    .filter((ids) => ids.length >= DUPLICATE_SX_MIN_NODES)
    .flat()
  const violations: AiDoctrineViolation[] = []
  const add = (code: string, ids: string[], message: string) => {
    if (ids.length) violations.push({ rule: 16, code, message, nodeIds: ids })
  }
  add(
    'wrapper-in-wrapper',
    wrappers,
    'A container wraps a single container and adds nothing. Remove the outer one.',
  )
  add('empty-container', empty, 'An element meant to hold content is empty. Remove it, or fill it.')
  add(
    'duplicated-inline-style',
    duplicatedSx,
    'The same inline style repeats across elements. Carry it in a theme token or a component prop, once.',
  )
  add('extra-font', fonts, "This names a font the theme does not load. Use the theme's typography.")
  add(
    'eager-image',
    eager,
    'An image below the first loads eagerly. Leave loading unset so images further down the page load when they are reached.',
  )
  add(
    'autoplay-video',
    video,
    'A video loads its file before anyone plays it. Give it a poster, and let it play on click.',
  )
  add(
    'third-party-embed',
    embeds,
    'This embeds a third-party player or script, which loads its own code on every visit. Use a Video from the media library, or name the embed and its cost in the plan.',
  )
  return violations
}

/** The items a list or a row of cards repeats, as a re-ask names them. */
const ITEM_NOUNS: Readonly<Record<string, string>> = { muiListItem: 'list item', muiCard: 'card' }

/** Elements that frame or space what they hold and show nothing of their own. */
const FRAME_COMPONENTS = new Set([
  'div',
  'section',
  'muiBox',
  'muiStack',
  'muiContainer',
  'muiGrid',
  'muiPaper',
  'muiCard',
  'muiCardContent',
  'muiCardActions',
  'muiListItem',
  'muiAccordion',
  'muiAccordionDetails',
])

/** Elements that show only their words, by the props that hold them. */
const WORD_PROPS: Readonly<Record<string, readonly string[]>> = {
  ...LINE_PROPS,
  muiList: ['subheader'],
  muiInlineText: ['children'],
  muiButton: ['children'],
  muiScreenLink: ['children'],
}

/** Whether a node shows anything of its own: its words, or whatever an element that is neither a frame nor words draws. */
function showsOwn(node: AiDoctrineNode): boolean {
  const words = WORD_PROPS[node.componentId]
  if (words) return words.some((name) => isFilled(node.props?.[name]))
  return !FRAME_COMPONENTS.has(node.componentId)
}

/**
 * Rule 16, for an item with nothing in it (AGL-3072). A list item or a card
 * that holds elements, none of which shows a word, a picture or anything
 * else, is an empty row or an empty box on the page: a live About page's list
 * of estate planning services ended on a List Item whose List Item Text had
 * no words. An item that holds no element at all is `empty-container`'s, and
 * is not reported twice.
 */
export function detectEmptyItems(tree: AiDoctrineTree): AiDoctrineViolation[] {
  const empty: Array<{ id: string; noun: string }> = []
  for (const { id, node } of walkTree(tree)) {
    const noun = ITEM_NOUNS[node.componentId]
    if (!noun || !(node.nodes ?? []).some((child) => tree.nodes[child])) continue
    if (!walkTree({ rootId: id, nodes: tree.nodes }).some((inner) => showsOwn(inner.node))) {
      empty.push({ id, noun })
    }
  }
  if (!empty.length) return []
  const nouns = unique(empty.map((entry) => entry.noun))
  const message =
    nouns.length > 1
      ? 'A list item and a card hold nothing to read or see. Give each its words, or take it out.'
      : nouns[0] === 'list item'
        ? 'A list item holds no words, so its row shows empty. Write the words of its List Item Text, or take the item out.'
        : 'A card holds nothing to read or see. Give it its words, or take the card out.'
  return [{ rule: 16, code: 'empty-item', message, nodeIds: empty.map((entry) => entry.id) }]
}

// ── Rule 17: the budget, measured ────────────────────────────────────────

export interface AiOutputScore {
  nodes: number
  /** The stored node map, in the save's own bytes. */
  bytes: number
  /** What the placed library images request, from their recorded sizes. */
  imageBytes: number
  /** Placed images the media library could not size: hot-linked, or no facts supplied. */
  imagesUnmeasured: number
  embeds: number
  fontFamilies: number
  /** An email's rendered HTML; `null` for every other output. */
  emailHtmlBytes: number | null
}

const EMAIL_COLUMN_PX = 600
const MEDIA_IMAGE_PROPS: Record<string, readonly string[]> = {
  image: ['src'],
  emailImage: ['src'],
  video: ['poster'],
  collectionEntryAuthor: ['image'],
  contentAuthorProfile: ['image'],
}

/** The variant a slot of this width is served. */
function servedVariantWidth(slotWidth: number | null): number {
  const widest = MEDIA_CDN_VARIANT_WIDTHS[MEDIA_CDN_VARIANT_WIDTHS.length - 1]
  if (!slotWidth) return widest
  return MEDIA_CDN_VARIANT_WIDTHS.find((width) => width >= slotWidth) ?? widest
}

function pixels(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function imageRequests(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  context: AiDoctrineTreeContext,
): Array<{ id: string; bytes: number | null }> {
  const requests: Array<{ id: string; bytes: number | null }> = []
  for (const { id, node } of walkTree(tree)) {
    const named = MEDIA_IMAGE_PROPS[node.componentId] ?? []
    const values = mediaValues(node, context).filter(
      ({ name }) =>
        named.includes(name) || name.startsWith(`${REUSABLE_INSTANCE_PROP_VALUES_KEY}.`),
    )
    for (const { value } of values) {
      const ref = parseMediaRef(value)
      const facts = ref ? context.assets?.[ref.mediaId] : undefined
      if (!facts?.sizeBytes) {
        requests.push({ id, bytes: null })
        continue
      }
      const slot = pixels(node.props?.['width'])
      const variant = servedVariantWidth(
        outputKind === 'email' ? Math.min(slot ?? EMAIL_COLUMN_PX, EMAIL_COLUMN_PX) : slot,
      )
      // A variant is the original scaled down, so its bytes scale with its
      // area; a variant wider than the original is the original.
      const ratio = facts.width ? Math.min(1, variant / facts.width) : 1
      requests.push({ id, bytes: Math.round(facts.sizeBytes * ratio * ratio) })
    }
  }
  return requests
}

/** The rule-17 measurements of one validated tree. */
export function scoreAiOutput(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  context: AiDoctrineTreeContext = {},
): AiOutputScore {
  const visits = walkTree(tree)
  const images = imageRequests(tree, outputKind, context)
  const families = new Set<string>()
  for (const { node } of visits) {
    for (const family of sxValues(node.sx?.['fontFamily'])) {
      if (typeof family === 'string' && family.trim()) families.add(family.trim().toLowerCase())
    }
  }
  let emailHtmlBytes: number | null = null
  if (outputKind === 'email') {
    const { html } = renderEmailHtml({
      nodes: tree.nodes as Parameters<typeof renderEmailHtml>[0]['nodes'],
      rootId: tree.rootId,
      sanitize: (value: string) => sanitizeAuthorHtml(value),
    })
    emailHtmlBytes = new TextEncoder().encode(html).length
  }
  return {
    nodes: visits.length,
    bytes: nodeMapBytes(tree.nodes),
    imageBytes: images.reduce((sum, image) => sum + (image.bytes ?? 0), 0),
    imagesUnmeasured: images.filter((image) => image.bytes === null).length,
    embeds: visits.filter(({ node }) => EMBED_COMPONENTS.has(node.componentId)).length,
    fontFamilies: families.size,
    emailHtmlBytes,
  }
}

const METRIC_LABELS: Record<AiBudgetMetric, string> = {
  nodes: 'elements',
  bytes: 'stored size',
  imageBytes: 'image weight',
  embeds: 'third-party embeds',
  fontFamilies: 'extra font families',
  emailHtmlBytes: `rendered size (mail clients clip past ${formatBytes(AI_EMAIL_CLIP_BYTES)})`,
}

function figure(metric: AiBudgetMetric, value: number): string {
  return metric === 'nodes' || metric === 'embeds' || metric === 'fontFamilies'
    ? value.toLocaleString('en-US')
    : formatBytes(value)
}

/** The parts of a tree that weigh most under one metric, heaviest first. */
function heaviest(
  metric: AiBudgetMetric,
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
  context: AiDoctrineTreeContext,
): string[] {
  switch (metric) {
    case 'bytes':
    case 'emailHtmlBytes':
      return measureNodeMap(tree.nodes).largest.map((entry) => entry.id)
    case 'nodes': {
      const index = indexShapes(tree)
      return index.visits
        .filter((visit) => visit.depth >= 1 && visit.depth <= 2)
        .sort((a, b) => (index.sizeOf.get(b.id) ?? 0) - (index.sizeOf.get(a.id) ?? 0))
        .slice(0, 3)
        .map((visit) => visit.id)
    }
    case 'imageBytes':
      return imageRequests(tree, outputKind, context)
        .filter((image) => image.bytes !== null)
        .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
        .slice(0, 3)
        .map((image) => image.id)
    case 'embeds':
      return walkTree(tree)
        .filter(({ node }) => EMBED_COMPONENTS.has(node.componentId))
        .map((visit) => visit.id)
    case 'fontFamilies':
      return walkTree(tree)
        .filter(({ node }) => node.sx?.['fontFamily'] !== undefined)
        .map((visit) => visit.id)
  }
}

const BUDGET_METRICS: readonly AiBudgetMetric[] = [
  'nodes',
  'bytes',
  'imageBytes',
  'embeds',
  'fontFamilies',
  'emailHtmlBytes',
]

/**
 * Rule 17. An output over its kind's budget is refused with the figure, the
 * budget and the heaviest parts named, so the re-ask knows where to cut.
 */
export function detectOverBudget(
  score: AiOutputScore,
  outputKind: AiOutputKind,
  tree: AiDoctrineTree,
  context: AiDoctrineTreeContext = {},
): AiDoctrineViolation[] {
  const budget = AI_OUTPUT_BUDGETS[outputKind]
  const violations: AiDoctrineViolation[] = []
  for (const metric of BUDGET_METRICS) {
    const value = score[metric]
    const limit = budget[metric]
    if (value === null || limit === undefined || value <= limit) continue
    const offenders = heaviest(metric, tree, outputKind, context)
    const parts = offenders.length ? ` The heaviest parts: ${listNames(offenders, tree)}.` : ''
    violations.push({
      rule: 17,
      code: `over-budget-${metric}`,
      message: `This ${outputKind} measures ${figure(metric, value)} of ${METRIC_LABELS[metric]} against a budget of ${figure(metric, limit)}.${parts}`,
      nodeIds: offenders,
      figure: { metric, value, budget: limit },
    })
  }
  return violations
}

/**
 * What a first visit to a generated output is estimated to transfer.
 *
 * The page half is a MEASUREMENT the platform already holds, not a guess:
 * `ESTIMATED_PAGE_TRANSFER_BYTES` is the first-party weight a published page
 * measured at settle, which `check:page-view-rate` holds against the
 * tenant page budget and the bandwidth meter is priced from. The tenant's
 * real-user vitals (`web-vitals-rum.ts`) report to analytics per visit and
 * are not readable for a draft nobody has visited, so they are not a second
 * source here. On top of that weight go this output's own stored document
 * and the images it places. A component or a layout reports what it adds to
 * a page; an email is not a page load and has none.
 */
export function estimateAiOutputLoad(
  score: AiOutputScore,
  outputKind: AiOutputKind,
): AiLoadEstimate | null {
  if (outputKind === 'email') return null
  const pageBytes =
    outputKind === 'page' || outputKind === 'template' ? ESTIMATED_PAGE_TRANSFER_BYTES : 0
  return {
    pageBytes,
    documentBytes: score.bytes,
    imageBytes: score.imageBytes,
    imagesUnmeasured: score.imagesUnmeasured,
    embeds: score.embeds,
    totalBytes: Math.round(pageBytes + score.bytes + score.imageBytes),
  }
}

export interface AiDoctrineTreeReport {
  ok: boolean
  /** The palette validator's result: the tree to store, its repairs and its id map. */
  tree: Extract<AiNodeTreeResult, { ok: true }> | null
  violations: AiDoctrineViolation[]
  score: AiOutputScore | null
  load: AiLoadEstimate | null
}

/**
 * The whole check on one emitted tree: the palette validator first, then
 * every tree rule, then the budget. `otherPages` are the trees generated
 * beside this one, for the across-pages half of rule 1.
 */
export function validateAiDoctrineTree(
  input: unknown,
  outputKind: AiOutputKind,
  context: AiDoctrineTreeContext = {},
  otherPages: readonly AiDoctrineTree[] = [],
): AiDoctrineTreeReport {
  const validated = validateAiNodeTree(input, AI_OUTPUT_SURFACE[outputKind], context)
  const publish = detectPublishIntent(input)
  if (validated.ok === false) {
    return {
      ok: false,
      tree: null,
      violations: [
        {
          rule: null,
          code: `tree-${validated.code}`,
          message: `The answer could not be used as a ${outputKind}.`,
          detail: validated.error,
        },
        ...publish,
      ],
      score: null,
      load: null,
    }
  }
  const tree: AiDoctrineTree = {
    rootId: validated.rootId,
    nodes: validated.nodes as unknown as Record<string, AiDoctrineNode>,
  }
  // The validator's repairs name the nodes as they were written; every finding names the minted ids.
  const minted = new Map(Object.entries(validated.sourceIds).map(([id, source]) => [source, id]))
  const written = isRecord(input) && isRecord(input['nodes']) ? input['nodes'] : {}
  const violations = [
    ...publish,
    ...detectRepeatedSubtrees(tree, otherPages, context),
    ...detectLayoutRegions(tree, outputKind),
    ...detectInlineForms(tree, outputKind, context),
    ...detectLiteralStyles(tree, outputKind),
    ...detectInvisibleLinks(tree, outputKind),
    ...detectOffBrandEmail(tree, outputKind, context.brand),
    ...detectTypedData(tree),
    ...detectImageSources(tree, context),
    ...detectUnrelatedScreenLinks(tree, outputKind, context),
    ...detectLinksWithoutDestination(tree, outputKind),
    ...detectDocumentStructure(tree, outputKind),
    ...detectAdHocWidths(tree, outputKind),
    ...detectUnresponsiveGrids(tree, outputKind),
    ...detectOffVoiceCopy(aiTreeCopy(tree, context), context.framing),
    ...detectCutLines(validated.repairs, written, (id) => minted.get(id) ?? id),
    ...detectDanglingWords(tree),
    ...detectHeavyDocument(tree, outputKind, context),
    ...detectEmptyItems(tree),
  ]
  const score = scoreAiOutput(tree, outputKind, context)
  violations.push(...detectOverBudget(score, outputKind, tree, context))
  return {
    ok: violations.length === 0,
    tree: validated,
    violations,
    score,
    load: estimateAiOutputLoad(score, outputKind),
  }
}

// ── Plans ────────────────────────────────────────────────────────────────

type RecordKind =
  | 'component'
  | 'layout'
  | 'template'
  | 'form'
  | 'dataset'
  | 'collection'
  | 'screen'

const NAME_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'for',
  'to',
  'our',
  'your',
  'my',
  'us',
  'we',
  'page',
  'pages',
  'section',
  'new',
  'site',
  'block',
  'main',
])

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) =>
      word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word,
    )
    .filter((word) => !NAME_STOPWORDS.has(word))
}

/**
 * Whether two names name the same thing: the same words once filler is
 * dropped, or every word of a name of two or more words inside the other.
 */
export function aiNamesMatch(left: string, right: string): boolean {
  const a = new Set(nameTokens(left))
  const b = new Set(nameTokens(right))
  if (!a.size || !b.size) return false
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  return (
    [...small].every((word) => large.has(word)) &&
    (small.size === large.size || small.size >= 2)
  )
}

function inventoryKinds(inventory: AiSiteInventory | null): Map<string, RecordKind> {
  const kinds = new Map<string, RecordKind>()
  if (!inventory) return kinds
  const add = (rows: Array<{ id: string }>, kind: RecordKind) => {
    for (const row of rows) kinds.set(row.id, kind)
  }
  add(inventory.components, 'component')
  add(inventory.layouts, 'layout')
  add(inventory.templates, 'template')
  add(inventory.forms, 'form')
  add(inventory.datasets, 'dataset')
  add(inventory.collections, 'collection')
  add(inventory.screens, 'screen')
  return kinds
}

/** What a plan reference resolves to: an inventory record's kind, or a creation's. */
function refKind(
  ref: string | null,
  plan: AiBuildPlan,
  kinds: Map<string, RecordKind>,
): RecordKind | AiBuildPlanCreateKind | null {
  if (!ref) return null
  if (isAiPlanNewRef(ref)) return aiPlanCreateFor(plan, ref)?.kind ?? null
  return kinds.get(ref) ?? null
}

function sectionPaths(plan: AiBuildPlan) {
  return plan.screens.flatMap((screen, screenIndex) =>
    screen.sections.map((section, sectionIndex) => ({
      screen,
      screenIndex,
      section,
      path: `screens[${screenIndex}].sections[${sectionIndex}]`,
    })),
  )
}

const LAYOUT_REGION_NAME =
  /\b(?:site header|header|nav(?:igation)?|nav ?bar|footer|announcement(?: bar)?|cookie(?: notice| banner| consent)?|top ?bar)\b/i
const FORM_SECTION_NAME =
  /\bform\b|\bsign[- ]?up\b|\bsubscribe\b|\bnewsletter\b|\bcontact us\b|\b(?:get|request) a quote\b|\bregist(?:er|ration)\b|\b(?:en|in)quiry\b/i

/**
 * Rule 1 (plan): repeated items place a component, and a section two screens
 * share is one. A workspace that keeps no reusable components draws them in
 * their sections instead (AGL-3030), and nothing is refused.
 */
export function detectPlanRepeats(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  if (capabilities?.reusableComponents === false) return []
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  const placesComponent = (uses: string[]) =>
    uses.some((ref) => refKind(ref, plan, kinds) === 'component')
  const bound = (uses: string[]) =>
    uses.some((ref) => ['dataset', 'collection'].includes(String(refKind(ref, plan, kinds))))
  const repeated = sectionPaths(plan).filter(
    ({ section }) =>
      section.items >= AI_REPEAT_MIN_COUNT && !placesComponent(section.uses) && !bound(section.uses),
  )
  if (repeated.length) {
    violations.push({
      rule: 1,
      code: 'plan-repeated-items',
      message:
        'A section repeats items without a component. Plan one reusable component for the item, reuse one the site has, or bind the items to data.',
      paths: repeated.map((entry) => entry.path),
    })
  }
  const byName = new Map<string, ReturnType<typeof sectionPaths>>()
  for (const entry of sectionPaths(plan)) {
    const key = nameTokens(entry.section.name).join(' ')
    if (!key || LAYOUT_REGION_NAME.test(entry.section.name)) continue
    byName.set(key, [...(byName.get(key) ?? []), entry])
  }
  for (const entries of byName.values()) {
    const screens = new Set(entries.map((entry) => entry.screenIndex))
    if (screens.size < 2) continue
    const shared = entries
      .map((entry) => entry.section.uses.filter((ref) => refKind(ref, plan, kinds) === 'component'))
      .reduce((common, refs) => common.filter((ref) => refs.includes(ref)))
    if (shared.length) continue
    violations.push({
      rule: 1,
      code: 'plan-section-across-screens',
      message: `The "${entries[0].section.name}" section is planned on ${screens.size} screens. Plan it as one reusable component and place it on each.`,
      paths: entries.map((entry) => entry.path),
    })
  }
  return violations
}

/** The fewest sections of one item, side by side and of one kind, that are one list split apart. */
export const AI_SPLIT_LIST_MIN_SECTIONS = 2

/** A section name's label: what comes before a colon or a spaced dash, as "practice area" in "practice area: family law". */
const SECTION_LABEL = /^(.+?)\s*(?::|\s[-–—])\s*\S/

/** A name for many of what a name names one of. */
function pluralOf(name: string): string {
  const words = name.trim()
  if (/s$/i.test(words)) return words
  return /[^aeiou]y$/i.test(words) ? `${words.slice(0, -1)}ies` : `${words}s`
}

/**
 * What kind of item a section of one item shows, for telling a list split
 * into sections apart from sections that each show one different thing: the
 * components it places, else the label its name gives the item. `null` when
 * neither says, or when the section binds its item to data.
 */
function sectionItemKind(
  section: AiBuildPlanSection,
  plan: AiBuildPlan,
  kinds: Map<string, RecordKind>,
  inventory: AiSiteInventory | null,
): { key: string; name: string; components: string[] } | null {
  if (section.uses.some((ref) => ['dataset', 'collection'].includes(String(refKind(ref, plan, kinds))))) return null
  const label = SECTION_LABEL.exec(section.name)?.[1]?.trim() ?? ''
  const components = section.uses.filter((ref) => refKind(ref, plan, kinds) === 'component')
  if (components.length) {
    const [first] = components
    const named = isAiPlanNewRef(first)
      ? aiPlanCreateFor(plan, first)?.name
      : inventory?.components.find((row) => row.id === first)?.name
    return {
      key: `component:${components.map((ref) => ref.toLowerCase()).sort().join('|')}`,
      name: pluralOf(label || named || first),
      components,
    }
  }
  const words = nameTokens(label).join(' ')
  return words ? { key: `label:${words}`, name: pluralOf(label), components: [] } : null
}

/**
 * Rule 1 (plan): a list is one section whose items repeat (AGL-3071). A
 * section's `items` counts what it repeats, so two or more sections side by
 * side that each show one item of the same kind — the same component, or a
 * name that labels the same kind of item — are one list split apart. A live
 * Free About page planned "the four areas we practice" as four sections of one
 * item: none was drawn from the one written-once item a repeated section is
 * built from, and the four came out in three different shapes. The re-ask
 * names the sections and gives the one section to plan instead. Where the
 * workspace keeps reusable components, a list long enough for rule 1 places
 * one for its item, so the section it gives places one too.
 *
 * Sections of several items are never joined: two lists that share a card
 * are two lists, and rule 8 counts each within its own section (AGL-3061).
 */
export function detectPlanSplitLists(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  plan.screens.forEach((screen, screenIndex) => {
    let run: Array<{ index: number; kind: NonNullable<ReturnType<typeof sectionItemKind>> }> = []
    const close = () => {
      if (run.length >= AI_SPLIT_LIST_MIN_SECTIONS) {
        const names = run.map(({ index }) => `"${screen.sections[index].name}"`)
        const listed = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        const [{ kind }] = run
        // Rule 1 asks a list this long on a workspace that keeps components to place one for its item.
        const component =
          !kind.components.length && capabilities?.reusableComponents !== false && run.length >= AI_REPEAT_MIN_COUNT
        const section = { name: kind.name, uses: component ? ['new:<name>'] : kind.components, items: run.length }
        const instead = component
          ? `, placing one reusable component for the item: reuse one the site has by its id, or declare one in create and place it as new:<name>, as in ${JSON.stringify(section)}.`
          : `: ${JSON.stringify(section)}.`
        violations.push({
          rule: 1,
          code: 'plan-split-list',
          message: `The sections ${listed} each show one item of the same kind, so they are one list split apart. Plan them as one section whose ${run.length} items repeat${instead}`,
          paths: run.map(({ index }) => `screens[${screenIndex}].sections[${index}]`),
        })
      }
      run = []
    }
    screen.sections.forEach((section, index) => {
      const kind = section.items === 1 ? sectionItemKind(section, plan, kinds, inventory) : null
      if (!kind || (run.length && run[0].kind.key !== kind.key)) close()
      if (kind) run.push({ index, kind })
    })
    close()
  })
  return violations
}

/** Where the plan's sections place a record of one kind, as `screens[0].sections[1].uses[0]`. */
function placementsOf(
  plan: AiBuildPlan,
  kinds: Map<string, RecordKind>,
  kind: RecordKind,
): string[] {
  return sectionPaths(plan).flatMap(({ section, path }) =>
    section.uses.flatMap((ref, index) =>
      refKind(ref, plan, kinds) === kind ? [`${path}.uses[${index}]`] : [],
    ),
  )
}

/**
 * Rule 2 (plan): every screen declares a layout, no section is a copy of a
 * layout region, and no section places a layout, which frames a whole screen
 * (AGL-3040). A site with no layout, where this job may not create one
 * (AGL-3030), has nothing to declare: its screens name none, and a screen
 * that names none is not refused there. A screen whose layout is a `new:`
 * reference the plan never creates is refused here, and only here.
 */
export function detectPlanLayoutRegions(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  const mayCreateLayout = !capabilities || capabilities.create.layout.allowed
  const noLayoutToName = !mayCreateLayout && !(inventory?.layouts.length ?? 0)
  const unlaid = plan.screens
    .map((screen, index) => ({ screen, index }))
    .filter(
      ({ screen }) =>
        refKind(screen.layout, plan, kinds) !== 'layout' &&
        !(noLayoutToName && screen.layout === null),
    )
  if (unlaid.length) {
    violations.push({
      rule: 2,
      code: 'plan-screen-without-layout',
      message: noLayoutToName
        ? 'A screen names a layout the site does not have, and this job may not create one. Leave the layout empty.'
        : mayCreateLayout
          ? "A screen names no layout the site has or the plan creates. Put every screen in the site's layout, or plan one."
          : 'A screen names no layout the site has, and this job may not create one. Put every screen in a layout the site has.',
      paths: unlaid.map(({ index }) => `screens[${index}].layout`),
    })
  }
  const regions = sectionPaths(plan).filter(({ section }) =>
    LAYOUT_REGION_NAME.test(section.name),
  )
  if (regions.length) {
    violations.push({
      rule: 2,
      code: 'plan-layout-region-section',
      message:
        'A screen plans its own header, navigation or footer. Those live in the layout; take the section off the screen.',
      paths: regions.map((entry) => entry.path),
    })
  }
  const placed = placementsOf(plan, kinds, 'layout')
  if (placed.length) {
    violations.push({
      rule: 2,
      code: 'plan-layout-in-section',
      message:
        "A section places a layout. A layout frames a whole screen and is never placed inside one: name it as the screen's layout, and take it out of the section's uses.",
      paths: placed,
    })
  }
  return violations
}

/**
 * Rule 3 (plan): a section that collects answers places a form from the Forms
 * page. A workspace that keeps no saved forms draws the form on the page
 * (AGL-3030), and nothing is refused.
 */
export function detectPlanInlineForms(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  if (capabilities?.reusableComponents === false) return []
  const kinds = inventoryKinds(inventory)
  const unbound = sectionPaths(plan).filter(
    ({ section }) =>
      FORM_SECTION_NAME.test(section.name) &&
      !section.uses.some((ref) => refKind(ref, plan, kinds) === 'form'),
  )
  return unbound.length
    ? [
        {
          rule: 3,
          code: 'plan-form-not-placed',
          message:
            'A section collects answers without a form. Reuse a form from the Forms page, or plan one there, and place it by id.',
          paths: unbound.map((entry) => entry.path),
        },
      ]
    : []
}

/** Pages sharing one shape this many times are a template applied. */
export const AI_SIMILAR_PAGES_MIN = 3

/**
 * Rule 4 (plan): three or more screens with the same sections share one
 * template, and a template is what a screen applies, never what one of its
 * sections places (AGL-3040).
 */
export function detectUntemplatedSimilarPages(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null = null,
): AiDoctrineViolation[] {
  const groups = new Map<string, number[]>()
  plan.screens.forEach((screen, index) => {
    if (screen.sections.length < 2) return
    const signature = screen.sections
      .map((section) => nameTokens(section.name).join(' '))
      .join('|')
    groups.set(signature, [...(groups.get(signature) ?? []), index])
  })
  const violations: AiDoctrineViolation[] = []
  for (const indexes of groups.values()) {
    if (indexes.length < AI_SIMILAR_PAGES_MIN) continue
    const templates = new Set(indexes.map((index) => plan.screens[index].template))
    if (templates.size === 1 && !templates.has(null)) continue
    violations.push({
      rule: 4,
      code: 'plan-similar-pages',
      message: `${indexes.length} screens share one shape. Plan one template and apply it ${indexes.length} times with each page's copy, or bind it to a collection.`,
      paths: indexes.map((index) => `screens[${index}].template`),
    })
  }
  const placed = placementsOf(plan, inventoryKinds(inventory), 'template')
  if (placed.length) {
    violations.push({
      rule: 4,
      code: 'plan-template-in-section',
      message:
        "A section places a template. A template is applied to a whole screen and is never placed inside one: take it out of the section's uses, and name it as the screen's template only when the whole screen is built from it.",
      paths: placed,
    })
  }
  return violations
}

/** Rule 5 (plan): a color value belongs only in a theme change. */
export function detectPlanLiteralColors(plan: AiBuildPlan): AiDoctrineViolation[] {
  const paths: string[] = []
  plan.create.forEach((entry, index) => {
    if (entry.kind === 'theme-change') return
    if (hasLiteralColor(entry.why) || entry.fields.some(hasLiteralColor)) {
      paths.push(`create[${index}]`)
    }
  })
  for (const { section, path } of sectionPaths(plan)) {
    if (hasLiteralColor(section.name)) paths.push(path)
  }
  return paths.length
    ? [
        {
          rule: 5,
          code: 'plan-literal-color',
          message:
            'The plan writes a color by value outside a theme change. Name theme tokens, and plan a theme change for a color the theme lacks.',
          paths,
        },
      ]
    : []
}

const REUSE_BEFORE_CREATE_KINDS: ReadonlySet<AiBuildPlanCreateKind> = new Set([
  'component',
  'layout',
  'form',
  'dataset',
])

/** Rule 7 (plan): reuse names real records, and a creation is an exception that says why. */
export function detectCreateBeforeReuse(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  const unknown = plan.reuse
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.kind !== 'theme' && kinds.get(entry.id) !== entry.kind)
  if (unknown.length) {
    violations.push({
      rule: 7,
      code: 'plan-reuse-unknown',
      message:
        'The plan reuses something the site does not have. Reuse only what the site inventory lists.',
      paths: unknown.map(({ index }) => `reuse[${index}]`),
    })
  }
  const unexplained = plan.create
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.why.trim())
  if (unexplained.length) {
    violations.push({
      rule: 7,
      code: 'plan-create-without-why',
      message: 'The plan creates something without saying why nothing the site has will do.',
      paths: unexplained.map(({ index }) => `create[${index}].why`),
    })
  }
  const rows: Record<string, Array<{ id: string; name: string }>> = {
    component: inventory?.components ?? [],
    layout: inventory?.layouts ?? [],
    form: inventory?.forms ?? [],
    dataset: inventory?.datasets ?? [],
  }
  plan.create.forEach((entry, index) => {
    if (!REUSE_BEFORE_CREATE_KINDS.has(entry.kind) || entry.duplicateOf) return
    const existing = rows[entry.kind].find((row) => aiNamesMatch(row.name, entry.name))
    if (!existing) return
    violations.push({
      rule: 7,
      code: 'plan-duplicates-existing',
      message: `The site already has a ${entry.kind} named "${existing.name}". Reuse it, or propose extending it, instead of creating "${entry.name}".`,
      paths: [`create[${index}]`],
    })
  })
  return violations
}

/**
 * Rule 7 (plan): a plan creates only what the request says this job may
 * create on this site (AGL-3030) — what the workspace's plan includes, what
 * the site has room for, and what the job builds itself. One violation a
 * creation, each saying why and what to do instead.
 */
export function detectPlanUncreatable(
  plan: AiBuildPlan,
  capabilities: AiPlanCapabilities | null,
): AiDoctrineViolation[] {
  if (!capabilities) return []
  return aiPlanUncreatable(plan, capabilities).map((entry) => ({
    rule: 7,
    code: 'plan-create-not-allowed',
    message: entry.message,
    paths: [entry.path],
  }))
}

/**
 * What a section most likely meant by a creation it places and the plan never
 * declares, so the refusal can name the way out: a form where the reference
 * or its section reads as one and the section places no form yet, otherwise
 * a component. Only the message reads it; the reference is refused whatever
 * it was meant to be.
 */
function undeclaredPlacementKind(
  name: string,
  section: AiBuildPlanSection,
  plan: AiBuildPlan,
  kinds: Map<string, RecordKind>,
): 'form' | 'component' {
  if (FORM_SECTION_NAME.test(name)) return 'form'
  const placesForm = section.uses.some((ref) => refKind(ref, plan, kinds) === 'form')
  return FORM_SECTION_NAME.test(section.name) && !placesForm ? 'form' : 'component'
}

/**
 * Rule 7 (plan): what a plan places, it reuses or it creates (AGL-3040). The
 * doctrine has a plan refer to what it creates as new:<name>, so a reference
 * that names no entry of the create list is a creation nothing builds. A page
 * kept with one stops at its first pass, sending the member to make that
 * creation by hand, which a workspace that cannot make it never can. Each is
 * refused with the one re-ask, once a name however often it is placed, and
 * says what to do on THIS workspace: declare the creation where the job may
 * make one more of that kind, and otherwise build the page without it, drawn
 * on the page or placed from what the site has. A screen's layout is rule
 * 2's (`plan-screen-without-layout`), and is not reported twice.
 */
export function detectPlanUndeclaredCreations(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const byName = new Map<string, AiPlanUndeclaredRef[]>()
  for (const ref of aiPlanUndeclaredRefs(plan)) {
    if (ref.field === 'layout') continue
    const key = ref.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), ref])
  }
  return [...byName.values()].map((refs): AiDoctrineViolation => {
    const [first] = refs
    const screen = plan.screens[first.screenIndex]
    const section = first.field === 'uses' ? screen.sections[first.sectionIndex] : null
    const kind: AiBuildPlanCreateKind = section
      ? undeclaredPlacementKind(first.name, section, plan, kinds)
      : 'template'
    const refused = capabilities ? aiPlanUncreatableKind(plan, kind, capabilities) : null
    const where = section
      ? `${section.name ? `The "${section.name}" section` : 'A section'} places a creation named "${first.name}", but the plan never creates it`
      : `${screen.title ? `The screen "${screen.title}"` : 'A screen'} applies a template named "${first.name}", but the plan never creates it`
    let message: string
    if (!refused) {
      const otherwise = section
        ? `place ${aiCreationNoun(kind)} the site already has by its id`
        : "leave the screen's template empty"
      message = `${where}. Declare it in create as ${aiCreationNoun(kind)}, with why nothing the site has will do, or ${otherwise}.`
    } else if (section) {
      message = `${where}, and ${refused.reason}. ${refused.instead} Take it out of the section's uses.`
    } else {
      message = `${where}, and ${refused.reason}. Leave the screen's template empty, or apply a template the site already has.`
    }
    return { rule: 7, code: 'plan-creation-undeclared', message, paths: refs.map((ref) => ref.path) }
  })
}

/**
 * Rule 8 (plan): long lists are bound, and a list the site already holds is
 * bound to it. Where this job may not create a dataset (AGL-3030), the way
 * out the refusal names is a shorter list rather than a dataset it would
 * only refuse next.
 */
export function detectPlanTypedData(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  const data = [...(inventory?.datasets ?? []), ...(inventory?.collections ?? [])]
  const typed: string[] = []
  const unbound: Array<{ path: string; name: string }> = []
  for (const { section, path } of sectionPaths(plan)) {
    const bindsData = section.uses.some((ref) =>
      ['dataset', 'collection'].includes(String(refKind(ref, plan, kinds))),
    )
    if (bindsData) continue
    if (section.items >= AI_TYPED_LIST_MIN_ITEMS) typed.push(path)
    const match = data.find((row) => aiNamesMatch(row.name, section.name))
    if (match) unbound.push({ path, name: match.name })
  }
  if (typed.length) {
    violations.push({
      rule: 8,
      code: 'plan-typed-list',
      message:
        capabilities && !capabilities.create.dataset.allowed
          ? `A section plans a long list of typed-out items. Bind it to a dataset or collection the site has, or plan fewer than ${AI_TYPED_LIST_MIN_ITEMS} items.`
          : 'A section plans a long list of typed-out items. Bind it to a dataset or collection, or plan a dataset for data the site does not have yet.',
      paths: typed,
    })
  }
  if (unbound.length) {
    violations.push({
      rule: 8,
      code: 'plan-existing-data-unbound',
      message: `The site already holds "${unbound[0].name}" as data. Bind the section to it instead of copying it into the page.`,
      paths: unbound.map((entry) => entry.path),
    })
  }
  return violations
}

const SLUG = /^\/?[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\/?$|^\/$/
export const AI_SEO_TITLE_MAX = 70
export const AI_SEO_DESCRIPTION_MAX = 170

function slugKey(slug: string): string {
  return slug.trim().toLowerCase().replace(/^\/+|\/+$/g, '')
}

/** Rule 10 (plan): every screen has a free, well-formed slug, an SEO title and description. */
export function detectMissingNavAndSeo(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): AiDoctrineViolation[] {
  const violations: AiDoctrineViolation[] = []
  const taken = new Map(
    (inventory?.screens ?? []).map((screen) => [slugKey(screen.slug), screen.name]),
  )
  const seen = new Set<string>()
  const badSlugs: string[] = []
  const collisions: string[] = []
  const seo: string[] = []
  plan.screens.forEach((screen, index) => {
    const key = slugKey(screen.slug)
    if (!screen.slug.trim() || !SLUG.test(screen.slug.trim())) {
      badSlugs.push(`screens[${index}].slug`)
    } else if (seen.has(key) || taken.has(key)) {
      collisions.push(`screens[${index}].slug`)
    }
    seen.add(key)
    if (!screen.seoTitle || screen.seoTitle.length > AI_SEO_TITLE_MAX) {
      seo.push(`screens[${index}].seoTitle`)
    }
    if (!screen.seoDescription || screen.seoDescription.length > AI_SEO_DESCRIPTION_MAX) {
      seo.push(`screens[${index}].seoDescription`)
    }
  })
  if (badSlugs.length) {
    violations.push({
      rule: 10,
      code: 'plan-slug',
      message:
        'A screen has no usable address. Give each one a slug of lowercase words joined by hyphens.',
      paths: badSlugs,
    })
  }
  if (collisions.length) {
    violations.push({
      rule: 10,
      code: 'plan-slug-taken',
      message:
        'A screen reuses an address the site or the plan already uses. Give each screen its own slug.',
      paths: collisions,
    })
  }
  if (seo.length) {
    violations.push({
      rule: 10,
      code: 'plan-seo',
      message: `A screen is missing its search title or description, or runs past ${AI_SEO_TITLE_MAX} and ${AI_SEO_DESCRIPTION_MAX} characters. Write both for every screen.`,
      paths: seo,
    })
  }
  return violations
}

/** Every piece of copy a plan carries, with its path. */
export function aiPlanCopy(plan: AiBuildPlan): AiCopySample[] {
  const samples: AiCopySample[] = []
  plan.screens.forEach((screen, index) => {
    samples.push({ at: `screens[${index}].title`, text: screen.title })
    samples.push({ at: `screens[${index}].seoTitle`, text: screen.seoTitle })
    samples.push({ at: `screens[${index}].seoDescription`, text: screen.seoDescription })
  })
  plan.create.forEach((entry, index) => {
    samples.push({ at: `create[${index}].name`, text: entry.name })
  })
  return samples
}

/** Rule 15 (plan): a screen or template like one the site has starts as its duplicate. */
export function detectMissedDuplicate(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  const unresolved: string[] = []
  plan.screens.forEach((screen, index) => {
    if (screen.duplicateOf) {
      if (kinds.get(screen.duplicateOf) !== 'screen') {
        unresolved.push(`screens[${index}].duplicateOf`)
      }
      return
    }
    const nearest = (inventory?.screens ?? []).find(
      (existing) => !existing.template && aiNamesMatch(existing.name, screen.title),
    )
    if (nearest) {
      violations.push({
        rule: 15,
        code: 'plan-missed-duplicate',
        message: `The site already has "${nearest.name}". Start the new screen from a duplicate of it, which keeps its bindings and SEO, and edit that.`,
        paths: [`screens[${index}].duplicateOf`],
      })
    }
  })
  plan.create.forEach((entry, index) => {
    if (entry.duplicateOf) {
      const kind = kinds.get(entry.duplicateOf)
      if (!kind || (kind !== entry.kind && !(entry.kind === 'template' && kind === 'screen'))) {
        unresolved.push(`create[${index}].duplicateOf`)
      }
      return
    }
    if (entry.kind !== 'template') return
    const nearest = (inventory?.templates ?? []).find((existing) =>
      aiNamesMatch(existing.name, entry.name),
    )
    if (nearest) {
      violations.push({
        rule: 15,
        code: 'plan-missed-duplicate',
        message: `The site already has the "${nearest.name}" template. Start from a duplicate of it and edit that.`,
        paths: [`create[${index}].duplicateOf`],
      })
    }
  })
  if (unresolved.length) {
    violations.push({
      rule: 15,
      code: 'plan-duplicate-unknown',
      message:
        'The plan duplicates something the site does not have. Duplicate only what the site inventory lists.',
      paths: unresolved,
    })
  }
  return violations
}

/** What each exchange of a Free page job comes to at its worst, in credits. */
export interface AiFreePageWorstCase {
  /** The page plan. */
  plan: number
  /** The one layout a Free plan includes, built first on a site with none (AGL-3031). */
  layout: number
  /** The first section pass, which writes the cached prefix. */
  firstSection: number
  /** Each later section pass, which reads it. */
  laterSection: number
  /** A page's listing. */
  listing: number
}

/**
 * The Free taste's wall at its worst (AGL-3030, AGL-3070): each exchange of a
 * Free page job in credits, every answer at its ceiling, as
 * `jobs/ai-job-free-page.spec.ts` derives them from the page plan and the
 * layout generation measured live and the requests as they stand. The spec
 * fails when a figure it derives moves and this does not, so the section cap
 * below cannot drift from the proof.
 */
export const AI_FREE_PAGE_WORST_CASE_CREDITS: Readonly<AiFreePageWorstCase> = {
  plan: 83,
  layout: 64,
  firstSection: 44,
  laterSection: 20,
  listing: 3,
}

/**
 * The most sections a Free job fits in `FREE_AI_TASTE_CREDITS_PER_MONTH` at
 * its worst: the plan, the layouts it builds first, a listing for each page
 * and the first section's pass, then as many later passes as the rest pays
 * for; none when that is already past the wall. A component or a form is never
 * a Free creation, since rule 7 refuses both on a workspace that keeps no
 * reusable components, so the wall's proof measures neither.
 */
export function aiFreePageSectionsWithin(
  creations: { layouts: number; pages?: number },
  credits: Readonly<AiFreePageWorstCase> = AI_FREE_PAGE_WORST_CASE_CREDITS,
): number {
  const before =
    credits.plan + creations.layouts * credits.layout + (creations.pages ?? 1) * credits.listing + credits.firstSection
  if (before > FREE_AI_TASTE_CREDITS_PER_MONTH) return 0
  return 1 + Math.floor((FREE_AI_TASTE_CREDITS_PER_MONTH - before) / credits.laterSection)
}

/**
 * The layouts a Free plan's job builds before its sections: the ones it
 * creates that the workspace may make, and on a site with no layout where it
 * may make one, the one rule 2 asks the plan to create.
 */
function freePlanLayouts(plan: AiBuildPlan, inventory: AiSiteInventory | null, capabilities: AiPlanCapabilities): number {
  const refused = aiPlanUncreatable(plan, capabilities).filter((entry) => entry.kind === 'layout').length
  const creates = plan.create.filter((entry) => entry.kind === 'layout').length - refused
  const needs = !(inventory?.layouts.length ?? 0) && capabilities.create.layout.allowed ? 1 : 0
  return Math.max(creates, needs)
}

/**
 * The Free wall (plan): a plan asks for no more sections than the Free taste
 * pays for at its worst beside what the job builds first (AGL-3070). A live
 * Free plan asked for eight sections beside its layout, where the wall's worst
 * case pays for six, and fit only because every exchange ran under its
 * ceiling; one that does not runs out of credits with its page half built. The
 * cap only lowers what a plan may ask for, from the same figures the wall is
 * proven with, so no plan the proof admits is refused. It is no building rule,
 * so it names none.
 */
export function detectPlanOverFreeWall(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null,
): AiDoctrineViolation[] {
  if (!capabilities?.freeTaste) return []
  const asked = plan.screens.reduce((sum, screen) => sum + screen.sections.length, 0)
  const layouts = freePlanLayouts(plan, inventory, capabilities)
  const pages = Math.max(plan.screens.length, 1)
  const fits = aiFreePageSectionsWithin({ layouts, pages })
  if (asked <= fits) return []
  const job = pages > 1 ? `a Free plan of ${pages} pages` : 'a Free page'
  const beside = layouts ? ` that creates ${layouts > 1 ? `${layouts} layouts` : 'its layout'}` : ''
  return [
    {
      rule: null,
      code: 'plan-over-free-wall',
      message: `This plan asks for ${asked} sections, and ${job}${beside} fits ${fits} in the ${FREE_AI_TASTE_CREDITS_PER_MONTH} AI credits a Free workspace has a month. Plan at most ${fits}: draw a list's repeated items in one section, and leave out a section the brief does not ask for.`,
      paths: plan.screens.map((_, index) => `screens[${index}].sections`),
    },
  ]
}

/**
 * Every plan rule, against the site inventory the plan was made from and,
 * where the job read them, what it may create there (AGL-3030). `null`
 * capabilities restrict nothing: the doctrine applies whole.
 */
export function validateAiBuildPlan(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  framing: AiCopyFraming = null,
  capabilities: AiPlanCapabilities | null = null,
): AiDoctrineViolation[] {
  return [
    ...detectPlanRepeats(plan, inventory, capabilities),
    ...detectPlanSplitLists(plan, inventory, capabilities),
    ...detectPlanOverFreeWall(plan, inventory, capabilities),
    ...detectPlanLayoutRegions(plan, inventory, capabilities),
    ...detectPlanInlineForms(plan, inventory, capabilities),
    ...detectUntemplatedSimilarPages(plan, inventory),
    ...detectPlanLiteralColors(plan),
    ...detectCreateBeforeReuse(plan, inventory),
    ...detectPlanUncreatable(plan, capabilities),
    ...detectPlanUndeclaredCreations(plan, inventory, capabilities),
    ...detectPlanTypedData(plan, inventory, capabilities),
    ...detectMissingNavAndSeo(plan, inventory),
    ...detectOffVoiceCopy(aiPlanCopy(plan), framing),
    ...detectMissedDuplicate(plan, inventory),
  ]
}
