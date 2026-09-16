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

// lockdown-423: via libs/plugins/ai/src/lib/runtime/ai-gate.ts
// The POST climbs `aiGateLadder`, whose lockdown rung is the verdict.

import { NODE_HIDE_IF_PROP } from '@aglyn/aglyn/app-utils/compose-reusable-components'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  ASSIST_EDIT_ACTION_ID,
  assistEditDocumentOf,
  summarizeAssistEditOps,
  type AssistEditCanvasContext,
  type AssistEditCanvasNode,
  type AssistEditComponentProp,
  type AssistEditPropBinding,
  type AssistEditProposal,
  type AssistEditSaveAsComponentOp,
  type AssistEditTarget,
} from '../model/assist-edit'
import type { AiSystemBlock, AiTool } from '../providers/contract'
import { AI_ROUTING_TABLE } from '../providers/routing'
import {
  aiComponentPropBindsToField,
  aiComponentUnofferedAnswers,
  type AiComponentPropBinding,
} from '../runtime/ai-component-bindings'
import {
  runValidatedGeneration,
  type AiCustomGenerationInput,
  type AiGenerationCheckResult,
  type AiValidatedGeneration,
} from '../runtime/ai-doctrine'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import { aiGateLadder } from '../runtime/ai-gate'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import {
  AI_COMPONENT_MAX_PROPS,
  AI_COMPONENT_PROP_KINDS,
  aiComponentPropKindWords,
} from '../tools/ai-component-tool'
import { recordAssistExchange, releaseAssistMessage } from '../usage/assist-usage'
import { parseAssistEditContext } from './assist-edit'

/**
 * Save the selection as a reusable component, with AI (AGL-2908):
 * `POST /api/ai/generate/component { orgId, hostId, route, canvas, name }`.
 *
 * The second entry point of the component job. The first builds a component
 * from a brief; this one reads a section the person already has and proposes
 * which of its values become properties — the judgment a person makes in
 * FILE ▸ Properties…, made from the same evidence.
 *
 * ## What it sends, and nothing else
 *
 * The outline of the open page, component or layout — its elements, their
 * names, their shortened settings and text, and the selected element's own
 * styles — and the name the member typed for the component. It reads no
 * other page, no entry, no product, no contact and no site inventory, so
 * none of them is sent. The `AI_DOORS` entry says so.
 *
 * ## It answers references, never a document
 *
 * `props[]` without defaults, and `bindings[]` of `{ nodeId, field, prop }`.
 * The outline shortens every string, so the server has no full value to make
 * a default out of and never invents one: the client reads each bound
 * field's current value off the live canvas as it writes the token in, which
 * is what makes the instance render exactly what was there.
 *
 * ## It writes nothing
 *
 * The answer is an `AssistEditProposal` carrying one `saveAsComponent` op,
 * shown on AGL-2906's own card. The member applies it, and the apply creates
 * the component through the host resources route and swaps the subtree for
 * an instance on the open draft. This door touches no document at all.
 *
 * ## The rungs
 *
 * `aiGateLadder`: the `aiGenerative` entitlement, `release_ai_generative`,
 * the `ai-generate` lockdown switch, `ai.generate` on the site the body
 * named, a per-uid window and a reservation. A refusal before the model runs
 * hands the reservation back.
 */

/** The name of the structured-output tool the proposal arrives through. */
export const AI_COMPONENT_SELECTION_TOOL_NAME = 'propose_component_from_selection'

/** The doctrine kind this step runs under; it has no tree of its own to read. */
export const AI_COMPONENT_SELECTION_KIND = 'component-selection'

/**
 * The answer ceiling. A proposal is a property list and a binding list —
 * references, never a tree — so it needs a fraction of what the from-brief
 * step's answer does.
 */
export const AI_COMPONENT_SELECTION_MAX_TOKENS = 4_000

const RATE_LIMIT = { key: 'ai-generate-component', limit: 10, windowMs: 60_000 }

/** The longest name a component is created under, as the promote dialog takes one. */
const NAME_CHARS = 80
/** The longest summary the card shows. */
const SUMMARY_CHARS = 160

const NAME_MAX = 40
const LABEL_MAX = 80
const HELP_MAX = 200

const PROP_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every control character and line separator as a space, then squeezed and cut. */
function cleanText(value: unknown, limit: number): string {
  let out = ''
  for (const char of String(value ?? '')) {
    const code = char.charCodeAt(0)
    out +=
      code < 32 || code === 127 || code === 0x85 || code === 0x2028 || code === 0x2029
        ? ' '
        : char
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, limit)
}

/* ------------------------------------------------------------------ *
 * The selection
 * ------------------------------------------------------------------ */

/** The element ids of the selection's subtree, the selection included. */
export function aiComponentSelectionIds(
  context: AssistEditCanvasContext,
  selectedId: string,
): Set<string> {
  const byParent = new Map<string, string[]>()
  for (const node of context.nodes) {
    if (!node.parentId) continue
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node.id])
  }
  const found = new Set<string>([selectedId])
  const queue = [...(byParent.get(selectedId) ?? [])]
  while (queue.length) {
    const id = queue.shift() as string
    if (found.has(id)) continue
    found.add(id)
    queue.push(...(byParent.get(id) ?? []))
  }
  return found
}

/** A heading's level in the outline: the element it renders as, else its variant. */
function headingLevel(node: AssistEditCanvasNode): number | null {
  if (node.componentId !== 'muiTypography') return null
  const props = node.props ?? {}
  const element = typeof props['component'] === 'string' ? props['component'] : ''
  const match = /^h([1-6])$/.exec(element || String(props['variant'] ?? ''))
  return match ? Number(match[1]) : null
}

/** Whichever element a node was told to render as. */
const elementOf = (node: AssistEditCanvasNode): string => {
  const value = node.props?.['component'] ?? node.props?.['element']
  return typeof value === 'string' ? value : ''
}

/** Why this selection cannot become a component; `null` when it can. */
export function aiComponentSelectionRefusal(
  context: AssistEditCanvasContext,
  selectedId: string | null,
): string | null {
  if (!selectedId || selectedId === CANVAS_ROOT_ELEMENT_ID) {
    return 'Select the section you want to save as a component first.'
  }
  const described = new Map(context.nodes.map((node) => [node.id, node]))
  const selection = described.get(selectedId)
  if (!selection) {
    return 'Select the section you want to save as a component first.'
  }
  const ids = aiComponentSelectionIds(context, selectedId)
  // The outline stops at a cap, so a selection larger than it can describe is
  // one the model would read half of. Refuse rather than guess at the rest.
  for (const id of ids) {
    const node = described.get(id)
    if (!node) return 'This section is too large to read all of. Pick a smaller part of it.'
    if (node.childCount > (context.nodes.filter((other) => other.parentId === id).length ?? 0)) {
      return 'This section is too large to read all of. Pick a smaller part of it.'
    }
  }
  // Rule 11, before any spend: a component is placed inside pages, so it
  // carries neither the main landmark nor a second top-level heading.
  const inside = [...ids].map((id) => described.get(id)).filter(Boolean) as AssistEditCanvasNode[]
  if (inside.some((node) => elementOf(node) === 'main')) {
    return 'This section is the page’s main landmark, which a component cannot carry. Pick the part inside it.'
  }
  if (inside.filter((node) => headingLevel(node) === 1).length > 1) {
    return 'This section has more than one top-level heading. A component carries at most one.'
  }
  return null
}

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

const STRING = { type: 'string' } as const

/**
 * The strict tool the proposal arrives through. Every field is required and
 * flat — optional properties are not portable across strict tool
 * implementations — so a kind with no answers sends `[]`.
 */
export function aiComponentSelectionTool(): AiTool {
  return {
    name: AI_COMPONENT_SELECTION_TOOL_NAME,
    description:
      'Propose the properties this section should declare once it is a reusable component, and where each one binds.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'props', 'bindings'],
      properties: {
        summary: {
          type: 'string',
          description: 'One line, for the person deciding: what each page will be able to change.',
        },
        props: {
          type: 'array',
          description: 'The properties, in the order a page sets them.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'type', 'label', 'description', 'options'],
            properties: {
              name: {
                type: 'string',
                description: 'Letters, digits and underscores, starting with a letter.',
              },
              type: {
                type: 'string',
                enum: [...AI_COMPONENT_PROP_KINDS],
                description: `The kind, as type (the name a page reads): ${aiComponentPropKindWords()}.`,
              },
              label: {
                type: 'string',
                description:
                  'The words a page reads beside the field. A property that hides an optional part is labeled "Hide …".',
              },
              description: { type: 'string', description: 'Help beside the field, or "".' },
              options: {
                type: 'array',
                description: 'The answers of a choice; [] for every other kind.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['value', 'label'],
                  properties: {
                    value: {
                      type: 'string',
                      description: 'What the bound field receives: one of the values that field lists.',
                    },
                    label: { type: 'string', description: 'What a page picks.' },
                  },
                },
              },
            },
          },
        },
        bindings: {
          type: 'array',
          description: 'Where each property goes. Every property is bound at least once.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nodeId', 'field', 'prop'],
            properties: {
              nodeId: {
                type: 'string',
                description: 'An element id from the selected section, as the outline gave it.',
              },
              field: {
                type: 'string',
                description: `A setting of that element, or "${NODE_HIDE_IF_PROP}" to hide an optional part.`,
              },
              prop: { type: 'string', description: 'The name of the property it takes.' },
            },
          },
        },
      },
    },
  }
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

/** What the model proposed, once it has been read and held to the selection. */
export interface AiComponentSelectionProposal {
  summary: string
  props: AssistEditComponentProp[]
  bindings: AssistEditPropBinding[]
}

/** The label a property that hides an optional part opens with. */
const HIDE_LABEL = /^Hide\b/

const paletteEntry = (componentId: string) => AI_PALETTE[componentId]

/**
 * The proposal, held to the selection it was made from.
 *
 * A CLOSED WORLD, like the edit rung's: every element named is one the
 * outline described, inside the selection. A binding outside it would tie a
 * property of the new component to an element the component does not
 * contain, and the token would render as its own marker on the page.
 *
 * Every other rule is the from-brief step's own, read from the same module,
 * so the two paths cannot disagree about which property fits which field.
 */
export function checkAiComponentSelection(
  answer: Record<string, unknown>,
  context: AssistEditCanvasContext,
  selectedId: string,
): AiGenerationCheckResult<AiComponentSelectionProposal> {
  const violations: AiDoctrineViolation[] = []
  const finding = (code: string, message: string, path: string): void => {
    violations.push({ rule: 1, code, message, paths: [path] })
  }
  const inside = aiComponentSelectionIds(context, selectedId)
  const described = new Map(context.nodes.map((node) => [node.id, node]))

  const rawProps = Array.isArray(answer['props']) ? answer['props'] : null
  const rawBindings = Array.isArray(answer['bindings']) ? answer['bindings'] : null
  if (!rawProps || !rawBindings) {
    finding(
      'proposal-missing',
      'The proposal came without its properties or its bindings. Send both lists, even when one is empty.',
      'props',
    )
    return { value: null, violations }
  }
  if (rawProps.length > AI_COMPONENT_MAX_PROPS) {
    finding(
      'props-too-many',
      `A component declares at most ${AI_COMPONENT_MAX_PROPS} properties. Keep the ones a page really changes.`,
      'props',
    )
    return { value: null, violations }
  }

  const props: AssistEditComponentProp[] = []
  const byName = new Map<string, AssistEditComponentProp>()
  rawProps.forEach((raw, index) => {
    const path = `props[${index}]`
    if (!isRecord(raw)) return finding('prop-shape', 'A property is not an object.', path)
    const name = cleanText(raw['name'], NAME_MAX)
    if (!PROP_NAME.test(name)) {
      return finding(
        'prop-name',
        'A property name is letters, digits and underscores, starting with a letter.',
        path,
      )
    }
    if (byName.has(name)) {
      return finding('prop-duplicate', `Two properties are called "${name}".`, path)
    }
    const type = cleanText(raw['type'], NAME_MAX)
    if (!(AI_COMPONENT_PROP_KINDS as readonly string[]).includes(type)) {
      return finding('prop-kind', `"${type}" is not a kind a property takes.`, path)
    }
    const options = Array.isArray(raw['options'])
      ? raw['options']
          .filter(isRecord)
          .map((option) => ({
            value: cleanText(option['value'], LABEL_MAX),
            label: cleanText(option['label'], LABEL_MAX),
          }))
          .filter((option) => option.value)
      : []
    if (type === 'choice' && !options.length) {
      return finding('prop-answers', `The choice "${name}" lists no answers.`, path)
    }
    const label = cleanText(raw['label'], LABEL_MAX)
    const description = cleanText(raw['description'], HELP_MAX)
    const prop: AssistEditComponentProp = {
      name,
      type: type as AssistEditComponentProp['type'],
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(options.length ? { options } : {}),
    }
    props.push(prop)
    byName.set(name, prop)
  })
  if (violations.length) return { value: null, violations }

  const bindings: AssistEditPropBinding[] = []
  const bound = new Set<string>()
  rawBindings.forEach((raw, index) => {
    const path = `bindings[${index}]`
    if (!isRecord(raw)) return finding('binding-shape', 'A binding is not an object.', path)
    const nodeId = cleanText(raw['nodeId'], 64)
    const node = described.get(nodeId)
    if (!node || !inside.has(nodeId)) {
      return finding(
        'binding-outside',
        'A property is bound to an element outside the section being saved. Bind only elements the section contains.',
        path,
      )
    }
    const field = cleanText(raw['field'], 40)
    if (!FIELD_NAME.test(field)) {
      return finding('binding-field', `"${field}" is not a setting of an element.`, path)
    }
    if (field === NODE_HIDE_IF_PROP && nodeId === selectedId) {
      return finding(
        'binding-hides-all',
        'A property cannot hide the whole component. Hide the optional part inside it.',
        path,
      )
    }
    const propName = cleanText(raw['prop'], NAME_MAX)
    const prop = byName.get(propName)
    if (!prop) {
      return finding('binding-undeclared', `No property is called "${propName}".`, path)
    }
    const entry = paletteEntry(node.componentId)
    const binding = prop as AiComponentPropBinding
    if (!aiComponentPropBindsToField(binding, entry, field, 'whole')) {
      return finding(
        'binding-fit',
        `"${prop.name}" does not fit the "${field}" setting of that element. Bind it to a setting of its own kind.`,
        path,
      )
    }
    const unoffered = aiComponentUnofferedAnswers(binding, entry, field)
    if (unoffered.length) {
      return finding(
        'binding-answers',
        `The answers ${unoffered.join(', ')} of "${prop.name}" are not ones that setting lists.`,
        path,
      )
    }
    if (field === NODE_HIDE_IF_PROP && !HIDE_LABEL.test(prop.label ?? '')) {
      return finding(
        'hide-label',
        `A property that hides a part is labeled "Hide …", so a page reads what it does. "${prop.name}" is not.`,
        path,
      )
    }
    bound.add(propName)
    bindings.push({ nodeId, componentId: node.componentId, field, prop: propName })
  })
  if (violations.length) return { value: null, violations }

  for (const prop of props) {
    if (bound.has(prop.name)) continue
    finding(
      'prop-unbound',
      `"${prop.name}" is declared and never bound. Every property fills a setting of the section.`,
      'bindings',
    )
  }
  if (!bindings.length) {
    finding(
      'nothing-proposed',
      'Nothing in this section was proposed as a property. Name the values a page should be able to change.',
      'bindings',
    )
  }
  if (violations.length) return { value: null, violations }
  return {
    value: {
      summary: cleanText(answer['summary'], SUMMARY_CHARS),
      props,
      bindings,
    },
    violations: [],
  }
}

/* ------------------------------------------------------------------ *
 * The request
 * ------------------------------------------------------------------ */

const INSTRUCTION_TEXT = [
  'You are naming the properties a section should declare once it becomes a reusable component.',
  '',
  'A person selected a section of a page they are editing. You are given the outline of that page — its elements, their settings and their text, shortened — and the id of the element they selected. Decide which of the values inside that selection a page placing the component should be able to change, and bind each one to the setting it fills.',
  '',
  'Rules:',
  '- Only elements inside the selected section. Never bind anything outside it.',
  '- One property per thing a page changes, not one per element. A heading and the paragraph under it are two properties; the same heading bound twice is one.',
  '- Bind a property to a setting of its own kind: copy to text, a picture to a picture, an address to a link, an answer to a setting that lists answers.',
  `- An optional part gets a Yes / no property labeled "Hide …", bound to that part's "${NODE_HIDE_IF_PROP}". Never to the section itself.`,
  '- Leave alone what every page should show the same way: the layout, the styling, the labels that make the section what it is.',
  '- Do not invent defaults. The editor reads each value off the page as it writes the property in.',
  '',
  `Answer by calling ${AI_COMPONENT_SELECTION_TOOL_NAME} exactly once. A reply in prose cannot be used.`,
].join('\n')

/** Byte-identical on every request, so the block caches. */
export const AI_COMPONENT_SELECTION_INSTRUCTIONS: AiSystemBlock[] = [
  { text: INSTRUCTION_TEXT, cacheBreakpoint: true },
]

/** The outline and the selection, as the question the model answers. */
export function aiComponentSelectionPrompt(
  context: AssistEditCanvasContext,
  selectedId: string,
  name: string,
): string {
  const inside = aiComponentSelectionIds(context, selectedId)
  const lines = context.nodes.map((node) => {
    const parts = [
      `${inside.has(node.id) ? '*' : ' '} ${node.id}: ${node.componentId}`,
      node.name ? `name=${JSON.stringify(node.name)}` : '',
      node.parentId ? `in=${node.parentId}` : 'root',
      node.childCount ? `children=${node.childCount}` : '',
      node.props ? `settings=${JSON.stringify(node.props)}` : '',
    ]
    return parts.filter(Boolean).join(' ')
  })
  return [
    `The component will be called ${JSON.stringify(name)}.`,
    `The selected section is ${selectedId}; every line marked * is inside it.`,
    '',
    ...lines,
  ].join('\n')
}

/** What the door answers on success. */
export interface AiComponentSelectionAnswer {
  edit: AssistEditProposal
  exchangeId: string | null
}

/**
 * The proposal for one selection, as the op the card applies. Exported for
 * the spec, which drives it with a recorded answer and never a live model.
 */
export function aiComponentSelectionOp(
  proposal: AiComponentSelectionProposal,
  selection: AssistEditCanvasNode,
  name: string,
): AssistEditSaveAsComponentOp {
  return {
    op: 'saveAsComponent',
    nodeId: selection.id,
    componentId: selection.componentId,
    name,
    props: proposal.props,
    bindings: proposal.bindings,
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown> | null
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = null
  }
  const rawHost = body?.['hostId']
  const hostId = typeof rawHost === 'string' && rawHost ? rawHost : null
  const gate = await aiGateLadder(
    { request, orgId: String(body?.['orgId'] ?? ''), hostId },
    {
      feature: 'aiGenerative',
      releaseFlag: 'release_ai_generative',
      lockdownFeature: 'ai-generate',
      permission: 'ai.generate',
      rateLimit: RATE_LIMIT,
    },
  )
  if (gate instanceof Response) return gate
  // Nothing is spent until the model runs, so every exit before it hands the
  // reservation back.
  const release = () =>
    releaseAssistMessage(gate.firestore, gate.orgId, gate.reservation).catch(() => undefined)
  const refuse = async (error: string, status: number): Promise<Response> => {
    await release()
    return Response.json({ error }, { status })
  }

  if (!hostId) return refuse('Open the site this section is on before saving it.', 400)
  const document = assistEditDocumentOf(String(body?.['route'] ?? ''))
  if (!document) {
    return refuse('Open the page, component or layout this section is on.', 400)
  }
  const context = parseAssistEditContext(body?.['canvas'])
  if (!context) return refuse('The editor did not describe what is open.', 400)
  const name = cleanText(body?.['name'], NAME_CHARS)
  if (!name) return refuse('Give the component a name first.', 400)

  const selectedId = context.selectedId
  const refusal = aiComponentSelectionRefusal(context, selectedId)
  if (refusal) return refuse(refusal, 400)
  const selection = context.nodes.find((node) => node.id === selectedId)
  if (!selection) return refuse('Select the section you want to save as a component first.', 400)

  const target: AssistEditTarget = { hostId, ...document }
  const generation: AiCustomGenerationInput<AiComponentSelectionProposal> = {
    step: 'job.component',
    instructions: AI_COMPONENT_SELECTION_INSTRUCTIONS,
    // No site inventory: this step reads the open document and nothing else
    // of the site, and the disclosure says so.
    inventory: undefined,
    messages: [{ role: 'user', content: aiComponentSelectionPrompt(context, selection.id, name) }],
    tool: aiComponentSelectionTool(),
    maxTokens: AI_COMPONENT_SELECTION_MAX_TOKENS,
    ...(AI_ROUTING_TABLE['job.component'].thinking
      ? { thinking: AI_ROUTING_TABLE['job.component'].thinking }
      : {}),
    check: (answer) => checkAiComponentSelection(answer, context, selection.id),
  }
  let result: AiValidatedGeneration<AiComponentSelectionProposal>
  try {
    result = await runValidatedGeneration(AI_COMPONENT_SELECTION_KIND, generation)
  } catch (error) {
    await release()
    console.error('ai component proposal failed', { orgId: gate.orgId, hostId, error })
    return Response.json({ error: 'The component could not be proposed' }, { status: 500 })
  }

  if (result.status !== 'ok') {
    const error =
      result.status === 'refused'
        ? 'The assistant would not propose a component for this section.'
        : (result.message ??
          'The assistant could not name properties for this section. Try a smaller part of it.')
    // The model ran, so the reservation is spent: it is not handed back.
    return Response.json({ error }, { status: 422 })
  }

  const op = aiComponentSelectionOp(result.value, selection, name)
  const edit: AssistEditProposal = {
    id: ASSIST_EDIT_ACTION_ID,
    summary: result.value.summary,
    ops: [op],
    diff: summarizeAssistEditOps([op]),
    dropped: [],
    target,
  }
  let exchangeId: string | null = null
  try {
    exchangeId = await recordAssistExchange(gate.firestore, gate.orgId, {
      uid: gate.uid,
      hostId,
      kind: 'component',
      // The person's own words for the component, and the proposal's line
      // back: the pair the signals page reads, and nothing off the page.
      question: name,
      answer: edit.summary,
      route: String(body?.['route'] ?? ''),
      model: result.model,
      tier: 'entitled',
      usage: result.usage,
      docsPaths: [],
      stopReason: result.stopReason,
      free: gate.reservation.free ?? null,
      editOps: edit.ops.length,
    })
  } catch (error) {
    // The proposal is the answer; a meter that could not be written is not a
    // reason to withhold it from the person who paid for it.
    console.error('ai component exchange not recorded', { orgId: gate.orgId, error })
  }
  return Response.json({ edit, exchangeId } satisfies AiComponentSelectionAnswer)
}
