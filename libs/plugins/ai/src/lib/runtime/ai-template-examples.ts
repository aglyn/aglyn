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
  STARTER_TEMPLATES,
  type StarterTemplate,
} from '@aglyn/aglyn/app-utils/starter-templates'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  validateAiDoctrineTree,
  type AiDoctrineNode,
  type AiDoctrineTree,
} from './ai-doctrine-validators'
import { isHeadlineVariant } from './ai-palette'
import { AI_PALETTE, AI_SURFACES } from './ai-palette.generated'
import type { AiSystemBlock } from './ai-runtime'

/**
 * The page examples a template generation is shown (AGL-2909): pages from
 * the platform's own starter sites (`STARTER_TEMPLATES`), in the node-map
 * shape the tool takes, as one cached block that is the same bytes for every
 * org.
 *
 * Three things about a starter predate the building rules, and every example
 * is brought up to them the same way rather than shown as it stands:
 *
 * - HEADINGS. A starter picks a heading's look with its variant, and rule 11
 *   reads its level from the element. The page's first heading renders as
 *   its h1, each later one as an h2, and a sixth-level subtitle as a
 *   paragraph.
 * - FORMS. A starter draws its contact form inline, and rule 3 places a form
 *   built on the Forms page by id, so the form is left out.
 * - LINKS. A starter's call to action points nowhere until a member picks
 *   where it goes, and rule 10 refuses a Button or a Screen Link with no
 *   destination (AGL-3072), so such a link is left out.
 *
 * Only props the palette declares are kept, since the model is held to the
 * same palette, and none that holds a px, rem or em length, which rule 5
 * names as a length never to write. A page that still breaks a rule, that
 * the palette validator would change in any way, or that places an element
 * the page surface does not offer (a commerce block) is not shown, and two
 * pages of one shape are shown once: an example the model imitates is one
 * the doctrine accepts exactly as written.
 */

export interface AiTemplateExample {
  /** The starter site's name. */
  starter: string
  /** The page's name within it. */
  page: string
  tree: AiDoctrineTree
}

/** The block's ceiling: 1,500 tokens at four characters a token. */
export const AI_TEMPLATE_EXAMPLES_MAX_CHARS = 6_000

const FORM_COMPONENTS = new Set(['form', 'formField'])

/** The elements a page links with, which go where their `screenId` or `href` says. */
const LINK_COMPONENTS = new Set(['muiButton', 'muiScreenLink'])

/** Whether a starter node is a link that names nowhere to go. */
function linksNowhere(componentId: string, props: Record<string, unknown> | undefined): boolean {
  if (!LINK_COMPONENTS.has(componentId)) return false
  const named = (value: unknown) => typeof value === 'string' && value.trim() !== ''
  return !named(props?.['screenId']) && !named(props?.['href'])
}

/** A CSS length in the units rule 5 forbids. */
const CSS_LENGTH = /\d(?:\.\d+)?(?:px|rem|em)\b/i

type StarterNode = {
  componentId?: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: unknown
}

/** A starter page as the tool's node map, brought up to the rules above; `null` when it cannot be shown. */
export function aiStarterExampleTree(nodes: Record<string, StarterNode>): AiDoctrineTree | null {
  if (!nodes[CANVAS_ROOT_ELEMENT_ID]) return null
  const allowed = new Set(AI_SURFACES.screen.allow)
  const out: Record<string, AiDoctrineNode> = {}
  let headings = 0
  let unavailable = false
  const visit = (id: string): string | null => {
    const node = nodes[id]
    const componentId = String(node?.componentId ?? '')
    if (!node || FORM_COMPONENTS.has(componentId) || linksNowhere(componentId, node.props)) return null
    const root = id === CANVAS_ROOT_ELEMENT_ID
    if (!root && !allowed.has(componentId)) {
      unavailable = true
      return null
    }
    // Inserted before the children, so the map reads top-down.
    const shaped: AiDoctrineNode = { componentId: root ? 'div' : componentId }
    out[id] = shaped
    const declared = AI_PALETTE[componentId]?.propsSchema.properties ?? {}
    const props: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(node.props ?? {})) {
      if (!declared[name] || value === undefined) continue
      if (typeof value === 'string' && CSS_LENGTH.test(value)) continue
      props[name] = value
    }
    if (componentId === 'muiTypography') {
      const variant = props['variant']
      if (variant === 'h6') props['component'] = 'p'
      else if (isHeadlineVariant(variant)) props['component'] = headings++ === 0 ? 'h1' : 'h2'
    }
    if (Object.keys(props).length) shaped.props = props
    if (node.sx && Object.keys(node.sx).length) shaped.sx = node.sx
    const children = (Array.isArray(node.nodes) ? (node.nodes as unknown[]) : [])
      .map((child) => (typeof child === 'string' ? visit(child) : null))
      .filter((child): child is string => child !== null)
    if (children.length) shaped.nodes = children
    return id
  }
  visit(CANVAS_ROOT_ELEMENT_ID)
  return unavailable ? null : { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: out }
}

/** A tree's element structure without its copy or ids, to show one shape once. */
function shapeOf(tree: AiDoctrineTree, id = tree.rootId): string {
  const node = tree.nodes[id]
  return `${node.componentId}(${(node.nodes ?? []).map((child) => shapeOf(tree, child)).join(',')})`
}

/** Every starter page the doctrine accepts as a template exactly as the example shows it. */
export function aiStarterTemplateExamples(
  starters: readonly StarterTemplate[] = STARTER_TEMPLATES,
): AiTemplateExample[] {
  const examples: AiTemplateExample[] = []
  const shapes = new Set<string>()
  for (const starter of starters) {
    for (const screen of starter.screens) {
      const tree = aiStarterExampleTree(screen.nodes as Record<string, StarterNode>)
      if (!tree) continue
      const report = validateAiDoctrineTree(tree, 'template')
      if (!report.ok || !report.tree || report.tree.repairs.length) continue
      const shape = shapeOf(tree)
      if (shapes.has(shape)) continue
      shapes.add(shape)
      examples.push({ starter: starter.displayName, page: screen.displayName, tree })
    }
  }
  return examples
}

export const AI_TEMPLATE_EXAMPLES_PREAMBLE = [
  'Examples: pages from the platform’s starter sites, in the node-map shape the tool takes.',
  'Build the way they are built: each band a Container at a stock width (xl for a marketing band, lg for an interactive one, md for prose) with vertical padding on the spacing scale, its content in a Stack, and one h1 for the page.',
  'Their copy is the starter’s own; a template binds its subject’s tokens wherever a record’s own words, links or pictures go.',
].join(' ')

/** The examples as one cached system block, held to its ceiling an example at a time. */
export function aiTemplateExamplesBlock(
  examples: readonly AiTemplateExample[] = aiStarterTemplateExamples(),
): AiSystemBlock {
  const parts = [AI_TEMPLATE_EXAMPLES_PREAMBLE]
  let used = AI_TEMPLATE_EXAMPLES_PREAMBLE.length
  for (const example of examples) {
    const text = `Starter "${example.starter}", page "${example.page}":\n${JSON.stringify(example.tree)}`
    if (used + text.length + 2 > AI_TEMPLATE_EXAMPLES_MAX_CHARS) continue
    parts.push(text)
    used += text.length + 2
  }
  return { text: parts.join('\n\n'), cacheBreakpoint: true }
}

let examplesBlock: AiSystemBlock | null = null

/** The block a template generation sends, built once per process from the starters. */
export function aiTemplateExamplesSystemBlock(): AiSystemBlock {
  examplesBlock ??= aiTemplateExamplesBlock()
  return examplesBlock
}
