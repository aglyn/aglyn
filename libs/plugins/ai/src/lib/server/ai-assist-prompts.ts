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

import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  sanitizeMarketplaceDefinition,
} from '@aglyn/aglyn/app-utils/node-definition-sanitizer'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import { AI_ACCEPTABLE_USE_BLOCK, type AiSystemBlock, type AiTool } from '../runtime/ai-runtime'
import type { AiResult } from '../providers/contract'

/**
 * The copy assistant's prompts and its section tool (AGL-2937), by their own
 * module so a spec can read them without a Firestore, an ID token or a
 * provider — the handler beside them needs all three.
 *
 * ── Why the section mode answers through a tool ───────────────────────────
 *
 * It asked for "ONLY a JSON object, no prose or code fences" and then parsed
 * whatever came back, stripping a fence if it found one. When that parse
 * failed the handler answered 502 and the tokens were already spent: the
 * whole request, prompt and answer, bought nothing, and the member's next
 * move is to press the button again and spend it twice. A strict tool is the
 * cheaper shape for exactly that reason — the answer arrives as validated
 * arguments rather than as text that has to be guessed at — and it is what
 * AGL-2937 asks of every door.
 *
 * The parse stays as a fallback. A provider whose adapter has no tool
 * support, or a model that answers in prose anyway, still gets read rather
 * than refused: the tool is how the answer is asked for, not the only way it
 * can arrive.
 *
 * ── Why the flat node list ────────────────────────────────────────────────
 *
 * A strict schema forbids additional properties, so a map keyed by node id
 * cannot be described in one: every key would have to be a declared
 * property. The tool therefore takes a LIST of nodes, each naming its own id
 * and its children by id, and `readAssistSection` rebuilds the map the
 * besigner consumer already reads. The same reason `assistEditTool` takes
 * name/value pairs rather than a props object.
 *
 * ── Caching ───────────────────────────────────────────────────────────────
 *
 * Each mode's static text carries a breakpoint. None of the three is long
 * enough for its model to cache today — `runtime/ai-prompt-cache.spec.ts`
 * measures all three against their minimums and records the verdict — so the
 * marker is a statement about the block rather than a saving. It costs
 * nothing, it is correct if a mode is ever served by a model with a lower
 * minimum, and the ledger is what says whether it pays.
 */

export type AiAssistMode = 'element' | 'blog' | 'section'

/** The mode prompts. Static text: no byte of any workspace is in one. */
const MODE_PROMPT: Readonly<Record<AiAssistMode, string>> = {
  element:
    'You write website copy inside a site builder. Reply with ONLY the final text for the element — no quotes, preamble, or markdown. Keep roughly the same length and role as the current text unless the instruction says otherwise.',
  blog:
    'You write blog posts inside a site builder. Reply with ONLY the post body in markdown-lite: **bold**, *italic*, ## headings, - lists, [links](https://url). No front matter, title line, or preamble — the title renders separately.',
  section:
    'You design one website section inside a site builder. Answer by calling ' +
    `${'submit_section'} exactly once, with a flat list of nodes: each node ` +
    'names its own id, the component it is, its parent (empty for the root) ' +
    'and its children by id, and fills props as name/value pairs. Useful ' +
    'props — muiStack: direction (row|column), spacing, justifyContent, ' +
    'alignItems; muiTypography: children, variant (h1..h6, body1, ' +
    'subtitle1); muiButton: children, variant (contained|outlined), color; ' +
    'image: src, alt; muiContainer: maxWidth (sm|md|lg). Keep it small: 4-12 ' +
    'nodes, one root container. Leave image src empty. Write real copy, not ' +
    'lorem ipsum.',
}

/**
 * One mode's system blocks: the acceptable-use rules ahead of the mode's own
 * prompt (AGL-2925), as one cached block with no per-org byte in it.
 */
export function assistModeSystemBlocks(mode: AiAssistMode): AiSystemBlock[] {
  return [{ text: `${AI_ACCEPTABLE_USE_BLOCK}\n\n${MODE_PROMPT[mode]}`, cacheBreakpoint: true }]
}

export const ASSIST_SECTION_TOOL_NAME = 'submit_section'

const STRING = { type: 'string' } as const

const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

/**
 * The strict tool a generated section arrives through. `componentId` is an
 * enum of the marketplace allowlist — the same list the sanitizer holds the
 * answer to afterward — so an unpublishable component is refused by the
 * schema before it costs a re-ask.
 */
export function assistSectionTool(): AiTool {
  const pair = strictObject({ name: STRING, value: STRING })
  const node = strictObject({
    id: STRING,
    componentId: { type: 'string', enum: [...MARKETPLACE_COMPONENT_ID_ALLOWLIST] },
    parentId: STRING,
    children: { type: 'array', items: STRING },
    props: { type: 'array', items: pair },
  })
  return {
    name: ASSIST_SECTION_TOOL_NAME,
    description:
      'Submit the section you designed, as a flat list of nodes. The first ' +
      'node with an empty parentId is the root. The member reviews the ' +
      'section and places it, or discards it.',
    inputSchema: {
      type: 'object',
      properties: { nodes: { type: 'array', items: node } },
      required: ['nodes'],
      additionalProperties: false,
    },
    strict: true,
  }
}

/** The sanitized section, in the shape the besigner consumer already reads. */
export interface AssistSection {
  rootId: string
  nodes: Record<string, unknown>
}

interface RawNode {
  id: string
  componentId: string
  parentId: string
  children: string[]
  props: Array<{ name: string; value: string }>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A pair's value in the type the component's own schema declares for that
 * prop, since a strict tool can only carry strings. `children` stays text
 * whatever a schema says: a number in it is copy a visitor reads, not a
 * count.
 */
function propValue(componentId: string, name: string, value: string): unknown {
  if (name === 'children') return value
  const declared = AI_PALETTE[componentId]?.propsSchema?.properties?.[name] as
    | { type?: string }
    | undefined
  const type = declared?.type
  if (type === 'boolean') return value === 'true'
  if (type === 'number' || type === 'integer') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  if (type) return value
  // No schema for this prop: a bare number is read as one, so `spacing: "2"`
  // does not reach the canvas as text. The palette's own typing wins above,
  // which is why muiStack's string-typed `spacing` stays a string.
  const parsed = Number(value)
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : value
}

/** The flat node list as the stored map: `{ $id, componentId, parentId, props, nodes }`. */
function definitionFromNodes(nodes: readonly RawNode[]): {
  rootId: string
  nodes: Record<string, unknown>
} {
  const ids = new Set(nodes.map((node) => node.id))
  const root = nodes.find((node) => !node.parentId || !ids.has(node.parentId))
  const map: Record<string, unknown> = {}
  for (const node of nodes) {
    const props: Record<string, unknown> = {}
    for (const { name, value } of node.props) {
      if (name) props[name] = propValue(node.componentId, name, value)
    }
    map[node.id] = {
      $id: node.id,
      componentId: node.componentId,
      parentId: node === root ? null : node.parentId,
      props,
      nodes: node.children.filter((child) => ids.has(child)),
    }
  }
  return { rootId: root?.id ?? '', nodes: map }
}

/** A tool call's arguments as nodes, or `null` when the shape is not one. */
function nodesFromToolUse(input: Record<string, unknown>): RawNode[] | null {
  const raw = input['nodes']
  if (!Array.isArray(raw) || !raw.length) return null
  const nodes: RawNode[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) return null
    const id = String(entry['id'] ?? '')
    const componentId = String(entry['componentId'] ?? '')
    if (!id || !componentId) return null
    const props = Array.isArray(entry['props']) ? entry['props'] : []
    nodes.push({
      id,
      componentId,
      parentId: String(entry['parentId'] ?? ''),
      children: (Array.isArray(entry['children']) ? entry['children'] : []).map(String),
      props: props.filter(isRecord).map((pair) => ({
        name: String(pair['name'] ?? ''),
        value: String(pair['value'] ?? ''),
      })),
    })
  }
  return nodes
}

/** The old shape: a JSON object of `{ rootId, nodes }`, possibly fenced. */
function definitionFromText(text: string): { rootId: string; nodes: Record<string, unknown> } | null {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  return {
    rootId: String(parsed['rootId'] ?? ''),
    nodes: isRecord(parsed['nodes']) ? parsed['nodes'] : {},
  }
}

/**
 * What reading a section answer came to. Discriminated by a string rather
 * than a boolean, like every other result in the plugin: this tree compiles
 * without `strictNullChecks`, where a `true`/`false` discriminant does not
 * narrow.
 */
export type AssistSectionRead =
  | { status: 'ok'; section: AssistSection }
  /** Neither a tool call nor JSON: nothing could be read out of the answer. */
  | { status: 'unreadable'; error: string }
  /** Read, and refused by the sanitizer every marketplace install passes. */
  | { status: 'rejected'; error: string }

/**
 * Read a section answer: the tool call first, the text parse behind it, then
 * the marketplace sanitizer every generated subtree has always passed before
 * it reaches a canvas.
 */
export function readAssistSection(result: AiResult): AssistSectionRead {
  const call =
    result.kind === 'completion'
      ? result.toolUse.find((use) => use.name === ASSIST_SECTION_TOOL_NAME)
      : undefined
  const nodes = call ? nodesFromToolUse(call.input) : null
  const definition = nodes
    ? definitionFromNodes(nodes)
    : definitionFromText(result.kind === 'completion' ? result.text : '')
  if (!definition) return { status: 'unreadable', error: 'AI returned invalid JSON' }
  const sanitized = sanitizeMarketplaceDefinition(definition)
  // `=== false`, not `!`: see `AssistSectionRead`.
  if (sanitized.ok === false) return { status: 'rejected', error: sanitized.error }
  return { status: 'ok', section: { rootId: sanitized.rootId, nodes: sanitized.nodes } }
}
