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

import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-alt'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiSeoContentFix } from '../model/ai-seo'
import { validateAiNodeTree } from './ai-node-tree'
import { AI_TEXT_LIMITS } from './ai-palette'

/**
 * A site audit's content fixes, applied to a COPY of a page's node map
 * (AGL-2910). The caller stores the result as a new unpublished version;
 * nothing here reads or writes a document, and the map it is handed is
 * never changed.
 *
 * Each fix is checked against the page as it is now, not as it was audited:
 * an image that has gained a description keeps it, a heading that has gone
 * is skipped, and every skip is named. A heading's new text and a new
 * heading pass the AI node-tree validator — the one path an AI-emitted node
 * takes into storage — before they touch the copy.
 */

export interface AiSeoContentFixResult {
  nodes: Record<string, Record<string, unknown>>
  /** Fixes that changed the copy. */
  applied: AiSeoContentFix[]
  /** Fixes that did not, each with the customer-safe reason. */
  skipped: Array<{ fix: AiSeoContentFix; reason: string }>
}

type StoredNode = Record<string, unknown> & { props?: Record<string, unknown>; nodes?: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const TEXT_COMPONENTS: ReadonlySet<string> = new Set(['muiTypography', 'muiInlineText', 'muiListItemText'])

/**
 * A heading as the validator would store it: the text held to a headline's
 * length and the element to the palette. `null` when the validator refuses
 * it — the text is not something a generated heading may say.
 */
function validatedHeading(level: 1 | 2, text: string): { text: string; node: Record<string, unknown> } | null {
  const result = validateAiNodeTree(
    {
      rootId: CANVAS_ROOT_ELEMENT_ID,
      nodes: {
        [CANVAS_ROOT_ELEMENT_ID]: {
          $id: CANVAS_ROOT_ELEMENT_ID,
          componentId: 'div',
          parentId: null,
          nodes: ['heading'],
        },
        heading: {
          $id: 'heading',
          componentId: 'muiTypography',
          parentId: CANVAS_ROOT_ELEMENT_ID,
          props: { variant: `h${level}`, children: text.slice(0, AI_TEXT_LIMITS.headline) },
          nodes: [],
        },
      },
    },
    'screen',
  )
  if (!result.ok) return null
  const root = result.nodes[result.rootId] as { nodes?: string[] }
  const node = result.nodes[root.nodes?.[0] ?? ''] as Record<string, unknown> | undefined
  const props = (node?.['props'] ?? {}) as Record<string, unknown>
  const children = typeof props['children'] === 'string' ? props['children'].trim() : ''
  return children && node ? { text: children, node } : null
}

const cloneNodes = (nodes: Record<string, unknown>): Record<string, StoredNode> =>
  JSON.parse(JSON.stringify(nodes)) as Record<string, StoredNode>

/** Apply `fixes` to a copy of `nodes`, whose content region starts at `contentRootId`. */
export function applyAiSeoContentFixes(
  nodes: Record<string, unknown>,
  fixes: readonly AiSeoContentFix[],
  contentRootId: string | null,
): AiSeoContentFixResult {
  const copy = cloneNodes(nodes)
  const applied: AiSeoContentFix[] = []
  const skipped: AiSeoContentFixResult['skipped'] = []
  const skip = (fix: AiSeoContentFix, reason: string) => skipped.push({ fix, reason })

  for (const fix of fixes) {
    switch (fix.kind) {
      case 'image-alt': {
        const node = copy[fix.nodeId]
        if (!node || node['componentId'] !== 'image') {
          skip(fix, 'The image is no longer on the page.')
          break
        }
        const props = isRecord(node.props) ? node.props : {}
        if (String(props['alt'] ?? '').trim()) {
          skip(fix, 'The image has been given a description since the audit.')
          break
        }
        const alt = fix.alt.replace(/\s+/g, ' ').trim().slice(0, MEDIA_ALT_MAX_LENGTH)
        if (!alt) {
          skip(fix, 'The proposed description was empty.')
          break
        }
        node.props = { ...props, alt }
        applied.push(fix)
        break
      }
      case 'h1-set':
      case 'h1-demote': {
        const node = copy[fix.nodeId]
        const props = node && isRecord(node.props) ? node.props : null
        if (!node || !props || !TEXT_COMPONENTS.has(String(node['componentId']))) {
          skip(fix, 'The heading is no longer on the page.')
          break
        }
        if (typeof props['html'] === 'string' && props['html'].trim()) {
          skip(fix, 'The heading is rich text, which a fix does not rewrite.')
          break
        }
        if (fix.kind === 'h1-demote') {
          node.props = { ...props, component: 'h2' }
          applied.push(fix)
          break
        }
        const heading = validatedHeading(1, fix.text)
        if (!heading) {
          skip(fix, 'The proposed heading could not be used.')
          break
        }
        node.props = { ...props, component: 'h1', children: heading.text }
        applied.push(fix)
        break
      }
      case 'h1-insert': {
        const parent = contentRootId ? copy[contentRootId] : undefined
        if (!parent || !contentRootId) {
          skip(fix, 'The page has no content region to add a heading to.')
          break
        }
        const heading = validatedHeading(1, fix.text)
        if (!heading) {
          skip(fix, 'The proposed heading could not be used.')
          break
        }
        const id = String(heading.node['$id'])
        copy[id] = { ...heading.node, parentId: contentRootId, nodes: [] }
        const children = Array.isArray(parent.nodes) ? (parent.nodes as unknown[]) : []
        parent.nodes = [id, ...children]
        applied.push(fix)
        break
      }
    }
  }
  return { nodes: copy, applied, skipped }
}
