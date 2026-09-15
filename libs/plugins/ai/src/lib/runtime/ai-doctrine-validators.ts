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
import { ESTIMATED_PAGE_TRANSFER_BYTES } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import { renderEmailHtml } from '@aglyn/shared-util-email/email-render'
import {
  aiPlanCreateFor,
  isAiPlanNewRef,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
} from '../model/ai-build-plan'
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
  /** The rule broken; `null` when the answer could not be read as the output at all. */
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
}

interface Visit {
  id: string
  node: AiDoctrineNode
  depth: number
  ancestors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every reachable node in document order, each once. */
function walkTree(tree: AiDoctrineTree): Visit[] {
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
 * because the card does, and the fix is the card.
 */
function repeatedShapes(
  tree: AiDoctrineTree,
  index: ShapeIndex,
  minNodes: number,
  minCount: number,
): Array<{ shape: string; ids: string[] }> {
  const byShape = new Map<string, string[]>()
  for (const visit of index.visits) {
    if (visit.id === tree.rootId) continue
    if ((index.sizeOf.get(visit.id) ?? 0) < minNodes) continue
    if (repeatedByData(tree, visit)) continue
    const shape = index.shapeOf.get(visit.id) as string
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
 */
export function detectRepeatedSubtrees(
  tree: AiDoctrineTree,
  otherPages: readonly AiDoctrineTree[] = [],
): AiDoctrineViolation[] {
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
 */
export function detectInlineForms(
  tree: AiDoctrineTree,
  outputKind: AiOutputKind,
): AiDoctrineViolation[] {
  if (outputKind === 'form' || outputKind === 'email') return []
  const loose: string[] = []
  const unbound: string[] = []
  const shadowed: string[] = []
  for (const visit of walkTree(tree)) {
    if (
      visit.node.componentId === 'formField' &&
      !hasAncestor(tree, visit, (node) => node.componentId === 'form')
    ) {
      loose.push(visit.id)
    }
    if (visit.node.componentId === 'form') {
      const bound = visit.node.props?.['formId']
      if (typeof bound !== 'string' || !bound) unbound.push(visit.id)
      else if ((visit.node.nodes ?? []).length) shadowed.push(visit.id)
    }
  }
  const violations: AiDoctrineViolation[] = []
  if (loose.length || unbound.length) {
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
 */
export function detectTypedData(tree: AiDoctrineTree): AiDoctrineViolation[] {
  const index = indexShapes(tree)
  const violations: AiDoctrineViolation[] = repeatedShapes(
    tree,
    index,
    AI_REPEAT_MIN_NODES - 1,
    AI_TYPED_LIST_MIN_ITEMS,
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

/** A heading's level: the element it renders as, else the variant's own. */
function headingLevel(node: AiDoctrineNode): number | null {
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
    .map((visit) => ({ id: visit.id, level: headingLevel(visit.node) }))
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
  const violations = [
    ...publish,
    ...detectRepeatedSubtrees(tree, otherPages),
    ...detectLayoutRegions(tree, outputKind),
    ...detectInlineForms(tree, outputKind),
    ...detectLiteralStyles(tree, outputKind),
    ...detectOffBrandEmail(tree, outputKind, context.brand),
    ...detectTypedData(tree),
    ...detectImageSources(tree, context),
    ...detectDocumentStructure(tree, outputKind),
    ...detectAdHocWidths(tree, outputKind),
    ...detectOffVoiceCopy(aiTreeCopy(tree, context), context.framing),
    ...detectHeavyDocument(tree, outputKind, context),
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

/** Rule 1 (plan): repeated items place a component, and a section two screens share is one. */
export function detectPlanRepeats(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): AiDoctrineViolation[] {
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

/** Rule 2 (plan): every screen declares a layout, and no section is a copy of a layout region. */
export function detectPlanLayoutRegions(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): AiDoctrineViolation[] {
  const kinds = inventoryKinds(inventory)
  const violations: AiDoctrineViolation[] = []
  const unlaid = plan.screens
    .map((screen, index) => ({ screen, index }))
    .filter(({ screen }) => refKind(screen.layout, plan, kinds) !== 'layout')
  if (unlaid.length) {
    violations.push({
      rule: 2,
      code: 'plan-screen-without-layout',
      message:
        "A screen names no layout the site has or the plan creates. Put every screen in the site's layout, or plan one.",
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
  return violations
}

/** Rule 3 (plan): a section that collects answers places a form from the Forms page. */
export function detectPlanInlineForms(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): AiDoctrineViolation[] {
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

/** Rule 4 (plan): three or more screens with the same sections share one template. */
export function detectUntemplatedSimilarPages(plan: AiBuildPlan): AiDoctrineViolation[] {
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

/** Rule 8 (plan): long lists are bound, and a list the site already holds is bound to it. */
export function detectPlanTypedData(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
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
        'A section plans a long list of typed-out items. Bind it to a dataset or collection, or plan a dataset for data the site does not have yet.',
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

/** Every plan rule, against the site inventory the plan was made from. */
export function validateAiBuildPlan(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
  framing: AiCopyFraming = null,
): AiDoctrineViolation[] {
  return [
    ...detectPlanRepeats(plan, inventory),
    ...detectPlanLayoutRegions(plan, inventory),
    ...detectPlanInlineForms(plan, inventory),
    ...detectUntemplatedSimilarPages(plan),
    ...detectPlanLiteralColors(plan),
    ...detectCreateBeforeReuse(plan, inventory),
    ...detectPlanTypedData(plan, inventory),
    ...detectMissingNavAndSeo(plan, inventory),
    ...detectOffVoiceCopy(aiPlanCopy(plan), framing),
    ...detectMissedDuplicate(plan, inventory),
  ]
}
