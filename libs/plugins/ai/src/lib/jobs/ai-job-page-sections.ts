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
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiBuildPlanScreen, AiBuildPlanSection } from '../model/ai-build-plan'
import { aiPageTypeDefinition, parseAiPageJobInputs } from '../model/ai-page-job'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import { aiHomeScreenIds, type AiSiteInventory } from '../model/ai-site-inventory'
import type { AiTool } from '../providers/contract'
import {
  AI_REASK_OFFENDING_MAX_CHARS,
  aiAnswerTree,
  aiNodeTreeContextFromInventory,
  type AiGenerationCheck,
} from '../runtime/ai-doctrine'
import {
  detectCutLines,
  isAiLinkElement,
  validateAiDoctrineTree,
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineTreeContext,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { AI_INSTANCE_REF_PROP, validateAiNodeTree } from '../runtime/ai-node-tree'
import { aiPageLinkTarget, aiPageScrollInteraction } from '../runtime/ai-page-links'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { AI_PALETTE_CATALOG } from '../runtime/ai-palette.generated'
import { AI_REPEAT_KEY, expandAiRepeatedItems } from '../runtime/ai-repeated-items'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiJobBriefLine, aiPlanReferenceLines } from './ai-job-generation'

/**
 * A page built one section at a time (AGL-2907): what one section pass asks
 * for, how its answer is held to the building rules as part of the page, and
 * how it joins the page.
 *
 * Pure: no Firestore and no provider, so the page step, its specs and the
 * evals read one definition of a section.
 *
 * ── Held as part of the page ─────────────────────────────────────────────
 *
 * A section is checked twice over, by validators the doctrine already has:
 * the palette validator on the section as the model wrote it, then the
 * doctrine's whole page check on the page built so far with the section
 * added. So the page's one main, its one h1 and its heading outline, repeats
 * across sections, and its weight against the page budget are held on every
 * pass, not only on the last. The violations name the section's own nodes,
 * by the ids the model wrote, so a re-ask quotes this section and nothing
 * else — the page is never sent back.
 *
 * ── A repeated item written once (AGL-3053) ──────────────────────────────
 *
 * Where the workspace keeps no reusable components, an answer writes a
 * repeated item once and lists its copies' values, and the check draws the
 * copies before either validator reads the section (`ai-repeated-items.ts`).
 * Both then read the section as the page stores it, so the page's rules hold
 * on every copy exactly as on an item written out in full, and a finding on a
 * copy names the node the model wrote. Where the workspace keeps components,
 * an item written once is refused: it places instances.
 */

/** The section root id a pass writes, from the job and the plan section's index. */
export function aiPageSectionNodeId(jobId: string, index: number): string {
  return `ai-${jobId.slice(0, 12)}-section-${index + 1}`
}

/** The strict tool a section arrives through. The node map rides as JSON text, as a page's does. */
export const AI_PAGE_SECTION_TOOL: AiTool = {
  name: 'submit_section',
  description: 'Submit one section of the page as one flat node map.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tree'],
    properties: {
      tree: {
        type: 'string',
        description:
          'The section as JSON: {"rootId": "<id>", "nodes": {"<id>": {"componentId": "...", "props": {...}, "sx": {...}, "nodes": ["<child id>", ...]}}}. The root is the document wrapper (componentId "div") holding one Section.',
      },
    },
  },
}

/** The page step's own instructions, cached after the doctrine, with the screen palette after them. */
export const AI_JOB_PAGE_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      'You build a web page one section at a time, in the order a confirmed plan gives. Each answer is ONE section: call submit_section with a flat node map whose root is the document wrapper (componentId "div") holding exactly one Section (section).',
      'The first section is the top of the page and holds the page’s one h1, its title. Every later section opens with an h2, and headings below it step down one level at a time.',
      'Place what the section’s plan line names. A component the site has is placed as an instance, never drawn again: componentId "reusableInstance", props {"refId": "<component id>", "propValues": {…}} filling the props the inventory lists. A form the site has is a Form (form) whose formId is that form’s id. Another screen of the site is linked by its screen id, with a Screen Link (muiScreenLink) or a Button (muiButton) whose screenId is that id.',
      'Where the request says the site keeps no saved forms or reusable components, draw them in the section instead: a repeated item is written once, and a form is a Form (form) with no formId, a formName saying what it collects and a submitLabel, holding one Form Field (formField) for each answer with its fieldName, label and fieldType.',
      'Lay the section out with a Container, a Stack or a Grid ("container": true, "spacing": 3) of Grid items sized like "xs:12 md:4", and size nothing with a fixed width. Colors come from the theme’s palette tokens such as primary.main, spacing from the spacing scale, and type from the text variants.',
      'The page renders inside the site’s layout, so a section is never a header, navigation or footer.',
      'A picture is an Image (image) with alt text that says what it should show and no src, for the site owner to fill from the media library.',
      'Write plain, specific copy in the site’s voice, with no filler. Where the brief leaves out a fact, such as a price, a phone number or an address, write the gap in square brackets instead of inventing it.',
    ].join('\n'),
  },
  { text: AI_PALETTE_CATALOG.screen, cacheBreakpoint: true },
]

/** A plan reference as the request names it: the id with the name it was planned under. */
function referenceOf(plan: AiJobPlan, ref: string): string {
  const label = plan.labels?.[ref]
  return label ? `${ref} ("${label}")` : ref
}

export interface AiPageSectionPromptInput {
  job: Pick<AiJob, 'brief' | 'inputs'>
  plan: AiJobPlan
  screen: AiBuildPlanScreen
  index: number
  /** The most elements the section may carry at this pass's answer ceiling. */
  maxElements: number
  /**
   * Whether the workspace keeps reusable components and saved forms
   * (AGL-3030); `false` asks for the section built inline. Absent is `true`.
   */
  reusableComponents?: boolean
}

/** What a section request says where the workspace keeps no reusable components or saved forms. */
export const AI_PAGE_SECTION_INLINE_LINE =
  'This site keeps no saved forms or reusable components: write a repeated item once, and draw a form as a Form holding its Form Fields.'

/** How a repeated item is written once, in the words a request and a re-ask share. */
const AI_PAGE_SECTION_REPEAT_SHAPE = `put {{1}}, {{2}}… where its copies differ, and give its outermost node "${AI_REPEAT_KEY}", one list of values a copy, in that order, as [["Title 1", "Text 1"], ["Title 2", "Text 2"]]`

/**
 * How a repeated item is written once (AGL-3053): the item's subtree once,
 * with placeholders where its copies differ and their values listed, which
 * the section check draws into its copies (`ai-repeated-items.ts`). It rides
 * the request of a section whose plan line shows items on a workspace that
 * keeps no reusable components, and no other: a section with nothing to repeat
 * pays nothing for it, the cached prefix every workspace shares says only that
 * a repeated item is written once, and a workspace that places components is
 * never shown how.
 */
export const AI_PAGE_SECTION_REPEAT_LINE = `Write a repeated item once: ${AI_PAGE_SECTION_REPEAT_SHAPE}.`

/**
 * What a pass whose answer ran past its ceiling is told makes a section
 * smaller (AGL-3042): fewer elements, down to the budget the request gave,
 * shorter copy, and a repeated item drawn no more than once — placed as an
 * instance where the workspace keeps reusable components, and written once
 * where it keeps none (AGL-3053), with the shape spelled out, since a section
 * whose plan line showed no items was never told it. It rides the re-ask,
 * never the first request, so a pass that fits sends no byte more.
 */
export function aiPageSectionSmaller(input: Pick<AiPageSectionPromptInput, 'maxElements' | 'reusableComponents'>): string {
  return input.reusableComponents === false
    ? `Make it smaller: use fewer elements, at most ${input.maxElements}; write shorter copy; and write a repeated item once instead of drawing it again: ${AI_PAGE_SECTION_REPEAT_SHAPE}.`
    : `Make it smaller: use fewer elements, at most ${input.maxElements}; write shorter copy; and place a repeated item as an instance of a component the site has instead of drawing it again.`
}

/** One pass's user turn: the page, the brief, the plan, this section and what is built above it. */
export function aiPageSectionPrompt(input: AiPageSectionPromptInput): string {
  const { job, plan, screen, index } = input
  const inputs = parseAiPageJobInputs(job.inputs)
  const type = typeof inputs === 'string' ? null : aiPageTypeDefinition(inputs.pageType)
  const section = screen.sections[index] as AiBuildPlanSection
  const places = section.uses.length
    ? ` It places ${section.uses.map((ref) => referenceOf(plan, ref)).join(', ')}.`
    : ''
  const items = section.items ? ` It shows ${section.items} items.` : ''
  const built = screen.sections.slice(0, index).map((entry, position) => `${position + 1}. ${entry.name}`)
  return [
    `Page: "${screen.title}" at ${screen.slug}`,
    ...(type ? [`Page type: ${type.purpose}`] : []),
    aiJobBriefLine(job),
    ...aiPlanReferenceLines(plan),
    `Build section ${index + 1} of ${screen.sections.length}: "${section.name}".${places}${items}`,
    built.length
      ? `Already built, above it: ${built.join('; ')}. The page’s h1 is in section 1.`
      : 'Nothing is built yet: this section holds the page’s h1.',
    ...(input.reusableComponents === false
      ? [AI_PAGE_SECTION_INLINE_LINE, ...(section.items ? [AI_PAGE_SECTION_REPEAT_LINE] : [])]
      : []),
    `Keep this section to at most ${input.maxElements} elements.`,
  ].join('\n')
}

/** A validated section: its nodes keyed as the page stores them, its root under the page root. */
export interface AiPageSection {
  rootId: string
  nodes: NodesMap
  /** The page's weight with the section added, as the doctrine measured it. */
  load: AiLoadEstimate | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A page with nothing on it yet: the document wrapper. */
export function aiEmptyPage(): NodesMap {
  return {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      parentId: null,
      nodes: [],
    },
  } as unknown as NodesMap
}

/**
 * The page with a section in its plan position: after every section with a
 * lower index and before every one with a higher, the page's other children
 * — whatever a member placed — kept where they are. A section already on the
 * page is replaced, never doubled.
 */
export function aiPageWithSection(
  page: NodesMap,
  section: AiPageSection,
  sectionIds: readonly string[],
): NodesMap {
  const nodes: Record<string, Record<string, unknown>> = {}
  const previous = (page as unknown as Record<string, Record<string, unknown>>)[section.rootId]
  const replaced = new Set<string>()
  if (previous) {
    for (const { id } of walkTree({
      rootId: section.rootId,
      nodes: page as unknown as Record<string, AiDoctrineNode>,
    })) {
      replaced.add(id)
    }
  }
  for (const [id, node] of Object.entries(page)) {
    if (!replaced.has(id)) nodes[id] = { ...(node as unknown as Record<string, unknown>) }
  }
  const root = nodes[CANVAS_ROOT_ELEMENT_ID] ?? (aiEmptyPage()[CANVAS_ROOT_ELEMENT_ID] as unknown as Record<string, unknown>)
  const children = (Array.isArray(root['nodes']) ? (root['nodes'] as string[]) : []).filter(
    (id) => id !== section.rootId,
  )
  const order = new Map(sectionIds.map((id, position) => [id, position]))
  const at = order.get(section.rootId) ?? sectionIds.length
  const before = children.findIndex((id) => (order.get(id) ?? -1) > at)
  children.splice(before === -1 ? children.length : before, 0, section.rootId)
  nodes[CANVAS_ROOT_ELEMENT_ID] = { ...root, nodes: children }
  for (const [id, node] of Object.entries(section.nodes)) {
    nodes[id] = { ...(node as unknown as Record<string, unknown>) }
  }
  return nodes as unknown as NodesMap
}

/**
 * What a tree generated against this inventory may reference, the brand it is
 * held to, where the workspace keeps no reusable components or saved forms
 * (AGL-3030) that the page is built inline, and the sections its plan names,
 * which a link may take a visitor to (AGL-3097).
 */
export function aiPageCheckContext(
  inventory: AiSiteInventory | null,
  options: { reusableComponents?: boolean; sections?: readonly string[] } = {},
): AiDoctrineTreeContext {
  return {
    brand: inventory?.theme ? { colors: inventory.theme.colors, fonts: inventory.theme.fonts } : null,
    ...aiNodeTreeContextFromInventory(inventory),
    homeScreenIds: aiHomeScreenIds(inventory),
    ...(options.reusableComponents === false ? { reusableComponents: false } : {}),
    ...(options.sections?.length ? { pageSections: options.sections } : {}),
  }
}

export interface AiPageSectionCheckInput {
  /** The page as stored so far; an empty page on the first pass. */
  page: NodesMap
  /** Every section root id of the plan, in order. */
  sectionIds: readonly string[]
  index: number
  context: AiDoctrineTreeContext
  /** What the plan line says the section places: inventory ids. */
  uses: readonly string[]
  inventory: AiSiteInventory | null
}

/** The parts of an answer the violations name, as the model wrote them, capped as the doctrine caps a re-ask. */
function offendingOf(raw: unknown, violations: readonly AiDoctrineViolation[]): { offending?: Record<string, unknown> } {
  const rawNodes = isRecord(raw) && isRecord(raw['nodes']) ? raw['nodes'] : {}
  const offending: Record<string, unknown> = {}
  let used = 2
  for (const id of new Set(violations.flatMap((violation) => violation.nodeIds ?? []))) {
    if (rawNodes[id] === undefined) continue
    const size = JSON.stringify(rawNodes[id]).length + id.length + 4
    if (used + size > AI_REASK_OFFENDING_MAX_CHARS) break
    offending[id] = rawNodes[id]
    used += size
  }
  return Object.keys(offending).length ? { offending } : {}
}

/**
 * The check a section's answer is held to: a repeated item written once drawn
 * into its copies (AGL-3053), then the palette validator on the section, with
 * any line it cut at its ceiling refused (AGL-3076), the doctrine's page check
 * on the page with the section added, and the plan line — every component it
 * names placed as an instance, every form bound by its id (rule 7). Violations
 * name the section's own nodes by the ids the MODEL wrote, and a copy's nodes
 * by the item's; one that names only nodes an earlier pass stored belongs to
 * the page rather than to this answer, and is left to the last pass (AGL-3078).
 */
export function aiPageSectionCheck(input: AiPageSectionCheckInput): AiGenerationCheck<AiPageSection> {
  const sectionId = input.sectionIds[input.index]
  const components = new Set((input.inventory?.components ?? []).map((row) => row.id))
  const forms = new Set((input.inventory?.forms ?? []).map((row) => row.id))
  return (answer) => {
    const raw = aiAnswerTree(answer)
    const drawn = expandAiRepeatedItems(raw, { inline: input.context.reusableComponents === false, noun: 'section' })
    if (drawn.ok === false) {
      return { value: null, violations: drawn.violations, ...offendingOf(raw, drawn.violations) }
    }
    // Every id below is the drawn tree's; a copy's leads back to the node the model wrote.
    const written = (id: string): string => drawn.sourceIds[id] ?? id
    const validated = validateAiNodeTree(drawn.tree, 'screen', input.context)
    if (validated.ok === false) {
      return {
        value: null,
        violations: [
          {
            rule: null,
            code: `tree-${validated.code}`,
            message: 'The answer could not be used as a section.',
            detail: validated.error,
          },
        ],
      }
    }
    const wrapper = validated.nodes[validated.rootId] as unknown as AiDoctrineNode | undefined
    const top = (wrapper?.nodes ?? []).filter((id) => validated.nodes[id])
    const sectionNode = top.length === 1 ? (validated.nodes[top[0]] as unknown as AiDoctrineNode) : null
    if (!sectionNode || sectionNode.componentId !== 'section') {
      return {
        value: null,
        violations: [
          {
            rule: null,
            code: 'section-shape',
            message: 'Answer with exactly one Section element inside the document wrapper.',
          },
        ],
      }
    }

    // The section's root takes its plan id, so a pass run again finds it, and
    // hangs under the page root; every other minted id stays as minted.
    const minted = top[0]
    const modelIds: Record<string, string> = Object.fromEntries(
      Object.entries(validated.sourceIds).map(([id, source]) => [id, written(source)]),
    )
    modelIds[sectionId] = written(validated.sourceIds[minted] ?? minted)
    const sectionNodes: Record<string, Record<string, unknown>> = {}
    for (const { id, node } of walkTree({
      rootId: minted,
      nodes: validated.nodes as unknown as Record<string, AiDoctrineNode>,
    })) {
      const stored = { ...(node as unknown as Record<string, unknown>) }
      if (id === minted) {
        stored['$id'] = sectionId
        stored['parentId'] = CANVAS_ROOT_ELEMENT_ID
      } else if (stored['parentId'] === minted) {
        stored['parentId'] = sectionId
      }
      sectionNodes[id === minted ? sectionId : id] = stored
    }
    const drawnNodes = isRecord(drawn.tree) && isRecord(drawn.tree['nodes']) ? drawn.tree['nodes'] : {}
    // What the model wrote of one of the section's nodes, by the id the page stores it under.
    const drawnIdOf = (stored: string): string =>
      validated.sourceIds[stored === sectionId ? minted : stored] ?? stored
    // A link that names a section of this page carries the platform's Scroll to
    // element interaction to that section's root, whose id is minted from the
    // plan before the section is built (AGL-3097).
    const sections = input.context.pageSections ?? []
    for (const [id, node] of Object.entries(sectionNodes)) {
      const props = isRecord(node['props']) ? node['props'] : {}
      if (!isAiLinkElement(node['componentId']) || props['screenId'] || props['href']) continue
      const target = aiPageLinkTarget(drawnNodes[drawnIdOf(id)], sections)
      if (target?.kind === 'section') {
        node['interactions'] = [aiPageScrollInteraction(input.sectionIds[target.section], sections[target.section])]
      }
    }
    const section: AiPageSection = { rootId: sectionId, nodes: sectionNodes as unknown as NodesMap, load: null }

    const page = aiPageWithSection(input.page, section, input.sectionIds)
    const own = new Set(Object.keys(sectionNodes))
    // The page check reads the section as the page stores it, where the palette
    // validator has already dropped what it could not read, such as a
    // `container` written as text or a link's `scrollTo`; what the model wrote
    // of each of the section's nodes is read from the section as it was drawn
    // (AGL-3078). A link the page already carries to one of its section roots
    // goes there, whichever pass wrote it (AGL-3097).
    const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page }, 'page', {
      ...input.context,
      writtenNode: (id) => (own.has(id) ? drawnNodes[drawnIdOf(id)] : undefined),
      scrollTargetIds: input.sectionIds,
    })
    // The page check mints its ids afresh: its map leads back to the page's
    // ids, and the section's own lead back to the model's.
    const pageIds = report.tree?.sourceIds ?? {}
    const toModel = (id: string): string | null => {
      const stored = pageIds[id] ?? id
      return own.has(stored) ? (modelIds[stored] ?? stored) : null
    }
    // The page check reads the section as it is stored, where a line the
    // palette validator cut is already cut, so the cut is read from the
    // section's own validation, first (AGL-3076). Copies of one item name one
    // node the model wrote, once.
    //
    // A PASS ANSWERS ONLY FOR THE SECTION IT WROTE (AGL-3078). The page check
    // reads the whole page, so it also names nodes an earlier pass stored; the
    // model is not shown those and cannot mend them, so a finding that names
    // none of this section's nodes is not held against this answer. Dropping
    // it neither hides nor forgives it: the last pass runs the same check on
    // the finished page, where every node is the page's and the review names
    // each one and outlines it. Kept, such a finding would re-ask the model
    // for a node it never saw, refuse the same answer twice, and stop the page
    // with findings whose ids all filtered away — no node ids, and so no
    // outline either.
    const violations: AiDoctrineViolation[] = [
      ...detectCutLines(validated.repairs, drawnNodes, written),
      ...report.violations.flatMap((violation) => {
        if (!violation.nodeIds?.length) return [violation]
        const named = [...new Set(violation.nodeIds.map(toModel).filter((id): id is string => id !== null))]
        return named.length ? [{ ...violation, nodeIds: named }] : []
      }),
    ]

    const placed = new Set<string>()
    const bound = new Set<string>()
    for (const node of Object.values(sectionNodes)) {
      const props = isRecord(node['props']) ? node['props'] : {}
      if (node['componentId'] === REUSABLE_INSTANCE_COMPONENT_ID && typeof props[AI_INSTANCE_REF_PROP] === 'string') {
        placed.add(props[AI_INSTANCE_REF_PROP] as string)
      }
      if (node['componentId'] === 'form' && typeof props['formId'] === 'string') bound.add(props['formId'])
    }
    const missing = input.uses.filter(
      (ref) => (components.has(ref) && !placed.has(ref)) || (forms.has(ref) && !bound.has(ref)),
    )
    if (missing.length) {
      violations.push({
        rule: 7,
        code: 'plan-reuse-not-placed',
        message: `The confirmed plan places ${missing.join(', ')} in this section, and the section does not. Place each one by its id.`,
      })
    }

    return {
      value: { ...section, load: report.load },
      violations,
      ...offendingOf(raw, violations),
    }
  }
}
