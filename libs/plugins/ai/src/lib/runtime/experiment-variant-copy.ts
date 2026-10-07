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

import { AI_TEXT_LIMITS } from './ai-palette'

/**
 * One A/B variant's copy, put into a COPY of a page's node map (AGL-3603),
 * which the caller stores as a new unpublished version for the variant to
 * pin. Nothing here reads or writes a document, and the map it is handed is
 * never changed.
 *
 * The copy lands in the region the test varies: the whole page's content for
 * a page test, the one section's subtree for a section test. Within it the
 * first heading takes the variant's headline and the first plain text after
 * it takes the body — the same two places the copy under test was read from
 * when a person pasted "the headline and copy as they stand". Rich text is
 * never rewritten, structure is never changed, and a region with no plain
 * heading or text to take the copy says so rather than guessing.
 */

/** The text elements a variant's copy may be written into, as the SEO fixes read them. */
const TEXT_COMPONENTS: ReadonlySet<string> = new Set(['muiTypography', 'muiInlineText', 'muiListItemText'])

const HEADING = /^h[1-6]$/

type StoredNode = Record<string, unknown> & { props?: Record<string, unknown>; nodes?: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export interface AiExperimentVariantCopy {
  headline: string
  body: string
}

export interface AiExperimentVariantCopyResult {
  nodes: Record<string, StoredNode>
  /** Which of the two the copy changed. */
  changed: Array<'headline' | 'body'>
  /** Why nothing changed, when nothing did; customer-safe. */
  reason: string | null
}

/** A text element's own plain text, or `null` for one a variant may not rewrite. */
function plainText(node: StoredNode | undefined): string | null {
  if (!node || !TEXT_COMPONENTS.has(String(node['componentId']))) return null
  const props = isRecord(node.props) ? node.props : {}
  if (typeof props['html'] === 'string' && props['html'].trim()) return null
  return typeof props['children'] === 'string' ? props['children'] : null
}

function isHeading(node: StoredNode): boolean {
  const props = isRecord(node.props) ? node.props : {}
  return HEADING.test(String(props['component'] ?? '')) || HEADING.test(String(props['variant'] ?? ''))
}

/** The region's elements in document order, the region's root first. */
function walk(nodes: Record<string, StoredNode>, rootId: string): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id) || !nodes[id]) return
    seen.add(id)
    order.push(id)
    const children = Array.isArray(nodes[id].nodes) ? (nodes[id].nodes as unknown[]) : []
    for (const child of children) if (typeof child === 'string') visit(child)
  }
  visit(rootId)
  return order
}

const line = (value: string, limit: number) => value.replace(/\s+/g, ' ').trim().slice(0, limit).trim()

/** Put one variant's copy into a copy of `nodes`, inside the region rooted at `regionRootId`. */
export function applyAiExperimentVariantCopy(
  nodes: Record<string, unknown>,
  copy: AiExperimentVariantCopy,
  regionRootId: string | null,
): AiExperimentVariantCopyResult {
  const result = JSON.parse(JSON.stringify(nodes)) as Record<string, StoredNode>
  if (!regionRootId || !result[regionRootId]) {
    return { nodes: result, changed: [], reason: 'The part of the page under test is no longer there.' }
  }
  const order = walk(result, regionRootId)
  const headline = line(copy.headline, AI_TEXT_LIMITS.headline)
  const body = copy.body.replace(/\r\n?/g, '\n').trim().slice(0, AI_TEXT_LIMITS.body).trim()
  const changed: AiExperimentVariantCopyResult['changed'] = []

  const headingAt = order.findIndex((id) => plainText(result[id]) !== null && isHeading(result[id]))
  if (headline && headingAt >= 0) {
    const node = result[order[headingAt]]
    node.props = { ...(node.props ?? {}), children: headline }
    changed.push('headline')
  }
  // The body is the first plain text after the heading, or in the region when it has none.
  const bodyAt = order.findIndex(
    (id, index) => index > headingAt && plainText(result[id]) !== null && !isHeading(result[id]),
  )
  if (body && bodyAt >= 0) {
    const node = result[order[bodyAt]]
    node.props = { ...(node.props ?? {}), children: body }
    changed.push('body')
  }
  return {
    nodes: result,
    changed,
    reason: changed.length ? null : 'This part of the page has no plain heading or text for the variant’s copy.',
  }
}
