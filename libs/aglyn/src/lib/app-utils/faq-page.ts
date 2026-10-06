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

/**
 * `FAQPage` structured data for a published page (AGL-3574).
 *
 * ## Why the page's NODES are the input
 *
 * A FAQ is the block search engines and AI assistants quote, and nothing
 * about the page records that one is there except the nodes an author placed:
 * no screen field, no collection, no host setting. So this reads the composed
 * node map the way `pageVideoObjects` (`video-object.ts`, AGL-2747) reads it
 * for `VideoObject`, and for the same reason — it is the only record.
 *
 * ⚠️ The composed map is **denormalized and flat**: `Record<string, node>`
 * whose children are id STRINGS under `nodes`, never a nested `children`
 * array. Every walk here follows those id lists.
 *
 * ## What counts as a FAQ
 *
 * A `section` element whose accessible label says so — `FAQ`, `FAQs`,
 * `Pricing FAQ`, `Frequently asked questions`. The label is the one thing an
 * author writes that names the block's purpose rather than its layout, and a
 * site built from the default template, by Aglyn AI or by hand all set it,
 * because the Section element asks for it. Nothing else is inferred: a grid
 * of two-line cards in a section called `Features` is not a FAQ, however much
 * it looks like one, and a wrong `FAQPage` is a rich-result error reported
 * against the page rather than a smaller win.
 *
 * Inside that section the pairs are read from two shapes, which between them
 * cover how the block is built on every live page:
 *
 * - **A container of pairs.** Any node with two or more children where EVERY
 *   child holds exactly two text-bearing nodes: the first is the question, the
 *   second the answer. That is a grid of two-line stacks, a column of two-line
 *   sections, a list of two-line boxes — the wrapper's element does not
 *   matter, the shape does. A heading and a lede beside the list never match,
 *   because a heading holds one text, and the section that holds both the
 *   heading and the list never matches, because the heading is one of its
 *   children.
 * - **Accordions.** A `muiAccordion` is a question and an answer by
 *   construction: its summary's text is the question, and the first text under
 *   its details is the answer. Read on its own terms so an answer of two
 *   paragraphs still publishes its first one.
 *
 * ## Why an incomplete block is not emitted
 *
 * Google asks for a real list, so a single pair is withheld rather than
 * published as a one-question page, the way `breadcrumbListJsonLd` declines a
 * single-crumb list. A binding token nothing resolved (`{{entry.title}}`) is a
 * marker, not a sentence, so it is removed before a pair is judged, and a pair
 * that is empty on either side once it is gone is dropped. The list is capped
 * at {@link FAQ_PAGE_MAX_QUESTIONS}: a page that asks more is a help center,
 * and the first fifty are the ones the author put first.
 */

import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import type { AglynNodeSchema, NodeId } from '../foundation'
import { collectDescendantIds } from './compose-reusable-components'

/** Component id of the Section element. Persisted in documents; never renamed. */
export const SECTION_COMPONENT_ID = 'section'

/** Component ids of the Accordion element and its two fixed children. */
export const ACCORDION_COMPONENT_ID = 'muiAccordion'
export const ACCORDION_SUMMARY_COMPONENT_ID = 'muiAccordionSummary'
export const ACCORDION_DETAILS_COMPONENT_ID = 'muiAccordionDetails'

/** Fewer pairs than this is not a list, and `FAQPage` describes a list. */
export const FAQ_PAGE_MIN_QUESTIONS = 2

/** More pairs than this is a help center; the author's first fifty are kept. */
export const FAQ_PAGE_MAX_QUESTIONS = 50

/**
 * The accessible labels that name a FAQ block: the word on its own or at
 * either end of a longer label (`FAQ`, `FAQs`, `Pricing FAQ`), or the phrase
 * spelled out.
 */
const FAQ_LABEL = /\bfaqs?\b|frequently asked/i

/** A binding token that nothing resolved — `{{entry.title}}`, `{{var:…}}`. */
const UNRESOLVED_TOKEN = /\{\{[^{}]*\}\}/g

/** A node as the composed map holds it — flat, children by id. */
interface ComposedNode {
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
  nodes?: unknown
}

type ComposedNodes = Record<string, unknown>

/** One question and its answer, both already cleaned and non-empty. */
type Pair = [question: string, answer: string]

const nodeAt = (nodes: ComposedNodes, id: string): ComposedNode | undefined => {
  const node = nodes[id]
  return node && typeof node === 'object' ? (node as ComposedNode) : undefined
}

/** The child ids a node lists, in document order; nothing for a leaf. */
const childIds = (node: ComposedNode | undefined): string[] =>
  Array.isArray(node?.nodes)
    ? (node.nodes as unknown[]).filter(
        (id): id is string => typeof id === 'string',
      )
    : []

/**
 * The text a node carries, before cleaning, or `undefined` for a node that
 * carries none. `resolvedProps` wins field by field: a node inside a repeated
 * collection holds its bound sentence only in the resolved copy, and the raw
 * `props` there still hold the token.
 */
const rawText = (node: ComposedNode | undefined): string | undefined => {
  const value = node?.resolvedProps?.['children'] ?? node?.props?.['children']
  return typeof value === 'string' ? value : undefined
}

/** Unresolved tokens removed, whitespace collapsed, ends trimmed. */
const cleanText = (value: string | undefined): string =>
  (value ?? '').replace(UNRESOLVED_TOKEN, '').replace(/\s+/g, ' ').trim()

/**
 * The text-bearing nodes under `id` (inclusive), in document order, stopping
 * once `limit` have been found — a pair holder is judged on whether it holds
 * exactly two, so a third ends the question.
 */
const textNodesUnder = (
  nodes: ComposedNodes,
  id: string,
  limit: number,
): ComposedNode[] => {
  const found: ComposedNode[] = []
  const seen = new Set<string>()
  const stack: string[] = [id]
  while (stack.length && found.length < limit) {
    const current = stack.pop() as string
    if (seen.has(current)) continue
    seen.add(current)
    const node = nodeAt(nodes, current)
    if (!node) continue
    if (rawText(node) !== undefined) found.push(node)
    // Pushed reversed so the stack pops children in document order.
    const children = childIds(node)
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push(children[index])
    }
  }
  return found
}

/** A node holding exactly two texts is a question over an answer. */
const pairFromHolder = (nodes: ComposedNodes, id: string): Pair | undefined => {
  const texts = textNodesUnder(nodes, id, 3)
  if (texts.length !== 2) return undefined
  const question = cleanText(rawText(texts[0]))
  const answer = cleanText(rawText(texts[1]))
  return question && answer ? [question, answer] : undefined
}

/**
 * Whether every child of `node` holds exactly two texts — the container-of-
 * pairs shape. Two children at least: a lone wrapper around one two-line
 * stack is the stack's parent, not a list, and reading it as one would count
 * the same pair twice. An accordion child hands the whole container to the
 * accordion reading, which knows which of its texts is the answer.
 */
const isPairContainer = (nodes: ComposedNodes, node: ComposedNode): boolean => {
  const children = childIds(node).filter((id) => nodeAt(nodes, id))
  if (children.length < FAQ_PAGE_MIN_QUESTIONS) return false
  return children.every((id) => {
    const child = nodeAt(nodes, id)
    return (
      child?.componentId !== ACCORDION_COMPONENT_ID &&
      textNodesUnder(nodes, id, 3).length === 2
    )
  })
}

/**
 * The first text under `id` (inclusive), cleaned — the summary's own label, or
 * the first paragraph of the details.
 */
const firstTextUnder = (nodes: ComposedNodes, id: string): string =>
  cleanText(rawText(textNodesUnder(nodes, id, 1)[0]))

/** An accordion's summary asks, and its details answer. */
const pairFromAccordion = (
  nodes: ComposedNodes,
  node: ComposedNode,
): Pair | undefined => {
  const children = childIds(node)
  const summaryId = children.find(
    (id) => nodeAt(nodes, id)?.componentId === ACCORDION_SUMMARY_COMPONENT_ID,
  )
  const detailsId = children.find(
    (id) => nodeAt(nodes, id)?.componentId === ACCORDION_DETAILS_COMPONENT_ID,
  )
  if (!summaryId || !detailsId) return undefined
  const question = firstTextUnder(nodes, summaryId)
  const answer = firstTextUnder(nodes, detailsId)
  return question && answer ? [question, answer] : undefined
}

/**
 * Every pair under one FAQ section, in document order, appended to `pairs`
 * until the cap. A matched container or accordion is not descended into: its
 * pairs are read once, by the reading that matched it.
 */
const collectPairs = (
  nodes: ComposedNodes,
  sectionId: string,
  pairs: Pair[],
): void => {
  const seen = new Set<string>([sectionId])
  const stack: string[] = [...childIds(nodeAt(nodes, sectionId))].reverse()
  while (stack.length && pairs.length < FAQ_PAGE_MAX_QUESTIONS) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodeAt(nodes, id)
    if (!node) continue
    if (node.componentId === ACCORDION_COMPONENT_ID) {
      const pair = pairFromAccordion(nodes, node)
      if (pair) pairs.push(pair)
      continue
    }
    if (isPairContainer(nodes, node)) {
      for (const childId of childIds(node)) {
        if (pairs.length >= FAQ_PAGE_MAX_QUESTIONS) break
        const pair = pairFromHolder(nodes, childId)
        if (pair) pairs.push(pair)
      }
      continue
    }
    const children = childIds(node)
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push(children[index])
    }
  }
}

/** Whether a node is a Section element whose accessible label names a FAQ. */
export const isFaqSection = (node: unknown): boolean => {
  const composed = node as ComposedNode | null | undefined
  if (composed?.componentId !== SECTION_COMPONENT_ID) return false
  const label =
    composed.resolvedProps?.['ariaLabel'] ?? composed.props?.['ariaLabel']
  return typeof label === 'string' && FAQ_LABEL.test(label)
}

/**
 * The one `FAQPage` for a page, or `null` — the common case — for a page with
 * no FAQ section, a FAQ that resolves to fewer than two pairs, and a page with
 * no nodes at all. The route then emits no extra script.
 *
 * Several FAQ sections on one page merge into one block, in page order: a
 * crawler reads one `FAQPage` per page, and two would be read as a conflict.
 *
 * ⚠️ Hand this the map the page actually SHIPS, not the one the loader read.
 *
 * ## Only the sections the page draws
 *
 * Being in the map is not being on the page. The renderer starts at
 * {@link NODE_ROOT_ID} and follows child id lists, and nothing else, so a node
 * no list names is carried in the payload and never drawn — the template a
 * collection expansion or a dataset repeater leaves beside its clones, with
 * its literal `{{entry.title}}` tokens still in it (AGL-2957). So when the map
 * has a root, a section counts only if a child list reaches it from there. A
 * map with no root is a fragment with no entry point to measure reach from,
 * and keeps the whole-map walk.
 *
 * The reach is computed only for a map that holds a FAQ section at all, so a
 * page without one costs a single pass over its values and no walk.
 */
export function pageFaqPage(
  nodes: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!nodes) return null
  const sectionIds: string[] = []
  for (const id in nodes) {
    if (isFaqSection(nodes[id])) sectionIds.push(id)
  }
  if (!sectionIds.length) return null
  const drawn = nodes[NODE_ROOT_ID]
    ? collectDescendantIds(
        nodes as Record<NodeId, AglynNodeSchema>,
        NODE_ROOT_ID,
      )
    : undefined
  const pairs: Pair[] = []
  for (const id of sectionIds) {
    if (pairs.length >= FAQ_PAGE_MAX_QUESTIONS) break
    if (drawn && id !== NODE_ROOT_ID && !drawn.has(id)) continue
    collectPairs(nodes, id, pairs)
  }
  if (pairs.length < FAQ_PAGE_MIN_QUESTIONS) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.slice(0, FAQ_PAGE_MAX_QUESTIONS).map(([name, text]) => ({
      '@type': 'Question',
      name,
      acceptedAnswer: { '@type': 'Answer', text },
    })),
  }
}
