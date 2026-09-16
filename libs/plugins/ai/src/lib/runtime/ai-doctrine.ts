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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { parseAiBuildPlan, type AiBuildPlan } from '../model/ai-build-plan'
import {
  AI_INVENTORY_KINDS,
  AI_SITE_INVENTORY_MAX_CHARS,
  type AiInventoryKind,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import type { AiStepKind } from '../providers/catalog'
import type { AiProvider } from '../providers/contract'
import { aiModelForStep, type AiPluginSettings } from '../providers/routing'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  runAiRequest,
  type AiCompletion,
  type AiEffort,
  type AiMessage,
  type AiSystemBlock,
  type AiThinking,
  type AiTool,
  type AiUsage,
} from './ai-runtime'
import {
  aiDoctrineViolationText,
  detectPublishIntent,
  validateAiBuildPlan,
  validateAiDoctrineTree,
  type AiCopyFraming,
  type AiDoctrineTree,
  type AiDoctrineTreeContext,
  type AiDoctrineViolation,
  type AiOutputScore,
} from './ai-doctrine-validators'
import type { AiNodeTreeContext } from './ai-node-tree'
import {
  AI_OUTPUT_BUDGETS,
  AI_OUTPUT_KINDS,
  AI_OUTPUT_SURFACE,
  type AiLoadEstimate,
  type AiOutputKind,
  type AiSurface,
} from './ai-palette'
import { AI_PALETTE_CATALOG } from './ai-palette.generated'

/**
 * The building doctrine (AGL-2935): the one place the procedures a generator
 * follows live, and the one loop every generator runs them through.
 *
 * A page with the same card twelve times, a header pasted on every screen, a
 * form drawn inline, a hex color in an `sx`: each is what a careless author
 * does, and the AI must never do it. So no generator carries its own copy of
 * the rules. It hands its instructions, its tool and the brief to
 * `runValidatedGeneration(kind, …)`, which
 *
 *  1. prefixes the doctrine as a CACHED system block — byte-identical for
 *     every org, so it is one cache entry for the platform — then the door's
 *     own instructions, then the palette catalog for the output's surface,
 *     and last the site inventory as a VOLATILE block, the one per-site part;
 *  2. calls the runtime once, reads the answer off the tool, and holds it to
 *     the doctrine's validators (`ai-doctrine-validators.ts`) — the doctrine
 *     always runs for a kind it knows, and a door can only ADD checks;
 *  3. on a violation, asks ONCE more with the broken rules named and the
 *     offending parts quoted — never the whole document again (AGL-2937);
 *  4. and when the second answer still breaks a rule, gives up with
 *     `needs_input`: a person decides, rather than a loop spending on the
 *     same refusal.
 *
 * Tokens from every attempt are summed on the result, so the caller meters
 * what was actually spent. Nothing here writes a document or publishes.
 */

// ── The doctrine block ───────────────────────────────────────────────────

function kilobytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`
    : `${Math.round(bytes / 1_000)} KB`
}

function budgetLine(kind: AiOutputKind): string {
  const budget = AI_OUTPUT_BUDGETS[kind]
  const parts = [
    `${budget.nodes} elements`,
    `${kilobytes(budget.bytes)} stored`,
    budget.imageBytes ? `${kilobytes(budget.imageBytes)} of images` : 'no images',
    budget.embeds ? `${budget.embeds} embed` : 'no embeds',
  ]
  if (budget.emailHtmlBytes) parts.push(`${kilobytes(budget.emailHtmlBytes)} of rendered HTML`)
  return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} at most ${parts.join(', ')}`
}

/**
 * The procedures in the model's terms. Static text only: the budgets are
 * read from `AI_OUTPUT_BUDGETS` once, at load, so the block is the same bytes
 * on every request and changes only when a budget does.
 */
export const AI_BUILDING_DOCTRINE = [
  'How to build on this platform. Every plan and every document you produce is checked against these rules; an answer that breaks one is refused and asked for again with the rule named.',
  '',
  '1. Repeats become one reusable component. A block with the same elements and props that differs only in its copy, links or images, appearing 3 or more times on a page or on 2 pages built together, is one reusable component with typed props, placed as instances: a "reusableInstance" node whose "refId" names the component and whose "propValues" fill its props. Search the site inventory first, and never create a component that duplicates one listed there; reuse it, or propose extending it.',
  '2. Site-wide regions live in the layout. A header, navigation, footer, announcement bar or cookie notice belongs in a layout. Every screen declares the site\'s layout, or one the plan creates, and never carries its own copy of a layout region.',
  '3. Forms are built on the Forms page, then placed. A form is created there with its fields, validation, consent and routing, and a page places a "form" element bound by its "formId", with no fields drawn inside it. Never draw loose form fields on a page.',
  '4. Similar pages share one template. When pages share one structure and differ by copy or data (products, locations, team members, services), plan one template and apply it once per page, or bind it to a collection when the data exists.',
  '5. Colors, spacing and type come from the theme. Use palette tokens such as "primary.main", "text.secondary" and "background.paper", plain numbers on the spacing scale, the theme\'s shape and its typography variants. Never write a hex, rgb or named color, or a px, rem or em length. A color the theme lacks is a theme change in the plan, never a value on an element.',
  '6. Emails use the brand. An email uses only the brand colors and fonts the site inventory lists, and a campaign starts from an email template rather than a one-off design.',
  '7. Reuse before creating. Prefer what the site inventory lists: components, layouts, templates, forms, themes, datasets, collections and screens, referenced by id. Creating is the exception, and every creation says why nothing listed will do. In a plan, refer to something the plan itself creates as new:<name>.',
  '8. Data is bound, not typed. A list that exists as a dataset, collection, product or record is bound to it and never copied into text; a long list the site lacks becomes a dataset in the plan.',
  '9. Images come from the media library, with alt text. Place images by media reference, or leave "src" empty for an upload; never link an image from another website. Every image has alt text describing it, or "decorative": true.',
  '10. Navigation and SEO travel with a page. Every new screen has a slug of lowercase words joined by hyphens that the site does not already use, a search title of at most 70 characters, a search description of at most 170, and a navigation entry when the brief implies one.',
  '11. One main landmark and an ordered outline. A page declares at most one "main"; a component, form or email declares none; a layout has exactly one "layoutSlot". A page has exactly one h1 and never skips a heading level, and a layout has no h1. Set a heading\'s level with the Typography "component" (h1 to h6).',
  '12. Responsive by the theme\'s breakpoints. Widths come from a Container\'s maxWidth, a Grid\'s size, a percentage, or responsive values keyed by xs, sm, md, lg and xl, never a fixed px or viewport width.',
  '13. Drafts only. Everything you produce is a new draft that a person reviews and publishes. Never ask to publish, and never change something already live.',
  '14. The site\'s voice, with no filler. Write real copy in the tone of the site and the brief, never lorem ipsum or "your text here". When the brief lacks a fact such as a phone number, a price or a name, mark it in square brackets instead of inventing it. For agencies and enterprises, never call the work simple, cheap or effortless.',
  '15. Start from a duplicate of the nearest thing. When the site has a similar screen, template or email, plan a duplicate of it and edit that, which keeps its versions, bindings and SEO.',
  '16. The smallest document that does the job. Build the flattest tree that renders the design: no container wrapping a single container, no empty containers, no inline style repeated across elements, text as text, images lazy below the first, video by poster and click-to-play, no fonts beyond the theme\'s, and no third-party embed or script unless the brief asks for it and the plan names its cost.',
  `17. A measured budget for every output. Each document is measured and refused over its budget: ${AI_OUTPUT_KINDS.map(budgetLine).join('; ')}.`,
  '',
  'Answer through the tool you are given, and only through it.',
].join('\n')

/**
 * The doctrine as the cached system block: the procedures and the platform's
 * acceptable-use rules (AGL-2925), which every generation prompt carries and
 * which ride here so a generator cannot leave them out.
 */
export const AI_DOCTRINE_SYSTEM_BLOCK: AiSystemBlock = {
  text: `${AI_BUILDING_DOCTRINE}\n\n${AI_ACCEPTABLE_USE_BLOCK}`,
  cacheBreakpoint: true,
}

// ── The inventory block ──────────────────────────────────────────────────

const KIND_HEADINGS: Record<AiInventoryKind, string> = {
  components: 'Reusable components (id · name · props an instance fills)',
  layouts: 'Layouts (id · name)',
  templates: 'Templates (id · name · kind)',
  forms: 'Forms (id · name · fields)',
  datasets: 'Datasets (id · name · fields)',
  collections: 'Content collections (id · name · slug)',
  screens: 'Screens (id · name · slug)',
}

/** One line per record, in the order the kind's heading names its columns. */
function inventoryLines(inventory: AiSiteInventory, kind: AiInventoryKind): string[] {
  switch (kind) {
    case 'components':
      return inventory.components.map((row) => {
        const props = Object.entries(row.props)
          .map(([name, type]) => `${name}:${type}`)
          .join(', ')
        return `${row.id} · ${row.name} · ${props || 'no props'}`
      })
    case 'layouts':
      return inventory.layouts.map((row) => `${row.id} · ${row.name}`)
    case 'templates':
      return inventory.templates.map((row) => `${row.id} · ${row.name} · ${row.kind}`)
    case 'forms':
      return inventory.forms.map((row) => `${row.id} · ${row.name} · ${row.fields.join(', ')}`)
    case 'datasets':
      return inventory.datasets.map(
        (row) => `${row.id} · ${row.name} · ${row.fields.join(', ')}`,
      )
    case 'collections':
      return inventory.collections.map((row) => `${row.id} · ${row.name} · ${row.slug}`)
    case 'screens':
      return inventory.screens.map(
        (row) =>
          `${row.id} · ${row.name} · ${row.slug}${row.template ? ' · entry template' : ''}`,
      )
  }
}

/**
 * The inventory as the prompt's VOLATILE block: per site, so it never sits
 * inside a cached prefix. Held to `AI_SITE_INVENTORY_MAX_CHARS` by cutting
 * the longest kind a line at a time, each cut kind named, so no one kind can
 * crowd the others out.
 */
export function aiSiteInventoryBlock(inventory: AiSiteInventory | null): string {
  if (!inventory) {
    return 'Site inventory: none was read for this request. Reuse nothing by id, and name every creation as new.'
  }
  const lines = Object.fromEntries(
    AI_INVENTORY_KINDS.map((kind) => [kind, inventoryLines(inventory, kind)]),
  ) as Record<AiInventoryKind, string[]>
  const truncated = new Set(inventory.truncated)
  const render = (): string => {
    const parts = [
      'Site inventory: what this site already has. Reuse these by id before creating anything.',
    ]
    for (const kind of AI_INVENTORY_KINDS) {
      parts.push(`${KIND_HEADINGS[kind]}:`)
      parts.push(...(lines[kind].length ? lines[kind].map((line) => `- ${line}`) : ['- none']))
    }
    if (inventory.theme) {
      parts.push(`Theme: ${inventory.theme.summary.join('; ') || 'the platform default'}.`)
      const colors = Object.entries(inventory.theme.colors)
        .map(([path, value]) => `${path}=${value}`)
        .join(', ')
      if (colors) parts.push(`Brand colors (light scheme): ${colors}`)
      if (inventory.theme.fonts.length) {
        parts.push(`Brand fonts: ${inventory.theme.fonts.join(', ')}`)
      }
    }
    if (truncated.size) {
      parts.push(
        `More exist than are listed for: ${AI_INVENTORY_KINDS.filter((kind) => truncated.has(kind)).join(', ')}. Do not assume one is missing because it is not listed.`,
      )
    }
    return parts.join('\n')
  }
  let block = render()
  while (block.length > AI_SITE_INVENTORY_MAX_CHARS) {
    const longest = AI_INVENTORY_KINDS.reduce((a, b) =>
      lines[b].length > lines[a].length ? b : a,
    )
    if (!lines[longest].length) break
    lines[longest] = lines[longest].slice(0, -1)
    truncated.add(longest)
    block = render()
  }
  return block.length > AI_SITE_INVENTORY_MAX_CHARS
    ? block.slice(0, AI_SITE_INVENTORY_MAX_CHARS)
    : block
}

/** What a tree generated against this inventory may reference, for `validateAiNodeTree`. */
export function aiNodeTreeContextFromInventory(
  inventory: AiSiteInventory | null,
): AiNodeTreeContext {
  if (!inventory) return {}
  return {
    screenIds: inventory.screens.map((screen) => screen.id),
    componentIds: inventory.components.map((component) => component.id),
    componentProps: Object.fromEntries(
      inventory.components.map((component) => [component.id, component.props]),
    ),
    formIds: inventory.forms.map((form) => form.id),
    datasetIds: inventory.datasets.map((dataset) => dataset.id),
  }
}

export interface AiDoctrineSystemOptions {
  /** The door's own static instructions, cached after the doctrine. */
  instructions?: readonly AiSystemBlock[]
  /** The palette surface a tree is composed on; its catalog is cached after the instructions. */
  surface?: AiSurface
}

/**
 * The system prompt every generator sends, in cache order: the doctrine
 * (cached), the door's instructions, the surface's palette catalog (cached),
 * then the site inventory (volatile). With no catalog behind them, the
 * instructions close the cached prefix themselves. The runtime refuses the
 * request if a door slips a volatile block inside the cached span.
 */
export function aiDoctrineSystemBlocks(
  inventory: AiSiteInventory | null,
  options: AiDoctrineSystemOptions = {},
): AiSystemBlock[] {
  const instructions = [...(options.instructions ?? [])]
  const catalog: AiSystemBlock[] = options.surface
    ? [{ text: AI_PALETTE_CATALOG[options.surface], cacheBreakpoint: true }]
    : []
  const last = instructions.length - 1
  if (
    !catalog.length &&
    last >= 0 &&
    !instructions[last].volatile &&
    !instructions.some((block) => block.cacheBreakpoint)
  ) {
    instructions[last] = { ...instructions[last], cacheBreakpoint: true }
  }
  return [
    AI_DOCTRINE_SYSTEM_BLOCK,
    ...instructions,
    ...catalog,
    { text: aiSiteInventoryBlock(inventory), volatile: true },
  ]
}

// ── Reading and checking an answer ───────────────────────────────────────

/** What a generation kind is: a document the palette composes, a plan, or a door's own kind. */
export type AiGenerationKind = AiOutputKind | 'plan'

/**
 * `max_tokens` per kind (AGL-2937): the ceiling of one answer, sized to the
 * kind's budget with room for the model's reasoning. A kind a door brings
 * with its own check takes `AI_CUSTOM_GENERATION_MAX_TOKENS` unless the door
 * names its own.
 */
export const AI_GENERATION_MAX_TOKENS: Record<AiGenerationKind, number> = {
  plan: 8_000,
  page: 32_000,
  template: 32_000,
  component: 8_000,
  layout: 12_000,
  form: 6_000,
  email: 16_000,
}

export const AI_CUSTOM_GENERATION_MAX_TOKENS = 8_000

/** One answer, and one re-ask with the violations named. */
export const AI_GENERATION_MAX_ATTEMPTS = 2

/** How much of the offending parts a re-ask quotes. */
export const AI_REASK_OFFENDING_MAX_CHARS = 6_000

export function isAiOutputKind(kind: string): kind is AiOutputKind {
  return (AI_OUTPUT_KINDS as readonly string[]).includes(kind)
}

/** What one check made of one answer. */
export interface AiGenerationCheckResult<T> {
  /** The value to keep; `null` when the answer could not be read as one. */
  value: T | null
  violations: AiDoctrineViolation[]
  /** The parts of the answer at fault, keyed as the model wrote them, for the re-ask. */
  offending?: Record<string, unknown>
}

export type AiGenerationCheck<T> = (
  answer: Record<string, unknown>,
) => AiGenerationCheckResult<T>

/** A tree that passed the palette validator and every doctrine rule. */
export interface AiValidatedTree {
  rootId: string
  nodes: NodesMap
  /** What the palette validator dropped or normalized on the way in. */
  repairs: string[]
  /** Each minted id → the id the model wrote for that node. */
  sourceIds: Record<string, string>
  score: AiOutputScore
  /** The weight the proposal shows; `null` for an email. */
  load: AiLoadEstimate | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The strict tool a tree arrives through. The node map rides as JSON text:
 * a map keyed by the model's own node ids has no fixed properties, and a
 * strict schema must close every object it declares.
 */
export function aiDoctrineTreeTool(kind: AiOutputKind): AiTool {
  return {
    name: `submit_${kind}`,
    description: `Submit the ${kind} as one flat node map.`,
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tree'],
      properties: {
        tree: {
          type: 'string',
          description:
            'The node map as JSON: {"rootId": "<id>", "nodes": {"<id>": {"componentId": "...", "props": {...}, "sx": {...}, "nodes": ["<child id>", ...]}}}.',
        },
      },
    },
  }
}

/** The tree a tool answer carries: `tree` as an object or JSON text, else the answer itself. */
export function aiAnswerTree(answer: Record<string, unknown>): unknown {
  const tree = answer['tree']
  if (typeof tree === 'string') {
    try {
      return JSON.parse(tree) as unknown
    } catch {
      return tree
    }
  }
  return isRecord(tree) ? tree : answer
}

/**
 * The answer a completion carries: the named tool's input, or — from a model
 * that answered in text instead — the text as a JSON object.
 */
function answerOf(result: AiCompletion, toolName: string): Record<string, unknown> | null {
  const call = result.toolUse.find((use) => use.name === toolName)
  if (call) return call.input
  const text = result.text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]
  for (const candidate of [text, fenced]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (isRecord(parsed)) return parsed
    } catch {
      // Not JSON; the next candidate, or no answer.
    }
  }
  return null
}

/** A JSON value capped to a character budget, entry by entry. */
function capped(entries: Array<[string, unknown]>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  let used = 2
  for (const [key, value] of entries) {
    const size = JSON.stringify(value ?? null).length + key.length + 4
    if (used + size > AI_REASK_OFFENDING_MAX_CHARS) break
    out[key] = value
    used += size
  }
  return Object.keys(out).length ? out : undefined
}

/** The value at a path such as `screens[1].sections[2]`. */
function valueAtPath(root: unknown, path: string): unknown {
  let value: unknown = root
  for (const part of path.match(/[^.[\]]+/g) ?? []) {
    if (Array.isArray(value)) value = value[Number(part)]
    else if (isRecord(value)) value = value[part]
    else return undefined
  }
  return value
}

/**
 * The doctrine's check for a tree kind: the palette validator, every tree
 * rule and the budget, with each offending node reported and quoted by the
 * id the MODEL wrote — the minted ids are ones it never saw.
 */
export function aiDoctrineTreeCheck(
  kind: AiOutputKind,
  context: AiDoctrineTreeContext = {},
  otherPages: readonly AiDoctrineTree[] = [],
): AiGenerationCheck<AiValidatedTree> {
  return (answer) => {
    const input = aiAnswerTree(answer)
    const report = validateAiDoctrineTree(input, kind, context, otherPages)
    if (!report.tree || !report.score) {
      return { value: null, violations: report.violations }
    }
    const { sourceIds } = report.tree
    const violations = report.violations.map((violation) =>
      violation.nodeIds
        ? { ...violation, nodeIds: violation.nodeIds.map((id) => sourceIds[id] ?? id) }
        : violation,
    )
    const rawNodes = isRecord(input) && isRecord(input['nodes']) ? input['nodes'] : {}
    const quoted: Array<[string, unknown]> = []
    const seen = new Set<string>()
    const quote = (id: string) => {
      const node = rawNodes[id]
      if (seen.has(id) || !isRecord(node)) return
      seen.add(id)
      quoted.push([id, node])
      for (const child of Array.isArray(node['nodes']) ? node['nodes'] : []) {
        if (typeof child === 'string') quote(child)
      }
    }
    for (const violation of violations) for (const id of violation.nodeIds ?? []) quote(id)
    return {
      value: {
        rootId: report.tree.rootId,
        nodes: report.tree.nodes,
        repairs: report.tree.repairs,
        sourceIds,
        score: report.score,
        load: report.load,
      },
      violations,
      offending: capped(quoted),
    }
  }
}

/** The doctrine's check for a plan: its shape, then every plan rule against the inventory. */
export function aiDoctrinePlanCheck(
  inventory: AiSiteInventory | null,
  framing: AiCopyFraming = null,
): AiGenerationCheck<AiBuildPlan> {
  return (answer) => {
    const publish = detectPublishIntent(answer)
    const parsed = parseAiBuildPlan(answer)
    if (parsed.ok === false) {
      return {
        value: null,
        violations: [
          {
            rule: null,
            code: 'plan-shape',
            message: 'The answer could not be read as a plan.',
            detail: parsed.error,
          },
          ...publish,
        ],
      }
    }
    const violations = [...publish, ...validateAiBuildPlan(parsed.plan, inventory, framing)]
    const paths = [...new Set(violations.flatMap((violation) => violation.paths ?? []))]
    return {
      value: parsed.plan,
      violations,
      offending: capped(paths.map((path) => [path, valueAtPath(parsed.plan, path)])),
    }
  }
}

/** The re-ask: the rules broken, where, and the offending parts as the model wrote them. */
export function aiReaskMessage(
  kind: string,
  toolName: string,
  violations: readonly AiDoctrineViolation[],
  offending?: Record<string, unknown>,
): string {
  const lines = [`Your ${kind} was not used, because it breaks these building rules:`]
  for (const violation of violations) {
    const where = violation.nodeIds?.length
      ? ` (nodes ${violation.nodeIds.join(', ')})`
      : violation.paths?.length
        ? ` (at ${violation.paths.join(', ')})`
        : ''
    const detail = violation.detail ? ` ${violation.detail}` : ''
    lines.push(`- ${aiDoctrineViolationText(violation)}${detail}${where}`)
  }
  if (offending && Object.keys(offending).length) {
    lines.push('', 'The parts at fault, as you wrote them:', JSON.stringify(offending))
  }
  lines.push(
    '',
    `Answer again with ${toolName}: the whole ${kind}, built so that none of these rules is broken.`,
  )
  return lines.join('\n')
}

/** What a person reads when the second answer still broke a rule. */
export function aiDoctrineNeedsInputMessage(violations: readonly AiDoctrineViolation[]): string {
  const first = violations.find((violation) => violation.rule !== null) ?? violations[0]
  if (!first) return 'This could not be built within the building rules.'
  const others = violations.length - 1
  return `This could not be built within the building rules. ${aiDoctrineViolationText(first)}${
    others > 0 ? ` (${others} more ${others === 1 ? 'rule was' : 'rules were'} also broken.)` : ''
  }`
}

function unreadableAnswer(
  kind: string,
  toolName: string,
  stopReason: string | null,
): AiDoctrineViolation {
  const cutOff = stopReason === 'max_tokens' || stopReason === 'length'
  return cutOff
    ? {
        rule: null,
        code: 'answer-cut-off',
        message: `The ${kind} ran past the size one answer may have. Build a smaller ${kind}.`,
      }
    : {
        rule: null,
        code: 'answer-unreadable',
        message: `The answer did not come through ${toolName}.`,
      }
}

// ── The loop ─────────────────────────────────────────────────────────────

interface AiGenerationInputBase {
  /** The routing table's step kind: it decides the model (never a model literal). */
  step: AiStepKind
  /** The org's resolved `pluginSettings/ai`, for its provider and model choices. */
  settings?: AiPluginSettings
  /** A route the door already resolved; the routing table's answer for `step` otherwise. */
  model?: string
  /** The door's own static instructions. */
  instructions: readonly AiSystemBlock[]
  /** The site the output is built for; `null` when none was read. */
  inventory: AiSiteInventory | null
  /** The brief and whatever the door sends in the user turn. */
  messages: readonly AiMessage[]
  /** The strict tool the answer arrives through. */
  tool: AiTool
  /** `AI_GENERATION_MAX_TOKENS` for the kind when absent. */
  maxTokens?: number
  thinking?: AiThinking
  effort?: AiEffort
  signal?: AbortSignal
  /** A provider chosen ahead of every setting; specs use it. */
  provider?: AiProvider
}

export interface AiTreeGenerationInput extends AiGenerationInputBase {
  /** What the tree rules read beyond the inventory: asset sizes, the brand, embeds, framing. */
  context?: AiDoctrineTreeContext
  /** Trees generated beside this one, for rule 1 across pages. */
  otherPages?: readonly AiDoctrineTree[]
  /** Checks the door adds to the doctrine's own, run on a tree the doctrine admitted. */
  extend?: (tree: AiValidatedTree, answer: Record<string, unknown>) => AiDoctrineViolation[]
}

export interface AiPlanGenerationInput extends AiGenerationInputBase {
  framing?: AiCopyFraming
  /** Checks the door adds to the doctrine's own, run on a plan that parsed. */
  extend?: (plan: AiBuildPlan, answer: Record<string, unknown>) => AiDoctrineViolation[]
}

export interface AiCustomGenerationInput<T> extends AiGenerationInputBase {
  /**
   * How a kind the doctrine has no reader for is read and checked — a theme
   * change, an edit. Rule 13 is held on every answer whatever it returns.
   */
  check: AiGenerationCheck<T>
}

/** What a generation spent, whatever its outcome. */
export interface AiGenerationSpend {
  /** Model calls made: 1, or 2 when the first answer was re-asked. */
  attempts: number
  /** Tokens across every attempt; the meter bills all of them. */
  usage: AiUsage
  estCostUsd: number
  model: string
  stopReason: string | null
}

export type AiValidatedGeneration<T> =
  | (AiGenerationSpend & { status: 'ok'; value: T })
  /** The re-ask still broke a rule: a person decides. `message` is customer-safe. */
  | (AiGenerationSpend & {
      status: 'needs_input'
      violations: AiDoctrineViolation[]
      message: string
    })
  /** The model declined; tokens were spent. */
  | (AiGenerationSpend & { status: 'refused' })

function withExtension<T>(
  check: AiGenerationCheck<T>,
  extend: ((value: T, answer: Record<string, unknown>) => AiDoctrineViolation[]) | undefined,
): AiGenerationCheck<T> {
  if (!extend) return check
  return (answer) => {
    const result = check(answer)
    return result.value === null
      ? result
      : { ...result, violations: [...result.violations, ...extend(result.value, answer)] }
  }
}

function checkFor(kind: string, input: object): AiGenerationCheck<unknown> {
  if (kind === 'plan') {
    const plan = input as AiPlanGenerationInput
    return withExtension(aiDoctrinePlanCheck(plan.inventory, plan.framing ?? null), plan.extend) as AiGenerationCheck<unknown>
  }
  if (isAiOutputKind(kind)) {
    const tree = input as AiTreeGenerationInput
    const context: AiDoctrineTreeContext = {
      brand: tree.inventory?.theme
        ? { colors: tree.inventory.theme.colors, fonts: tree.inventory.theme.fonts }
        : null,
      ...aiNodeTreeContextFromInventory(tree.inventory),
      ...tree.context,
    }
    return withExtension(
      aiDoctrineTreeCheck(kind, context, tree.otherPages),
      tree.extend,
    ) as AiGenerationCheck<unknown>
  }
  const custom = (input as Partial<AiCustomGenerationInput<unknown>>).check
  if (!custom) {
    throw new Error(`runValidatedGeneration: the doctrine has no reader for "${kind}"; pass check`)
  }
  return (answer) => {
    const result = custom(answer)
    return { ...result, violations: [...detectPublishIntent(answer), ...result.violations] }
  }
}

/**
 * Generate one output under the doctrine: ask, check, re-ask once with the
 * violations named, and give up with `needs_input` rather than spend again.
 *
 * `kind` decides the check: `'plan'` and the six palette kinds are read and
 * held by the doctrine itself; any other kind brings its own `check`, and the
 * doctrine still holds rule 13 on it. Throws only what the runtime throws — a
 * provider failure, an abort, a prompt the cache guard refuses — so a job
 * step's retry and failure paths stay the machine's.
 */
export function runValidatedGeneration(
  kind: 'plan',
  input: AiPlanGenerationInput,
): Promise<AiValidatedGeneration<AiBuildPlan>>
export function runValidatedGeneration(
  kind: AiOutputKind,
  input: AiTreeGenerationInput,
): Promise<AiValidatedGeneration<AiValidatedTree>>
export function runValidatedGeneration<T>(
  kind: string,
  input: AiCustomGenerationInput<T>,
): Promise<AiValidatedGeneration<T>>
export async function runValidatedGeneration(
  kind: string,
  input: AiGenerationInputBase,
): Promise<AiValidatedGeneration<unknown>> {
  const check = checkFor(kind, input)
  const model = input.model ?? aiModelForStep(input.step, input.settings)
  const system = aiDoctrineSystemBlocks(input.inventory, {
    instructions: input.instructions,
    ...(isAiOutputKind(kind) ? { surface: AI_OUTPUT_SURFACE[kind] } : {}),
  })
  const maxTokens =
    input.maxTokens ??
    AI_GENERATION_MAX_TOKENS[kind as AiGenerationKind] ??
    AI_CUSTOM_GENERATION_MAX_TOKENS
  const spend: AiGenerationSpend = {
    attempts: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0,
    model,
    stopReason: null,
  }
  let messages: AiMessage[] = [...input.messages]
  let violations: AiDoctrineViolation[] = []
  while (spend.attempts < AI_GENERATION_MAX_ATTEMPTS) {
    spend.attempts += 1
    const result = await runAiRequest({
      model,
      system,
      messages,
      tools: [input.tool],
      maxTokens,
      stream: false,
      ...(input.thinking ? { thinking: input.thinking } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.settings ? { settings: input.settings } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
    })
    spend.usage = {
      inputTokens: spend.usage.inputTokens + result.usage.inputTokens,
      outputTokens: spend.usage.outputTokens + result.usage.outputTokens,
      cacheReadTokens: spend.usage.cacheReadTokens + result.usage.cacheReadTokens,
      cacheWriteTokens: spend.usage.cacheWriteTokens + result.usage.cacheWriteTokens,
    }
    spend.estCostUsd = Math.round((spend.estCostUsd + result.estCostUsd) * 1_000_000) / 1_000_000
    spend.stopReason = result.stopReason
    if (result.kind === 'refusal') return { ...spend, status: 'refused' }

    const answer = answerOf(result, input.tool.name)
    const checked = answer
      ? check(answer)
      : { value: null, violations: [unreadableAnswer(kind, input.tool.name, result.stopReason)] }
    if (checked.value !== null && checked.violations.length === 0) {
      return { ...spend, status: 'ok', value: checked.value }
    }
    violations = checked.violations.length
      ? checked.violations
      : [unreadableAnswer(kind, input.tool.name, result.stopReason)]
    messages = [
      ...input.messages,
      { role: 'assistant', content: `Submitted the ${kind} with ${input.tool.name}.` },
      {
        role: 'user',
        content: aiReaskMessage(kind, input.tool.name, violations, checked.offending),
      },
    ]
  }
  return {
    ...spend,
    status: 'needs_input',
    violations,
    message: aiDoctrineNeedsInputMessage(violations),
  }
}
